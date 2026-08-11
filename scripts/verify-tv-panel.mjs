#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex, readTargets } from "./cdp-client.mjs";

const TV_URL = "https://dz-ailab.dzkjm.cn/canvas/projects?category=personal";

function countTopLevelTvPages(targets) {
  return targets.filter((target) => {
    if (target.type !== "page") return false;
    try { return new URL(target.url).hostname === "dz-ailab.dzkjm.cn"; } catch { return false; }
  }).length;
}

async function waitFor(client, expression, message, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

const beforePageCount = countTopLevelTvPages(await readTargets(9231));
const client = await connectMainCodex(9231);

try {
  await waitFor(
    client,
    `Boolean(document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="TV"]'))`,
    "TV shortcut did not appear",
  );
  await client.evaluate(`document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="TV"]')?.click()`);
  await waitFor(
    client,
    `document.getElementById("codex-tv-frame")?.dataset.loaded === "true"`,
    "TV iframe did not finish loading inside the Codex workspace",
  );

  const opened = await client.evaluate(`(() => {
    const page = document.getElementById("codex-tv-page");
    const frame = document.getElementById("codex-tv-frame");
    const button = document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="TV"]');
    if (!page || !frame || !button) return null;
    const pageRect = page.getBoundingClientRect();
    const surfaceRect = page.parentElement.getBoundingClientRect();
    let crossOriginLoaded = false;
    try { void frame.contentWindow.location.href; } catch (error) {
      crossOriginLoaded = error?.name === "SecurityError";
    }
    return {
      rootOpen: document.documentElement.getAttribute("data-codex-tv-open"),
      pageHidden: page.hidden,
      frameHidden: frame.hidden,
      frameUrl: frame.dataset.codexTvUrl,
      title: frame.title,
      active: button.dataset.active,
      ariaCurrent: button.getAttribute("aria-current"),
      crossOriginLoaded,
      pageRect: { x: pageRect.x, y: pageRect.y, width: pageRect.width, height: pageRect.height },
      surfaceRect: { x: surfaceRect.x, y: surfaceRect.y, width: surfaceRect.width, height: surfaceRect.height },
    };
  })()`);

  assert.ok(opened, "TV panel must exist");
  assert.equal(opened.rootOpen, "true");
  assert.equal(opened.pageHidden, false);
  assert.equal(opened.frameHidden, false);
  assert.equal(opened.frameUrl, TV_URL);
  assert.equal(opened.title, "TV");
  assert.equal(opened.active, "true");
  assert.equal(opened.ariaCurrent, "page");
  assert.equal(opened.crossOriginLoaded, true);
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(opened.pageRect[key] - opened.surfaceRect[key]) <= 1, `TV page ${key} must match the Codex workspace`);
  }

  const afterOpenPageCount = countTopLevelTvPages(await readTargets(9231));
  assert.equal(afterOpenPageCount, beforePageCount, "TV must not create a top-level browser page");

  await client.evaluate(`document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="项目管理"]')?.click()`);
  await waitFor(
    client,
    `document.documentElement.getAttribute("data-codex-taskboard-open") === "true"
      && document.documentElement.hasAttribute("data-codex-tv-open") === false`,
    "Project management did not replace the TV workspace",
  );
  const switched = await client.evaluate(`({
    tvHidden: document.getElementById("codex-tv-page")?.hidden,
    taskboardOpen: document.documentElement.getAttribute("data-codex-taskboard-open"),
  })`);
  assert.deepEqual(switched, { tvHidden: true, taskboardOpen: "true" });

  await client.evaluate(`window.__codexTaskboardInjection__?.close?.(false)`);
  const afterSwitchPageCount = countTopLevelTvPages(await readTargets(9231));
  assert.equal(afterSwitchPageCount, beforePageCount, "workspace switching must not create a browser page");

  process.stdout.write(`${JSON.stringify({ beforePageCount, afterOpenPageCount, afterSwitchPageCount, opened, switched }, null, 2)}\n`);
} finally {
  try { await client.evaluate(`window.__codexConversationPreviewInjection__?.closeTv?.(false)`); } catch {}
  try { await client.evaluate(`window.__codexTaskboardInjection__?.close?.(false)`); } catch {}
  client.close();
}
