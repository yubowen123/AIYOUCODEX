#!/usr/bin/env node

import assert from "node:assert/strict";

import { buildHomeProjectShelf, readTaskboardSnapshot } from "../lib/home-projects.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { connectMainCodex } from "./cdp-client.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await client.evaluate(expression)) return true; } catch {}
    await wait(80);
  }
  return false;
}

const repository = new PreviewRepository();
const taskboard = await readTaskboardSnapshot();
const homeProjects = taskboard.available
  ? buildHomeProjectShelf({ projects: taskboard.projects, tasks: taskboard.tasks })
  : { activeThreadIds: [] };
const expected = (await repository.readInterruptedCatalog({ activeThreadIds: homeProjects.activeThreadIds })).slice(0, 30);
const client = await connectMainCodex(9231);

try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="中断"]'))`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.getAttribute('aria-selected') === 'true'`), true);
  assert.equal(await waitFor(client, `document.querySelectorAll('[data-codex-sidebar-interrupted-row]').length === ${expected.length}`), true);
  const actual = await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-interrupted-row]')).map((row) => ({
    id: row.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^(?:local|cloud):/i, ''),
    kind: row.dataset.codexSidebarInterruptedKind,
    title: row.getAttribute('data-app-action-sidebar-thread-title'),
    visible: row.getClientRects().length > 0,
    tags: Array.from(row.querySelectorAll('.codex-conversation-card-tags > *')).map((tag) => tag.textContent.trim()),
  }))`);
  assert.deepEqual(actual.map((item) => item.id), expected.map((item) => item.threadId));
  assert.equal(new Set(actual.map((item) => item.id)).size, actual.length);
  assert.ok(actual.every((item) => item.visible));
  assert.ok(actual.every((item) => item.kind === "active" || item.kind === "passive"));
  assert.ok(actual.every((item) => item.tags.includes(item.kind === "active" ? "主动中断" : "被动中断")));
  process.stdout.write(`${JSON.stringify({ count: actual.length, top: actual.slice(0, 8) }, null, 2)}\n`);
} finally {
  try { await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`); } catch {}
  client.close();
}
