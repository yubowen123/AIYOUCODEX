import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { localEditorOrigin, OpenChatCutError } from './openchatcut-mcp.mjs';

export const OPENCHATCUT_LOCAL_PATH_TOOLS = new Set(['browse_local_media', 'import_asset', 'import_assets', 'import_folder']);
// These MIME pairs are accepted by OpenChatCut v0.2.16's verified upload handoff.
const mediaTypes = new Map([
  ['.mp4', ['video', 'video/mp4']], ['.m4v', ['video', 'video/x-m4v']], ['.mov', ['video', 'video/quicktime']], ['.webm', ['video', 'video/webm']],
  ['.jpg', ['image', 'image/jpeg']], ['.jpeg', ['image', 'image/jpeg']], ['.png', ['image', 'image/png']], ['.webp', ['image', 'image/webp']],
  ['.avif', ['image', 'image/avif']], ['.heic', ['image', 'image/heic']], ['.heif', ['image', 'image/heif']], ['.gif', ['gif', 'image/gif']], ['.svg', ['svg', 'image/svg+xml']],
  ['.mp3', ['audio', 'audio/mpeg']], ['.wav', ['audio', 'audio/wav']], ['.m4a', ['audio', 'audio/mp4']], ['.aac', ['audio', 'audio/aac']],
  ['.ogg', ['audio', 'audio/ogg']], ['.opus', ['audio', 'audio/opus']], ['.flac', ['audio', 'audio/flac']],
]);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const fail = (message, code = 'OPENCHATCUT_IMPORT_ERROR') => new OpenChatCutError(message, code);
const inside = (root, value) => { const relative = path.relative(root, value); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const unchanged = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** GET /api/keys exposes capability booleans and explicitly non-secret settings.
 * Never read, return or change provider credential values. */
export async function openChatCutImportSettings(baseUrl, { fetchImpl = fetch, requireLocalStorage = true } = {}) {
  const origin = localEditorOrigin(baseUrl);
  const response = await fetchImpl(`${origin}/api/keys`, { headers: { Origin: origin, 'Sec-Fetch-Site': 'none' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw fail('无法确认 OpenChatCut 本地素材存储设置，未读取或上传素材。', 'OPENCHATCUT_STORAGE_UNKNOWN');
  const value = await response.json();
  if (requireLocalStorage && value?.caps?.storage !== false) throw fail('OpenChatCut 云存储已启用或状态未知；本地导入尚未执行。请在 OpenChatCut 中选用本地存储。', 'OPENCHATCUT_LOCAL_STORAGE_REQUIRED');
  // AGENT_IMPORT_ROOTS is part of the upstream NON_SECRET_NAMES allowlist.
  const raw = value?.models?.AGENT_IMPORT_ROOTS;
  if (typeof raw !== 'string') throw fail('无法确认本地素材目录限制，未绕过目录限制。', 'OPENCHATCUT_IMPORT_ROOTS_INVALID');
  const roots = String(raw || '').split(/[\n,]+/u).map(entry => entry.trim()).filter(Boolean);
  const canonicalRoots = await Promise.all(roots.map(root => realpath(root).catch(() => null)));
  return { roots: canonicalRoots.filter(Boolean), restricted: roots.length > 0 };
}

async function permittedPath(value, settings) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length >= 4096) throw fail('素材路径必须是有效的绝对本地路径。', 'OPENCHATCUT_LOCAL_PATH_INVALID');
  if ((await lstat(value)).isSymbolicLink()) throw fail('本地素材扫描不跟随符号链接。', 'OPENCHATCUT_LOCAL_PATH_INVALID');
  const canonical = await realpath(value);
  if (settings.restricted && !settings.roots.some(root => inside(root, canonical))) throw fail('该路径不在 OpenChatCut 已配置的本地素材目录中。', 'PATH_OUTSIDE_IMPORT_ROOTS');
  return canonical;
}

function validateBrowse(args) {
  if ((args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 256))
    || (args.kind !== undefined && !['video', 'audio', 'image', 'gif', 'svg'].includes(args.kind))
    || (args.recursive !== undefined && typeof args.recursive !== 'boolean')
    || (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0 || args.offset > 10000))
    || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200))) throw fail('本地素材浏览参数无效。', 'OPENCHATCUT_LOCAL_PATH_INVALID');
}

async function scanDirectory(root, settings, { recursive = false, query = '', kind, includeUnsupported = false } = {}) {
  const entries = [], errors = [], unsupportedFiles = [], queue = [{ directory: root, depth: 0 }];
  let scanned = 0, truncated = false;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    try {
      const directory = await permittedPath(current.directory, settings);
      for await (const entry of await opendir(directory)) {
        if (++scanned > 10000) { truncated = true; break; }
        if (entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        const type = entry.isDirectory() ? 'directory' : entry.isFile() ? mediaTypes.get(path.extname(entry.name).toLowerCase())?.[0] : undefined;
        if (entry.isDirectory() && recursive) {
          if (current.depth < 12) queue.push({ directory: filename, depth: current.depth + 1 });
          else truncated = true;
        }
        if (!type) { if (includeUnsupported && entry.isFile() && unsupportedFiles.length < 50) unsupportedFiles.push(filename); continue; }
        if ((kind && kind !== type) || !path.relative(root, filename).toLowerCase().includes(query.toLowerCase())) continue;
        try {
          const resolved = await permittedPath(filename, settings), info = await lstat(resolved);
          entries.push({ path: resolved, name: entry.name, kind: type, ...(type === 'directory' ? {} : { size: info.size, modifiedAt: info.mtimeMs }) });
        } catch (error) { if (errors.length < 50) errors.push({ path: filename, error: error.message, code: error.code }); }
      }
    } catch (error) {
      if (index === 0) throw error;
      if (errors.length < 50) errors.push({ path: current.directory, error: error.message, code: error.code });
    }
    if (scanned > 10000) break;
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { entries, errors, unsupportedFiles, truncated };
}

export async function browseOpenChatCutLocalMedia(args, settings) {
  validateBrowse(args);
  const root = await permittedPath(args.path ?? os.homedir(), settings);
  const scanned = await scanDirectory(root, settings, args);
  const offset = args.offset ?? 0, end = offset + (args.limit ?? 100);
  return { ok: true, path: root, entries: scanned.entries.slice(offset, end), nextOffset: end < scanned.entries.length ? end : null,
    truncated: scanned.truncated, errors: scanned.errors };
}

/** A browser may return its opaque embedding origin in uploadUrl. Only the
 * official upload path and exact one-shot scope are reused on the trusted local
 * origin; an upstream result can never select a remote upload destination. */
export function localOpenChatCutUploadSlot(value, { baseUrl, projectId, filename, assetType, contentType, size, now = Date.now() }) {
  const slot = value?.slots?.[0];
  let supplied;
  try { supplied = new URL(slot?.uploadUrl); } catch { throw fail('OpenChatCut 上传槽无效。'); }
  const expected = { projectId, name: filename, assetType, sessionId: value?.sessionId, assetId: slot?.assetId };
  const allowedQueries = new Set([...Object.keys(expected), 'handoff']);
  if (value?.ok !== true || value.projectId !== projectId || !/^sess_[A-Za-z0-9_-]+$/u.test(value.sessionId || '')
    || !/^[A-Za-z0-9_-]{1,80}$/u.test(slot?.assetId || '') || value.slots.length !== 1
    || slot.method !== 'POST' || JSON.stringify(slot.allowedMethods) !== '["POST"]' || slot.size !== size
    || slot.filename !== filename || slot.assetType !== assetType || slot.contentType !== contentType
    || slot.headers?.['Content-Type'] !== contentType || slot.headers?.['Content-Length'] !== String(size)
    || !Number.isSafeInteger(slot.expiresAt) || slot.expiresAt <= now || supplied.pathname !== '/upload' || supplied.hash
    || supplied.username || supplied.password || !['http:', 'https:'].includes(supplied.protocol)
    || [...supplied.searchParams.keys()].some(key => !allowedQueries.has(key) || supplied.searchParams.getAll(key).length !== 1)
    || Object.entries(expected).some(([key, entry]) => supplied.searchParams.get(key) !== entry)
    || !/^[A-Za-z0-9_-]{20,256}$/u.test(supplied.searchParams.get('handoff') || '')
    || !/^uploads\/[A-Za-z0-9._-]+$/u.test(slot.fileKey || '') || slot.readUrl !== `/media/${slot.fileKey}`) throw fail('OpenChatCut 上传槽与当前工程、素材或字节数不一致，未上传素材。');
  return { ...slot, uploadUrl: `${localEditorOrigin(baseUrl)}${supplied.pathname}${supplied.search}` };
}

async function* readHandle(handle, size) {
  let position = 0;
  while (position < size) {
    const buffer = Buffer.allocUnsafe(Math.min(128 * 1024, size - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    position += bytesRead; yield buffer.subarray(0, bytesRead);
  }
}

async function hashHandle(handle, size) {
  const hash = createHash('sha256');
  for await (const chunk of readHandle(handle, size)) hash.update(chunk);
  return hash.digest('hex');
}

async function importFile(filename, { baseUrl, projectId, settings, invoke, fetchImpl, knownHashes, onProgress }) {
  const canonical = await permittedPath(filename, settings);
  const [assetType, contentType] = mediaTypes.get(path.extname(canonical).toLowerCase()) || [];
  if (!assetType) return { unsupported: true };
  const name = path.basename(filename);
  if (!name || /[\u0000-\u001f\u007f/\\]/u.test(name) || name.length > 255) throw fail('素材文件名无效。');
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size <= 0) throw fail('素材必须是非空常规文件。');
    if (knownHashes.size) {
      const hash = await hashHandle(handle, before.size);
      if (!unchanged(before, await handle.stat())) throw fail('素材在读取期间发生变化，未导入。', 'OPENCHATCUT_SOURCE_CHANGED');
      if (knownHashes.has(hash)) return { duplicate: true };
    }
    onProgress?.({ state: 'importing', message: `正在导入 ${name}`, filename: name });
    const handoff = await invoke('import_media', { action: 'create_session', assetType, filename: name, contentType, size: before.size });
    const slot = localOpenChatCutUploadSlot(handoff, { baseUrl, projectId, filename: name, assetType, contentType, size: before.size });
    const hash = createHash('sha256'); let bytes = 0;
    async function* body() { for await (const chunk of readHandle(handle, before.size)) { bytes += chunk.length; hash.update(chunk); yield chunk; } }
    let response;
    try {
      response = await fetchImpl(slot.uploadUrl, { method: 'POST', headers: { Origin: localEditorOrigin(baseUrl), 'Sec-Fetch-Site': 'none',
        'Content-Type': contentType, 'Content-Length': String(before.size) }, body: body(), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(30 * 60 * 1000) });
    } catch { throw fail('素材上传失败；未自动重试或发布工程素材。', 'OPENCHATCUT_UPLOAD_FAILED'); }
    if (!response.ok) throw fail(`素材上传失败（HTTP ${response.status}）；未自动重试。`, 'OPENCHATCUT_UPLOAD_FAILED');
    const uploaded = await response.json();
    const contentHash = hash.digest('hex');
    if (!unchanged(before, await handle.stat())) throw fail('素材在上传期间发生变化，未完成导入。', 'OPENCHATCUT_SOURCE_CHANGED');
    if (bytes !== before.size || uploaded.bytes !== before.size || uploaded.contentHash !== contentHash || uploaded.cloud === true
      || uploaded.assetId !== slot.assetId || uploaded.sessionId !== handoff.sessionId || uploaded.assetType !== assetType
      || uploaded.filename !== name || uploaded.fileKey !== slot.fileKey || uploaded.path !== slot.readUrl
      || !/^[A-Za-z0-9_-]{20,256}$/u.test(uploaded.receipt || '')) throw fail('素材上传回执与已读取文件不一致，未完成导入。', 'OPENCHATCUT_RECEIPT_INVALID');
    const probe = await invoke('probe_media', { source: slot.readUrl });
    const needsDuration = ['video', 'audio', 'gif'].includes(assetType);
    if (probe?.ok !== true || (needsDuration && !positive(probe.durationSeconds))) throw fail('OpenChatCut 未测得有效素材时长，未使用猜测值完成导入。', 'OPENCHATCUT_PROBE_FAILED');
    const finalized = await invoke('finalize_uploaded_asset', { receipt: uploaded.receipt, assetType,
      ...(positive(probe.durationSeconds) ? { durationInSeconds: probe.durationSeconds } : {}),
      ...Object.fromEntries(['width', 'height', 'fps'].filter(key => positive(probe[key])).map(key => [key, probe[key]])),
      ...(typeof probe.hasAudioTrack === 'boolean' ? { hasAudioTrack: probe.hasAudioTrack } : {}) });
    if (finalized?.ok !== true || finalized.assetId !== slot.assetId || typeof finalized.src !== 'string' || !finalized.src.startsWith('/media/')) throw fail('OpenChatCut 未确认素材已加入当前工程。', 'OPENCHATCUT_FINALIZE_FAILED');
    knownHashes.add(contentHash);
    // Receipts and upload handoffs stay in this operation and never enter events
    // or the persisted conversation/project map.
    const { receipt: _receipt, uploadUrl: _uploadUrl, ...asset } = finalized;
    return { asset: { ...asset, id: asset.assetId, kind: assetType === 'gif' || assetType === 'svg' ? 'image' : assetType } };
  } finally { await handle.close(); }
}

export async function importOpenChatCutLocalMedia(toolName, args, { baseUrl, projectId, invoke, fetchImpl = fetch, onProgress, settings } = {}) {
  if (!['import_asset', 'import_assets', 'import_folder'].includes(toolName)) throw fail('不支持的本地素材导入工具。');
  settings ||= await openChatCutImportSettings(baseUrl, { fetchImpl });
  const requested = toolName === 'import_assets' ? args.paths : [args.path];
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 100 || requested.some(value => typeof value !== 'string' || !value.trim())) throw fail('请提供 1–100 个绝对本地素材路径。', 'OPENCHATCUT_LOCAL_PATH_INVALID');
  const candidates = [], errors = [], unsupportedFiles = []; let truncated = false;
  for (const source of requested) {
    try {
      const canonical = await permittedPath(source, settings), info = await lstat(canonical);
      if (info.isDirectory()) {
        const scanned = await scanDirectory(canonical, settings, { recursive: true, includeUnsupported: true });
        candidates.push(...scanned.entries.filter(entry => entry.kind !== 'directory').map(entry => entry.path));
        errors.push(...scanned.errors); unsupportedFiles.push(...scanned.unsupportedFiles); truncated ||= scanned.truncated;
      } else candidates.push(source);
    } catch (error) { errors.push({ path: source, error: error.message, code: error.code }); }
  }
  if (candidates.length > 10000) { candidates.length = 10000; truncated = true; }
  const project = await invoke('read_project', { view: 'assets' });
  const knownHashes = new Set((Array.isArray(project?.assets) ? project.assets : []).flatMap(asset =>
    [asset.sourceContentHash, asset.contentHash].filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))));
  const imported = []; let duplicateCount = 0;
  for (const filename of [...new Set(candidates)]) {
    try {
      const result = await importFile(filename, { baseUrl, projectId, settings, invoke, fetchImpl, knownHashes, onProgress });
      if (result.duplicate) duplicateCount++;
      else if (result.unsupported) unsupportedFiles.push(filename);
      else imported.push(result.asset);
    } catch (error) { if (errors.length < 50) errors.push({ path: filename, error: error.message, code: error.code }); }
  }
  if (!imported.length && errors.length) throw fail(errors[0].error, errors[0].code || 'OPENCHATCUT_IMPORT_ERROR');
  return { ok: true, imported, duplicateCount, skippedDuplicates: duplicateCount > 0 && !imported.length && !errors.length && !unsupportedFiles.length,
    ...(unsupportedFiles.length ? { unsupportedFiles: unsupportedFiles.slice(0, 50) } : {}), ...(errors.length ? { errors: errors.slice(0, 50) } : {}),
    ...(truncated ? { truncated: true } : {}), transcription: 'not_started', adapter: 'verified-local-upload' };
}
