import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RESET_MONITOR_BINDING = "__aiyoucodexResetMonitorRequest__";
export const RESET_MONITOR_ID = "aiyoucodex-internal-reset-monitor";
export const monitorError = (message) => Object.assign(new Error(message), { code: "RESET_MONITOR_ERROR" });

export function resetIntervalHours(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 168) {
    throw monitorError("请输入 1–168 之间的整数小时。");
  }
  return value;
}

export function resetIntervalMinutes(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10080) {
    throw monitorError("请输入 1–10080 之间的整数分钟。");
  }
  return value;
}

export function nextResetMonitorRun(config, state, now) {
  if (!config.enabled) return null;
  if (state?.configRevision === config.revision && Number.isFinite(state.nextRunAt)) return state.nextRunAt;
  return Number.isFinite(state?.lastRunAt) ? state.lastRunAt + config.intervalMinutes * 60_000 : now;
}

export function resetMonitorPath(env = process.env) {
  return env.AIYOUCODEX_RESET_MONITOR_PATH
    || path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "aiyoucodex", "reset-monitor.json");
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

/** A dead process may leave a lock behind. Never remove a live owner's lock. */
export async function acquireMonitorLock(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID();
    let handle;
    try { handle = await open(filePath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(filePath, "utf8")); } catch { return null; }
      if (!Number.isSafeInteger(owner.pid) || processAlive(owner.pid)) return null;
      await unlink(filePath).catch(() => {});
      continue;
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
    return async () => {
      await handle.close();
      try {
        const owner = JSON.parse(await readFile(filePath, "utf8"));
        if (owner.token === token) await unlink(filePath);
      } catch {}
    };
  }
  return null;
}

export async function writeMonitorJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, filePath);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function readConfig(filePath) {
  const data = await readFile(filePath, "utf8");
  if (Buffer.byteLength(data) > 16 * 1024) throw monitorError("监控配置过大，未覆盖原有设置。");
  const raw = JSON.parse(data);
  if (raw?.schemaVersion !== 1 || typeof raw.revision !== "string" || typeof raw.enabled !== "boolean") {
    throw monitorError("本地监控配置无效，未覆盖原有设置。");
  }
  const intervalMinutes = raw.intervalMinutes == null
    ? resetIntervalHours(raw.intervalHours) * 60 : resetIntervalMinutes(raw.intervalMinutes);
  return { schemaVersion: 1, revision: raw.revision, enabled: raw.enabled,
    intervalMinutes, intervalHours: intervalMinutes / 60,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0 };
}

export async function readResetMonitorConfig(filePath = resetMonitorPath(), now = Date.now()) {
  try { return await readConfig(filePath); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const release = await acquireMonitorLock(`${filePath}.lock`);
  if (!release) throw monitorError("后台正在初始化监控，请稍后刷新。");
  try {
    try { return await readConfig(filePath); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    // Keep the legacy field a valid integer so an already-running old UI
    // controller can read the file during a rolling backend/UI update.
    const initial = { schemaVersion: 1, revision: randomUUID(), enabled: true, intervalMinutes: 15, intervalHours: 1, updatedAt: now };
    await writeMonitorJson(filePath, initial);
    return { ...initial, intervalHours: initial.intervalMinutes / 60 };
  } finally { await release(); }
}

export async function readResetMonitorStatus(filePath = resetMonitorPath()) {
  try {
    const data = await readFile(`${filePath}.status`, "utf8");
    if (Buffer.byteLength(data) > 16 * 1024) return null;
    const state = JSON.parse(data);
    return state?.schemaVersion === 1 ? state : null;
  } catch { return null; }
}

export function createInternalResetMonitorController({ filePath = resetMonitorPath(), now = Date.now } = {}) {
  async function snapshot() {
    const config = await readResetMonitorConfig(filePath, now());
    const state = await readResetMonitorStatus(filePath);
    const running = state?.running === true && Number.isFinite(state.heartbeatAt)
      && now() - state.heartbeatAt < 90_000 && processAlive(state.pid);
    const nextRunAt = nextResetMonitorRun(config, state, now());
    return { available: true, configured: true, id: RESET_MONITOR_ID, ...config,
      running, nextRunAt, lastRunAt: state?.lastRunAt ?? null, lastStatus: state?.lastStatus ?? "never",
      message: !config.enabled ? "内置监控已暂停" : running ? "内置监控运行中" : "设置已保存，等待 AIYOUcodex 后台连接" };
  }
  return {
    snapshot,
    async request(input) {
      if (input?.action === "snapshot") return snapshot();
      if (input?.action !== "save") throw monitorError("不支持的监控操作。");
      const intervalMinutes = input.intervalMinutes == null
        ? resetIntervalHours(input.intervalHours) * 60 : resetIntervalMinutes(input.intervalMinutes);
      if (typeof input.enabled !== "boolean") throw monitorError("请选择是否启用定时监控。");
      await readResetMonitorConfig(filePath, now());
      const release = await acquireMonitorLock(`${filePath}.lock`);
      if (!release) throw monitorError("另一窗口正在保存监控设置，请刷新后重试。");
      try {
        const current = await readConfig(filePath);
        if (input.id !== RESET_MONITOR_ID || input.revision !== current.revision) {
          throw monitorError("监控设置已变化，请刷新后再保存。输入的草稿仍保留。");
        }
        if (current.enabled !== input.enabled || current.intervalMinutes !== intervalMinutes) {
          await writeMonitorJson(filePath, { ...current, revision: randomUUID(), enabled: input.enabled,
            intervalMinutes, intervalHours: Math.max(1, Math.ceil(intervalMinutes / 60)), updatedAt: now() });
        }
      } finally { await release(); }
      return snapshot();
    },
  };
}
