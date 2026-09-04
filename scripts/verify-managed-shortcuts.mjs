#!/usr/bin/env node

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { readManagedShortcuts } from "../lib/managed-shortcuts.mjs";
import { connectMainCodex, readTargets } from "./cdp-client.mjs";

async function waitFor(client, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const shortcuts = await readManagedShortcuts();
assert.ok(shortcuts.length, "no managed shortcuts are configured on this computer");
const internal = shortcuts.find((item) => item.openMode === "internal");
assert.ok(internal, "at least one managed shortcut must use the internal panel for this verification");

const configuredUrls = new Set(shortcuts.map((item) => item.url));
const topLevelCount = (targets) => targets.filter((target) =>
  target.type === "page" && configuredUrls.has(target.url),
).length;
const beforeTopLevelCount = topLevelCount(await readTargets(9231));
const client = await connectMainCodex(9231);
const screenshotPath = "/tmp/codex-managed-shortcut-verification.png";

try {
  const selector = `[data-codex-sidebar-shortcut-managed=${JSON.stringify(internal.id)}]`;
  assert.equal(await waitFor(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), true,
    "managed shortcut must appear in the sidebar");

  const order = await client.evaluate(`Array.from(document.querySelectorAll('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-card]')).map((button) => ({
    name: button.dataset.codexSidebarShortcutName || '',
    managed: button.dataset.codexSidebarShortcutManaged || '',
  }))`);
  assert.equal(order[0]?.name, "新对话", "native new chat must remain first");
  assert.equal(order[1]?.managed, internal.id, "managed shortcuts must follow new chat");

  await client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  assert.equal(await waitFor(client, `document.getElementById('codex-custom-shortcut-page')?.hidden === false
    && document.getElementById('codex-custom-shortcut-frame')?.src === ${JSON.stringify(internal.url)}`), true,
    "managed shortcut must open in the shared side panel");
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const opened = await client.evaluate(`(() => {
    const page = document.getElementById('codex-custom-shortcut-page');
    const frame = document.getElementById('codex-custom-shortcut-frame');
    const button = document.querySelector(${JSON.stringify(selector)});
    const rect = page?.getBoundingClientRect();
    let crossOrigin = false;
    try { void frame?.contentWindow?.location?.href; } catch (error) { crossOrigin = error?.name === 'SecurityError'; }
    return {
      title: page?.querySelector('[data-codex-custom-shortcut-title]')?.textContent || '',
      frameUrl: frame?.src || '',
      visible: Boolean(page && !page.hidden && rect?.width > 0 && rect?.height > 0),
      active: button?.dataset.active || '',
      crossOrigin,
    };
  })()`);
  assert.deepEqual(opened, {
    title: internal.name,
    frameUrl: internal.url,
    visible: true,
    active: "true",
    crossOrigin: true,
  });
  assert.equal(topLevelCount(await readTargets(9231)), beforeTopLevelCount,
    "internal managed shortcuts must not open a top-level browser page");
  const capture = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));

  await client.evaluate(`document.querySelector('[data-codex-custom-shortcut-close]')?.click()`);
  assert.equal(await waitFor(client, `document.getElementById('codex-custom-shortcut-page')?.hidden === true`), true,
    "the shared side-panel close button must close the managed shortcut");

  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `document.querySelectorAll(${JSON.stringify(selector)}).length === 1`, 20_000), true,
    "managed shortcut must survive a full renderer reload without duplication");

  process.stdout.write(`${JSON.stringify({ configured: shortcuts.length, order, opened, topLevelPagesAdded: 0, reloadPersisted: true, screenshotPath }, null, 2)}\n`);
} finally {
  await client.evaluate(`document.querySelector('[data-codex-custom-shortcut-close]')?.click()`).catch(() => {});
  client.close();
}
