import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(process.env.AIYOUCODEX_INJECTION_FILE || new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("retained product surfaces never mix headings, folders or new-chat sources", {
  timeout: 30000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Requires isolated Chrome/Chromium",
}, async t => {
  assert.ok(executable, "Required Chrome/Chromium browser must be installed");
  const profile = await mkdtemp(path.join(tmpdir(), "aiyou-active-surface-"));
  const section = (product, label) => `<section data-app-action-sidebar-section-heading="${label}"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">${label}</button></header><div role="list"></div></section>`;
  const surface = (product, hidden, projects) => `<div id="${product}-header" style="${hidden ? 'display:none!important' : ''}"><div>${product}<span><button aria-label="搜索">搜索</button></span></div><div id="${product}-new-row"><button id="${product}-new" title="新聊天"><span class="text-fade-truncate">新聊天</span></button></div></div><div id="${product}-scroll" data-app-action-sidebar-scroll style="${hidden ? 'display:none!important' : ''}">${section(product, 'Pinned')}${projects ? section(product, 'Projects') : ''}${section(product, 'Recents')}</div>`;
  const fixture = `<style>body{margin:0}aside{width:500px}button{min-height:24px}nav[data-app-navigation-rail]{position:absolute;left:0;top:0;width:48px;height:800px}aside{margin-left:48px}</style><nav data-app-navigation-rail><button aria-label="首页">首页</button></nav><aside id="app-shell-sidebar"><nav>${surface('codex', true, false)}${surface('chatgpt', false, true)}</nav></aside>`;
  const server = createServer((req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(fixture); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(`window.__clicks=[];for(const p of ['codex','chatgpt'])document.getElementById(p+'-new').onclick=()=>window.__clicks.push(p);document.querySelectorAll('[data-app-action-sidebar-section-toggle]').forEach(b=>b.onclick=()=>b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true')))`);
  await client.evaluate(source.replace("  window[SENTINEL] = {", "  window[SENTINEL] = { __test: { findNativeShortcutButton, nativeSidebarContentRoot },"));
  await waitForBrowserState(client, "document.querySelector('#codex-sidebar-section-tabs')?.parentElement.id==='chatgpt-scroll'", "Tabs belong to the visible product scroller, below its header");
  assert.equal(await client.evaluate("document.getElementById('chatgpt-new-row').getBoundingClientRect().height"), 0);
  assert.equal(await client.evaluate("document.querySelector('#chatgpt-scroll [data-app-action-sidebar-section-heading=\"Pinned\"] header').getBoundingClientRect().height"), 0);
  assert.equal(await client.evaluate(`${api}.__test.findNativeShortcutButton('新聊天').id`), "chatgpt-new", "Our hidden source row still resolves its own native action");
  await client.evaluate(`${api}.__test.findNativeShortcutButton('新聊天').click()`);
  assert.deepEqual(await client.evaluate("window.__clicks"), ["chatgpt"]);
  await client.evaluate(`${api}.setSearchCatalog([{threadId:'11111111-1111-4111-8111-111111111111',title:'项目任务',projectId:'p1',projectName:'项目 A',projectRootPath:'/Users/test/a'},{threadId:'22222222-2222-4222-8222-222222222222',title:'已保存的置顶任务',projectId:'p1',projectName:'项目 A',projectRootPath:'/Users/test/a'}]);${api}.setPinnedThreads(['22222222-2222-4222-8222-222222222222'])`);
  await waitForBrowserState(client, "!!document.querySelector('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-tag=p1]')", "Virtual project folders mount from the catalog");
  await waitForBrowserState(client, "document.querySelector('#chatgpt-scroll [data-codex-sidebar-virtual-pinned-list] [data-app-action-sidebar-thread-id]')!==null", "An empty native pinned section gets saved pins from the authoritative catalog");
  await client.evaluate(`${api}.setSnapshot({remoteProjects:[{id:'remote:host-a:p1',nativeProjectId:'p1',hostId:'host-a',label:'项目 A',remotePath:'/Users/test/a'},{id:'remote:host-b:p1',nativeProjectId:'p1',hostId:'host-b',label:'项目 A',remotePath:'/Users/test/a'}]})`);
  await waitForBrowserState(client, "document.querySelectorAll('[data-codex-sidebar-remote-badge]').length===2", "Remote projects without local session files receive badges and separate host identities");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-codex-sidebar-folder-label=\"项目 A\"]').length"), 3, "Same-name local and two remote projects never collapse");
  await client.evaluate("document.querySelector('[data-codex-sidebar-section-tab=\"项目\"]').click();document.querySelector('[data-codex-sidebar-folder-tag=\"remote:host-a:p1\"]').click()");
  assert.equal(await client.evaluate("document.querySelector('[data-codex-sidebar-folder-new-chat]').disabled"), true, "A remote path cannot become a local execution root");
  assert.ok(await client.evaluate("document.querySelector('[data-codex-sidebar-virtual-folder-panel=\"remote:host-a:p1\"]').textContent.includes('远程项目')"));
  await client.evaluate("document.getElementById('codex-header').style.display='';document.getElementById('codex-scroll').style.display='';document.getElementById('chatgpt-header').style.setProperty('display','none','important');document.getElementById('chatgpt-scroll').style.setProperty('display','none','important')");
  await waitForBrowserState(client, "document.querySelector('#codex-sidebar-section-tabs')?.parentElement.id==='codex-scroll'", "Switching product rebinds all groups to the new visible scroller");
  await waitForBrowserState(client, "document.querySelector('#codex-sidebar-folder-switcher')?.closest('#codex-scroll')!==null", "Codex without a native Projects section gets its own virtual project panel");
  assert.equal(await client.evaluate(`${api}.__test.findNativeShortcutButton('新聊天').id`), "codex-new");
  assert.equal(await client.evaluate("document.getElementById('codex-header').getBoundingClientRect().top < document.getElementById('codex-sidebar-section-tabs').getBoundingClientRect().top"), true);
  await client.evaluate("document.querySelector('[data-codex-sidebar-section-tab=\"置顶\"]').click()");
  assert.equal(await client.evaluate("document.querySelector('#codex-scroll [data-app-action-sidebar-section-heading=\"Pinned\"]').hidden"), false);
  assert.equal(await client.evaluate("document.querySelectorAll('#codex-scroll [data-codex-sidebar-virtual-pinned-list] [data-app-action-sidebar-thread-id]').length"), 1);
  assert.equal(await client.evaluate("document.getElementById('codex-scroll').hidden"), false, "A group selection never conceals the whole product scroller");
  await client.evaluate(`${api}.destroy()`);
  assert.ok(await client.evaluate("document.getElementById('codex-new-row').getBoundingClientRect().height>0"));
});
