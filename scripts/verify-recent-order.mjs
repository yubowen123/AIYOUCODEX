#!/usr/bin/env node

import assert from "node:assert/strict";

import { presentCardPreview } from "../lib/card-view.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { connectMainCodex } from "./cdp-client.mjs";

async function waitFor(client, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return true;
}

const client = await connectMainCodex(9231);

try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="最近"]'))`, 12_000), true,
    "Recent tab must be injected after a fresh renderer load");
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="最近"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelectorAll('[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]').length > 1`, 12_000), true,
    "Recent tab must expose multiple native conversation rows");
  const initialRowCount = await client.evaluate(`document.querySelectorAll(
    '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
  ).length`);
  const requestedExpansion = await client.evaluate(`(() => {
    const panel = document.querySelector('[data-codex-sidebar-section-panel="最近"]');
    const button = Array.from(panel?.querySelectorAll('button') || [])
      .find((candidate) => candidate.textContent?.trim() === '展开显示');
    button?.click();
    return Boolean(button);
  })()`);
  if (requestedExpansion) {
    assert.equal(await waitFor(client, `document.querySelectorAll(
      '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
    ).length > ${initialRowCount}`, 12_000), true, "Recent expansion must mount additional conversations");
  }

  const requests = await client.evaluate(`(() => Array.from(
    document.querySelectorAll('[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]'),
  ).map((row) => ({
    key: (row.getAttribute('data-app-action-sidebar-thread-id') || '') + '\\n'
      + (row.getAttribute('data-app-action-sidebar-thread-title') || ''),
    id: row.getAttribute('data-app-action-sidebar-thread-id') || '',
    title: row.getAttribute('data-app-action-sidebar-thread-title') || '',
  })))()`);
  const previews = await new PreviewRepository().readMany(requests);
  const timeByKey = new Map(previews.map((preview) => [preview.key, Date.parse(preview.updatedAt || "")]));
  assert.ok(previews.every((preview) => Number.isFinite(timeByKey.get(preview.key))),
    "Every mounted Recent conversation must have a valid updatedAt timestamp");

  const expectedOrder = requests
    .map((request, sourceIndex) => ({ ...request, sourceIndex, updatedAt: timeByKey.get(request.key) }))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.sourceIndex - right.sourceIndex)
    .map((request) => request.id);

  const expectedJson = JSON.stringify(expectedOrder);
  assert.equal(await waitFor(client, `Array.from(
    document.querySelectorAll('[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]'),
  ).every((row) => {
    const time = row.querySelector('.codex-conversation-card-time')?.textContent || '';
    return time && time !== '正在读取时间';
  })`, 12_000), true, "Installed injector must automatically load Recent timestamps");
  const deliberatelyDisordered = await client.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll(
      '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
    ));
    const first = rows[0]?.closest('[role="listitem"]');
    const second = rows[1]?.closest('[role="listitem"]');
    if (!first || !second || first.parentElement !== second.parentElement) return null;
    first.parentElement.insertBefore(second, first);
    return Array.from(document.querySelectorAll(
      '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
    )).map((row) => row.getAttribute('data-app-action-sidebar-thread-id'));
  })()`);
  assert.ok(deliberatelyDisordered, "Verifier must be able to create a deterministic Recent inversion");
  assert.notDeepEqual(deliberatelyDisordered, expectedOrder,
    "The deterministic inversion must differ from the true time order");
  const presentedPreviews = previews.map((preview) => presentCardPreview(preview));
  await client.evaluate(`window.__codexConversationPreviewInjection__?.setPreviews?.(${JSON.stringify(presentedPreviews)})`);
  const sorted = await waitFor(client, `JSON.stringify(Array.from(
    document.querySelectorAll('[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]'),
  ).map((row) => row.getAttribute('data-app-action-sidebar-thread-id'))) === ${JSON.stringify(expectedJson)}`);
  if (!sorted) {
    const actualOrder = await client.evaluate(`Array.from(document.querySelectorAll(
      '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
    )).map((row) => row.getAttribute('data-app-action-sidebar-thread-id'))`);
    assert.deepEqual(actualOrder, expectedOrder,
      "Recent DOM order must follow last communication time descending");
  }

  const actual = await client.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll(
      '[data-codex-sidebar-section-panel="最近"] [data-app-action-sidebar-thread-row]',
    ));
    const domOrder = rows.map((row) => row.getAttribute('data-app-action-sidebar-thread-id'));
    const visualOrder = rows.map((row) => ({
      id: row.getAttribute('data-app-action-sidebar-thread-id'),
      rect: row.getBoundingClientRect(),
    })).sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
      .map((item) => item.id);
    return {
      domOrder,
      visualOrder,
      labels: rows.map((row) => ({
        title: row.getAttribute('data-app-action-sidebar-thread-title'),
        time: row.querySelector('.codex-conversation-card-time')?.textContent || '',
      })),
    };
  })()`);
  assert.deepEqual(actual.domOrder, expectedOrder);
  assert.deepEqual(actual.visualOrder, expectedOrder,
    "Two-column Recent cards must read left-to-right, then top-to-bottom in descending time order");

  process.stdout.write(`${JSON.stringify({ expectedOrder, ...actual }, null, 2)}\n`);
} finally {
  try { await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`); } catch {}
  client.close();
}
