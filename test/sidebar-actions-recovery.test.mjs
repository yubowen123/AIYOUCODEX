import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(process.env.AIYOUCODEX_INJECTION_FILE
  || new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("sidebar actions recover after partial redraw, source gaps and host clones without self-proxying", {
  timeout: 45_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Chrome/Chromium required",
}, async (t) => {
  assert.ok(executable);
  const profile = await mkdtemp(path.join(tmpdir(), "aiyou-sidebar-actions-"));
  const icon = '<svg viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" stroke="currentColor"/></svg>';
  const fixture = `<style>body{margin:0}aside{width:480px}button{min-width:24px;min-height:24px}svg{width:16px;height:16px}</style>
    <aside id="app-shell-sidebar"><nav><div data-app-action-sidebar-scroll><div id="sections">
    <section data-app-action-sidebar-section-heading="项目"><header id="heading"><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button>
    <div id="native-actions"><button id="options" aria-label="项目侧边栏选项">${icon}</button><button id="create" aria-label="添加新项目">${icon}</button></div></header>
    <div role="list"><div data-sidebar-project-kind="local"><div id="folder-row" role="button" data-app-action-sidebar-project-row data-app-action-sidebar-project-id="p1" data-app-action-sidebar-project-label="项目 A" aria-expanded="true">
    <span>项目 A</span><div id="folder-actions"><button id="folder-options" aria-label="项目 A 的项目操作">${icon}</button><button id="folder-new" aria-label="在 项目 A 中开始新聊天">${icon}</button></div></div></div></div>
    </section></div></div></nav></aside><main><button id="unrelated" aria-label="添加新项目">无关区域</button><div contenteditable="true">未发送的输入</div></main>`;
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(fixture); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  const bar = "#codex-sidebar-section-tabs";
  const host = `${bar} [data-codex-sidebar-project-actions]`;
  const proxies = `${host} [data-codex-native-action-proxies]`;
  const chat = `${host} [data-codex-sidebar-current-folder-new-chat]`;
  const sortControl = '#codex-sidebar-folder-switcher [data-codex-sidebar-folder-sort]';
  const createControl = '#codex-sidebar-folder-switcher [data-codex-sidebar-project-create]';
  const newChatControl = '#codex-sidebar-folder-switcher [data-codex-sidebar-folder-new-chat]';
  const available = `${JSON.stringify(host)}`;
  await client.evaluate(`(()=>{const folder=document.querySelector('[data-sidebar-project-kind]').cloneNode(true);folder.querySelectorAll('[id]').forEach(e=>e.id+='-b');const row=folder.querySelector('[data-app-action-sidebar-project-row]');row.dataset.appActionSidebarProjectId='p2';row.dataset.appActionSidebarProjectLabel='项目 B';row.querySelector('span').textContent='项目 B';folder.querySelectorAll('[aria-label]').forEach(e=>e.setAttribute('aria-label',e.getAttribute('aria-label').replaceAll('项目 A','项目 B')));document.querySelector('[role=list]').append(folder)})();window.__clicks=[];for(const id of ['options','create','folder-options','folder-new','folder-new-b','unrelated'])document.getElementById(id).onclick=()=>window.__clicks.push(id);window.__routes=[];window.addEventListener('message',e=>{if(e.data.type==='navigate-to-route')window.__routes.push(e.data.path)})`);
  await client.evaluate(source.replace("  window[SENTINEL] = {", "  window[SENTINEL] = { __test: { nativeGlobalProjectActionButtons },"));
  await waitForBrowserState(client, `document.querySelector(${available})?.querySelectorAll('button').length===3`, "Three project action icons mount");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(newChatControl)})?.disabled===false`, "The search row includes an enabled new-chat action for the selected project");
  assert.deepEqual(await client.evaluate("[...document.querySelectorAll('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-actions] > button')].map(button=>button.getAttribute('aria-label'))"),
    ["排序设置", "创建项目", "在“项目 A”中新建对话"]);
  // This fails on the old implementation: it scans the whole document,
  // including the proxy buttons and an unrelated tool with the same label.
  assert.deepEqual(await client.evaluate(`${api}.__test.nativeGlobalProjectActionButtons().map(e=>e.id)`), ["options", "create"]);
  async function click(selector) {
    const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    assert.equal(point.hit, true, selector);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  const options = `${proxies} button[aria-label="项目侧边栏选项"]`;
  await click(options); await click(`${proxies} button[aria-label="添加新项目"]`); await click(chat);
  await click('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-actions] button[aria-label="项目 A 的项目操作"]');
  await click('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-actions] button[aria-label="在 项目 A 中开始新聊天"]');
  await click(createControl); await click(newChatControl);
  assert.deepEqual(await client.evaluate("window.__clicks"), ["options", "create", "folder-new", "folder-options", "folder-new", "create", "folder-new"]);
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(sortControl)})?.getAttribute('aria-label')`), '排序设置');
  assert.deepEqual(await client.evaluate("window.__routes"), [], "Distinct actions never silently navigate to Projects");
  await click('[data-codex-sidebar-folder-tag="p2"]');
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(chat)})?.dataset.codexSidebarCurrentFolderNewChat==='p2'`, "Switching folders binds the new-chat action to the selected project");
  await click(chat);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "folder-new-b");
  await click(newChatControl);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "folder-new-b", "Search-row new chat follows the selected project, not project creation");
  await click('[data-codex-sidebar-folder-tag="p1"]');
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(chat)})?.dataset.codexSidebarCurrentFolderNewChat==='p1'`, "Returning to the first folder restores its own action");
  await client.evaluate(`const search=document.querySelector('[data-codex-sidebar-folder-search]');search.value='项目';search.dispatchEvent(new Event('input',{bubbles:true}))`);

  await client.evaluate(`document.querySelector(${JSON.stringify(proxies)}).replaceChildren()`);
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(proxies)})?.children.length===2`, "An emptied proxy group repairs without a changed snapshot");
  await client.evaluate(`document.querySelector(${JSON.stringify(host)}).remove()`);
  await waitForBrowserState(client, `document.querySelector(${available})?.querySelectorAll('button').length===3`, "A partially removed action host repairs without losing tabs");
  await client.evaluate(`document.querySelector(${JSON.stringify(bar)}).replaceWith(document.querySelector(${JSON.stringify(bar)}).cloneNode(true))`);
  await waitForBrowserState(client, `typeof document.querySelector(${JSON.stringify(chat)})?.onclick==='function'&&typeof document.querySelector(${JSON.stringify(options)})?.onclick==='function'`, "Cloned visible nodes regain their real handlers");
  await click(options);
  assert.equal(await client.evaluate("document.querySelector('[data-codex-sidebar-folder-search]').value"), "项目", "Toolbar recovery preserves the folder search");
  await click('[data-codex-sidebar-section-tab="最近"]');
  assert.equal(await client.evaluate(`document.querySelector(${available}).hidden`), false, "New project/chat controls persist outside the Projects tab");
  await click('[data-codex-sidebar-section-tab="项目"]');
  await waitForBrowserState(client, `document.querySelector(${available})?.hidden===false&&document.querySelector(${available})?.querySelectorAll('button').length===3`, "Returning to Projects restores all three action icons");

  // Controls can move out of the section heading in a new host layout.
  await client.evaluate("document.getElementById('sections').before(document.getElementById('native-actions'))");
  await delay(200);
  for (let i = 0; i < 4; i++) await client.evaluate(`${api}.refresh()`);
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(proxies)}).children.length`), 2, "Lookup never grows by reusing its own proxies");
  await client.evaluate("window.__nativeActions=document.getElementById('native-actions');window.__nativeActions.remove()");
  await waitForBrowserState(client, `!document.querySelector(${JSON.stringify(proxies)})`, "Missing native controls remove their proxies");
  const count = await client.evaluate("window.__clicks.length");
  assert.deepEqual(await client.evaluate("window.__routes"), [], "Missing actions do not invent a project-page fallback");
  assert.equal(await client.evaluate("window.__clicks.length"), count);
  await client.evaluate("document.getElementById('sections').before(window.__nativeActions);document.getElementById('create').disabled=true");
  await waitForBrowserState(client, `!document.querySelector(${JSON.stringify(options)})?.disabled&&document.querySelector(${JSON.stringify(proxies + ' button[aria-label="添加新项目"]')})?.disabled===true`, "Native source recovery preserves per-action disabled state");
  await client.evaluate("document.getElementById('create').disabled=false");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(proxies + ' button[aria-label="添加新项目"]')})?.disabled===false`, "Changing only a native disabled attribute updates the action");
  await client.evaluate("window.__create=document.getElementById('create');window.__create.remove()");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(proxies)})?.children.length===1&&!document.querySelector(${JSON.stringify(proxies + ' button[aria-label="添加新项目"]')})`, "One missing source removes only its own action");
  await click(options);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "options");
  await client.evaluate("window.__create.setAttribute('aria-label','Add new project');document.getElementById('native-actions').append(window.__create)");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(proxies)})?.children.length===2&&document.querySelector(${JSON.stringify(proxies + ' button[aria-label="Add new project"]')})?.disabled===false`, "A native label/locale change updates the same slot without duplicates");

  // Folder actions may be direct children rather than a shared hover wrapper.
  await client.evaluate("document.getElementById('folder-row').append(...document.getElementById('folder-actions').children);document.getElementById('folder-actions').remove()");
  await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(chat)})&&!document.querySelector(${JSON.stringify(chat)}).disabled&&!document.querySelector(${JSON.stringify(chat)}).hidden`, "Direct-child folder buttons remain discoverable");
  await click(chat);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "folder-new");
  await client.evaluate("document.getElementById('folder-new').remove()");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(chat)})?.disabled===true&&!document.querySelector(${JSON.stringify(chat)}).hidden`, "Missing folder create action stays visible with an honest disabled state");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(newChatControl)})?.disabled`), true, "Search-row new chat remains visible but disabled without a matching native action");
  await client.evaluate(`${api}.setSearchCatalog([{threadId:'11111111-1111-4111-8111-111111111111',title:'项目 A 的历史对话',projectId:'p1',projectName:'项目 A',projectRootPath:'/Users/test/project-a'}]);window.__bridgeCalls=[];window.electronBridge={sendMessageFromView:async message=>{window.__bridgeCalls.push(message)}}`);
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(newChatControl)})?.disabled===false`, "A local project root keeps new chat usable when Codex omits the folder button");
  await click(newChatControl);
  await waitForBrowserState(client, "window.__routes.at(-1)==='/'", "Fallback opens the native blank composer");
  assert.deepEqual(await client.evaluate("window.__bridgeCalls"), [{ type: "electron-set-active-workspace-root", root: "/Users/test/project-a" }]);
  await client.evaluate(`window.electronBridge=undefined;window.__routes=[];${api}.refresh()`);
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(newChatControl)})?.disabled===true`, "No native button or workspace bridge leaves the action honestly disabled");
  const folderOptions = '#codex-sidebar-folder-switcher [data-codex-sidebar-folder-actions] button[aria-label="项目 A 的项目操作"]';
  await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(folderOptions)})`, "Folder options remain available independently");
  await click(folderOptions);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "folder-options");
  assert.deepEqual(await client.evaluate("window.__routes"), []);

  // Current host: retained inactive pages, div section landmarks and rail
  // navigation without mounted project-toolbar actions.
  await client.evaluate(`const inactive=document.createElement('div');inactive.dataset.appShellActivePage='false';inactive.innerHTML='<aside id="app-shell-sidebar"><button aria-label="添加新项目" id="inactive-create"></button></aside>';document.body.prepend(inactive);
    const section=document.querySelector('section[data-app-action-sidebar-section-heading]'),replacement=document.createElement('div');for(const a of section.attributes)replacement.setAttribute(a.name,a.value);replacement.append(...section.childNodes);section.replaceWith(replacement);
    const rail=document.createElement('nav');rail.dataset.appNavigationRail='';rail.style.cssText='position:fixed;right:0;top:0;width:50px;height:700px';document.body.append(rail);
    document.getElementById('native-actions').remove();window.__routes=[];`);
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(chat)})?.disabled===true&&!document.querySelector(${JSON.stringify(proxies)})&&!!document.querySelector('[data-codex-sidebar-tab-project-create]')`, "Modern layout keeps persistent project creation and honestly disabled chat controls");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(sortControl)})?.getBoundingClientRect().width > 0`), true, "Sorting stays visible when Codex removes its project-toolbar actions");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(createControl)})?.getBoundingClientRect().width > 0`), true, "Create stays visible when Codex removes its project-toolbar actions");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(newChatControl)})?.getBoundingClientRect().width > 0`), true, "New chat stays visible when Codex removes its project-toolbar actions");
  assert.deepEqual(await client.evaluate('window.__routes'), []);
  assert.deepEqual(await client.evaluate(`${api}.__test.nativeGlobalProjectActionButtons().map(e=>e.id)`), [], "Never select a matching action from an inactive retained page");

  await client.evaluate("const create=document.createElement('button');create.id='global-create';create.dataset.appActionSidebarProjectCreate='';create.setAttribute('aria-label','添加新项目');create.onclick=()=>window.__clicks.push('global-create');document.querySelector('main').append(create)");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(proxies + ' button[aria-label="添加新项目"]')})?.isConnected===true`, "Explicit native project-create action remains discoverable after layout relocation");
  await click(`${proxies} button[aria-label="添加新项目"]`);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "global-create");
  await click(createControl);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "global-create", "The persistent create control invokes the matching native action");
  assert.deepEqual(await client.evaluate("window.__routes"), []);

  await client.evaluate("document.getElementById('global-create').remove();window.addEventListener('message',e=>{if(e.data?.type==='navigate-to-route'&&e.data.path==='/projects'){const create=document.createElement('button');create.dataset.appActionSidebarProjectCreate='';create.setAttribute('aria-label','添加新项目');create.onclick=()=>window.__clicks.push('route-create');document.querySelector('main').append(create)}},{once:true})");
  await click(createControl);
  await waitForBrowserState(client, "window.__clicks.at(-1)==='route-create'", "Create control reaches a native create action after Projects route mounts");
  assert.deepEqual(await client.evaluate("window.__routes"), ["/projects"]);

  await client.evaluate(`(()=>{const folder=document.querySelector('[data-sidebar-project-kind]').cloneNode(true);folder.querySelectorAll('[id]').forEach(e=>e.id+='-sort');const row=folder.querySelector('[data-app-action-sidebar-project-row]');row.dataset.appActionSidebarProjectId='p3';row.dataset.appActionSidebarProjectLabel='000 项目';row.querySelector('span').textContent='000 项目';folder.querySelectorAll('[aria-label]').forEach(e=>e.setAttribute('aria-label',e.getAttribute('aria-label').replaceAll('项目 A','000 项目')));document.getElementById('folder-row').closest('[role=list]').append(folder)})()`);
  await client.evaluate("(()=>{const search=document.querySelector('[data-codex-sidebar-folder-search]');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await click(sortControl);
  await click('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-sort-mode="name"]');
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-tags] button:nth-child(2)')})?.dataset.codexSidebarFolderId==='p3'`, "Name sorting changes the visible project order");
  assert.equal(await client.evaluate("localStorage.getItem('codex-conversation-preview:folder-sort')"), "name");
  await click(sortControl);
  await click('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-sort-mode="native"]');
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-tags] button:nth-child(2)')})?.dataset.codexSidebarFolderId==='p1'`, "Native sorting restores the original project order");

  await client.evaluate("[...document.querySelectorAll('[id=app-shell-sidebar]')].at(-1).style.width='300px'");
  await click(sortControl);
  await click('#codex-sidebar-folder-switcher [data-codex-sidebar-folder-sort-mode="recent"]');
  await click(createControl);
  assert.equal(await client.evaluate("window.__clicks.at(-1)"), "route-create", "Narrow sidebar does not cover the create control");
  await client.evaluate("document.querySelector('#codex-sidebar-folder-switcher .codex-sidebar-folder-search-row').replaceWith(document.querySelector('#codex-sidebar-folder-switcher .codex-sidebar-folder-search-row').cloneNode(true))");
  await waitForBrowserState(client, `typeof document.querySelector(${JSON.stringify(newChatControl)})?.onclick==='function'&&typeof document.querySelector(${JSON.stringify(createControl)})?.onclick==='function'&&typeof document.querySelector(${JSON.stringify(sortControl)})?.onclick==='function'`, "Cloned search-row controls regain their distinct click handlers");
  await client.evaluate("const restored=document.createElement('button');restored.id='restored-folder-new';restored.setAttribute('aria-label','在 项目 A 中开始新聊天');restored.onclick=()=>window.__clicks.push('restored-folder-new');document.getElementById('folder-row').append(restored)");
  await waitForBrowserState(client, `document.querySelector(${JSON.stringify(newChatControl)})?.disabled===false`, "Restored native chat action re-enables the search-row button");
  await click(newChatControl);
  assert.equal(await client.evaluate("window.__bridgeCalls.at(-1).root"), "/Users/test/project-a", "Selected project root wins over a restored but unbound native button");
  const narrowActions = await client.evaluate(`(()=>{const h=document.querySelector(${available}).getBoundingClientRect();return [...document.querySelectorAll(${JSON.stringify(host + " button:not([hidden])")})].map(b=>{const r=b.getBoundingClientRect();return {label:b.getAttribute('aria-label'),left:r.left,right:r.right,width:r.width,height:r.height,hostLeft:h.left,hostRight:h.right}})})()`);
  assert.equal(narrowActions.every(r => r.width >= 26 && r.left >= r.hostLeft && r.right <= r.hostRight && r.height > 0), true, JSON.stringify(narrowActions));
  await delay(250);
  const syncCount = await client.evaluate(`${api}.getHealth().syncCount`);
  await delay(400);
  assert.equal(await client.evaluate(`${api}.getHealth().syncCount`), syncCount, "Repair does not create an idle render loop");
  assert.equal(await client.evaluate("document.querySelector('[contenteditable]').textContent"), "未发送的输入");
  assert.deepEqual(await client.evaluate(`${api}.getHealth().errors`), {});
});
