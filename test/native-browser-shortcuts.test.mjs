import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { normalizeManagedShortcuts } from "../lib/managed-shortcuts.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const functionSource = (name) => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n  function ", start + 1));
};
const item = { id: "workspace", name: "Workspace", url: "https://workspace.example/canvas/", icon: "play", managed: true, openMode: "in-app", keepAlive: true };
function fixture(records = new Map()) {
  let id = 0;
  const sent = [], notices = [], timers = [];
  const window = { location: { origin: "https://host.example" }, electronBridge: { sendMessageFromView() {} }, postMessage: (message) => sent.push(message) };
  const context = vm.createContext({ URL, window, crypto: { randomUUID: () => `fixture-${++id}` },
    nativeShortcutRecords: records, nativeShortcutTimers: new Set(), nativeShortcutNotice: null, destroyed: false,
    threadId: "11111111-1111-4111-8111-111111111111", nativeShortcutThreadId: () => context.threadId,
    closeOtherWorkspacePanels: () => {},
    showNativeShortcutNotice: (text) => notices.push(text),
    setTimeout: (fn) => { timers.push(fn); return fn; },
  });
  for (const name of ["validShortcutUrl", "shortcutItemKey", "openNativeBrowserShortcut", "handleNativeShortcutMessage"]) vm.runInContext(functionSource(name), context);
  const open = (options) => context.openNativeBrowserShortcut(item, options);
  const state = (record, snapshot, overrides = {}) => context.handleNativeShortcutMessage({ source: window, origin: window.location.origin,
    data: { type: "browser-sidebar-state", conversationId: record.conversationId, browserTabId: record.browserTabId, snapshot }, ...overrides });
  return { context, records, sent, notices, timers, open, state, window };
}

test("in-app mode is opt-in; legacy and external modes keep their contract", () => {
  const { managed, ...configured } = item;
  assert.equal(normalizeManagedShortcuts({ schemaVersion: 1, shortcuts: [configured] })[0].openMode, "in-app");
  assert.throws(() => normalizeManagedShortcuts({ schemaVersion: 1, shortcuts: [{ ...configured, openMode: "browser" }] }), /keepAlive/);
});

test("first open navigates once; toggling, reveal and reinjection preserve tab and canvas URL", () => {
  const f = fixture();
  assert.equal(f.open().status, "requested");
  const record = [...f.records.values()][0];
  assert.equal(f.sent[0].initialUrl, item.url);
  assert.equal(f.sent[0].type, "open-browser-tab");
  f.open({ toggle: true });
  f.open();
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[1].type, "toggle-browser-panel");
  assert.equal(f.sent[1].open, undefined, "The native host, not guessed visibility, toggles its current state");
  assert.equal(f.sent[2].open, true);
  for (const message of f.sent.slice(1)) {
    assert.equal(message.browserTabId, record.browserTabId);
    assert.equal("url" in message || "initialUrl" in message, false, "Reopening must not reset a navigated canvas");
  }
  const reattached = fixture(f.records);
  reattached.open();
  assert.equal(reattached.sent[0].browserTabId, record.browserTabId);
  assert.equal(reattached.sent[0].initialUrl, undefined);
});

test("current task and shortcut identities isolate native tabs", () => {
  const f = fixture();
  f.open();
  f.context.threadId = "22222222-2222-4222-8222-222222222222";
  f.open();
  assert.equal(f.records.size, 2);
  assert.notEqual(f.sent[0].browserTabId, f.sent[1].browserTabId);
  f.context.threadId = "";
  assert.equal(f.open().reason, "current-thread-unavailable");
  assert.equal(f.sent.length, 2);
});

test("a request, HTTP URL or an unrelated message cannot confirm successful loading", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  const loaded = { committedUrl: item.url, isLoading: false, isWaitingForResponse: false };
  f.state(record, loaded, { source: {} });
  assert.equal(record.status, "requested");
  f.state(record, loaded, { origin: "https://untrusted.example" });
  f.state({ ...record, conversationId: "other" }, loaded);
  f.state(record, { url: item.url });
  f.state(record, { ...loaded, isLoading: true });
  assert.equal(record.status, "requested");
  f.state(record, loaded);
  assert.equal(record.status, "loaded");
  f.timers[0]();
  assert.equal(record.status, "loaded");
});

test("timeouts and load errors remain explicit and never auto-retry or reload", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  f.timers[0]();
  assert.equal(record.status, "unconfirmed");
  assert.equal(f.sent.length, 1);
  f.state(record, { loadError: { errorDescription: "ERR_CONNECTION_FAILED" } });
  assert.equal(record.status, "failed");
  assert.match(f.notices.at(-1), /加载失败/);
  assert.equal(f.sent.length, 1);
});

test("missing native interface and credential-bearing URLs do not dispatch", () => {
  const f = fixture();
  delete f.window.electronBridge;
  assert.equal(f.open().reason, "native-browser-unavailable");
  assert.equal(f.sent.length, 0);
  assert.equal(f.context.validShortcutUrl("https://user:password@workspace.example/"), null);
});

test("private native shortcuts never use the old hidden iframe warming path", () => {
  const ensure = functionSource("ensureManagedShortcut");
  assert.match(ensure, /native-background-open-unavailable/);
  assert.match(source, /item\.managed && item\.openMode === "in-app"/);
  assert.doesNotMatch(source, /setBypassCSP|webSecurity\s*:\s*false/);
});
