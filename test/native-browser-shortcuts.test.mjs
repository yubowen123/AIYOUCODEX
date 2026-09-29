import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { normalizeManagedShortcuts } from "../lib/managed-shortcuts.mjs";

const source = await readFile(process.env.AIYOU_NATIVE_SHORTCUT_SOURCE_PATH
  || new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
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
    RENDERER_TARGET_ID_GLOBAL: "__CODEX_SIDEBAR_RENDERER_TARGET_ID__",
    threadId: "11111111-1111-4111-8111-111111111111", nativeShortcutThreadId: () => context.threadId,
    closeOtherWorkspacePanels: () => {},
    normalizedManagedShortcuts: () => [item],
    showNativeShortcutNotice: (text) => notices.push(text),
    setTimeout: (fn) => { timers.push(fn); return fn; },
  });
  for (const name of ["validShortcutUrl", "shortcutItemKey", "nativeShortcutContext", "nativeShortcutIsCurrent", "nativeShortcutStatus",
    "openNativeBrowserShortcut", "handleNativeShortcutMessage"]) vm.runInContext(functionSource(name), context);
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
  assert.equal(f.sent[0].url, item.url);
  assert.equal(f.sent[0].open, true);
  assert.equal(f.sent[0].type, "toggle-browser-panel");
  f.state(record, { committedUrl: item.url, isLoading: false, isWaitingForResponse: false });
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
  assert.equal(f.open().reason, "current-route-unavailable");
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

test("new host client task aliases confirm the unique owned browser tab", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  const alias = "client-new-thread:33333333-3333-4333-8333-333333333333";
  f.state(record, { isLoading: true });
  f.state({ ...record, conversationId: alias }, { committedUrl: item.url, isLoading: false, isWaitingForResponse: false });
  f.state(record, { committedUrl: item.url, isLoading: false, isWaitingForResponse: false });
  assert.equal(record.status, "loaded");
  assert.equal(record.hostConversationId, alias);
  f.open({ toggle: true });
  assert.equal(f.sent.at(-1).conversationId, alias);
  assert.equal("url" in f.sent.at(-1), false);
});

test("a confirmed empty native tab receives its URL once, using the host task identity", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  const alias = "client-new-thread:33333333-3333-4333-8333-333333333333";
  const blank = { url: "about:blank", committedUrl: "", isLoading: false, isWaitingForResponse: false };
  f.state({ ...record, conversationId: alias }, blank);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].url, item.url);
  assert.equal(f.sent[1].browserTabId, record.browserTabId);
  assert.equal(f.sent[1].conversationId, alias);
  f.state({ ...record, conversationId: alias }, blank);
  f.open({ toggle: true });
  f.state({ ...record, conversationId: alias }, blank);
  assert.equal(f.sent.filter((message) => "url" in message).length, 2, "No repair loop or repeated canvas navigation");
});

test("old unconfirmed records recover a blank tab without creating another tab", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  delete record.recoverBlankOnShow;
  record.status = "unconfirmed";
  const next = fixture(f.records);
  next.open({ toggle: true });
  assert.equal(next.sent[0].open, true, "An unresolved tab is revealed, not toggled closed");
  assert.equal("url" in next.sent[0], false, "Unknown pages must not be reloaded");
  next.state(record, { tabType: "new-tab-page", isLoading: false, isWaitingForResponse: false });
  assert.equal(next.sent[1].browserTabId, record.browserTabId);
  assert.equal(next.sent[1].url, item.url);
  assert.equal(next.records.size, 1);
});

test("loading, missing snapshots, login redirects and existing canvases cannot trigger blank recovery", () => {
  for (const snapshot of [{}, { url: "about:blank", isLoading: true, isWaitingForResponse: false },
    { url: "https://login.example/", committedUrl: "about:blank", isLoading: false, isWaitingForResponse: false },
    { url: item.url + "saved-work", isLoading: false, isWaitingForResponse: false }]) {
    const f = fixture();
    f.open();
    const record = [...f.records.values()][0];
    f.state(record, snapshot);
    assert.equal(f.sent.length, 1);
    if (record.hasNavigated) {
      f.state(record, { url: "about:blank", isLoading: false, isWaitingForResponse: false });
      assert.equal(f.sent.length, 1, "Never replace a page the user has navigated");
    }
  }
});

test("an internal alias cannot bind a background task or replace a previously bound alias", () => {
  const f = fixture();
  f.open();
  const record = [...f.records.values()][0];
  const alias = "client-new-thread:33333333-3333-4333-8333-333333333333";
  const loaded = { committedUrl: item.url, isLoading: false, isWaitingForResponse: false };
  f.context.threadId = "another-task";
  f.state({ ...record, conversationId: alias }, loaded);
  assert.equal(record.status, "requested");
  f.context.threadId = record.conversationId;
  f.state({ ...record, conversationId: alias }, loaded);
  f.state({ ...record, conversationId: "client-new-thread:44444444-4444-4444-8444-444444444444" }, { loadError: {} });
  assert.equal(record.status, "loaded");
});

test("the active sidebar task takes precedence over multi-selected cards", () => {
  const f = fixture();
  const id = f.context.threadId;
  f.context.normalizedThreadId = (value) => value.replace(/^local:/, "");
  const row = (id, active, selected) => ({ getAttribute: (key) => ({
    "data-app-action-sidebar-thread-id": "local:" + id,
    "data-app-action-sidebar-thread-active": String(active),
    "data-app-action-sidebar-thread-selected": String(selected),
  })[key] });
  f.context.document = { querySelectorAll: () => [row(id, true, false), row("22222222-2222-4222-8222-222222222222", false, true)] };
  vm.runInContext(functionSource("nativeShortcutThreadId"), f.context);
  assert.equal(f.context.nativeShortcutThreadId(), id);
});
test("a stale initialRoute is never treated as the current task identity", () => {
  const f = fixture();
  const id = "33333333-3333-4333-8333-333333333333";
  f.context.document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '[data-thread-find-target="conversation"]' ? {} : null,
  };
  f.context.window.location.href = `app://-/index.html?initialRoute=%2Flocal%2F${id}`;
  vm.runInContext(functionSource("nativeShortcutThreadId"), f.context);
  assert.equal(f.context.nativeShortcutThreadId(), "");
  assert.equal(f.context.nativeShortcutContext(), null, "launch route alone cannot own a browser tab");
  f.context.window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = "current-window";
  f.context.window.navigation = { currentEntry: { key: "current-route", url: "app://-/local/current" } };
  assert.equal(f.context.nativeShortcutContext().conversationId, "", "host must resolve the current route");
  assert.match(f.context.nativeShortcutContext().scopeKey, /current-window:current-route/);
});

test("host-resolved routes open without a guessed conversation ID and bind only their own receipt", () => {
  const f = fixture();
  f.context.threadId = "";
  f.window.location.href = "app://-/index.html?initialRoute=%2Flocal%2Fold-thread";
  f.window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = "current-window";
  f.window.navigation = { currentEntry: { key: "route-one", url: "app://-/index.html" } };
  assert.equal(f.open().status, "requested");
  assert.equal("conversationId" in f.sent[0], false);
  const record = [...f.records.values()][0];
  const hostId = "client-new-thread:33333333-3333-4333-8333-333333333333";
  f.state({ ...record, conversationId: hostId }, { committedUrl: item.url, isLoading: false, isWaitingForResponse: false });
  assert.equal(record.status, "loaded");
  assert.equal(record.hostConversationId, hostId);
  f.open({ toggle: true });
  assert.equal(f.sent.at(-1).browserTabId, record.browserTabId);
  assert.equal(f.sent.at(-1).conversationId, hostId);
  assert.equal("url" in f.sent.at(-1), false);
  f.window.navigation.currentEntry.key = "route-two";
  f.open();
  assert.equal(f.records.size, 2, "a different route must not reuse the prior canvas tab");
  assert.equal("conversationId" in f.sent.at(-1), false);
});

test("shortcut status distinguishes missing route, requested tab and host-confirmed page without exposing the URL", () => {
  const f = fixture();
  f.context.threadId = "";
  assert.equal(f.context.nativeShortcutStatus(item.id).reason, "current-route-unavailable");
  f.window.location.href = "app://-/index.html";
  f.window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = "current-window";
  f.window.navigation = { currentEntry: { key: "route-one", url: "app://-/index.html" } };
  assert.equal(f.context.nativeShortcutStatus(item.id).status, "idle");
  f.open();
  const record = [...f.records.values()][0];
  assert.equal(f.context.nativeShortcutStatus(item.id).status, "requested");
  f.state({ ...record, conversationId: "client-new-thread:33333333-3333-4333-8333-333333333333" },
    { committedUrl: item.url, isLoading: false, isWaitingForResponse: false });
  const status = f.context.nativeShortcutStatus(item.id);
  assert.equal(status.status, "loaded");
  assert.equal(status.hasHostReceipt, true);
  assert.equal(JSON.stringify(status).includes(item.url), false);
});

test("an explicit active sidebar row wins over a stale window initial route", () => {
  const f = fixture();
  const current = "22222222-2222-4222-8222-222222222222";
  f.context.normalizedThreadId = (value) => value.replace(/^local:/, "");
  f.context.document = {
    querySelectorAll: () => [{
      getAttribute: (key) => ({
        "data-app-action-sidebar-thread-id": "local:" + current,
        "data-app-action-sidebar-thread-active": "true",
      })[key],
    }],
    querySelector: () => ({}),
  };
  f.context.window.location.href = "app://-/index.html?initialRoute=%2Flocal%2F33333333-3333-4333-8333-333333333333";
  vm.runInContext(functionSource("nativeShortcutThreadId"), f.context);
  assert.equal(f.context.nativeShortcutThreadId(), current);
});
