import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PAGE = 100;
const MAX_TASKS = 500;
const MAX_BYTES = 512 * 1024 * 1024;
const UNGROUPED = "ungrouped";
const PROJECT_ID = /^\d{1,32}$/;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,95}$/;
const MEDIA = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".heic", ".tiff"]),
  video: new Set([".mp4", ".mov", ".m4v", ".webm"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]),
};

function issue(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

async function binary() {
  const exe = process.platform === "win32" ? "dreamina.exe" : "dreamina";
  for (const directory of [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".dreamina_cli"), "/opt/homebrew/bin", "/usr/local/bin"]) {
    const candidate = path.join(directory, exe);
    if (path.isAbsolute(candidate) && await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  return exe;
}

async function run(args, { timeout = 30_000, signal } = {}) {
  try {
    const result = await exec(await binary(), args, { timeout, signal, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    const output = result.stdout.trim();
    if (/未检测到有效登录态|请先执行 dreamina login|not logged in/i.test(output.slice(0, 180))) {
      throw issue("即梦 CLI 需要登录。请在终端执行 dreamina login 后再试。", "DREAMINA_LOGIN_REQUIRED", 409);
    }
    return output;
  } catch (error) {
    if (error.name === "AbortError" || error.code === "DREAMINA_LOGIN_REQUIRED") throw error;
    if (error.code === "ENOENT") throw issue("没有找到即梦官方 CLI，请先安装 dreamina。", "DREAMINA_CLI_MISSING", 409);
    if (/未检测到有效登录态|请先执行 dreamina login|not logged in|unauthenticated/i.test(String(error.stderr || "") + String(error.stdout || ""))) {
      throw issue("即梦 CLI 需要登录。请在终端执行 dreamina login 后再试。", "DREAMINA_LOGIN_REQUIRED", 409);
    }
    if (error.killed) throw issue("即梦 CLI 请求超时。", "DREAMINA_TIMEOUT", 504);
    throw issue("即梦 CLI 没有完成操作，请检查 CLI 登录状态和网络。", "DREAMINA_CLI_ERROR", 502);
  }
}

const text = (value, limit = 512) => typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, limit) : "";
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const kindOf = name => Object.keys(MEDIA).find(kind => MEDIA[kind].has(path.extname(name).toLowerCase()));

function parse(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function parseDreaminaSessions(output) {
  const rows = new Map();
  function add(id, name) {
    const key = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : text(id, 33);
    const label = text(name, 140);
    if (PROJECT_ID.test(key) && label) rows.set(key, { id: key, name: label });
  }
  const json = parse(output);
  const entries = Array.isArray(json) ? json : json?.sessions || json?.data?.sessions;
  if (Array.isArray(entries)) {
    for (const row of entries) add(row?.id ?? row?.session_id, row?.name ?? row?.title);
  } else {
    for (const raw of output.split(/\r?\n/u)) {
      const line = raw.replace(/\u001b\[[0-9;]*m/g, "");
      const pipe = line.match(/^\s*\|\s*(\d+)\s*\|\s*([^|]+)\|/u);
      const tabs = line.match(/^\s*(\d+)\t+([^\t]+)\t+/u);
      const columns = line.match(/^\s*(\d+)\s+(.+?)\s{2,}\S.*?\s{2,}\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*$/u)
        || line.match(/^\s*(\d+)\s{2,}(.+?)\s{2,}(?:true|false|yes|no|[-—●✓]|已置顶|未置顶|是|否)\s+(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}|[-—])\s*$/iu);
      const match = pipe || tabs || columns;
      if (match) add(match[1], match[2]);
    }
  }
  return [...rows.values()];
}

function parseTasks(output) {
  const json = parse(output);
  const rows = Array.isArray(json) ? json : json?.tasks ?? json?.items ?? json?.task_list ?? json?.data?.tasks ?? json?.data?.items ?? json?.data?.task_list ?? json?.data;
  if (!Array.isArray(rows)) throw issue("当前即梦 CLI 的历史输出无法识别，请更新 CLI 后重试。", "DREAMINA_UNSUPPORTED_HISTORY", 502);
  return rows;
}

function submitId(row) {
  return text(row?.submit_id ?? row?.submitId, 96);
}

async function localRecords(ids) {
  // Read extra metadata for officially listed task IDs only. No saved account/credential rows.
  const filename = path.join(os.homedir(), ".dreamina_cli", "tasks.db");
  const before = await lstat(filename).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()) return new Map();
  let database;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    database = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
    const statement = database.prepare("SELECT submit_id, gen_task_type, gen_status, create_time, request, result_json FROM aigc_task WHERE submit_id = ?");
    const rows = ids.map(id => statement.get(id)).filter(Boolean);
    return new Map(rows.map(row => [row.submit_id, row]));
  } catch {
    // The official CLI results remain usable if the optional local cache schema changes.
    return new Map();
  } finally {
    database?.close();
  }
}

const validNumber = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
function setting(value) {
  return validNumber(value) ?? (text(value, 100) || undefined);
}
function referenceName(value) {
  const raw = text(value, 8192);
  // Preserve slot order and filename without leaking signed URLs or absolute paths.
  if (!raw) return "";
  let relative = raw.split(/[?#]/, 1)[0];
  if (/^https?:\/\//i.test(raw)) {
    try { relative = new URL(raw).pathname; } catch { return ""; }
  } else if (/^[a-z][a-z0-9+.-]+:\/\//i.test(raw)) return "";
  const name = relative.split(/[\/\\]/).filter(Boolean).at(-1);
  if (!name || name === "." || name === "..") return "";
  return text(name, 260);
}

export function normalizeDreaminaTask(row, cache = {}) {
  const id = submitId(row);
  if (!TASK_ID.test(id) || text(row.gen_status ?? row.status ?? cache.gen_status).toLowerCase() !== "success") return null;
  const rowRequest = object(parse(row.request));
  const localRequest = object(parse(cache.request));
  const req = { ...object(parse(localRequest.body) || localRequest), ...object(parse(rowRequest.body) || rowRequest) };
  const result = object(parse(row.result_json ?? row.result ?? cache.result_json));
  const group = row.session_id ?? row.workspace ?? req.workspace ?? req.session_id;
  const key = typeof group === "number" && Number.isSafeInteger(group) ? String(group) : text(group, 33);
  const projectId = PROJECT_ID.test(key) ? key : UNGROUPED;
  const taskType = text(row.gen_task_type ?? cache.gen_task_type);
  const images = Array.isArray(result.images) ? result.images : [];
  const videos = Array.isArray(result.videos) ? result.videos : [];
  const audios = Array.isArray(result.audios) ? result.audios : [];
  const resultKinds = [images.length ? "image" : "", videos.length ? "video" : "", audios.length ? "audio" : ""].filter(Boolean);
  const kind = resultKinds.length === 1 ? resultKinds[0] : /video/.test(taskType) ? "video" : /image/.test(taskType) ? "image" : /audio/.test(taskType) ? "audio" : "";
  if (!kind) return null;
  const specs = { image: images, video: videos, audio: audios }[kind].slice(0, 20).map(item =>
    Object.fromEntries(["width", "height", "format", "fps", "duration"].flatMap(key => {
      const value = setting(item?.[key]);
      return value === undefined ? [] : [[key, value]];
    }))
  );
  const referenceSlots = [];
  for (const medium of ["image", "video", "audio"]) {
    const values = req[`${medium}_paths`];
    if (!Array.isArray(values)) continue;
    values.slice(0, 20).forEach((value, index) => {
      const name = referenceName(value);
      if (name) referenceSlots.push({ type: medium, slot: index + 1, name });
    });
  }
  const settings = { generationType: taskType, workspaceId: projectId === UNGROUPED ? undefined : projectId, referenceSlots, outputSpecs: specs };
  for (const [source, destination] of Object.entries({ ratio: "ratio", duration: "duration", video_resolution: "resolution", resolution_type: "resolution", seed: "seed", generate_num: "variants" })) {
    const value = setting(req[source]);
    if (value !== undefined) settings[destination] = value;
  }
  const created = row.create_time ?? cache.create_time;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    const date = new Date(created < 1e12 ? created * 1000 : created);
    if (Number.isFinite(date.getTime())) settings.createdAt = date.toISOString();
  }
  return {
    id, submitId: id, projectId, kind,
    name: text(row.asset_name ?? row.name, 160) || `即梦${{ image: "图片", video: "视频", audio: "音频" }[kind]} ${id.slice(0, 8)}`,
    prompt: text(row.prompt ?? req.prompt, 50_000),
    negativePrompt: text(row.negative_prompt ?? req.negative_prompt, 50_000),
    model: text(row.model_version ?? row.model ?? req.model_version ?? req.model),
    settings,
    references: referenceSlots.map(slot => slot.name),
  };
}

async function listTasks(options) {
  const rows = new Map();
  for (let offset = 0; offset < MAX_TASKS; offset += PAGE) {
    const data = parseTasks(await run(["list_task", "--gen_status=success", `--limit=${PAGE}`, `--offset=${offset}`], options));
    const size = rows.size;
    for (const row of data.slice(0, PAGE)) {
      const id = submitId(row);
      if (TASK_ID.test(id)) rows.set(id, row);
    }
    if (data.length < PAGE || size === rows.size) break;
  }
  const associated = await localRecords([...rows.keys()]);
  return [...rows.values()].map(row => normalizeDreaminaTask(row, associated.get(submitId(row)))).filter(Boolean);
}

export async function listDreaminaProjects(options = {}) {
  // A Dreamina session is a named creation-history container, not a workspace from AIYOU.
  const sessionsStdout = await run(["session", "list", "-n", "100"], options);
  const sessions = parseDreaminaSessions(sessionsStdout);
  const assets = await listTasks(options);
  const result = new Map(sessions.map(row => [row.id, row]));
  for (const asset of assets) {
    if (result.has(asset.projectId)) continue;
    const name = asset.projectId === UNGROUPED ? "未分组的 CLI 任务"
      : asset.projectId === "0" ? "即梦默认会话" : `即梦历史会话 ${asset.projectId}`;
    result.set(asset.projectId, { id: asset.projectId, name });
  }
  return [...result.values()];
}

export async function listDreaminaAssets(projectId, options = {}) {
  if (typeof projectId !== "string" || (projectId !== UNGROUPED && !PROJECT_ID.test(projectId))) {
    throw issue("即梦会话标识无效。", "DREAMINA_INVALID_PROJECT", 400);
  }
  return (await listTasks(options)).filter(row => row.projectId === projectId);
}

export async function downloadDreaminaTask(submitId, directory, { signal } = {}) {
  if (typeof submitId !== "string" || !TASK_ID.test(submitId) || !path.isAbsolute(directory || "")) {
    throw issue("即梦任务或暂存目录无效。", "DREAMINA_INVALID_DOWNLOAD", 400);
  }
  const root = await realpath(directory);
  const output = await mkdtemp(path.join(root, "dreamina-task-"));
  try {
    // Callers must only invoke this from the explicit manual sync, never from list/refresh.
    await run(["query_result", `--submit_id=${submitId}`, `--download_dir=${output}`], { signal, timeout: 120_000 });
    const entries = await readdir(output, { withFileTypes: true });
    const expectedDir = await realpath(output);
    if (path.dirname(expectedDir) !== root) throw issue("即梦下载目录已变更。", "DREAMINA_INVALID_DOWNLOAD", 409);
    const files = [];
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !kindOf(entry.name)) continue;
      const candidate = path.join(output, entry.name);
      const actual = await realpath(candidate);
      const info = await lstat(candidate);
      if (path.dirname(actual) !== expectedDir || !info.isFile() || info.size <= 0) continue;
      bytes += info.size;
      if (bytes > MAX_BYTES) throw issue("即梦任务下载的产物超过 512 MiB。", "DREAMINA_DOWNLOAD_TOO_LARGE", 413);
      files.push(actual);
    }
    if (files.length === 0) throw issue("即梦没有下载到已完成的媒体文件，可能需要重新登录或原产物已失效。", "DREAMINA_DOWNLOAD_EMPTY", 409);
    return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en", { numeric: true }));
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
