import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEfficiencyController, EfficiencyBridge, EFFICIENCY_BINDING } from "../lib/efficiency-bridge.mjs";

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "aiyou-efficiency-bridge-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const records = new Map([
    ["thread-a", { threadId: "thread-a", projectPath: path.join(rootDir, "project"), title: "First task" }],
    ["thread-b", { threadId: "thread-b", projectPath: path.join(rootDir, "project"), title: "Second task" }],
    ["projectless", { threadId: "projectless", projectPath: null, title: "No project" }],
  ]);
  const activity = { id: "thread-a", sequence: [] };
  const repository = {
    resolveEfficiencyThread: async (id) => records.get(id) || null,
    readTokenUsage: async () => ({ source: "codex-token-count", cumulative: { inputTokens: 0, totalTokens: 0 }, lastRequest: null }),
  };
  const controller = createEfficiencyController({
    rootDir, repository,
    readActiveContext: async () => ({ threadId: activity.sequence.length ? activity.sequence.shift() : activity.id }),
  });
  return { rootDir, controller, repository, records, activity, store: controller.store };
}

async function save(controller, scope, mode, defaultSkills = null, extra = {}) {
  const view = await controller.snapshot();
  return controller.request({ action: "saveScope", scope, mode, defaultSkills, expectedVersion: view.version, expectedTargetKey: view.targetKey, ...extra });
}

test("controller applies global → project → thread inheritance and reset without fabricating token savings", async (t) => {
  const { controller, activity } = await fixture(t);
  let view = await controller.snapshot();
  assert.equal(view.effective.mode, "smart");
  assert.deepEqual(view.scopeAvailable, { project: true, thread: true });
  assert.equal(view.usage.available, true);
  assert.match(view.usage.text, /输入 0.*总计 0/u);
  assert.equal("savingsPercent" in view.usage, false);
  view = await save(controller, "global", "concise", ["skill:first"]);
  assert.deepEqual(view.effective.defaultSkills, ["skill:first"]);
  view = await save(controller, "project", "detailed");
  assert.equal(view.effective.mode, "detailed");
  assert.deepEqual(view.effective.defaultSkills, ["skill:first"]);
  view = await save(controller, "thread", "smart", []);
  assert.equal(view.effective.mode, "smart");
  assert.deepEqual(view.effective.defaultSkills, []);
  activity.id = "thread-b";
  view = await controller.snapshot();
  assert.equal(view.effective.mode, "detailed");
  assert.deepEqual(view.effective.defaultSkills, ["skill:first"]);
  activity.id = "thread-a";
  view = await controller.snapshot();
  view = await controller.request({ action: "resetScope", scope: "thread", expectedVersion: view.version, expectedTargetKey: view.targetKey });
  assert.equal(view.effective.mode, "detailed");
  assert.deepEqual(view.scopes.thread, {});
});

test("stale target keys and a switch during asynchronous resolution reject rather than retarget writes", async (t) => {
  const { controller, store, activity } = await fixture(t);
  const first = await controller.snapshot();
  activity.id = "thread-b";
  await assert.rejects(controller.request({ action: "saveScope", scope: "thread", mode: "concise", defaultSkills: [], expectedTargetKey: first.targetKey, expectedVersion: first.version }), { code: "EFFICIENCY_TARGET_CHANGED" });
  assert.equal((await store.read({ threadId: "thread-b" })).version, 0);
  activity.id = "thread-a";
  activity.sequence = ["thread-a", "thread-b"];
  await assert.rejects(controller.request({ action: "saveScope", scope: "thread", mode: "concise", defaultSkills: [], expectedTargetKey: first.targetKey, expectedVersion: first.version }), { code: "EFFICIENCY_TARGET_CHANGED" });
  assert.equal((await store.read({ threadId: "thread-a" })).version, 0);
  assert.equal((await store.read({ threadId: "thread-b" })).version, 0);
});

test("controller preserves optimistic 409 conflicts for policies and separate context revisions", async (t) => {
  const { controller, store } = await fixture(t);
  const stale = await controller.snapshot();
  await store.setPolicy({ expectedVersion: stale.version, patch: { mode: "detailed" } });
  await assert.rejects(controller.request({ action: "saveScope", scope: "global", mode: "concise", defaultSkills: [], expectedTargetKey: stale.targetKey, expectedVersion: stale.version }), { code: "EFFICIENCY_CONFLICT", statusCode: 409 });
  const current = await controller.snapshot();
  const changed = await controller.request({ action: "saveContext", expectedTargetKey: current.targetKey, expectedContextVersion: 0, context: { goal: "User-approved goal", nextStep: "Run tests" } });
  assert.equal(changed.context.version, 1);
  assert.equal(changed.version, current.version);
  await assert.rejects(controller.request({ action: "saveContext", expectedTargetKey: current.targetKey, expectedContextVersion: 0, context: {} }), { code: "EFFICIENCY_CONFLICT", statusCode: 409 });
  const reset = await controller.request({ action: "resetContext", expectedTargetKey: current.targetKey, expectedContextVersion: 1 });
  assert.equal(reset.context.goal, "");
  assert.equal(reset.context.version, 2);
});

test("renderer-supplied thread and filesystem fields cannot redirect policy or context writes", async (t) => {
  const { controller, store, rootDir } = await fixture(t);
  const view = await save(controller, "thread", "concise", [], {
    threadId: "thread-b", projectPath: "/attacker/project", rootDir: "/attacker/root", filePath: "/attacker/state.json",
  });
  assert.equal(view.effective.mode, "concise");
  assert.equal((await store.read({ threadId: "thread-b" })).effective.mode, "smart");
  await controller.request({
    action: "saveContext", expectedTargetKey: view.targetKey, expectedContextVersion: 0, threadId: "thread-b",
    projectPath: "/attacker/project", context: { goal: "Only current task" },
  });
  assert.equal((await store.read({ threadId: "thread-a" })).context.goal, "Only current task");
  assert.equal((await store.read({ threadId: "thread-b" })).context.goal, "");
  assert.equal(store.filePath, path.join(rootDir, "state.json"));
  const state = JSON.parse(await readFile(store.filePath, "utf8"));
  assert.deepEqual(Object.keys(state.threads), ["thread-a"]);
  assert.doesNotMatch(JSON.stringify(state), /attacker/u);
});

test("loaded receipt is true only for active enabled policy fingerprint and matching thread", async (t) => {
  const { controller, store, activity } = await fixture(t);
  let view = await controller.snapshot();
  assert.equal(view.hookStatus.loaded, false);
  await writeFile(store.hookPath, JSON.stringify({ schemaVersion: 1, sessions: { "thread-a": { status: {
    lastEmittedFingerprint: view.currentPolicyFingerprint, lastEmittedAt: "2026-09-06T12:00:00Z",
  } } } }));
  view = await controller.snapshot();
  assert.equal(view.hookStatus.loaded, true);
  activity.id = "thread-b";
  assert.equal((await controller.snapshot()).hookStatus.loaded, false);
  activity.id = "thread-a";
  view = await save(controller, "global", "concise");
  assert.equal(view.hookStatus.loaded, false);
  await writeFile(store.hookPath, JSON.stringify({ schemaVersion: 1, sessions: { "thread-a": { status: {
    lastEmittedFingerprint: view.currentPolicyFingerprint, lastEmittedAt: "2026-09-06T12:01:00Z",
  } } } }));
  assert.equal((await controller.snapshot()).hookStatus.loaded, true);
  await store.setPolicy({ expectedVersion: view.version, patch: { enabled: false } });
  assert.equal((await controller.snapshot()).hookStatus.loaded, false);
});

test("unknown local task exposes global controls only and cannot save scoped policy or context", async (t) => {
  const { controller, activity, store } = await fixture(t);
  activity.id = "unknown";
  let view = await controller.snapshot();
  assert.deepEqual(view.scopeAvailable, { project: false, thread: false });
  assert.equal(view.usage.available, false);
  view = await save(controller, "global", "concise");
  assert.equal(view.effective.mode, "concise");
  for (const scope of ["project", "thread"]) {
    await assert.rejects(controller.request({ action: "saveScope", scope, mode: "detailed", defaultSkills: [], expectedVersion: view.version, expectedTargetKey: view.targetKey }), /requires threadId/u);
  }
  await assert.rejects(controller.request({ action: "saveContext", expectedTargetKey: view.targetKey, expectedContextVersion: 0, context: {} }), { code: "EFFICIENCY_TARGET_CHANGED" });
  assert.equal((await store.read()).version, view.version);
  activity.id = "projectless";
  assert.deepEqual((await controller.snapshot()).scopeAvailable, { project: false, thread: true });
});

test("controller rejects invalid actions, scopes, skill payloads and unsupported context fields", async (t) => {
  const { controller, store } = await fixture(t);
  const view = await controller.snapshot();
  const base = { action: "saveScope", scope: "global", mode: "concise", defaultSkills: [], expectedVersion: view.version, expectedTargetKey: view.targetKey };
  for (const invalid of [null, [], { action: "execute" }, { ...base, scope: "filesystem" }, { ...base, mode: "silent-unsafe" }, { ...base, defaultSkills: [{ id: "x", path: "/x" }] }]) {
    await assert.rejects(controller.request(invalid));
  }
  await assert.rejects(controller.request({ action: "saveContext", expectedTargetKey: view.targetKey, expectedContextVersion: 0, context: { cwd: "/untrusted" } }));
  assert.equal((await store.read()).version, 0);
});

class Client {
  constructor() { this.listeners = new Map(); this.calls = []; this.currentContexts = []; }
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    return () => this.listeners.get(name)?.delete(handler);
  }
  emit(name, event) { for (const handler of this.listeners.get(name) || []) handler(event); }
  async send(method, params = {}) {
    this.calls.push({ method, params });
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
    if (method === "Runtime.enable") for (const context of this.currentContexts) this.emit("Runtime.executionContextCreated", { context });
    return {};
  }
  responses() {
    return this.calls.filter((call) => call.method === "Runtime.evaluate").map((call) => ({
      contextId: call.params.contextId,
      ...JSON.parse(call.params.expression.match(/\?\.\((.*)\)$/su)[1]),
    }));
  }
}
const context = (id, frameId = "top", isDefault = true) => ({ id, auxData: { frameId, isDefault } });
const binding = (value, executionContextId = 1, name = EFFICIENCY_BINDING) => ({ name, payload: typeof value === "string" ? value : JSON.stringify(value), executionContextId });

test("bridge installs only in the top frame default world and rejects subframe or unknown contexts", async () => {
  let executions = 0;
  const bridge = new EfficiencyBridge({ request: async () => { executions += 1; return { version: executions }; } });
  const client = new Client();
  client.currentContexts = [context(1), context(2, "child"), context(3, "top", false), context(4, "other")];
  await bridge.install(client);
  assert.deepEqual(client.calls.filter((call) => call.method === "Runtime.addBinding").map((call) => call.params.executionContextId), [1]);
  for (const id of [2, 3, 4, 999]) await bridge.receive(binding({ requestId: "ignored-" + id, action: "refresh" }, id));
  await bridge.receive(binding({ requestId: "wrong-binding", action: "refresh" }, 1, "other"));
  assert.equal(executions, 0);
  assert.equal(client.responses().length, 0);
  await bridge.receive(binding({ requestId: "valid", action: "refresh" }));
  assert.equal(executions, 1);
  assert.equal(client.responses()[0].contextId, 1);
  assert.equal(client.responses()[0].ok, true);
  bridge.dispose();
});

test("bridge rejects malformed or oversized payloads, and a duplicate request executes only once", async () => {
  let executions = 0;
  const bridge = new EfficiencyBridge({ request: async () => { executions += 1; return {}; } });
  const client = new Client(); client.currentContexts = [context(1)];
  await bridge.install(client);
  for (const payload of ["not JSON", "null", "[]", JSON.stringify({}), JSON.stringify({ requestId: 123 }), JSON.stringify({ requestId: true }), JSON.stringify({ requestId: "<script>" }), JSON.stringify({ requestId: "x".repeat(101) }), JSON.stringify({ requestId: "large", data: "x".repeat(16_384) })]) {
    await bridge.receive(binding(payload));
  }
  assert.equal(executions, 0);
  const event = binding({ requestId: "same", action: "saveScope" });
  await Promise.all([bridge.receive(event), bridge.receive(event), bridge.receive(event)]);
  assert.equal(executions, 1);
  assert.equal(client.responses().length, 1);
  bridge.dispose();
});

test("bridge sanitizes conflicts and generic failures without exposing local errors", async () => {
  const bridge = new EfficiencyBridge({ request: async (payload) => {
    if (payload.requestId === "conflict") throw Object.assign(new Error("/private/state.json"), { code: "EFFICIENCY_CONFLICT" });
    if (payload.requestId === "stale") throw Object.assign(new Error("当前任务已切换"), { code: "EFFICIENCY_TARGET_CHANGED" });
    throw new Error("secret /private/path");
  } });
  const client = new Client(); client.currentContexts = [context(1)];
  await bridge.install(client);
  for (const requestId of ["conflict", "stale", "other"]) await bridge.receive(binding({ requestId, action: "refresh" }));
  const responses = client.responses();
  assert.ok(responses.every((response) => response.ok === false));
  assert.match(responses[0].error, /其他窗口/u);
  assert.match(responses[1].error, /任务已切换/u);
  assert.doesNotMatch(JSON.stringify(responses), /private|secret/u);
  bridge.dispose();
});

test("reviewed Chinese context uses a bounded larger envelope without widening ordinary settings", async () => {
  const received = [];
  const bridge = new EfficiencyBridge({ request: async (payload) => { received.push(payload.action); return {}; } });
  const client = new Client(); client.currentContexts = [context(1)];
  await bridge.install(client);
  for (const action of ["saveContext", "previewContextExecution", "prepareContextExecution"]) {
    await bridge.receive(binding({ requestId: action, action, context: { progress: "测".repeat(6000) } }));
  }
  await bridge.receive(binding({ requestId: "large-normal", action: "saveScope", data: "测".repeat(6000) }));
  await bridge.receive(binding({ requestId: "unbounded-context", action: "prepareContextExecution", data: "测".repeat(24000) }));
  assert.deepEqual(received, ["saveContext", "previewContextExecution", "prepareContextExecution"]);
  bridge.dispose();
});

test("context destruction and bridge reinstallation suppress stale async responses", async () => {
  let resolveRequest;
  const bridge = new EfficiencyBridge({ request: () => new Promise((resolve) => { resolveRequest = resolve; }) });
  const first = new Client(); first.currentContexts = [context(1)];
  await bridge.install(first);
  const pending = bridge.receive(binding({ requestId: "old", action: "refresh" }));
  first.emit("Runtime.executionContextDestroyed", { executionContextId: 1 });
  resolveRequest({ version: 1 });
  await pending;
  assert.equal(first.responses().length, 0);
  first.emit("Runtime.executionContextCreated", { context: context(1) });
  const another = bridge.receive(binding({ requestId: "old-generation", action: "refresh" }));
  const second = new Client(); second.currentContexts = [context(7)];
  await bridge.install(second);
  resolveRequest({ version: 2 });
  await another;
  assert.equal(first.responses().length, 0);
  assert.equal(second.responses().length, 0);
  assert.ok([...first.listeners.values()].every((handlers) => handlers.size === 0));
  bridge.dispose();
});

test("binding transport and real controller commit one revision for repeated identical requests", async (t) => {
  const { controller, store } = await fixture(t);
  const view = await controller.snapshot();
  const bridge = new EfficiencyBridge(controller);
  const client = new Client(); client.currentContexts = [context(1), context(2, "asset-frame")];
  await bridge.install(client);
  t.after(() => bridge.dispose());
  const payload = {
    requestId: "real-save", action: "saveScope", scope: "thread", mode: "concise", defaultSkills: [],
    expectedTargetKey: view.targetKey, expectedVersion: view.version,
  };
  await bridge.receive(binding(payload, 2));
  assert.equal((await store.read()).version, 0);
  await Promise.all([bridge.receive(binding(payload)), bridge.receive(binding(payload))]);
  assert.equal((await store.read({ threadId: "thread-a" })).version, 1);
  assert.equal((await store.read({ threadId: "thread-a" })).effective.mode, "concise");
  assert.equal(client.responses().length, 1);
  assert.equal(client.responses()[0].data.version, 1);
  assert.equal(client.responses()[0].ok, true);
  await bridge.receive(binding({ ...payload, requestId: "stale-revision" }));
  assert.equal(client.responses().length, 2);
  assert.equal(client.responses()[1].ok, false);
  assert.match(client.responses()[1].error, /其他窗口/u);
  assert.equal((await store.read()).version, 1);
});
