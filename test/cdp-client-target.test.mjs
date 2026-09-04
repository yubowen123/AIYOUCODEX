import assert from "node:assert/strict";
import test from "node:test";

import {
  selectMainCodexTarget,
  selectMainCodexTargets,
} from "../scripts/cdp-client.mjs";

function target(overrides = {}) {
  return {
    id: "main",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1/main",
    ...overrides,
  };
}

test("main Codex target accepts the ChatGPT title used by current desktop builds", () => {
  const overlay = target({
    id: "overlay",
    title: "ChatGPT",
    url: "app://-/index.html?initialRoute=%2Favatar-overlay",
    webSocketDebuggerUrl: "ws://127.0.0.1/overlay",
  });
  const main = target({ title: "ChatGPT" });

  assert.equal(selectMainCodexTarget([overlay, main]), main);
});

test("all normal top-level Codex windows are selected, including windows opened on a task route", () => {
  const first = target({ id: "window-1", title: "ChatGPT" });
  const second = target({
    id: "window-2",
    title: "ChatGPT",
    url: "app://-/index.html?initialRoute=%2Flocal%2F019d1234-5678-7000-8000-abcdefabcdef",
    webSocketDebuggerUrl: "ws://127.0.0.1/window-2",
  });
  const overlay = target({
    id: "overlay",
    title: "ChatGPT",
    url: "app://-/index.html?initialRoute=%2Favatar-overlay",
    webSocketDebuggerUrl: "ws://127.0.0.1/overlay",
  });

  assert.deepEqual(selectMainCodexTargets([first, overlay, second]), [first, second]);
});

test("the legacy single-target helper prefers a routed conversation over an empty root window", () => {
  const emptyRoot = target({ id: "empty-root", title: "ChatGPT" });
  const conversation = target({
    id: "conversation",
    title: "ChatGPT",
    url: "app://-/index.html?initialRoute=%2Flocal%2F019d1234-5678-7000-8000-abcdefabcdef",
    webSocketDebuggerUrl: "ws://127.0.0.1/conversation",
  });

  assert.equal(selectMainCodexTarget([emptyRoot, conversation]), conversation);
  assert.equal(selectMainCodexTarget([emptyRoot]), emptyRoot);
});

test("main Codex target keeps supporting legacy Codex titles", () => {
  const main = target();
  assert.equal(selectMainCodexTarget([main]), main);
});

test("main Codex target rejects routed overlays and unrelated pages", () => {
  assert.equal(selectMainCodexTarget([
    target({ title: "ChatGPT", url: "app://-/index.html?initialRoute=%2Favatar-overlay" }),
    target({ title: "ChatGPT", url: "app://-/index.html?initialRoute=%2Fglobal-dictation" }),
    target({ title: "ChatGPT", url: "https://chatgpt.com/" }),
    target({ title: "Other" }),
  ]), undefined);
});
