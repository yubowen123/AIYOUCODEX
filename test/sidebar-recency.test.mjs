import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("sidebar activity order survives delayed snapshots, missing index entries, pagination and clipped native bounds", {
  timeout: 30_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Browser unavailable",
}, async t => {
  assert.ok(executable);
  const profile = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), "aiyou-recency-browser-"));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: "about:blank" }));
  const fixture = `<style>*{box-sizing:border-box}body{margin:0}#app-shell-sidebar{width:480px;overflow:hidden}
    [data-app-action-sidebar-scroll]{height:620px;overflow:hidden auto;contain:layout paint}button{min-height:24px}</style>
    <div id="root"></div><aside id="app-shell-sidebar"><nav><header><button class="sidebar-item">新对话</button></header>
    <div data-app-action-sidebar-scroll><div><section data-app-action-sidebar-section-heading="项目">
    <header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header><div></div></section>
    </div></div></nav></aside><main></main>`;
  const { frameTree } = await client.send("Page.getFrameTree");
  await client.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: fixture });
  await client.evaluate("localStorage.setItem('codex-conversation-preview:view-mode','card')").catch(() => {});
  await client.evaluate(source.replace("  window[SENTINEL] = {", "  window[SENTINEL] = { __test: { refreshNativeExecutionStates },"));
  const ids = Array.from({ length: 35 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
  const entries = ids.map((threadId, i) => ({ threadId, title: `Conversation ${i}`, updatedAt: new Date(Date.parse("2026-10-08T10:00:00Z") - i * 60_000).toISOString() }));
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(`${api}.setSnapshot({recentCatalog:${JSON.stringify(entries)},pinnedThreads:${JSON.stringify([ids[0],ids[1]])}})`);
  await waitForBrowserState(client, "!!document.querySelector('[data-codex-sidebar-section-tab=" + '"最近"' + "]')", "Recent tab mounts");
  await client.evaluate("document.querySelector('[data-codex-sidebar-section-tab=" + '"最近"' + "]')?.click()");
  await waitForBrowserState(client, "document.querySelectorAll('[data-codex-sidebar-recent-row]').length===30", "First page is bounded");
  assert.equal(await client.evaluate("document.querySelector('[data-codex-sidebar-recent-more]').textContent"), "加载更多对话 · 已显示 30 / 33");
  await client.evaluate("document.querySelector('[data-codex-sidebar-recent-more]').click()");
  await waitForBrowserState(client, "document.querySelectorAll('[data-codex-sidebar-recent-row]').length===33", "Older conversations remain accessible");
  const missingId = "22222222-2222-4222-8222-222222222222";
  const native = [{ conversationId: missingId, title: "Brand new conversation", updatedAt: Date.parse("2026-10-08T11:00:00Z") },
    { conversationId: ids[1], title: "Pinned recently used", updatedAt: Date.parse("2026-10-08T10:30:00Z") }];
  await client.evaluate(`(()=>{const atom={scope:{id:'fixture'},resolve:()=>null};const managers=[{getHostId:()=> 'local',getThreadSummaries:()=>${JSON.stringify(native)}}];
    window.__aiyouNativeRemoteCatalogAdapter__={atom};document.getElementById('root').__reactContainerFixture={memoizedProps:{value:new Map([['fixture',{store:{get:()=>managers}}]])}};
    ${api}.__test.refreshNativeExecutionStates();})()`);
  const recentIds = "[...document.querySelectorAll('[data-codex-sidebar-recent-row]')].map(e=>e.getAttribute('data-app-action-sidebar-thread-id').replace(/^local:/,''))";
  await waitForBrowserState(client, `${recentIds}[0]===${JSON.stringify(missingId)}`, "New native conversation appears without a file/index refresh");
  await client.evaluate(`${api}.setRecentCatalog(${JSON.stringify(entries)})`);
  await delay(120);
  assert.equal(await client.evaluate(`${recentIds}[0]`), missingId, "A delayed disk snapshot cannot roll back live native order");
  await client.evaluate("document.querySelector('[data-codex-sidebar-section-tab=" + '"置顶"' + "]')?.click()");
  const pinnedIds = "[...document.querySelectorAll('[data-codex-sidebar-virtual-pinned-list] [data-app-action-sidebar-thread-row]')].map(e=>e.getAttribute('data-app-action-sidebar-thread-id').replace(/^local:/,''))";
  await waitForBrowserState(client, `${pinnedIds}[0]===${JSON.stringify(ids[1])}`, "Pinned conversations follow activity instead of pin insertion order");
  // Older preview delivery must not disagree with the new timestamp on the card.
  await client.evaluate(`${api}.setPreviews([{key:${JSON.stringify(`local:${ids[1]}\nPinned recently used`)},threadId:${JSON.stringify(ids[1])},updatedAt:'2026-01-01T00:00:00Z',summary:'Fixture summary'}]);${api}.refresh()`);
  assert.match(await client.evaluate("document.querySelector('[data-codex-sidebar-virtual-pinned-list] .codex-conversation-card-time').textContent"), /10:30|18:30|10月8日|10\/8/);
  const bounds = await client.evaluate(`(()=>{document.documentElement.dataset.codexConversationView='card';${api}.refresh();const root=document.querySelector('[data-app-action-sidebar-scroll]'),r=root.getBoundingClientRect();
    const rows=[...document.querySelectorAll('[data-codex-sidebar-virtual-pinned-list] [data-app-action-sidebar-thread-row]')];return {root:r.toJSON(),rows:rows.map(e=>e.getBoundingClientRect().toJSON()),overflow:root.scrollWidth>root.clientWidth}})()`);
  assert.equal(bounds.overflow, false);
  assert.ok(bounds.rows.every(r => r.left >= bounds.root.left + 8 && r.right <= bounds.root.right - 8), "Native paint clipping retains space around both card edges");
  await client.evaluate(`(()=>{const list=document.querySelector('[data-codex-sidebar-virtual-pinned-list]');
    list.removeAttribute('data-codex-sidebar-virtual-pinned-list');list.setAttribute('role','list');list.id='native-pinned-fixture';
    [...list.children].reverse().forEach(e=>list.appendChild(e));list.querySelectorAll('[data-codex-sidebar-pinned-project-row]').forEach(e=>e.removeAttribute('data-codex-sidebar-pinned-project-row'));
    ${api}.refresh();})()`);
  assert.equal(await client.evaluate("document.querySelector('#native-pinned-fixture [data-app-action-sidebar-thread-row]').getAttribute('data-app-action-sidebar-thread-id').replace(/^local:/,'')"), ids[1], "Native pinned DOM uses the same activity order as the fallback list");
});
