import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import test from "node:test";
import { CdpClient } from "../scripts/cdp-client.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Actual production function ${name} exists`);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}

test("distinct permanent conversations survive identical title, dedupeKey and nearby timestamps", () => {
  const context = vm.createContext({ normalizedThreadId: (id) => String(id || "").replace(/^local:/, "") });
  vm.runInContext(functionSource("dedupeFolderCatalogEntries"), context);
  const a = { threadId: "11111111-1111-4111-8111-111111111111", title: "创建角色资产", dedupeKey: "same", updatedAt: "2026-09-05T10:05:00Z" };
  const b = { ...a, threadId: "22222222-2222-4222-8222-222222222222", updatedAt: "2026-09-05T10:00:00Z" };
  const result = context.dedupeFolderCatalogEntries([b, a, { ...a, updatedAt: "2026-09-05T09:00:00Z" }]);
  assert.deepEqual(Array.from(result.entries, (entry) => entry.threadId), [a.threadId, b.threadId]);
  assert.equal(result.suppressedIds.size, 0, "The retained native UUID must not be hidden");
});

const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let browserExecutable;
for (const candidate of candidates) { try { await access(candidate); browserExecutable = candidate; break; } catch {} }
const requireBrowser = process.env.AIYOUCODEX_REQUIRE_BROWSER === "1";

test("isolated browser: sidebar ownership, overflow scope, idle stability, batch updates and action proxies", {
  timeout: 30_000,
  skip: !browserExecutable && !requireBrowser && "Set AIYOUCODEX_TEST_BROWSER to a Chrome/Chromium binary for real DOM tests",
}, async (t) => {
  assert.ok(browserExecutable, "AIYOUCODEX_REQUIRE_BROWSER=1 requires an installed Chrome/Chromium binary; interaction checks cannot be skipped");
  const profile = await mkdtemp(path.join(tmpdir(), "aiyoucodex-ui-regression-"));
  const browser = spawn(browserExecutable, ["--headless=new", "--no-sandbox", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  t.after(async () => {
    client?.close();
    browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port;
  for (let i = 0; i < 70; i += 1) {
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch {}
    await delay(100);
  }
  assert.ok(port, "Isolated browser exposes CDP");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  client = new CdpClient(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await client.connect();
  const fixture = `<style>body{margin:0}#app-shell-sidebar{width:480px}button{min-width:24px;min-height:24px}</style>
    <aside id="app-shell-sidebar"><nav role="navigation"><div id="shortcut-header"><div id="new-row">
    <div><span><button id="native-new" class="sidebar-item"><span class="text-fade-truncate">新对话</span></button></span></div>
    <button aria-label="新建侧边聊天">+</button></div></div>
    <div data-app-action-sidebar-scroll><div id="nav-group"><div id="navigation-buttons">
    <button class="sidebar-item"><span class="text-fade-truncate">Pull requests</span></button>
    <button class="sidebar-item"><span class="text-fade-truncate">已安排</span></button>
    <button class="sidebar-item"><span class="text-fade-truncate">插件</span></button></div>
    <button id="native-explore" class="sidebar-item"><span class="text-fade-truncate">探索</span></button></div>
    <div id="sections"><section data-app-action-sidebar-section-heading="项目"><header id="native-heading">
    <span><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></span>
    <div id="native-actions"><button aria-label="项目选项">…</button><button aria-label="添加项目">+</button></div>
    </header><div></div></section></div></div></nav></aside>
    <main><button id="conversation-explore">探索</button><div contenteditable="true"></div></main>
    <div id="proxy-host" style="position:fixed;bottom:0;left:500px"></div>`;
  await client.send("Page.enable");
  const { frameTree } = await client.send("Page.getFrameTree");
  await client.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: fixture });
  await client.evaluate(`window.__nativeParents = [document.getElementById('native-actions').parentElement, document.getElementById('native-explore').parentElement];`);
  const instrumented = source.replace("  window[SENTINEL] = {", "  window[SENTINEL] = { __test: { syncNativeActionProxies },");
  await client.evaluate(instrumented);
  assert.equal(await client.evaluate("window.__codexConversationPreviewInjection__.getHealth().components.folders"), "not-mounted",
    "A legitimate account with no project folders must not fail strict readiness");
  const payload = { previews: [], usage: { available: true, text: "本周剩余 42%", remainingPercent: 42 },
    searchCatalog: [{ projectId: "fixture-project", projectName: "测试文件夹", threadId: "11111111-1111-4111-8111-111111111111", title: "测试任务", updatedAt: "2026-09-05T10:00:00Z" }],
    recentCatalog: [], interruptedCatalog: [], pinnedThreads: [], activeProjectThreads: [], skillCatalog: [] };
  await client.evaluate(`window.__codexConversationPreviewInjection__.setSnapshot(${JSON.stringify(payload)})`);
  await delay(450);
  const initial = await client.evaluate(`(()=>{ const api=window.__codexConversationPreviewInjection__;return {health:api.getHealth(), tabs:[...document.querySelectorAll('[data-codex-sidebar-section-tab]')].map(x=>x.textContent), search:!!document.querySelector('[data-codex-sidebar-folder-search]'), overflowHidden:getComputedStyle(document.getElementById('native-explore')).display==='none',bodyUntouched:getComputedStyle(document.getElementById('conversation-explore')).display!=='none',parentsPreserved:window.__nativeParents[0]===document.getElementById('native-actions').parentElement&&window.__nativeParents[1]===document.getElementById('native-explore').parentElement};})()`);
  assert.deepEqual(initial.tabs, ["置顶", "项目", "最近", "中断"], "Missing native sections get local virtual fallbacks");
  assert.equal(initial.search, true);
  assert.equal(initial.overflowHidden, true);
  assert.equal(initial.bodyUntouched, true);
  assert.equal(initial.parentsPreserved, true);
  assert.deepEqual(initial.health.errors, {});
  await delay(550);
  assert.equal(await client.evaluate("window.__codexConversationPreviewInjection__.getHealth().syncCount"), initial.health.syncCount,
    "Idle native DOM must not trigger an enhancer MutationObserver feedback loop");
  const beforeBatch = initial.health.syncCount;
  payload.usage.text = "本周剩余 41%";
  payload.usage.remainingPercent = 41;
  payload.recentCatalog = payload.searchCatalog;
  await client.evaluate(`window.__codexConversationPreviewInjection__.setSnapshot(${JSON.stringify(payload)})`);
  await delay(220);
  const afterBatch = await client.evaluate("window.__codexConversationPreviewInjection__.getHealth().syncCount");
  assert.equal(afterBatch, beforeBatch + 1, "Multiple setter updates commit one render");
  await client.evaluate(`window.__codexConversationPreviewInjection__.setSnapshot(${JSON.stringify(payload)})`);
  await delay(180);
  assert.equal(await client.evaluate("window.__codexConversationPreviewInjection__.getHealth().syncCount"), afterBatch,
    "Identical snapshots do not rerender");
  assert.equal(await client.evaluate(`(async()=>{let mutations=0;const watcher=new MutationObserver(records=>mutations+=records.length);watcher.observe(document.documentElement,{subtree:true,childList:true,attributes:true});window.__codexConversationPreviewInjection__.getHealth();window.__codexConversationPreviewInjection__.getHealth();await new Promise(resolve=>setTimeout(resolve,0));watcher.disconnect();return mutations;})()`), 0,
    "Health probes are read-only");
  await client.evaluate("document.getElementById('codex-sidebar-shortcut-grid').remove()");
  await delay(200);
  assert.equal(await client.evaluate("!!document.getElementById('codex-sidebar-shortcut-grid')"), true,
    "A native render removing an enhancement root still triggers local remount");
  await client.evaluate(`window.__clicks=[];document.querySelector('#native-actions button').onclick=()=>window.__clicks.push('old');
    window.__codexConversationPreviewInjection__.__test.syncNativeActionProxies(document.getElementById('proxy-host'),()=>document.querySelectorAll('#native-actions button'),'project');`);
  async function realClick() {
    const rect = await client.evaluate("(()=>{const r=document.querySelector('#proxy-host button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  await realClick();
  await client.evaluate(`(()=>{const old=document.querySelector('#native-actions button');const fresh=old.cloneNode(true);fresh.onclick=()=>window.__clicks.push('new');old.replaceWith(fresh);})()`);
  await realClick();
  assert.deepEqual(await client.evaluate("window.__clicks"), ["old", "new"], "A single real click resolves the latest native button after replacement");
  assert.equal(await client.evaluate("document.getElementById('native-actions').parentElement===window.__nativeParents[0]"), true);
  await client.evaluate(`(()=>{const target=document.querySelector('#native-actions button');target.setAttribute('aria-haspopup','menu');target.onclick=()=>{target.setAttribute('aria-controls','fixture-menu');const wrapper=document.createElement('div');wrapper.setAttribute('data-radix-popper-content-wrapper','');wrapper.style.cssText='position:fixed;left:0;top:0;width:100px;height:30px;transform:translate(0px,0px)';wrapper.innerHTML='<div role="menu" id="fixture-menu">保留的原生选项</div>';document.body.appendChild(wrapper);};})()`);
  await realClick();
  await delay(70);
  const menu = await client.evaluate(`(()=>{const b=document.querySelector('#proxy-host button').getBoundingClientRect();const m=document.getElementById('fixture-menu').getBoundingClientRect();const wrapper=document.getElementById('fixture-menu').parentElement.getBoundingClientRect();return {buttonX:b.x,expectedY:b.bottom+wrapper.height+12<=innerHeight?b.bottom+4:Math.max(8,b.top-wrapper.height-4),menuX:m.x,menuY:m.y,body:document.getElementById('fixture-menu').textContent}})()`);
  assert.equal(menu.body, "保留的原生选项");
  assert.equal(menu.menuX, menu.buttonX);
  assert.equal(menu.menuY, menu.expectedY, "Native menu is positioned by the visible proxy, not by a hidden source");
  await client.evaluate("window.__codexConversationPreviewInjection__.destroy()");
  assert.equal(await client.evaluate("getComputedStyle(document.getElementById('native-explore')).display==='none'"), false,
    "Destroy restores the untouched native navigation");
});
