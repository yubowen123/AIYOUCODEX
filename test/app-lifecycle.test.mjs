import assert from "node:assert/strict";
import test from "node:test";
import { createAppLifecycleController } from "../lib/app-lifecycle.mjs";

const host = { pid: 42, appPath: "/Applications/Codex.app", bundleId: "com.openai.codex", debuggingPort: 9231 };

test("one exit serves concurrent windows and suppresses recovery until an explicitly reopened host", async () => {
  let current = host;
  let release;
  const calls = [];
  const controller = createAppLifecycleController({ platform: "darwin", desktopRuntime: {
    readProcess: async () => current,
    quit: async app => { calls.push(app); await new Promise(resolve => { release = resolve; }); current = null; },
  } });
  assert.deepEqual(controller.request({ action: "snapshot" }), { supported: true });
  const first = controller.request({ action: "quit", pid: 99999, appPath: "/other/app" });
  const second = controller.request({ action: "quit" });
  await Promise.resolve();
  assert.equal(controller.shouldRecover(host), false);
  assert.equal(controller.shouldRecover(null), false);
  assert.deepEqual(calls, [host]);
  release();
  assert.deepEqual(await first, { closed: true });
  assert.deepEqual(await second, { closed: true });
  assert.deepEqual(await controller.request({ action: "quit" }), { closed: true });
  assert.equal(calls.length, 1);
  current = { ...host, pid: 84 };
  await controller.observeRunningHost();
  assert.equal(controller.shouldRecover(current), true);
});

test("native quit errors allow retry and restore ordinary recovery", async () => {
  let current = host;
  let calls = 0;
  const controller = createAppLifecycleController({ platform: "darwin", desktopRuntime: {
    readProcess: async () => current,
    quit: async () => { if (++calls === 1) throw new Error("native close failed"); current = null; },
  } });
  await assert.rejects(controller.request({ action: "quit" }), { code: "APP_EXIT_ERROR" });
  assert.equal(controller.shouldRecover(host), true);
  assert.deepEqual(await controller.request({ action: "quit" }), { closed: true });
  assert.equal(calls, 2);
});

test("canceled native quit reports that the app is still running", async () => {
  let calls = 0;
  const controller = createAppLifecycleController({ platform: "win32", attempts: 2, wait: async () => {}, desktopRuntime: {
    readProcess: async () => host, quit: async () => { calls += 1; },
  } });
  await assert.rejects(controller.request({ action: "quit" }), /应用尚未退出/);
  assert.equal(calls, 1);
  assert.equal(controller.shouldRecover(host), true);
});

test("unsupported platforms, missing hosts and another debug instance never trigger quit", async () => {
  let calls = 0;
  for (const [platform, current] of [["linux", host], ["darwin", null], ["win32", { ...host, debuggingPort: 9999 }], ["darwin", { ...host, debuggingPort: undefined }]]) {
    const controller = createAppLifecycleController({ platform, desktopRuntime: {
      readProcess: async () => current, quit: async () => { calls += 1; },
    } });
    await assert.rejects(controller.request({ action: "quit" }), { code: "APP_EXIT_ERROR" });
  }
  assert.equal(calls, 0);
});

test("an unrelated process appearing after native quit is left running", async () => {
  let current = host;
  const calls = [];
  const next = { ...host, pid: 100 };
  const controller = createAppLifecycleController({ platform: "win32", desktopRuntime: {
    readProcess: async () => current,
    quit: async app => { calls.push(app); current = next; },
  } });
  assert.deepEqual(await controller.request({ action: "quit" }), { closed: true });
  assert.deepEqual(calls, [host]);
  assert.equal(controller.shouldRecover(next), true);
  assert.throws(() => controller.request({ action: "restart" }), { code: "APP_EXIT_ERROR" });
});
