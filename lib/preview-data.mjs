import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractPreviewTags } from "./card-view.mjs";
import { parseRateLimitLines } from "./usage-data.mjs";

const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DEFAULT_MAX_TAIL_BYTES = 8 * 1024 * 1024;

function timestampValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && (item.type === "input_text" || item.type === "output_text"))
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

export function cleanPreviewText(value, { user = false } = {}) {
  let text = String(value || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, " ")
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, " ")
    .replace(/```[\s\S]*?```/g, " [代码] ");

  if (user) {
    const requestMarker = text.match(/(?:^|\n)##?\s*My request:\s*\n?/i);
    if (requestMarker?.index != null) {
      text = text.slice(requestMarker.index + requestMarker[0].length);
    }
    text = text.replace(/(?:^|\n)#\s*Files mentioned by the user:[\s\S]*?(?=\n#|$)/gi, " ");
  }

  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(value, maxLength = 360) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function coreSummary(value, fallback = "暂无可用总结") {
  const text = cleanPreviewText(value);
  if (!text) return fallback;
  const sentence = text.match(/^.{12,90}?[。！？!?]/)?.[0] || text;
  return truncateText(sentence, 96);
}

function eventCandidate(entry) {
  const time = timestampValue(entry.timestamp);
  if (entry.type === "event_msg") {
    if (entry.payload?.type === "user_message") {
      return { kind: "user", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "agent_message") {
      return { kind: "assistant", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "task_complete") {
      return { kind: "complete", time, text: entry.payload.last_agent_message || "" };
    }
  }
  if (entry.type === "response_item" && entry.payload?.type === "message") {
    const text = contentText(entry.payload.content);
    if (entry.payload.role === "user") return { kind: "user-fallback", time, text };
    if (entry.payload.role === "assistant") return { kind: "assistant-fallback", time, text };
  }
  return null;
}

export function parsePreviewLines(lines, { title = "" } = {}) {
  const latest = new Map();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || (!line.includes('"event_msg"') && !line.includes('"response_item"'))) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const candidate = eventCandidate(entry);
    if (!candidate || !candidate.text) continue;
    if (!latest.has(candidate.kind)) latest.set(candidate.kind, candidate);
    if (latest.has("user") && latest.has("assistant") && latest.has("complete")) break;
  }

  const user = latest.get("user") || latest.get("user-fallback");
  const assistant = latest.get("assistant") || latest.get("assistant-fallback");
  const complete = latest.get("complete");
  const summarySource = complete && (!user || complete.time >= user.time)
    ? complete.text
    : assistant?.text || user?.text || title;

  return {
    summary: coreSummary(summarySource, title ? `围绕“${title}”的对话` : "暂无可用总结"),
    recentInput: truncateText(cleanPreviewText(user?.text, { user: true }), 520),
    recentOutput: truncateText(cleanPreviewText(assistant?.text || complete?.text), 520),
  };
}

async function tailLines(filePath, maxBytes = DEFAULT_MAX_TAIL_BYTES) {
  const fileStat = await stat(filePath);
  const length = Math.min(fileStat.size, maxBytes);
  const start = fileStat.size - length;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { lines: text.split("\n"), fileStat };
  } finally {
    await handle.close();
  }
}

async function walkSessionFiles(root, result) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSessionFiles(entryPath, result);
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
    const threadId = entry.name.match(THREAD_ID_PATTERN)?.[1]?.toLowerCase();
    if (threadId) result.set(threadId, entryPath);
  }));
}

export class PreviewRepository {
  constructor({
    codexHome = path.join(os.homedir(), ".codex"),
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
  } = {}) {
    this.codexHome = codexHome;
    this.sessionsRoot = path.join(codexHome, "sessions");
    this.sessionIndexPath = path.join(codexHome, "session_index.jsonl");
    this.maxTailBytes = maxTailBytes;
    this.filesById = new Map();
    this.idsByTitle = new Map();
    this.metadataById = new Map();
    this.cache = new Map();
    this.indexed = false;
  }

  async refreshIndex() {
    const files = new Map();
    await walkSessionFiles(this.sessionsRoot, files);
    this.filesById = files;

    const idsByTitle = new Map();
    const metadataById = new Map();
    try {
      const content = await readFile(this.sessionIndexPath, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const id = String(row.id || "").toLowerCase();
          const title = String(row.thread_name || "").trim();
          if (!THREAD_ID_PATTERN.test(id) || !title) continue;
          const existing = idsByTitle.get(title);
          const updatedAt = timestampValue(row.updated_at);
          if (!existing || updatedAt >= existing.updatedAt) {
            idsByTitle.set(title, { id, updatedAt });
          }
          const existingMetadata = metadataById.get(id);
          if (!existingMetadata || updatedAt >= existingMetadata.updatedAtMs) {
            metadataById.set(id, {
              title,
              updatedAtMs: updatedAt,
              updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
            });
          }
        } catch {}
      }
    } catch {}
    this.idsByTitle = idsByTitle;
    this.metadataById = metadataById;
    this.indexed = true;
  }

  async ensureIndex() {
    if (!this.indexed) await this.refreshIndex();
  }

  resolveThreadId(rawId, title = "") {
    const normalized = String(rawId || "").replace(/^(?:local|cloud):/i, "").toLowerCase();
    if (THREAD_ID_PATTERN.test(normalized) && this.filesById.has(normalized)) return normalized;
    return this.idsByTitle.get(String(title || "").trim())?.id || null;
  }

  async readPreview(rawId, title = "") {
    await this.ensureIndex();
    let threadId = this.resolveThreadId(rawId, title);
    if (!threadId) {
      await this.refreshIndex();
      threadId = this.resolveThreadId(rawId, title);
    }
    if (!threadId) {
      return {
        threadId: null,
        summary: title ? `围绕“${title}”的对话` : "暂无可用总结",
        recentInput: "",
        recentOutput: "",
        updatedAt: null,
        tags: extractPreviewTags({ title }),
      };
    }

    const filePath = this.filesById.get(threadId);
    if (!filePath) return null;
    const currentStat = await stat(filePath);
    const metadata = this.metadataById.get(threadId);
    const updatedAt = metadata?.updatedAt || new Date(currentStat.mtimeMs).toISOString();
    const cacheKey = `${currentStat.size}:${currentStat.mtimeMs}:${updatedAt}`;
    const cached = this.cache.get(threadId);
    if (cached?.cacheKey === cacheKey && cached.preview) return cached.preview;

    const { lines } = await tailLines(filePath, this.maxTailBytes);
    const preview = { threadId, ...parsePreviewLines(lines, { title }), updatedAt };
    if (!preview.recentInput && cached?.preview?.recentInput) {
      preview.recentInput = cached.preview.recentInput;
    }
    preview.tags = extractPreviewTags({ title, ...preview });
    this.cache.set(threadId, { cacheKey, preview, usage: parseRateLimitLines(lines) });
    return preview;
  }

  async readMany(requests) {
    const unique = requests.slice(0, 200);
    return Promise.all(unique.map(async (request) => ({
      key: String(request.key || ""),
      ...(await this.readPreview(request.id, request.title)),
    })));
  }

  async readUsage() {
    await this.ensureIndex();
    const candidates = Array.from(this.metadataById.entries())
      .filter(([threadId]) => this.filesById.has(threadId))
      .sort((left, right) => right[1].updatedAtMs - left[1].updatedAtMs);
    for (const [threadId] of candidates.slice(0, 12)) {
      const cached = this.cache.get(threadId);
      if (cached?.usage) return cached.usage;
      try {
        const { lines } = await tailLines(this.filesById.get(threadId), this.maxTailBytes);
        const usage = parseRateLimitLines(lines);
        if (usage) return usage;
      } catch {}
    }
    return null;
  }
}
