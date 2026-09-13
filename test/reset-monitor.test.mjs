import assert from "node:assert/strict";
import test from "node:test";
import { createResetMonitorController, resetIntervalHours } from "../lib/reset-monitor.mjs";

const original = () => ({ id: "fixture-reset", name: "重置公告", kind: "heartbeat", status: "ACTIVE",
  prompt: "按已保存计划检查 @thsottiaux，运行 scripts/reset-announcements.mjs collect，无变化保持安静。",
  targetThreadId: "fixture-thread", notificationPolicy: "failed_runs_only", rrule: "FREQ=HOURLY;INTERVAL=3",
  nextRunAt: 100000, lastRunAt: 1000, createdAt: 100, updatedAt: 1000 });

test("monitor changes the native schedule, reads it back, preserves private fields and survives controller restart", async () => {
  let item = original(), writes = 0;
  const request = async (method, payload) => {
    if (method === "list-automations") return { items: [item, { ...original(), id: "unrelated", prompt: "unrelated" }] };
    writes++; item = { ...item, ...payload, updatedAt: item.updatedAt + 1, nextRunAt: payload.status === "PAUSED" ? null : 999000 };
    return { item };
  };
  const controller = createResetMonitorController({ nativeRequest: request });
  const before = await controller.snapshot();
  const saved = await controller.request({ action: "save", ...before, intervalHours: 6, enabled: true });
  assert.equal(item.rrule, "FREQ=HOURLY;INTERVAL=6");
  assert.equal(saved.intervalHours, 6); assert.equal(saved.nextRunAt, 999000);
  for (const key of ["id", "name", "prompt", "targetThreadId", "notificationPolicy"]) assert.equal(item[key], original()[key]);
  assert.equal(writes, 1);
  assert.deepEqual(await createResetMonitorController({ nativeRequest: request }).snapshot(), saved);
  await controller.request({ action: "save", ...saved, intervalHours: 6, enabled: true });
  assert.equal(writes, 1, "Unchanged saves do not reset the next run");
  const paused = await controller.request({ action: "save", ...saved, intervalHours: 6, enabled: false });
  assert.equal(paused.enabled, false); assert.equal(paused.nextRunAt, null);
  const resumed = await controller.request({ action: "save", ...paused, intervalHours: 3, enabled: true });
  assert.equal(resumed.enabled, true); assert.equal(resumed.intervalHours, 3);
});

test("invalid hours, stale window, missing and duplicate plans never write", async () => {
  for (const value of [0, -1, 1.5, 169, NaN, Infinity, "3", null]) assert.throws(() => resetIntervalHours(value));
  for (const value of [1, 3, 168]) assert.equal(resetIntervalHours(value), value);
  let items = [original()], writes = 0;
  const controller = createResetMonitorController({ nativeRequest: async method => {
    if (method !== "list-automations") writes++;
    return { items };
  } });
  const before = await controller.snapshot();
  items[0] = { ...items[0], prompt: items[0].prompt + "新要求" };
  await assert.rejects(controller.request({ action: "save", ...before, enabled: true, intervalHours: 5 }), /已变化/);
  items = []; assert.equal((await controller.snapshot({ refresh: true })).configured, false);
  await assert.rejects(controller.request({ action: "save", ...before, enabled: true, intervalHours: 5 }), /不存在/);
  items = [original(), { ...original(), id: "duplicate" }];
  const duplicate = await controller.snapshot({ refresh: true });
  assert.equal(duplicate.available, false); assert.match(duplicate.message, /多个/);
  assert.equal(writes, 0);
});

test("read failure retains cached interval; failed or unverified save is never reported as success or retried", async () => {
  let broken = false, writes = 0;
  const controller = createResetMonitorController({ nativeRequest: async method => {
    if (method === "list-automations") { if (broken) throw Error("offline"); return { items: [original()] }; }
    writes++; return { item: original() };
  } });
  const before = await controller.snapshot(); broken = true;
  const failed = await controller.snapshot({ refresh: true });
  assert.equal(failed.available, false); assert.equal(failed.intervalHours, 3);
  broken = false;
  await assert.rejects(controller.request({ action: "save", ...before, intervalHours: 6, enabled: true }), /未确认计划/);
  assert.equal(writes, 1);
});

test("concurrent windows cannot submit two schedule changes", async () => {
  let item = original(), release, writes = 0;
  const held = new Promise(resolve => { release = resolve; });
  const controller = createResetMonitorController({ nativeRequest: async (method, payload) => {
    if (method === "list-automations") return { items: [item] };
    writes++; await held; item = { ...item, ...payload, updatedAt: 2000 }; return { item };
  } });
  const before = await controller.snapshot();
  const first = controller.request({ action: "save", ...before, intervalHours: 4, enabled: true });
  await assert.rejects(controller.request({ action: "save", ...before, intervalHours: 5, enabled: true }), /另一窗口/);
  release(); assert.equal((await first).intervalHours, 4); assert.equal(writes, 1);
});
