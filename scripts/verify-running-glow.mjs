#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return true;
    } catch {}
    await wait(80);
  }
  return false;
}

const taskResponse = await fetch("http://127.0.0.1:47823/api/tasks");
assert.equal(taskResponse.ok, true);
const tasks = (await taskResponse.json()).tasks;
const activeThreadIds = [...new Set(tasks
  .filter((task) => task.status === "in_progress" && THREAD_ID_PATTERN.test(String(task.threadId || "").replace(/^(?:local|cloud):/i, "")))
  .map((task) => String(task.threadId).replace(/^(?:local|cloud):/i, "").toLowerCase()))].sort();
assert.ok(activeThreadIds.length > 0, "at least one running Taskboard task must be linked to a Codex task");

const client = await connectMainCodex(9231);
const originalThreadId = await client.evaluate(`document.querySelector('[data-app-action-sidebar-thread-active="true"]')
  ?.getAttribute('data-app-action-sidebar-thread-id')
  ?.replace(/^(?:local|cloud):/i, '')`);

try {
  await client.evaluate(`window.postMessage({ type: 'navigate-to-route', path: ${JSON.stringify(`/local/${activeThreadIds[0]}`)} }, '*')`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="项目"]'))`), true,
    "verification must first enter a task page that mounts the sidebar project controls");
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-label="全部"]'))`), true);
  await client.evaluate(`(() => {
    document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
    document.querySelector('[data-codex-sidebar-folder-label="全部"]')?.click();
    const toggle = document.getElementById('codex-conversation-view-toggle');
    if (toggle?.getAttribute('aria-checked') !== 'true') toggle.click();
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '全部'`), true);
  assert.equal(await waitFor(client, `document.documentElement.dataset.codexConversationView === 'card'`), true);
  const activeJson = JSON.stringify(activeThreadIds);
  assert.equal(await waitFor(client, `(() => {
    const active = new Set(${activeJson});
    return Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
      .some((row) => row.getClientRects().length > 0
        && active.has((row.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase())
        && row.dataset.codexProjectRunning === 'true');
  })()`), true, "a Taskboard in-progress thread must decorate its visible project card");

  const actual = await client.evaluate(`(() => {
    const active = new Set(${activeJson});
    const rows = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
      .filter((row) => row.getClientRects().length > 0);
    const running = rows.find((row) => active.has((row.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase()));
    const idle = rows.find((row) => !active.has((row.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase()));
    const glow = running ? getComputedStyle(running, '::before') : null;
    const card = running ? getComputedStyle(running) : null;
    return {
      runningId: running?.getAttribute('data-app-action-sidebar-thread-id'),
      running: running?.dataset.codexProjectRunning,
      idleRunning: idle?.dataset.codexProjectRunning || null,
      animationName: glow?.animationName,
      animationDuration: glow?.animationDuration,
      backgroundImage: glow?.backgroundImage,
      pointerEvents: glow?.pointerEvents,
      position: glow?.position,
      content: glow?.content,
      borderColor: card?.borderColor,
      boxShadow: card?.boxShadow,
    };
  })()`);
  assert.equal(actual.running, "true");
  assert.equal(actual.idleRunning, null, "non-running cards must not receive the execution decoration");
  assert.match(actual.animationName || "", /codex-running-border-flow/);
  assert.notEqual(actual.animationDuration, "0s");
  assert.match(actual.backgroundImage || "", /conic-gradient/);
  assert.equal(actual.pointerEvents, "none");
  assert.equal(actual.position, "absolute");
  assert.notEqual(actual.content, "none");
  const borderChannels = actual.borderColor.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)?.slice(1).map(Number);
  assert.ok(borderChannels
    && borderChannels[2] > borderChannels[1]
    && borderChannels[1] > borderChannels[0]
    && borderChannels[2] >= 0.9,
  `the running border must resolve to blue, got ${actual.borderColor}`);
  assert.match(actual.boxShadow || "", /15px/, "the running card must retain a visible outer aura");

  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const reducedAnimation = await client.evaluate(`getComputedStyle(Array.from(document.querySelectorAll('[data-codex-project-running="true"]')).find((row) => row.getClientRects().length > 0), '::before').animationName`);
  assert.equal(reducedAnimation, "none", "reduced-motion mode must keep the marker static");
  await client.send("Emulation.setEmulatedMedia", { features: [] });

  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`), true);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('[data-codex-project-running="true"]')).some((row) => row.getClientRects().length > 0)`, 20_000), true,
    "running decoration must recover after renderer reload");

  process.stdout.write(`${JSON.stringify({ activeThreadIds, actual, reloadVerified: true }, null, 2)}\n`);
} finally {
  try {
    await client.send("Emulation.setEmulatedMedia", { features: [] });
    if (originalThreadId) {
      await client.evaluate(`window.postMessage({ type: 'navigate-to-route', path: ${JSON.stringify(`/local/${originalThreadId}`)} }, '*')`);
    }
  } catch {}
  client.close();
}
