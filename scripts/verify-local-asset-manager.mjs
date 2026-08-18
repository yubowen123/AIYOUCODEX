#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, connectMainCodex, readTargets } from "./cdp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = path.join(root, "output", "local-asset-manager-verification.png");

async function waitFor(check, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function clickAt(client, expression, clickCount = 1) {
  const point = await client.evaluate(`(() => { const node = ${expression}; if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(point, `click target missing: ${expression}`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount });
}

const main = await connectMainCodex();
let frame = null;
try {
  const shortcutReady = await waitFor(() => main.evaluate(`Boolean(Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((node) => node.dataset.codexSidebarShortcutName === '资产控制台'))`), 15_000);
  assert.equal(shortcutReady, true, "Asset Console shortcut was not injected after runtime restart");
  const open = await main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === false`);
  if (open) {
    await clickAt(main, `document.querySelector('#codex-asset-console-page .codex-asset-console-close')`);
    await waitFor(() => main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === true`));
  }
  await clickAt(main, `Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((node) => node.dataset.codexSidebarShortcutName === '资产控制台')`);
  const target = await waitFor(async () => (await readTargets(9231)).find((item) => item.type === "iframe" && item.url.includes("/__codex_asset_console__/")));
  assert.ok(target?.webSocketDebuggerUrl, "Asset Console iframe target was not created");
  frame = new CdpClient(target.webSocketDebuggerUrl);
  await frame.connect();
  const ready = await waitFor(() => frame.evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.app-shell'))`));
  assert.equal(ready, true, "local asset manager did not finish loading");
  const libraryLoaded = await waitFor(() => frame.evaluate(`document.querySelectorAll('#localProjectList .project-item').length > 0 && document.querySelectorAll('#assetGrid .asset-card').length > 0 && !document.getElementById('scanState')?.classList.contains('busy')`));
  assert.equal(libraryLoaded, true, "local project assets did not finish scanning");

  const initial = await frame.evaluate(`(() => ({
    title: document.title,
    projectCount: document.querySelectorAll('#localProjectList .project-item').length,
    tabs: Array.from(document.querySelectorAll('[data-asset-kind]')).map((node) => node.textContent.trim()),
    searchPlaceholder: document.getElementById('librarySearchInput')?.placeholder || '',
    cardCount: document.querySelectorAll('#assetGrid .asset-card').length,
    sidebarWidth: Math.round(document.querySelector('.library-sidebar')?.getBoundingClientRect().width || 0),
    columns: getComputedStyle(document.documentElement).getPropertyValue('--asset-columns').trim(),
  }))()`);
  assert.equal(initial.title, "本地资产库");
  assert.deepEqual(initial.tabs.map((item) => item.replace(/\d+/g, "")), ["全部", "文本", "图片", "音频", "视频"]);
  assert.match(initial.searchPlaceholder, /名称、内容、分类或标签/);
  assert.ok(initial.sidebarWidth >= 200);

  await clickAt(frame, `document.querySelector('[data-asset-kind="image"]')`);
  const imageTab = await frame.evaluate(`(() => ({
    active: document.querySelector('[data-asset-kind="image"]')?.classList.contains('active'),
    masonry: document.getElementById('assetGrid')?.classList.contains('masonry'),
  }))()`);
  assert.deepEqual(imageTab, { active: true, masonry: true });

  await clickAt(frame, `document.getElementById('settingsButton')`);
  assert.equal(await frame.evaluate(`document.getElementById('settingsDialog')?.open === true`), true);
  await clickAt(frame, `document.querySelector('[data-close-dialog="settingsDialog"]')`);
  assert.equal(await frame.evaluate(`document.getElementById('settingsDialog')?.open === false`), true);

  await clickAt(frame, `document.getElementById('newProjectButton')`);
  const projectDialog = await frame.evaluate(`(() => ({
    open: document.getElementById('projectDialog')?.open === true,
    folders: Boolean(document.getElementById('codexNewProjectScanRoots')),
    platformCopy: document.querySelector('[data-codex-project-platform-copy]')?.textContent || '',
  }))()`);
  assert.equal(projectDialog.open, true);
  assert.equal(projectDialog.folders, true);
  assert.match(projectDialog.platformCopy, /本机扫描/);
  await clickAt(frame, `document.querySelector('[data-close-dialog="projectDialog"]')`);

  await clickAt(frame, `document.querySelector('[data-asset-kind="text"]')`);
  const textCardReady = await waitFor(() => frame.evaluate(`Boolean(document.querySelector('#assetGrid .text-card'))`));
  assert.equal(textCardReady, true, "text cards did not render");
  await clickAt(frame, `document.querySelector('#assetGrid .text-card .text-card-preview')`, 2);
  const textViewer = await waitFor(() => frame.evaluate(`(() => {
    const dialog = document.getElementById('textViewerDialog');
    const preview = document.getElementById('textViewerPreview');
    return dialog?.open && preview?.textContent?.trim() && !preview.textContent.includes('正在读取') ? {
      open: true,
      title: document.getElementById('textViewerTitle')?.textContent || '',
      previewLength: preview.textContent.trim().length,
      editAvailable: !document.getElementById('toggleTextEditButton')?.hidden,
    } : null;
  })()`));
  assert.ok(textViewer?.previewLength > 0, "text viewer did not load file content");
  await clickAt(frame, `document.querySelector('[data-close-dialog="textViewerDialog"]')`);
  await clickAt(frame, `document.querySelector('[data-asset-kind="image"]')`);

  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const screenshot = await main.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  process.stdout.write(`${JSON.stringify({ initial, imageTab, projectDialog, textViewer, screenshotPath }, null, 2)}\n`);
} finally {
  frame?.close();
  main.close();
}
