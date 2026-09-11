import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { managedShortcutsPath } from "./managed-shortcuts.mjs";

export const EFFICIENCY_SCHEMA_VERSION = 1;
export const EFFICIENCY_ROOT_ENV = "AIYOUCODEX_EFFICIENCY_DIR";
export const DEFAULT_EFFICIENCY_POLICY = Object.freeze({ enabled: true, mode: "smart", defaultSkills: [], contextBudget: 1400 });
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${label} contains a forbidden key`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${label}.${key} is not supported`);
}
function text(value, maximum, label) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} must be text of at most ${maximum} characters`);
  return value.trim();
}
export function validateEfficiencyThreadId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value) || FORBIDDEN_KEYS.has(value)) throw new TypeError("Invalid threadId");
  return value;
}
export function efficiencyRootPath(options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const configured = (options.env || process.env)[EFFICIENCY_ROOT_ENV];
  return configured ? pathApi.resolve(configured) : pathApi.join(pathApi.dirname(managedShortcutsPath(options)), "efficiency");
}
export async function canonicalEfficiencyProject(projectPath, { platform = process.platform } = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (typeof projectPath !== "string" || !pathApi.isAbsolute(projectPath) || /[\u0000-\u001f]/u.test(projectPath)) throw new TypeError("Authoritative project path must be absolute");
  let canonical = pathApi.resolve(projectPath);
  if (platform === process.platform) {
    try { canonical = await realpath(canonical); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // APFS/HFS compare Unicode-equivalent names; POSIX/NTFS can keep distinct names.
  if (platform === "darwin") canonical = canonical.normalize("NFC");
  if (platform === "win32") canonical = canonical.replaceAll("\\", "/").toLowerCase();
  return { key: createHash("sha256").update(`${platform}:${canonical}`).digest("hex"), path: canonical };
}
export function normalizeEfficiencyPolicy(patch) {
  keys(patch, ["enabled", "mode", "defaultSkills", "contextBudget"], "policy");
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) { result[key] = null; continue; }
    if (key === "mode") {
      if (!["smart", "concise", "detailed"].includes(value)) throw new TypeError("Unknown output mode");
    } else if (key === "enabled") {
      if (typeof value !== "boolean") throw new TypeError("enabled must be boolean");
    } else if (key === "contextBudget") {
      if (!Number.isInteger(value) || value < 512 || value > 2400) throw new TypeError("contextBudget must be 512..2400 characters");
    } else {
      if (!Array.isArray(value) || value.length > 8) throw new TypeError("defaultSkills supports at most 8 skills");
      const seen = new Set();
      result[key] = value.map((skill) => {
        keys(skill, ["id", "source"], "skill");
        const id = text(skill.id, 128, "skill.id");
        if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(id)) throw new TypeError("Invalid skill identity");
        const source = skill.source === undefined ? "" : text(skill.source, 200, "skill.source");
        const identity = `${source}\u0000${id}`;
        if (seen.has(identity)) throw new TypeError("Duplicate default skill");
        seen.add(identity);
        return { id, ...(source ? { source } : {}) };
      });
      continue;
    }
    result[key] = value;
  }
  return result;
}
export function normalizeEfficiencyContext(value) {
  keys(value, ["goal", "progress", "nextStep", "agreements", "references"], "context");
  const result = { goal: "", progress: "", nextStep: "", agreements: [], references: [] };
  for (const [key, maximum] of [["goal", 600], ["progress", 1200], ["nextStep", 600]]) if (value[key] !== undefined) result[key] = text(value[key], maximum, key);
  for (const [key, maximum] of [["agreements", 300], ["references", 500]]) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].length > 12) throw new TypeError(`${key} supports at most 12 entries`);
    result[key] = value[key].map((item) => text(item, maximum, key)).filter(Boolean);
  }
  if (JSON.stringify(result).length > 8192) throw new TypeError("Context exceeds 8192 characters");
  return result;
}
export function efficiencyPolicyFingerprint(view) {
  const policy = view.effective || DEFAULT_EFFICIENCY_POLICY;
  const context = view.context || {};
  // Deliberately excludes resolved display labels, read timestamps and hook receipts.
  const payload = { threadId: view.threadId || null,
    policy: { enabled: policy.enabled, mode: policy.mode, contextBudget: policy.contextBudget, defaultSkills: policy.defaultSkills },
    context: { version: context.version || 0, ...normalizeEfficiencyContext(Object.fromEntries(
      ["goal", "progress", "nextStep", "agreements", "references"].filter((key) => context[key] !== undefined).map((key) => [key, context[key]]),
    )) } };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
export class EfficiencyConflictError extends Error {
  constructor(currentVersion) { super("Configuration changed; reload before saving"); this.code = "EFFICIENCY_CONFLICT"; this.statusCode = 409; this.currentVersion = currentVersion; }
}

// A process-owned mkdir lock covers the complete read/modify/atomic-rename cycle.
// Never steal a live process's lock; a separate reaper lock prevents stale-lock ABA races.
export async function withEfficiencyFileLock(filePath, callback, { timeoutMs = 5000, platform = process.platform, mkdirLock = mkdir } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const token = randomUUID();
  const start = Date.now();
  const waitForLock = async () => {
    if (Date.now() - start > timeoutMs) { const error = new Error("Efficiency state is busy; retry later"); error.code = "EFFICIENCY_BUSY"; throw error; }
    await delay(12 + Math.floor(Math.random() * 15));
  };
  while (true) {
    let acquired = false;
    try {
      await mkdirLock(lockPath, { mode: 0o700 });
      acquired = true;
      await (await open(path.join(lockPath, "owner.json"), "wx", 0o600)).close();
      const handle = await open(path.join(lockPath, "owner.json"), "w", 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })); } finally { await handle.close(); }
      break;
    } catch (error) {
      // NTFS may report a directory pending deletion as EPERM rather than
      // EEXIST while another writer releases its lock. Only retry acquisition:
      // never treat this as ownership, run the callback, or remove that lock.
      if (!acquired && platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(error.code)) {
        await waitForLock(); continue;
      }
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")); } catch { /* An owner is still initializing; don't steal it. */ }
      let dead = false;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (error) { dead = error.code === "ESRCH"; }
      }
      if (dead) {
        const reaper = `${lockPath}.reaper`;
        let acquired = false;
        try {
          await mkdir(reaper, { mode: 0o700 }); acquired = true;
          const latest = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
          if (latest.token === owner.token) {
            const stale = `${lockPath}.stale-${token}`;
            await rename(lockPath, stale);
            await rm(stale, { recursive: true, force: true });
          }
        } catch (error) { if (!["ENOENT", "EEXIST"].includes(error.code)) throw error; }
        finally { if (acquired) await rm(reaper, { recursive: true, force: true }); }
      }
      await waitForLock();
    }
  }
  try { return await callback(); }
  finally {
    const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    if (owner.token === token) await rm(lockPath, { recursive: true, force: true });
  }
}
export async function readEfficiencyJson(filePath, fallback) {
  try {
    const info = await stat(filePath);
    if (info.size > MAX_STATE_BYTES) throw new Error("Efficiency state exceeds the size limit");
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
  } catch (error) { if (error.code === "ENOENT") return structuredClone(fallback); throw error; }
}
export async function writeEfficiencyJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("Efficiency state exceeds the size limit");
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, filePath); } finally { await rm(temporary, { force: true }); }
}
const blankState = () => ({ schemaVersion: 1, version: 0, global: {}, projects: {}, threads: {}, contexts: {} });
function validateState(state) {
  keys(state, ["schemaVersion", "version", "global", "projects", "threads", "contexts"], "state");
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || state.version < 0) throw new Error("Unsupported efficiency state version");
  normalizeEfficiencyPolicy(state.global);
  for (const field of ["projects", "threads", "contexts"]) object(state[field], field);
  for (const [key, policy] of Object.entries(state.projects)) {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid saved project identity");
    normalizeEfficiencyPolicy(policy);
  }
  for (const [threadId, policy] of Object.entries(state.threads)) {
    validateEfficiencyThreadId(threadId);
    normalizeEfficiencyPolicy(policy);
  }
  for (const [threadId, context] of Object.entries(state.contexts)) {
    validateEfficiencyThreadId(threadId);
    keys(context, ["version", "updatedAt", "goal", "progress", "nextStep", "agreements", "references"], "saved context");
    if (!Number.isSafeInteger(context.version) || context.version < 1 || typeof context.updatedAt !== "string" || !Number.isFinite(Date.parse(context.updatedAt))) throw new Error("Invalid saved context revision");
    const { version, updatedAt, ...content } = context;
    normalizeEfficiencyContext(content);
  }
  return state;
}
function combine(...policies) {
  const result = structuredClone(DEFAULT_EFFICIENCY_POLICY);
  for (const policy of policies) for (const [key, value] of Object.entries(normalizeEfficiencyPolicy(policy || {}))) if (value !== null) result[key] = value;
  return result;
}
export function createEfficiencyStore({ rootDir = efficiencyRootPath(), resolveThread, platform = process.platform } = {}) {
  const filePath = path.join(rootDir, "state.json");
  const hookPath = path.join(rootDir, "hook-events.json");
  async function scopeFor(threadId) {
    if (!threadId) return { threadId: null, project: null };
    validateEfficiencyThreadId(threadId);
    if (typeof resolveThread !== "function") throw new Error("An authoritative thread resolver is required");
    const record = await resolveThread(threadId);
    if (!record) { const error = new Error("Unknown or unavailable Codex thread"); error.statusCode = 404; throw error; }
    return { threadId, project: record.projectPath ? await canonicalEfficiencyProject(record.projectPath, { platform }) : null };
  }
  function view(state, scope, hookStatus = null) {
    const project = scope.project ? state.projects[scope.project.key] || {} : {};
    const thread = scope.threadId ? state.threads[scope.threadId] || {} : {};
    const saved = scope.threadId ? state.contexts[scope.threadId] : null;
    const result = { schemaVersion: 1, version: state.version, threadId: scope.threadId, projectKey: scope.project?.key || null,
      global: state.global, project, thread, effective: combine(state.global, project, thread),
      context: saved || { version: 0, ...normalizeEfficiencyContext({}), updatedAt: null }, hookStatus };
    result.currentPolicyFingerprint = efficiencyPolicyFingerprint(result);
    if (hookStatus) result.hookStatus = { ...hookStatus, currentPolicyFingerprint: result.currentPolicyFingerprint,
      matchesCurrent: result.effective.enabled && hookStatus.lastEmittedFingerprint === result.currentPolicyFingerprint };
    return result;
  }
  return {
    rootDir, filePath, hookPath, resolveScope: scopeFor,
    async read({ threadId } = {}) {
      const scope = await scopeFor(threadId);
      const state = validateState(await readEfficiencyJson(filePath, blankState()));
      const events = await readEfficiencyJson(hookPath, { schemaVersion: 1, sessions: {} });
      return view(state, scope, scope.threadId ? events.sessions?.[scope.threadId]?.status || null : null);
    },
    async setPolicy({ scope = "global", threadId, expectedVersion, patch } = {}) {
      if (!["global", "project", "thread"].includes(scope)) throw new TypeError("Unknown policy scope");
      const resolved = await scopeFor(threadId);
      if (scope !== "global" && !resolved.threadId) throw new TypeError("Scoped policy requires threadId");
      if (scope === "project" && !resolved.project) throw new TypeError("Thread has no associated project");
      const normalized = normalizeEfficiencyPolicy(patch);
      return withEfficiencyFileLock(filePath, async () => {
        const state = validateState(await readEfficiencyJson(filePath, blankState()));
        if (expectedVersion !== state.version) throw new EfficiencyConflictError(state.version);
        const target = scope === "global" ? state.global : (scope === "project" ? (state.projects[resolved.project.key] ||= {}) : (state.threads[threadId] ||= {}));
        for (const [key, value] of Object.entries(normalized)) { if (value === null) delete target[key]; else target[key] = value; }
        state.version += 1;
        await writeEfficiencyJson(filePath, state);
        return view(state, resolved);
      });
    },
    async setContext({ threadId, expectedVersion, context } = {}) {
      if (!threadId) throw new TypeError("Context requires threadId");
      const resolved = await scopeFor(threadId);
      const normalized = normalizeEfficiencyContext(context);
      return withEfficiencyFileLock(filePath, async () => {
        const state = validateState(await readEfficiencyJson(filePath, blankState()));
        const current = state.contexts[threadId]?.version || 0;
        if (expectedVersion !== current) throw new EfficiencyConflictError(current);
        if (!state.contexts[threadId] && Object.keys(state.contexts).length >= 1024) throw new Error("Context capacity reached; remove unused contexts first");
        state.contexts[threadId] = { ...normalized, version: current + 1, updatedAt: new Date().toISOString() };
        await writeEfficiencyJson(filePath, state);
        return view(state, resolved);
      });
    },
  };
}
