#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const STORAGE_KEY = "codex-conversation-preview:thread-statuses";
const CURRENT_THREAD_ID = process.env.CODEX_THREAD_ID || "019fe61d-6a11-7cf1-926b-435b108624b6";
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

const client = await connectMainCodex(9231);
let originalStorage = null;

try {
  originalStorage = await client.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-panel]:not([hidden])'))`), true);
  await client.evaluate(`(() => {
    const toggle = document.getElementById('codex-conversation-view-toggle');
    if (toggle?.getAttribute('aria-checked') !== 'true') toggle.click();
  })()`);
  assert.equal(await waitFor(client, `document.documentElement.dataset.codexConversationView === 'card'`), true);

  const target = await client.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
      .find((candidate) => candidate.getClientRects().length > 0);
    return row ? {
      id: row.getAttribute('data-app-action-sidebar-thread-id'),
      title: row.getAttribute('data-app-action-sidebar-thread-title'),
    } : null;
  })()`);
  assert.ok(target?.id, "a visible conversation card is required");
  const rowSelector = `[data-app-action-sidebar-thread-id=${JSON.stringify(target.id)}]`;

  assert.equal(await waitFor(client, `Boolean(document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)}))`), true,
    "every visible conversation card must expose a status button");
  let actual = await client.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)});
    return {
      status: button?.dataset.status,
      label: button?.getAttribute('aria-label'),
      hasPopup: button?.getAttribute('aria-haspopup'),
    };
  })()`);
  assert.deepEqual(actual, {
    status: "urgent-important",
    label: "状态：紧急且重要",
    hasPopup: "menu",
  });

  await client.evaluate(`document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-conversation-status-menu]'))`), true);
  actual = await client.evaluate(`(() => {
    const menu = document.querySelector('[data-codex-conversation-status-menu]');
    return Array.from(menu?.querySelectorAll('[data-codex-conversation-status-option]') || []).map((item) => ({
      value: item.dataset.codexConversationStatusOption,
      text: item.textContent.trim(),
      checked: item.getAttribute('aria-checked'),
    }));
  })()`);
  assert.deepEqual(actual, [
    { value: "urgent-important", text: "紧急且重要", checked: "true" },
    { value: "urgent-or-important", text: "紧急或重要", checked: "false" },
    { value: "not-urgent", text: "不紧急", checked: "false" },
    { value: "clear", text: "清除标注", checked: null },
  ]);

  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="urgent-or-important"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'urgent-or-important'`), true);
  assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}))[${JSON.stringify(target.id)}]`), "urgent-or-important");

  await client.evaluate(`document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.click()`);
  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="clear"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'clear'`), true);

  await client.evaluate(`document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.click()`);
  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="not-urgent"]')?.click()`);
  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'not-urgent'`), true,
    "the selected status must survive a renderer reload");

  process.stdout.write(`${JSON.stringify({ target, statuses: ["urgent-important", "urgent-or-important", "not-urgent", "clear"] }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      const original = ${JSON.stringify(originalStorage)};
      if (original == null) localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
      else localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, original);
    })()`);
    await client.send("Page.reload", { ignoreCache: true });
    await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`, 20_000);
    await client.evaluate(`window.postMessage({ type: 'navigate-to-route', path: '/local/${CURRENT_THREAD_ID}' }, '*')`);
  } catch {}
  client.close();
}
