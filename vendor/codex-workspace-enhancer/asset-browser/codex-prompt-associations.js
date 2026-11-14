import { constants, createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { hasSameCharacterInstruction } from "./character-associations.js";

const MEDIA_EXTENSIONS = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif"]),
  video: new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]),
};
const MAX_PROMPT_SIDECAR_BYTES = 256 * 1024;
const MAX_SIBLING_ENTRIES = 12000;

function mediaKind(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return Object.entries(MEDIA_EXTENSIONS).find(([, extensions]) => extensions.has(extension))?.[0] || "";
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanString).filter(Boolean))];
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (["ENOENT", "EISDIR"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readPromptSidecar(filePath) {
  const stat = await fs.lstat(filePath).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat?.isFile() || !stat.size || stat.size > MAX_PROMPT_SIDECAR_BYTES) return null;
  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > MAX_PROMPT_SIDECAR_BYTES) return null;
    const buffer = Buffer.alloc(MAX_PROMPT_SIDECAR_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (!bytesRead || bytesRead > MAX_PROMPT_SIDECAR_BYTES) return null;
    const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    return source.includes("\u0000") ? null : source;
  } catch (error) {
    if (["ENOENT", "EISDIR", "ELOOP"].includes(error.code) || error instanceof TypeError) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function portableBasename(name) {
  return cleanString(name).replace(/^[\x60"“]|[\x60"”]$/g, "").split(/[\\/]/).at(-1);
}

// A shared legacy stem is not sufficient to distinguish e.g. shot.png and shot.mp4.
async function stemMatchesAsset(assetPath, outputs = []) {
  const basename = path.basename(assetPath);
  const names = outputs.map(portableBasename).filter(Boolean);
  if (names.length) return names.every(name => name === basename);
  const stem = path.parse(basename).name.toLowerCase();
  const directory = await fs.opendir(path.dirname(assetPath));
  let inspected = 0;
  for await (const entry of directory) {
    if (++inspected > MAX_SIBLING_ENTRIES) return false;
    if (entry.name !== basename && mediaKind(entry.name) && path.parse(entry.name).name.toLowerCase() === stem
      && (entry.isFile() || entry.isSymbolicLink())) return false;
  }
  return true;
}

function promptText(value) {
  const result = cleanString(value);
  return /^(?:[（(]?(?:未登记|无)[）)]?|[-—]+)$/u.test(result) ? "" : result;
}

function parseMarkdownPrompt(source) {
  const lines = source.split(/\r?\n/);
  const fields = {};
  const sections = {};
  let section = "";
  let fence;
  for (const line of lines) {
    const fenceMatch = /^\s{0,3}([\x60~]{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
    }
    const heading = fence || fenceMatch ? "" : /^#{1,3}[ \t]+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    const key =
      /^(?:正向提示词(?:\s*[/／]\s*Prompt)?|提示词|Prompt|Positive Prompt)$/iu.test(heading) ? "prompt"
      : /^(?:负向提示词(?:\s*[/／]\s*.+)?|Negative Prompt)$/iu.test(heading) ? "negativePrompt"
        : /^(?:参考素材|参考资料|References)$/iu.test(heading) ? "references"
          : heading === "生成参数" ? "settings"
            : heading === "备注" ? "notes" : "";
    if (key && !Object.hasOwn(sections, key)) {
      section = key;
      sections[key] = [];
      continue;
    }
    if (section) {
      sections[section].push(line);
    } else if (!fence) {
      const metadata = /^\s*[-*]\s*(结果文件|生成工具|模型|任务创建)\s*[:：]\s*(.+)$/u.exec(line);
      if (metadata && !Object.hasOwn(fields, metadata[1])) fields[metadata[1]] = metadata[2].trim();
    }
  }
  const structured = Object.keys(sections).length > 0 || /^\s*#\s*生成提示词与结果记录(?:\s|$)/u.test(source);
  const prompt = promptText(structured ? sections.prompt?.join("\n") : source);
  const references = (sections.references || []).flatMap(line => /^\s*[-*]\s+(.+)$/.exec(line)?.[1] || [])
    .filter(item => item !== "无登记参考素材");
  let settings;
  try { settings = JSON.parse((sections.settings || []).join("\n").trim().replace(/^\x60{3}json\s*|\s*\x60{3}$/gi, "")); } catch {}
  return {
    prompt,
    negativePrompt: promptText(sections.negativePrompt?.join("\n")),
    references,
    settings,
    generator: promptText(fields.生成工具),
    model: promptText(fields.模型),
    createdAt: fields.任务创建,
    result: fields.结果文件,
  };
}

function normalizeAssociation(value = {}, fallbackPath = "") {
  const rawPath = cleanString(value.assetPath || fallbackPath);
  if (!rawPath) return null;
  const assetPath = path.resolve(rawPath);
  const kind = mediaKind(assetPath) || cleanString(value.kind);
  if (!assetPath || !["image", "video", "audio"].includes(kind)) return null;
  return {
    assetPath,
    kind,
    prompt: cleanString(value.prompt),
    negativePrompt: cleanString(value.negativePrompt),
    references: uniqueStrings(value.references),
    settings: value.settings && typeof value.settings === "object" && !Array.isArray(value.settings) ? value.settings : {},
    generator: cleanString(value.generator),
    model: cleanString(value.model),
    threadId: cleanString(value.threadId),
    cwd: cleanString(value.cwd),
    source: cleanString(value.source) || "manual-registration",
    sourceCallId: cleanString(value.sourceCallId),
    sessionPath: cleanString(value.sessionPath),
    createdAt: cleanString(value.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function outputPathFromEvent(payload, context, kind) {
  const candidates = [
    payload.output_path,
    payload.outputPath,
    payload.saved_path,
    payload.savedPath,
    payload.path,
    payload.result && typeof payload.result === "object" ? payload.result.path || payload.result.saved_path : "",
  ].map(cleanString).filter(Boolean);
  const explicit = candidates.find((candidate) => path.isAbsolute(candidate) && mediaKind(candidate) === kind);
  if (explicit) return path.resolve(explicit);
  if (kind !== "image" || !context.sessionId || !payload.call_id) return "";
  return path.resolve(context.generatedImagesRoot, context.sessionId, `${payload.call_id}.png`);
}

function associationFromEvent(event, context) {
  const payload = event?.payload || {};
  const match = cleanString(payload.type).match(/^(image|video|audio)_generation_end$/);
  if (!match || payload.status && payload.status !== "completed") return null;
  const kind = match[1];
  const assetPath = outputPathFromEvent(payload, context, kind);
  const prompt = cleanString(payload.revised_prompt || payload.prompt || payload.input_prompt);
  if (!assetPath || !prompt) return null;
  return normalizeAssociation({
    assetPath,
    kind,
    prompt,
    negativePrompt: payload.negative_prompt,
    references: payload.references,
    generator: `codex-${kind}`,
    model: payload.model,
    threadId: context.sessionId,
    cwd: context.cwd,
    source: "codex-session",
    sourceCallId: payload.call_id,
    sessionPath: context.sessionPath,
    createdAt: event.timestamp,
  });
}

async function listRecentJsonl(root, cutoffMs) {
  const results = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs >= cutoffMs) results.push({ filePath, stats });
      }
    }
  }
  await walk(root);
  return results.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
}

async function endsWithNewline(filePath, size) {
  if (!size) return true;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 10;
  } finally {
    await handle.close();
  }
}

function associationFromSidecar(assetPath, data) {
  const ticket = data?.ticket || data?.association || data;
  if (!ticket || typeof ticket !== "object") return null;
  const prompt = cleanString(ticket.prompt);
  if (!prompt) return null;
  return normalizeAssociation({
    assetPath,
    kind: ticket.kind,
    prompt,
    negativePrompt: ticket.negativePrompt,
    references: ticket.references,
    settings: ticket.settings,
    generator: ticket.generator,
    model: ticket.model,
    threadId: ticket.sourceContext?.threadId || ticket.threadId,
    cwd: ticket.sourceContext?.cwd,
    source: "generation-sidecar",
    sourceCallId: ticket.sourceContext?.callId,
    createdAt: ticket.createdAt,
  });
}

export class CodexPromptAssociationStore {
  constructor({
    registryPath,
    sessionsRoot = path.join(os.homedir(), ".codex", "sessions"),
    generatedImagesRoot = path.join(os.homedir(), ".codex", "generated_images"),
    lookbackDays = 14,
  }) {
    this.registryPath = path.resolve(registryPath);
    this.sessionsRoot = path.resolve(sessionsRoot);
    this.generatedImagesRoot = path.resolve(generatedImagesRoot);
    this.lookbackDays = Math.max(1, Number(lookbackDays) || 14);
    this.cache = null;
    this.mutation = Promise.resolve();
  }

  async readRegistry() {
    if (this.cache) return this.cache;
    const data = await readJson(this.registryPath);
    this.cache = {
      version: 1,
      sessions: data?.sessions && typeof data.sessions === "object" ? data.sessions : {},
      associations: data?.associations && typeof data.associations === "object" ? data.associations : {},
    };
    return this.cache;
  }

  async writeRegistry(registry) {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.registryPath);
    this.cache = registry;
  }

  withMutation(operation) {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  async register(input) {
    return await this.withMutation(async () => {
      const association = normalizeAssociation(input);
      if (!association || !association.prompt) throw new Error("关联提示词时必须提供有效的媒体文件和提示词");
      const registry = await this.readRegistry();
      registry.associations[association.assetPath] = association;
      await this.writeRegistry(registry);
      return association;
    });
  }

  async relocate(previousPath, nextPath) {
    return await this.withMutation(async () => {
      const previous = path.resolve(previousPath);
      const next = path.resolve(nextPath);
      const registry = await this.readRegistry();
      const association = registry.associations[previous];
      if (!association) return null;
      const relocated = normalizeAssociation({ ...association, assetPath: next }, next);
      delete registry.associations[previous];
      registry.associations[next] = relocated;
      await this.writeRegistry(registry);
      return relocated;
    });
  }

  async remove(assetPath) {
    return await this.withMutation(async () => {
      const resolvedPath = path.resolve(assetPath);
      const registry = await this.readRegistry();
      if (!registry.associations[resolvedPath]) return false;
      delete registry.associations[resolvedPath];
      await this.writeRegistry(registry);
      return true;
    });
  }

  async get(assetPath) {
    const resolvedPath = path.resolve(assetPath);
    const registry = await this.readRegistry();
    const stored = registry.associations[resolvedPath];
    if (stored?.prompt) return normalizeAssociation(stored, resolvedPath);
    const extension = path.extname(resolvedPath);
    if (!mediaKind(resolvedPath) || !extension) return null;
    const stem = resolvedPath.slice(0, -extension.length);
    const sidecar = await readJson(stem + ".meta.json");
    const json = associationFromSidecar(resolvedPath, sidecar);
    if (json) return json;

    for (const [file, shared] of [[resolvedPath + ".prompt.md", false], [stem + ".prompt.md", true]]) {
      const source = await readPromptSidecar(file);
      if (!source) continue;
      const { result, ...content } = parseMarkdownPrompt(source);
      if (!content.prompt) continue;
      if ((result || shared) && !await stemMatchesAsset(resolvedPath, [result])) continue;
      return normalizeAssociation({ ...content, assetPath: resolvedPath, source: "markdown-sidecar" });
    }
    return null;
  }

  async summary(assetPath) {
    const association = await this.get(assetPath);
    if (!association) return { available: false };
    const references = association.references.filter(p => mediaKind(p) === "image").slice(0, 30);
    const characterName = association.prompt.match(/(?:角色名|人物名|character\s*name)\s*[:：=]\s*["“]?([^\n,，。;；"”]{1,40})/iu)?.[1]?.trim() || "";
    return {
      available: true,
      source: association.source,
      kind: association.kind,
      generator: association.generator,
      model: association.model,
      threadId: association.threadId,
      ...(references.length ? { references } : {}),
      ...(characterName ? { characterName } : {}),
      ...(hasSameCharacterInstruction(association.prompt) ? { sameCharacter: true } : {}),
    };
  }

  async syncCodexSessions() {
    return await this.withMutation(async () => {
      const registry = await this.readRegistry();
      const files = await listRecentJsonl(this.sessionsRoot, Date.now() - this.lookbackDays * 86400000);
      let imported = 0;
      const importedAssociations = [];
      let inspected = 0;
      let changed = false;
      for (const { filePath, stats } of files) {
        const previous = registry.sessions[filePath] || {};
        const offset = Number(previous.offset) <= stats.size ? Number(previous.offset) || 0 : 0;
        if (offset === stats.size || !await endsWithNewline(filePath, stats.size)) continue;
        const context = {
          sessionId: cleanString(previous.sessionId),
          cwd: cleanString(previous.cwd),
          sessionPath: filePath,
          generatedImagesRoot: this.generatedImagesRoot,
        };
        const stream = createReadStream(filePath, { start: offset, end: stats.size - 1, encoding: "utf8" });
        const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "session_meta") {
            context.sessionId = cleanString(event.payload?.id || event.payload?.session_id || context.sessionId);
            context.cwd = cleanString(event.payload?.cwd || context.cwd);
            continue;
          }
          const association = associationFromEvent(event, context);
          if (!association || !await exists(association.assetPath)) continue;
          const current = registry.associations[association.assetPath];
          if (current?.source === "manual-registration") continue;
          registry.associations[association.assetPath] = association;
          if (!current) {
            imported += 1;
            importedAssociations.push(association);
          }
          changed = true;
        }
        registry.sessions[filePath] = {
          offset: stats.size,
          mtimeMs: stats.mtimeMs,
          sessionId: context.sessionId,
          cwd: context.cwd,
        };
        inspected += 1;
        changed = true;
      }
      if (changed) await this.writeRegistry(registry);
      return { imported, inspected, importedAssociations, associations: Object.values(registry.associations) };
    });
  }
}

export { associationFromEvent, mediaKind };
