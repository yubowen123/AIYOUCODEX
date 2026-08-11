#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function waitFor(client, expression, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function inspectAndClick(client, name) {
  const hit = await client.evaluate(`(() => {
    const button = document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name=${JSON.stringify(name)}]');
    if (!button) return null;
    window.__codexShortcutClickProbe = { button, events: [] };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, (event) => {
        window.__codexShortcutClickProbe?.events.push({
          type,
          name: event.target?.closest?.('[data-codex-sidebar-shortcut-name]')?.dataset.codexSidebarShortcutName || null,
        });
      }, { capture: true, once: true });
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    return {
      x,
      y,
      buttonTag: button.tagName,
      buttonPointerEvents: getComputedStyle(button).pointerEvents,
      hitTag: target?.tagName || null,
      hitName: target?.closest?.('[data-codex-sidebar-shortcut-name]')?.dataset.codexSidebarShortcutName || null,
      hitClass: target?.className || null,
      hitAria: target?.closest?.('[aria-label]')?.getAttribute('aria-label') || null,
    };
  })()`);
  assert.ok(hit, `${name} shortcut must exist`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
  await new Promise((resolve) => setTimeout(resolve, 120));
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await client.evaluate(`(() => {
    const probe = window.__codexShortcutClickProbe;
    const current = document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name=${JSON.stringify(name)}]');
    return {
      sameButton: probe?.button === current,
      originalConnected: Boolean(probe?.button?.isConnected),
      events: probe?.events || [],
      currentHitName: document.elementFromPoint(${hit.x}, ${hit.y})
        ?.closest?.('[data-codex-sidebar-shortcut-name]')?.dataset.codexSidebarShortcutName || null,
    };
  })()`);
  return { ...hit, ...after };
}

const client = await connectMainCodex(9231);
try {
  await client.evaluate(`(() => {
    window.__codexConversationPreviewInjection__?.closeTv?.(false);
    window.__codexTaskboardInjection__?.close?.(false);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const tv = await inspectAndClick(client, "TV");
  await waitFor(
    client,
    `document.documentElement.getAttribute("data-codex-tv-open") === "true"`,
    `real TV click hit ${JSON.stringify(tv)} but did not open TV`,
  );
  await client.evaluate(`window.__codexConversationPreviewInjection__?.closeTv?.(false)`);

  const projectManagement = await inspectAndClick(client, "项目管理");
  await waitFor(
    client,
    `document.documentElement.getAttribute("data-codex-taskboard-open") === "true"`,
    `real project-management click hit ${JSON.stringify(projectManagement)} but did not open Taskboard`,
  );

  process.stdout.write(`${JSON.stringify({ tv, projectManagement }, null, 2)}\n`);
} finally {
  try { await client.evaluate(`window.__codexConversationPreviewInjection__?.closeTv?.(false)`); } catch {}
  try { await client.evaluate(`window.__codexTaskboardInjection__?.close?.(false)`); } catch {}
  client.close();
}
