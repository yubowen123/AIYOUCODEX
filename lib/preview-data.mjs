import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractPreviewTags } from "./card-view.mjs";
import { parseRateLimitLines } from "./usage-data.mjs";

const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DEFAULT_MAX_TAIL_BYTES = 8 * 1024 * 1024;
const RECENT_ACTIVITY_REFINE_LIMIT = 80;
const INTERRUPTION_TAIL_BYTES = 2 * 1024 * 1024;
const PASSIVE_INTERRUPTION_IDLE_MS = 2 * 60 * 1000;
const SESSION_HEADER_BYTES = 128 * 1024;
const CATALOG_METADATA_CONCURRENCY = 16;

function timestampValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedWorkspacePath(value) {
  let normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(normalized)) normalized = normalized.toLocaleLowerCase();
  return normalized;
}

function projectForWorkspace(projects, workspacePath) {
  const workspace = normalizedWorkspacePath(workspacePath);
  if (!workspace) return null;
  const candidates = [];
  for (const [projectId, project] of Object.entries(projects || {})) {
    for (const rootPath of Array.isArray(project?.rootPaths) ? project.rootPaths : []) {
      const root = normalizedWorkspacePath(rootPath);
      if (!root || (workspace !== root && !workspace.startsWith(`${root}/`))) continue;
      candidates.push({ projectId, project, specificity: root.length });
    }
  }
  if (!candidates.length) return null;
  const specificity = Math.max(...candidates.map((candidate) => candidate.specificity));
  const mostSpecific = candidates.filter((candidate) => candidate.specificity === specificity);
  const projectIds = new Set(mostSpecific.map((candidate) => candidate.projectId));
  return projectIds.size === 1 ? mostSpecific[0] : null;
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readSessionWorkspace(filePath) {
  if (!filePath) return "";
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8");
    const match = header.match(/"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!match) return "";
    try { return JSON.parse(`"${match[1]}"`); } catch { return ""; }
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
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
  const activityAtMs = Math.max(0, ...Array.from(latest.values()).map((candidate) => candidate.time || 0));
  const summarySource = complete && (!user || complete.time >= user.time)
    ? complete.text
    : assistant?.text || user?.text || title;

  return {
    summary: coreSummary(summarySource, title ? `围绕“${title}”的对话` : "暂无可用总结"),
    recentInput: truncateText(cleanPreviewText(user?.text, { user: true }), 520),
    recentOutput: truncateText(cleanPreviewText(assistant?.text || complete?.text), 520),
    activityAt: activityAtMs ? new Date(activityAtMs).toISOString() : null,
  };
}

export function conversationDedupeKey({ title = "", recentInput = "", recentOutput = "" } = {}) {
  const content = cleanPreviewText([title, recentInput, recentOutput].filter(Boolean).join(" "))
    .normalize("NFKC")
    .toLocaleLowerCase();
  if (!/(?:安装|\binstall\b|skills?@latest\s+add|\badd\b)/i.test(content)) return "";
  const skillName = content.match(/--skill(?:=|\s+)([a-z0-9][a-z0-9._-]{1,63})/i)?.[1]
    || content.match(/(?:skill|技能)(?:名称)?\s*[：:]\s*([a-z0-9][a-z0-9._-]{1,63})/i)?.[1]
    || content.match(/(?:\.agents\/)?skills\/([a-z0-9][a-z0-9._-]{1,63})\/skill\.md/i)?.[1];
  return skillName ? `install-skill:${skillName.toLocaleLowerCase()}` : "";
}

export function parseInterruptionLines(lines) {
  let outcome = null;
  let startedAtMs = 0;
  let interruptedAtMs = 0;
  let activityAtMs = 0;
  for (const line of lines) {
    if (!line?.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const time = timestampValue(entry.timestamp);
    if (time) activityAtMs = Math.max(activityAtMs, time);
    if (entry.type !== "event_msg") continue;
    if (entry.payload?.type === "task_started") {
      outcome = "pending";
      startedAtMs = time;
      interruptedAtMs = 0;
    } else if (entry.payload?.type === "task_complete") {
      outcome = "complete";
      startedAtMs = 0;
      interruptedAtMs = 0;
    } else if (entry.payload?.type === "turn_aborted") {
      outcome = "interrupted";
      startedAtMs = 0;
      interruptedAtMs = time;
    }
  }
  if (outcome === "interrupted") {
    return { kind: "active", interruptedAtMs: interruptedAtMs || activityAtMs };
  }
  if (outcome === "pending") {
    return { kind: "passive", interruptedAtMs: activityAtMs || startedAtMs };
  }
  return null;
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
    this.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    this.maxTailBytes = maxTailBytes;
    this.filesById = new Map();
    this.idsByTitle = new Map();
    this.metadataById = new Map();
    this.cache = new Map();
    this.sessionWorkspaceById = new Map();
    this.searchCatalogCache = null;
    this.recentCatalogCache = null;
    this.interruptionCache = new Map();
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

    const metadata = this.metadataById.get(threadId);
    const filePath = this.filesById.get(threadId);
    if (!filePath) {
      return {
        threadId,
        summary: title ? `围绕“${title}”的对话` : "暂无可用总结",
        recentInput: "",
        recentOutput: "",
        updatedAt: metadata?.updatedAt || null,
        tags: extractPreviewTags({ title }),
      };
    }
    const currentStat = await stat(filePath);
    const indexedUpdatedAt = metadata?.updatedAt || new Date(currentStat.mtimeMs).toISOString();
    const cacheKey = `${currentStat.size}:${currentStat.mtimeMs}:${indexedUpdatedAt}`;
    const cached = this.cache.get(threadId);
    if (cached?.cacheKey === cacheKey && cached.preview) return cached.preview;

    const { lines } = await tailLines(filePath, this.maxTailBytes);
    const parsed = parsePreviewLines(lines, { title });
    const updatedAtMs = Math.max(timestampValue(indexedUpdatedAt), timestampValue(parsed.activityAt));
    const preview = {
      threadId,
      ...parsed,
      updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : null,
    };
    delete preview.activityAt;
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

  async readSearchCatalog() {
    return (await this.readRecentCatalog()).filter((item) => item.projectId && item.projectName);
  }

  async sessionWorkspace(threadId) {
    if (this.sessionWorkspaceById.has(threadId)) return this.sessionWorkspaceById.get(threadId);
    const workspacePath = await readSessionWorkspace(this.filesById.get(threadId));
    this.sessionWorkspaceById.set(threadId, workspacePath);
    return workspacePath;
  }

  async readRecentCatalog() {
    let indexStat;
    let stateStat = null;
    try {
      indexStat = await stat(this.sessionIndexPath);
    } catch {
      return [];
    }
    try { stateStat = await stat(this.globalStatePath); } catch {}
    const cacheKey = `${indexStat.size}:${indexStat.mtimeMs}:${stateStat?.size || 0}:${stateStat?.mtimeMs || 0}`;
    const cacheMatches = this.recentCatalogCache?.cacheKey === cacheKey;
    let items = cacheMatches ? this.recentCatalogCache.items : null;

    if (!this.indexed || !cacheMatches) await this.refreshIndex();

    if (!items) {
      let indexContent;
      let state = {};
      try {
        indexContent = await readFile(this.sessionIndexPath, "utf8");
      } catch {
        return [];
      }
      try { state = JSON.parse(await readFile(this.globalStatePath, "utf8")); } catch {}

      const projects = state?.["local-projects"] || {};
      const assignments = state?.["thread-project-assignments"] || {};
      const newestById = new Map();
      for (const line of indexContent.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const threadId = String(row.id || "").toLowerCase();
          const title = String(row.thread_name || "").trim();
          const updatedAtMs = timestampValue(row.updated_at);
          if (!THREAD_ID_PATTERN.test(threadId) || !title) continue;
          const current = newestById.get(threadId);
          if (!current || updatedAtMs >= current.updatedAtMs) {
            newestById.set(threadId, { threadId, title, updatedAtMs });
          }
        } catch {}
      }

      items = await mapWithConcurrency(Array.from(newestById.values()), CATALOG_METADATA_CONCURRENCY, async (thread) => {
        const assignment = assignments[thread.threadId];
        let projectId = String(assignment?.projectId || "");
        let projectName = String(projects[projectId]?.name || "").trim();
        if (!projectId || !projectName) {
          const inferred = projectForWorkspace(projects, await this.sessionWorkspace(thread.threadId));
          if (inferred) {
            projectId = inferred.projectId;
            projectName = String(inferred.project?.name || "").trim();
          }
        }
        return {
          threadId: thread.threadId,
          title: thread.title,
          updatedAt: thread.updatedAtMs ? new Date(thread.updatedAtMs).toISOString() : null,
          projectId,
          projectName,
        };
      });
      this.recentCatalogCache = { cacheKey, items };
    }

    const activeItems = await Promise.all(items.map(async (item) => {
      const filePath = this.filesById.get(item.threadId);
      if (!filePath) return item;
      try {
        const fileStat = await stat(filePath);
        const updatedAtMs = Math.max(timestampValue(item.updatedAt), fileStat.mtimeMs);
        return { ...item, updatedAt: new Date(updatedAtMs).toISOString() };
      } catch {
        return item;
      }
    }));
    activeItems.sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
    const refined = await Promise.all(activeItems.slice(0, RECENT_ACTIVITY_REFINE_LIMIT).map(async (item) => {
      try {
        const preview = await this.readPreview(`local:${item.threadId}`, item.title);
        const updatedAt = preview?.updatedAt || item.updatedAt;
        const dedupeKey = conversationDedupeKey({ title: item.title, ...preview });
        return dedupeKey ? { ...item, updatedAt, dedupeKey } : { ...item, updatedAt };
      } catch {
        return item;
      }
    }));
    const refinedById = new Map(refined.map((item) => [item.threadId, item]));
    return activeItems
      .map((item) => refinedById.get(item.threadId) || item)
      .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
  }

  async readInterruptedCatalog({
    nowMs = Date.now(),
    passiveIdleMs = PASSIVE_INTERRUPTION_IDLE_MS,
    activeThreadIds = [],
  } = {}) {
    const active = new Set(activeThreadIds.map((value) => String(value || "").replace(/^(?:local|cloud):/i, "").toLowerCase()));
    const recent = await this.readRecentCatalog();
    const interrupted = await Promise.all(recent.map(async (item) => {
      if (active.has(item.threadId)) return null;
      const filePath = this.filesById.get(item.threadId);
      if (!filePath) return null;
      try {
        const fileStat = await stat(filePath);
        const cacheKey = `${fileStat.size}:${fileStat.mtimeMs}`;
        let cached = this.interruptionCache.get(item.threadId);
        if (cached?.cacheKey !== cacheKey) {
          const { lines } = await tailLines(filePath, Math.min(this.maxTailBytes, INTERRUPTION_TAIL_BYTES));
          cached = { cacheKey, state: parseInterruptionLines(lines) };
          this.interruptionCache.set(item.threadId, cached);
        }
        const state = cached.state;
        if (!state) return null;
        if (state.kind === "passive" && nowMs - state.interruptedAtMs < passiveIdleMs) return null;
        return {
          ...item,
          updatedAt: state.interruptedAtMs ? new Date(state.interruptedAtMs).toISOString() : item.updatedAt,
          interruptionKind: state.kind,
          interruptionLabel: state.kind === "active" ? "主动中断" : "被动中断",
        };
      } catch {
        return null;
      }
    }));
    return interrupted
      .filter(Boolean)
      .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
  }

  async readPinnedThreadIds() {
    try {
      const state = JSON.parse(await readFile(this.globalStatePath, "utf8"));
      return [...new Set((Array.isArray(state?.["pinned-thread-ids"])
        ? state["pinned-thread-ids"]
        : [])
        .map((value) => String(value || "").replace(/^(?:local|cloud):/i, "").toLowerCase())
        .filter((value) => THREAD_ID_PATTERN.test(value)))];
    } catch {
      return [];
    }
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
