#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const DIALOG_ID = "codex-sidebar-shortcut-settings-dialog";
const SETTINGS_SELECTOR = "[data-codex-sidebar-shortcut-settings]";

async function pressAt(client, x, y) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function releaseAt(client, x, y) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function waitFor(client, expression, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

const client = await connectMainCodex(9231);
const attempts = [];

try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector(${JSON.stringify(SETTINGS_SELECTOR)}))`), true,
    "settings button must exist");

  for (let index = 0; index < 20; index += 1) {
    await client.evaluate(`(() => {
      document.getElementById(${JSON.stringify(DIALOG_ID)})?.close?.();
      window.__codexConversationPreviewInjection__?.refresh?.();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 110));

    const probe = await client.evaluate(`(() => {
      const settings = document.querySelector(${JSON.stringify(SETTINGS_SELECTOR)});
      const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
      const toggle = document.getElementById('codex-conversation-view-toggle');
      const usage = document.getElementById('codex-conversation-usage-status');
      if (!settings || !search || !toggle || !usage) return null;
      const rect = settings.getBoundingClientRect();
      const toolbar = settings.parentElement;
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        hitAria: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest?.('button')?.getAttribute('aria-label') || '',
        order: Array.from(toolbar.children).map((node) => {
          if (node === usage) return 'usage';
          if (node === toggle) return 'toggle';
          if (node === settings) return 'settings';
          if (node === search.parentElement) return 'search';
          return '';
        }).filter(Boolean),
      };
    })()`);
    assert.ok(probe, `attempt ${index + 1}: header controls must exist`);
    assert.equal(probe.hitAria, "管理快捷入口", `attempt ${index + 1}: center must hit settings`);
    assert.deepEqual(probe.order, ["usage", "toggle", "settings", "search"],
      `attempt ${index + 1}: injected controls must keep a stable order`);

    await pressAt(client, probe.x, probe.y);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const openedOnPointerDown = await client.evaluate(`document.getElementById(${JSON.stringify(DIALOG_ID)})?.open === true`);
    await releaseAt(client, probe.x, probe.y);
    assert.equal(openedOnPointerDown, true,
      `attempt ${index + 1}: settings must open on the first pointerdown even while sync runs`);
    attempts.push({ index: index + 1, openedOnPointerDown, ...probe });
  }

  await client.evaluate(`document.getElementById(${JSON.stringify(DIALOG_ID)})?.close?.()`);
  await client.evaluate(`document.querySelector(${JSON.stringify(SETTINGS_SELECTOR)})?.click()`);
  assert.equal(await waitFor(client, `document.getElementById(${JSON.stringify(DIALOG_ID)})?.open === true`), true,
    "keyboard/programmatic click fallback must open settings");

  process.stdout.write(`${JSON.stringify({ attempts: attempts.length, failures: 0, order: attempts[0]?.order }, null, 2)}\n`);
} finally {
  await client.evaluate(`document.getElementById(${JSON.stringify(DIALOG_ID)})?.close?.()`).catch(() => {});
  client.close();
}
