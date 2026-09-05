import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { injectionRuntimeNeedsRefresh, reconcileInjectionRuntime, taskboardServiceAction } from "../vendor/codex-taskboard/scripts/codex-injector-runtime.mjs";
import { createRuntimePlan } from "../lib/runtime-plan.mjs";

const source = readFileSync(new URL("../vendor/codex-taskboard/scripts/codex-injector.mjs", import.meta.url), "utf8");
const target = { id: "synthetic-renderer", title: "Codex", url: "app://codex", webSocketDebuggerUrl: "ws://synthetic" };
const sourceHash = "synthetic-source-v1";
const injectionSource = "SYNTHETIC_INJECTION_SOURCE";

function injectorHarness({ initiallyInjected = false } = {}) {
  const instances = [], logs = [];
  const renderer = { epoch: 1, assetFrame: {}, sourceHash: initiallyInjected ? sourceHash : null, entryMounted: initiallyInjected, scriptIdentifier: null };
  class Cdp {
    constructor() { this.calls = []; this.closed = false; this.handlers = new Map(); instances.push(this); }
    async open() {}
    close() { this.closed = true; }
    on(name, callback) { this.handlers.set(name, callback); }
    async waitFor() {}
    async send(method, params = {}) {
      this.calls.push({ method, params });
      if (method === "Page.reload") { renderer.epoch++; renderer.assetFrame = null; return {}; }
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: `registered-${instances.length}` };
      if (method === "Runtime.evaluate") {
        if (params.expression.includes("entryMounted:")) {
          if (this.failHealth) throw new Error("Synthetic health timeout");
          if (this.invalidHealth) return { exceptionDetails: { text: "Context changing" }, result: {} };
          return { result: { value: { ...renderer, pageVisible: false, frameUrl: null } } };
        }
        if (params.expression === injectionSource) { renderer.sourceHash = sourceHash; renderer.entryMounted = true; }
        return { result: {} };
      }
      return {};
    }
  }
  const context = vm.createContext({
    CdpConnection: Cdp, injectionRuntimeNeedsRefresh, reconcileInjectionRuntime,
    injectionScriptIdentifierName: "SCRIPT_IDENTIFIER", hostHeartbeatName: "HEARTBEAT", hostStartupTokenName: "STARTUP",
    installTaskboardHostBinding: async () => {}, publishHostHeartbeat: async () => {},
    waitForFrame: async () => true, writeFile: async () => {}, Buffer, setTimeout,
    codexTargets: async () => [target], console: { error: (line) => logs.push(line) },
  });
  vm.runInContext(source.slice(source.indexOf("async function readInjectionStatus("), source.indexOf("async function currentInjectionSource(")), context);
  const connections = new Map();
  const injectAll = (options = {}) => context.injectAll(9231, injectionSource, sourceHash, false, null, connections, options.keepAlive ?? true, {}, options.attachExisting ?? false, "test-startup");
  return { context, renderer, instances, connections, logs, injectAll };
}

test("resident watch injects and reconnects without Page.reload even when attach-existing was omitted", async () => {
  const h = injectorHarness();
  const assetFrame = h.renderer.assetFrame;
  await h.injectAll();
  assert.equal(h.renderer.entryMounted, true);
  assert.equal(h.instances.length, 1);
  h.instances[0].closed = true;
  await h.injectAll();
  assert.equal(h.instances.length, 2);
  assert.equal(h.renderer.epoch, 1);
  assert.equal(h.renderer.assetFrame, assetFrame);
  assert.equal(h.instances.flatMap((cdp) => cdp.calls).some((call) => call.method === "Page.reload"), false);
  assert.equal(h.connections.get(target.id), h.instances[1]);
});

test("a status timeout or invalid evaluation retains the existing connection and panels", async () => {
  const h = injectorHarness({ initiallyInjected: true });
  await h.injectAll();
  const connection = h.connections.get(target.id);
  connection.failHealth = true;
  await h.injectAll();
  assert.equal(h.connections.get(target.id), connection);
  assert.equal(connection.closed, false);
  assert.equal(h.instances.length, 1);
  const diagnostic = JSON.parse(h.logs[0]);
  assert.equal(diagnostic.event, "health-read-deferred");
  assert.equal(diagnostic.action, "preserve-renderer");
  assert.ok(Date.parse(diagnostic.at));
  connection.failHealth = false;
  connection.invalidHealth = true;
  await h.injectAll();
  assert.equal(h.connections.get(target.id), connection);
  connection.invalidHealth = false;
  await h.injectAll();
  assert.equal(connection.taskboardHealthFailures, 0);
  assert.equal(h.renderer.epoch, 1);
});

test("initial status failure closes only the new transport and never falls back to renderer refresh", async () => {
  const h = injectorHarness();
  const Cdp = h.context.CdpConnection;
  h.context.CdpConnection = class extends Cdp { constructor(...args) { super(...args); this.failHealth = true; } };
  await assert.rejects(h.injectAll(), /health timeout/);
  assert.equal(h.instances[0].closed, true);
  assert.equal(h.renderer.epoch, 1);
  assert.equal(h.instances[0].calls.some((call) => call.method === "Page.reload"), false);
});

test("one-shot manual refresh remains explicit and one-shot attach does not retain a socket", async () => {
  const manual = injectorHarness();
  await manual.injectAll({ keepAlive: false, attachExisting: false });
  assert.equal(manual.renderer.epoch, 2);
  assert.equal(manual.instances[0].closed, true);
  const attach = injectorHarness();
  await attach.injectAll({ keepAlive: false, attachExisting: true });
  assert.equal(attach.renderer.epoch, 1);
  assert.equal(attach.instances[0].closed, true);
});

test("managed attach still starts a missing Taskboard service while external attach never takes ownership", async () => {
  const plan = createRuntimePlan({ root: "/synthetic", platform: "darwin", home: "/Users/test", environment: {} });
  const child = plan.children.find((item) => item.name === "taskboard");
  assert.ok(child.args.includes("--attach-existing"));
  assert.equal(child.env.CODEX_TASKBOARD_MANAGE_SERVICE, "1");
  let starts = 0;
  const context = vm.createContext({
    process: { env: { CODEX_TASKBOARD_MANAGE_SERVICE: "1" } }, taskboardServiceAction,
    taskboardHealthUrl: "http://synthetic/health", isReachable: async () => false,
    waitUntilReachable: async () => {}, console: { error() {} },
    startTaskboard: () => { starts++; return { once() {}, unref() {}, exitCode: null, killed: false, kill() {} }; },
  });
  vm.runInContext(source.slice(source.indexOf("function createTaskboardSupervisor("), source.indexOf("function codexPids(")), context);
  const managed = context.createTaskboardSupervisor({ detached: false, attachExisting: true });
  const result = await managed.ensure();
  assert.equal(result.restarted, true);
  assert.equal(starts, 1);
  context.process.env = {};
  const external = context.createTaskboardSupervisor({ detached: false, attachExisting: true });
  await assert.rejects(external.ensure(), /Canonical Taskboard service is unavailable/);
  assert.equal(starts, 1);
});
