#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  connectCodexTarget,
  readTargets,
  selectMainCodexTargets,
} from "./cdp-client.mjs";

function parsePort(argv) {
  const portIndex = argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 9231;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  return port;
}

const port = parsePort(process.argv.slice(2));
const targets = selectMainCodexTargets(await readTargets(port));
assert.ok(targets.length > 0, "no top-level Codex windows are available");

const clients = [];
try {
  for (const target of targets) clients.push(await connectCodexTarget(target));

  const deadline = Date.now() + 8_000;
  let states = [];
  do {
    states = await Promise.all(clients.map((client) => client.evaluate(`(() => ({
      runtimeReady: Boolean(window.__codexConversationPreviewInjection__),
      shortcutGridReady: Boolean(document.getElementById("codex-sidebar-shortcut-grid")),
      sectionTabsReady: Boolean(document.getElementById("codex-sidebar-section-tabs")),
    }))()`)));
    if (states.every((state) => state.runtimeReady)
        && states.some((state) => state.shortcutGridReady && state.sectionTabsReady)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  const result = {
    targetCount: states.length,
    runtimeReadyCount: states.filter((state) => state.runtimeReady).length,
    shortcutGridReadyCount: states.filter((state) => state.shortcutGridReady).length,
    sectionTabsReadyCount: states.filter((state) => state.sectionTabsReady).length,
    allRuntimeReady: states.every((state) => state.runtimeReady),
    anyWorkspaceUiReady: states.some((state) => state.shortcutGridReady && state.sectionTabsReady),
  };

  assert.equal(result.allRuntimeReady, true, "enhancement runtime must be injected into every Codex window");
  assert.equal(result.anyWorkspaceUiReady, true, "at least one Codex window must expose the workspace UI");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  for (const client of clients) client.close();
}
