import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const OUTPUT_FIELDS = { image: ["inputImageUrls", "imageUrl"], video: ["inputVideoUrls", "videoUrl"], audio: ["inputAudioUrls", "audioUrl"] };
const SETTING_KEYS = [
  "aspectRatio", "resolution", "duration", "width", "height", "size", "quality",
  "seed", "batchSize", "generationType", "outputFormat", "bitrateMode", "fps",
  "style", "draft", "generateAudio", "soundId", "speed", "emotion", "tone", "volume",
  "pitch", "language", "sampleRate", "taskId", "createdAt", "createTime", "mediaSource",
];
const SIGNED_URL_PARAMS = /^(?:x-amz-.+|x-oss-.+|x-goog-.+|ossaccesskeyid|awsaccesskeyid|signature|expires|security-token|auth_key|q-sign-.+)$/i;

function findCli() {
  const home = os.homedir();
  const skills = [path.join(home, ".agents", "skills"), path.join(home, ".codex", "skills"), path.join(home, ".claude", "skills")];
  const cliEntries = skills.map(dir => path.join(dir, "neowow-canvas", "bin", "neowow.mjs"));
  const directories = [
    process.env.NEOWOW_CLI_INSTALL_DIR,
    path.join(home, ".neowow", "bin"),
    path.join(home, ".local", "bin"),
    ...String(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].filter(item => typeof item === "string" && path.isAbsolute(item));
  const binaries = directories.map(dir => path.join(dir, process.platform === "win32" ? "neowow.exe" : "neowow"));
  // Windows' official .cmd launcher uses cmd.exe and is not needed here:
  // execute its installed JavaScript entry with our existing Node runtime.
  for (const file of new Set([...cliEntries, ...binaries])) {
    try {
      if (!statSync(file).isFile()) continue;
      const script = file.endsWith(".mjs");
      accessSync(file, script ? constants.R_OK : constants.X_OK);
      return script ? { file: process.execPath, prefix: [file] } : { file, prefix: [] };
    } catch {}
  }
  return null;
}

export function neowowCliPresent() { return Boolean(findCli()); }

async function call(args, deadline) {
  const cli = findCli();
  if (!cli) throw new Error("未找到 NeoWOW 官方 CLI，请从 NeoWOW 用户中心的 CLI & Skill 安装并完成授权。");
  const timeout = Math.min(14_000, deadline - Date.now());
  if (timeout <= 0) throw new Error("NeoWOW 读取超时。");
  let result;
  try {
    // Only locally constructed read-only argument vectors. No shell, no CLI
    // mutation/generation, no access to CLI credentials, no raw stderr output.
    result = await execute(cli.file, [...cli.prefix, ...args], {
      timeout, maxBuffer: 24 * 1024 * 1024, windowsHide: true, shell: false,
      env: { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH || ""].join(path.delimiter) },
    });
  } catch (error) {
    if (error.killed || error.code === "ETIMEDOUT") throw new Error("NeoWOW CLI 读取超时。");
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("NeoWOW 返回内容超过读取上限。");
    if (/未登录|登录失效|API Key.{0,20}(?:无效|缺失|未配置)|\b(?:401|403)\b/i.test(String(error.stderr || "").slice(0, 3000))) {
      throw new Error("NeoWOW CLI 未授权或授权已失效，请在官方 CLI 中登录。");
    }
    throw new Error("NeoWOW CLI 未能读取数据，请检查本机安装、登录和项目权限。");
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("NeoWOW CLI 返回格式不匹配，请检查官方 CLI 版本。");
  }
}

function sourceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : "";
}
function cleanText(value, max = 32000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function dateOf(value) {
  const timestamp = typeof value === "number" ? (value < 10 ** 11 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp >= 8640000000000000) return "";
  return new Date(timestamp).toISOString();
}
function publicMediaUrl(value) {
  if (typeof value !== "string" || value.length > 16384) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
}
function identityUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (SIGNED_URL_PARAMS.test(key)) url.searchParams.delete(key);
  url.hash = "";
  return url.href;
}
function kindOf(value) {
  return value === "music" ? "audio" : Object.hasOwn(OUTPUT_FIELDS, value) ? value : "";
}
function urlsOf(value, kind) {
  return (Array.isArray(value) ? value : [value]).map(item => publicMediaUrl(
    typeof item === "string" ? item : item?.[OUTPUT_FIELDS[kind]?.[1]] || item?.url,
  )).filter(Boolean);
}
function resultUrls(data, kind) {
  const [field, direct] = OUTPUT_FIELDS[kind] || [];
  if (!field) return [];
  const fromOutput = urlsOf(data[field], kind);
  return fromOutput.length ? fromOutput : urlsOf(data.result?.[direct], kind);
}
function referenceList(data) {
  const items = [];
  for (const key of ["connectedImageUrls", "connectedVideoUrls", "connectedAudioUrls", "imageUrls", "referenceVideoUrls", "referenceAudioUrls", "audioUrl", "manualReferences"]) {
    for (const item of Array.isArray(data?.[key]) ? data[key] : [data?.[key]]) {
      const url = publicMediaUrl(typeof item === "string" ? item : item?.url);
      if (url) items.push(identityUrl(url));
    }
  }
  return [...new Set(items)].slice(0, 50);
}
function selectedSettings(...sources) {
  const settings = {};
  for (const source of sources) for (const key of SETTING_KEYS) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") settings[key] = value;
    else if (typeof value === "string" && value.trim()) settings[key] = value.slice(0, 512);
    else if (Array.isArray(value) && value.length <= 16 && value.every(item => typeof item === "string" && item.length <= 256)) settings[key] = value;
  }
  return settings;
}
function addWarnings(rows, warnings) {
  return Object.defineProperty(rows, "warnings", { value: warnings, enumerable: false });
}

export function createNeoWowAssetSource({ run = call, now = Date.now } = {}) {
  async function listProjects() {
    const deadline = now() + 36_000;
    const queue = [""], seenFolders = new Set(queue), projects = new Map(), warnings = [];
    let calls = 0, bounded = false;
    for (let i = 0; i < queue.length && !bounded; i++) {
      const folder = queue[i], pageSize = 50;
      const seenPages = new Set();
      for (let page = 1; ; page++) {
        if (calls >= 64 || now() >= deadline) { bounded = true; break; }
        calls++;
        let listed;
        try {
          listed = await run(["project", "list", "--page-num", String(page), "--page-size", String(pageSize), ...(folder ? ["--folder", folder] : [])], deadline);
        } catch (error) {
          if (!projects.size) throw error;
          warnings.push("部分 NeoWOW 项目列表未能读取，请重新检查连接后再试。");
          bounded = true; break;
        }
        if (!Array.isArray(listed.projects) || !Array.isArray(listed.folders)) throw new Error("NeoWOW 项目列表格式不匹配。");
        const pageKey = JSON.stringify([listed.projects.map(item => item?.sessionId), listed.folders.map(item => item?.folderId)]);
        if (seenPages.has(pageKey)) { warnings.push("NeoWOW 返回重复页，项目列表可能不完整。"); break; }
        seenPages.add(pageKey);
        for (const item of listed.projects) {
          const id = sourceId(item?.sessionId), name = cleanText(item?.title, 200);
          if (id && name && !projects.has(id)) projects.set(id, { id, name });
        }
        for (const item of listed.folders) {
          const id = sourceId(item?.folderId);
          if (id && !seenFolders.has(id)) { seenFolders.add(id); queue.push(id); }
        }
        const length = listed.projects.length + listed.folders.length;
        const limit = Math.min(pageSize, Number(listed.pageSize) || pageSize);
        if (length === 0 || (length < limit && page * limit >= (Number(listed.count) || length))) break;
      }
    }
    if (bounded) warnings.push("已达到 NeoWOW 项目列表读取上限，仅显示已读取的项目。");
    return addWarnings([...projects.values()], warnings);
  }

  async function listAssets(projectId) {
    const id = sourceId(projectId);
    if (!id) throw new Error("NeoWOW 项目 ID 无效。");
    const deadline = now() + 45_000;
    const snapshot = await run(["project", "get", id], deadline);
    if (snapshot.sessionId !== id || !Array.isArray(snapshot.nodes)) throw new Error("NeoWOW 返回的作品与所选项目不符，未开始同步。");
    const warnings = [], assets = new Map(), groups = new Map();
    const nodes = new Map(snapshot.nodes.filter(Boolean).map(node => [sourceId(node.id), node]).filter(([key]) => key));
    for (const [nodeId, node] of nodes) {
      if (node.type === "group" || node.type === "groupNode") groups.set(nodeId, cleanText(node.data?.label || node.data?.title || node.data?.name, 140));
    }
    const historyNodes = [];
    function add(node, kind, url, promptData, source = null) {
      const key = JSON.stringify([node.id, kind, identityUrl(url)]);
      const rowId = createHash("sha256").update(key).digest("hex").slice(0, 24);
      const title = cleanText(node.data?.label || node.data?.title || node.data?.name, 180);
      const parent = sourceId(node.parentId || node.parentNode || node.data?.parentId);
      const name = title || node.id;
      return assets.set(key, {
        id: rowId, name, url, kind, folder: groups.get(parent) || "",
        prompt: cleanText(promptData?.prompt || promptData?.textPrompt || (source ? promptData?.lyrics || promptData?.text || source.prompt : "")),
        negativePrompt: cleanText(promptData?.negativePrompt),
        model: cleanText(promptData?.modelDisplayName || promptData?.modelName || promptData?.model || source?.modelName, 180),
        settings: selectedSettings(promptData, source),
        references: referenceList(promptData),
        sourceNodeId: node.id,
        createdAt: dateOf(source?.createTime ?? node.data?.createdAt),
      });
    }
    for (const node of nodes.values()) {
      const kind = kindOf(node.type), data = node.data;
      if (!kind || !data || typeof data !== "object") continue;
      const uploaded = data.type === "upload" || data.mediaSource === "upload";
      const urls = resultUrls(data, kind);
      for (const url of urls) {
        // A captured editor prompt or model may belong to a later run. Only
        // attach generation metadata to a matching history result.
        add(node, kind, url, null);
      }
      if (!uploaded && (urls.length || data.taskId || data.mediaSource === "generated" || data.prompt)) historyNodes.push([node, kind]);
    }
    const historyLimit = Math.min(80, historyNodes.length);
    let current = 0, succeeded = 0, failed = 0;
    await Promise.all(Array.from({ length: Math.min(4, historyLimit) }, async () => {
      while (current < historyLimit && now() < deadline) {
        const [node, kind] = historyNodes[current++];
        try {
          const result = await run(["gen", "history", node.id, "--status", "SUCCESS", "--full", "--project", id], deadline);
          if (result.nodeKey !== node.id || !Array.isArray(result.records)) throw new Error("Invalid history");
          const records = result.records.slice().sort((a, b) => (Date.parse(b?.createTime) || 0) - (Date.parse(a?.createTime) || 0));
          const matched = new Set();
          for (const record of records) {
            if (!record || record.status && record.status !== "SUCCESS") continue;
            const recordKind = kindOf(record.dataType) || kind;
            if (recordKind !== kind) continue;
            const refs = (recordKind === "video" ? record.videoRef : recordKind === "audio" ? record.audioRef || record.voiceRef || record.musicRef : record.imageRef) || {};
            for (const url of urlsOf(record.resultData, recordKind)) {
              const canonical = identityUrl(url);
              if (matched.has(canonical)) continue;
              matched.add(canonical);
              add(node, recordKind, url, refs, record);
            }
          }
          succeeded++;
        } catch { failed++; }
      }
    }));
    if (historyNodes.length > current) warnings.push(`部分节点未读取生成历史（已处理 ${current}/${historyNodes.length}），已保留画布可确认的素材。`);
    if (failed) warnings.push(`${failed} 个节点的生成历史暂不可读，只同步其画布可确认的素材。`);
    if (succeeded && !assets.size) warnings.push("已读取生成历史，但没有可用的媒体文件地址。");
    return addWarnings([...assets.values()], warnings);
  }
  return { listProjects, listAssets };
}

const neoWowSource = createNeoWowAssetSource();
export const listNeoWowProjects = neoWowSource.listProjects;
export const listNeoWowAssets = neoWowSource.listAssets;
