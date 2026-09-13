import { createHash, randomUUID } from "node:crypto";

export const RESET_MONITOR_BINDING = "__aiyoucodexResetMonitorRequest__";
const fail = (message) => Object.assign(new Error(message), { code: "RESET_MONITOR_ERROR" });

export function resetIntervalHours(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 168) {
    throw fail("请输入 1–168 之间的整数小时。");
  }
  return value;
}

function intervalFromRule(rule) {
  const match = /^(?:RRULE:)?FREQ=HOURLY;INTERVAL=(\d+)$/i.exec(rule || "");
  const value = match ? Number(match[1]) : null;
  return value >= 1 && value <= 168 ? value : null;
}

function selectMonitor(items) {
  if (!Array.isArray(items)) throw fail("未读到 Codex 的定时计划，请稍后刷新。");
  const matches = items.filter((item) => item.kind === "heartbeat" && item.status !== "DELETED"
    && /thsottiaux/i.test(item.prompt || "") && /reset-announcements\.mjs/.test(item.prompt || ""));
  if (matches.length > 1) throw fail("发现多个重置监控计划，请先在 Codex 已安排中保留一个，避免重复监控。");
  return matches[0] || null;
}

function revision(item) {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 24);
}

function present(item) {
  return { available: true, configured: Boolean(item), id: item?.id || null,
    revision: item ? revision(item) : null, enabled: item?.status === "ACTIVE",
    intervalHours: item ? intervalFromRule(item.rrule) : 3,
    nextRunAt: item?.nextRunAt ?? null, lastRunAt: item?.lastRunAt ?? null,
    message: item ? (item.status === "ACTIVE" ? "定时监控已启用" : "定时监控已暂停")
      : "尚未配置：请先在 Codex 对话中要求启用重置公告监控，再回到此处设置间隔。" };
}

/** One shared controller across windows; the native scheduler is the source of truth. */
export function createResetMonitorController({ nativeRequest, now = Date.now } = {}) {
  let cached = null, lastRead = 0, reading = null, saving = false;
  async function read() {
    return selectMonitor((await nativeRequest("list-automations", {})).items);
  }
  async function snapshot({ refresh = false } = {}) {
    if (!refresh && cached && now() - lastRead < 30000) return cached;
    if (reading) return reading;
    reading = (async () => {
      try { cached = present(await read()); }
      catch (error) { cached = { ...cached, available: false, message: error.code === "RESET_MONITOR_ERROR"
        ? error.message : "定时计划暂时无法读取；未修改原计划，请稍后刷新。" }; }
      lastRead = now();
      return cached;
    })().finally(() => { reading = null; });
    return reading;
  }
  return {
    snapshot,
    async request(input) {
      if (input?.action === "snapshot") return snapshot({ refresh: true });
      if (input?.action !== "save") throw fail("不支持的监控操作。");
      const hours = resetIntervalHours(input.intervalHours);
      if (typeof input.enabled !== "boolean") throw fail("请选择是否启用定时监控。");
      if (saving) throw fail("另一窗口正在保存监控设置，请刷新后重试。");
      saving = true;
      try {
        if (reading) await reading;
        const item = await read();
        if (!item) throw fail("原监控计划已不存在，请先在 Codex 对话中重新启用。");
        if (input.id !== item.id || input.revision !== revision(item)) throw fail("监控计划已变化，请刷新后再保存。输入的草稿仍保留。");
        const rrule = `FREQ=HOURLY;INTERVAL=${hours}`;
        const status = input.enabled ? "ACTIVE" : "PAUSED";
        if (item.rrule === rrule && item.status === status) return (cached = present(item));
        // Preserve identity, prompt, target conversation and notification preferences.
        const update = { id: item.id, kind: "heartbeat", name: item.name, prompt: item.prompt,
          targetThreadId: item.targetThreadId, notificationPolicy: item.notificationPolicy ?? null, rrule, status };
        let returned;
        try { returned = (await nativeRequest("automation-update", update)).item; }
        catch { throw fail("保存结果尚未确认，请点击刷新核对实际计划，不要连续重复保存。"); }
        const actual = await read();
        if (returned?.id !== item.id || actual?.id !== item.id || actual.rrule !== rrule || actual.status !== status
          || actual.prompt !== item.prompt || actual.targetThreadId !== item.targetThreadId
          || actual.name !== item.name || (actual.notificationPolicy ?? null) !== (item.notificationPolicy ?? null)) {
          throw fail("未确认计划完整生效，请刷新检查。不会自动重复提交。");
        }
        cached = present(actual); lastRead = now();
        return cached;
      } finally { saving = false; lastRead = 0; }
    },
  };
}

/** Uses the same native fetch contract as Codex's own Scheduled settings. */
export async function requestResetMonitorNative(client, method, params) {
  if (!["list-automations", "automation-update"].includes(method)) throw fail("不支持的监控接口。");
  const requestId = `aiyou-reset-${randomUUID()}`;
  const reply = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true,
    expression: `new Promise((resolve) => {
      const requestId = ${JSON.stringify(requestId)};
      let finished = false;
      const finish = value => { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(value); };
      const onMessage = event => {
        const m = event.data;
        if (event.source !== null && event.source !== window) return;
        if (m?.type !== 'fetch-response' || m.requestId !== requestId) return;
        if (m.status < 200 || m.status >= 300 || typeof m.bodyJsonString !== 'string') return finish({ok:false});
        try { finish({ok:true, data:JSON.parse(m.bodyJsonString)}); } catch { finish({ok:false}); }
      };
      const timer = setTimeout(() => finish({ok:false}), 3500);
      window.addEventListener('message', onMessage);
      try { Promise.resolve(window.electronBridge.sendMessageFromView({type:'fetch', requestId, method:'POST',
        url:${JSON.stringify(`vscode://codex/${method}`)}, body:${JSON.stringify(JSON.stringify(params))}})).catch(() => finish({ok:false})); }
      catch { finish({ok:false}); }
    })` });
  if (reply.exceptionDetails || reply.result?.value?.ok !== true) throw fail("Codex 定时计划接口暂不可用，请刷新后重试。");
  return reply.result.value.data;
}
