import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";
import { createTaskboardServer } from "../vendor/codex-taskboard/server/index.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const boardSource = await readFile(new URL("../vendor/codex-taskboard/inject/codex-taskboard.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("six lanes follow live message order and colors; popup shortcuts toggle and Taskboard close remains reachable", {
  timeout: 55_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Requires isolated Chrome/Chromium",
}, async (t) => {
  assert.ok(executable);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "aiyoucodex-project-menus-"));
  const codexHome = path.join(temporaryRoot, "codex");
  await mkdir(path.join(codexHome, "sessions"), { recursive: true });
  const oldId = "11111111-1111-4111-8111-111111111111";
  const newId = "22222222-2222-4222-8222-222222222222";
  const oldFile = path.join(codexHome, "sessions", `rollout-${oldId}.jsonl`);
  const newFile = path.join(codexHome, "sessions", `rollout-${newId}.jsonl`);
  const message = (timestamp) => `${JSON.stringify({ timestamp, type: "event_msg", payload: { type: "agent_message", message: "Fixture response" } })}\n`;
  await writeFile(oldFile, message("2026-09-01T01:00:00.000Z"));
  await writeFile(newFile, message("2026-09-02T01:00:00.000Z"));
  const sqlite = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  sqlite.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT)");
  for (const [id, file] of [[oldId, oldFile], [newId, newFile]]) sqlite.prepare("INSERT INTO threads VALUES (?, ?)").run(id, file);
  sqlite.close();
  const app = createTaskboardServer({ dataDirectory: path.join(temporaryRoot, "board"), codexStatePath: path.join(codexHome, ".codex-global-state.json") });
  const address = await app.listen({ port: 0 });
  const origin = `http://127.0.0.1:${address.port}`;
  const statuses = ["todo", "in_progress", "in_review", "blocked", "done", "canceled"];
  for (const [index, status] of statuses.entries()) {
    for (const [age, threadId] of [["old", oldId], ["new", newId]]) {
      const response = await fetch(origin + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "local", title: `${status}-${age}`, status, threadId, priority: ["urgent", "high", "low"][index % 3] }) });
      assert.equal(response.status, 201);
    }
  }

  const fixture = `<style>body{margin:0;display:flex;height:100vh;overflow:hidden}aside{width:260px;flex:0 0 260px}main{flex:1;min-width:0;height:100vh}#surface{display:flex;width:100%;height:100%}#chat{flex:1;min-width:0;height:100%}.app-shell-main-content-frame{height:100%}button{min-height:28px}#native-toolbar{position:fixed;right:0;top:0;left:260px;height:48px;z-index:999;display:flex;justify-content:flex-end;align-items:center;background:#fafafa;-webkit-app-region:drag}#native-toolbar button{width:44px;height:36px;-webkit-app-region:no-drag}</style>
    <aside id="app-shell-sidebar"><nav role="navigation"><div data-app-action-sidebar-scroll><div><div><button aria-label="New chat"><span class="text-fade-truncate">New chat</span></button><button aria-label="Quick chat">+</button></div><div><button><span class="text-fade-truncate">Pull requests</span></button><button><span class="text-fade-truncate">Scheduled</span></button><button><span class="text-fade-truncate">Plugins</span></button></div></div><section data-app-action-sidebar-section="projects"><button data-app-action-sidebar-section-toggle>Projects</button></section></div></nav></aside>
    <main><header id="native-toolbar" data-testid="app-shell-header-context-menu-surface"><div data-app-shell-header-obstacle="true"><button id="native-share" onclick="window.nativeShareClicks=(window.nativeShareClicks||0)+1">分享</button><button id="native-panel">面板</button></div></header><div id="surface"><div id="chat" data-app-shell-main-content-layout><div class="app-shell-main-content-frame"><div id="composer" contenteditable="true" style="width:300px;height:90px">Keep my draft</div></div></div></div></main>`;
  const server = createServer((request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end(request.url === "/child" ? "<textarea>Retained state</textarea>" : fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const hostOrigin = `http://127.0.0.1:${server.address().port}`;
  const profile = path.join(temporaryRoot, "browser");
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1506,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await app.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: origin }));
  const order = (age) => `Array.from(document.querySelectorAll('.project-swimlane')).length===6&&Array.from(document.querySelectorAll('.project-swimlane')).every(l=>l.querySelectorAll('.project-swimlane-card').length===2&&l.querySelector('.project-swimlane-card').textContent.includes('-${age}'))`;
  await waitForBrowserState(client, order("new"), "All six lanes render most recent real conversation first");
  const colors = await client.evaluate(`['urgent','high','low'].map(p=>{const c=document.querySelector('.project-swimlane-card.priority-'+p),s=getComputedStyle(c);return {color:s.borderTopColor,width:s.borderTopWidth}})`);
  assert.deepEqual(colors, [{ color: "rgb(243, 78, 82)", width: "2px" }, { color: "rgb(240, 191, 0)", width: "2px" }, { color: "rgb(67, 188, 88)", width: "2px" }]);
  await appendFile(oldFile, message("2026-09-03T01:00:00.000Z"));
  await waitForBrowserState(client, order("old"), "New message reorders each lane without reopening", 9000);

  await client.send("Page.navigate", { url: hostOrigin });
  await waitForBrowserState(client, `location.origin===${JSON.stringify(hostOrigin)}&&document.readyState==='complete'`, "Isolated native-shell fixture loaded");
  await client.evaluate(`window.__CODEX_TASKBOARD_SOURCE_HASH__='fixture';window.__CODEX_TASKBOARD_DOCUMENT__=${JSON.stringify('<html><head></head><body><div id="root"></div><textarea id="draft">Retained board state</textarea><script>parent.postMessage({type:"taskboard:ready"},location.origin)</script></body></html>')};window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__=[{id:'fixture-tool',name:'Fixture Tool',url:location.origin+'/child',icon:'play',openMode:'internal',keepAlive:true}];`);
  await client.evaluate(boardSource);
  await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(`${api}.setSkillCatalog([{name:'fixture-skill',title:'Fixture Skill',description:'Keep two lines',path:'/fixture/SKILL.md'}])`);
  const shortcut = (name) => `[data-codex-sidebar-shortcut-card][data-codex-sidebar-shortcut-name="${name}"]`;
  async function click(selector) {
    await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(selector)})`, `Click target exists: ${selector}`);
    const point = await client.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),b=c.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return {x,y,hit:c.contains(document.elementFromPoint(x,y))}})()`);
    assert.equal(point.hit, true, `Target must be reachable: ${selector}`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  const shown = (selector) => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.hidden&&e.getAttribute('aria-hidden')!=='true'})()`;
  const separateChrome = `(()=>{const p=document.getElementById('codex-taskboard-page'),c=document.getElementById('codex-taskboard-close'),h=document.getElementById('native-toolbar');if(!p||p.hidden||!c)return false;const r=c.getBoundingClientRect(),n=h.getBoundingClientRect();return r.top>=n.bottom+4&&r.bottom<=innerHeight&&r.width>=40&&r.height>=40&&[[.15,.15],[.85,.15],[.5,.5],[.15,.85],[.85,.85]].every(([x,y])=>c.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)))})()`;
  await click(shortcut("项目管理"));
  await waitForBrowserState(client, shown("#codex-taskboard-page"), "Project panel opens");
  await waitForBrowserState(client, separateChrome, "Project close is below native toolbar, not competing in the same hit region");
  await click("#native-share");
  assert.equal(await client.evaluate("window.nativeShareClicks"), 1, "The original native toolbar remains usable while Taskboard is open");
  await click("#codex-taskboard-close");
  await waitForBrowserState(client, `!${shown("#codex-taskboard-page")}`, "Close works even during loading");
  await click(shortcut("项目管理"));
  await waitForBrowserState(client, "!!document.querySelector('#codex-taskboard-frame')&&!document.querySelector('#codex-taskboard-frame').hidden", "Project frame ready");
  await client.evaluate("window.fixtureFrame=document.getElementById('codex-taskboard-frame');window.fixtureFrame.contentDocument.getElementById('draft').value='Unsubmitted board draft'");
  await click(shortcut("项目管理"));
  await waitForBrowserState(client, `!${shown("#codex-taskboard-page")}`, "Second project click collapses");
  await click(shortcut("项目管理"));
  assert.equal(await client.evaluate("window.fixtureFrame===document.getElementById('codex-taskboard-frame')&&window.fixtureFrame.contentDocument.getElementById('draft').value==='Unsubmitted board draft'"), true, "Reopen keeps frame and draft");
  await client.evaluate("document.getElementById('native-toolbar').style.height='76px'");
  await waitForBrowserState(client, separateChrome, "Changing native header height recomputes separation");
  await client.evaluate("document.getElementById('native-toolbar').hidden=true");
  await waitForBrowserState(client, "parseFloat(document.getElementById('codex-taskboard-page').style.getPropertyValue('--codex-taskboard-header-inset'))===0", "No artificial gap when the native toolbar is hidden");
  await client.evaluate("document.getElementById('native-toolbar').hidden=false");
  await waitForBrowserState(client, separateChrome, "Restoring the native toolbar restores the safety gap");
  await client.evaluate("document.getElementById('surface').style.zoom='1.25'");
  await waitForBrowserState(client, separateChrome, "CSS scaling does not multiply the toolbar inset incorrectly");
  await client.evaluate("document.getElementById('surface').style.zoom='1';document.getElementById('native-toolbar').style.height='48px'");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 850, height: 620, deviceScaleFactor: 1, mobile: false });
  await waitForBrowserState(client, separateChrome, "Native buttons and close stay separate in a narrow window");
  await click("#codex-taskboard-close");
  await client.send("Emulation.clearDeviceMetricsOverride");
  await click(shortcut("Skills 分组"));
  const skillsSelector = "#codex-skill-organizer";
  try { await waitForBrowserState(client, shown(skillsSelector), "Skills opens"); } catch (error) {
    const state = await client.evaluate("({skills:document.getElementById('codex-skill-organizer')?.outerHTML.slice(0,1000),panels:Array.from(document.querySelectorAll('[data-codex-workspace-side-panel]')).map(p=>({id:p.id,hidden:p.hidden,aria:p.getAttribute('aria-hidden')})),buttons:Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).map(b=>({name:b.dataset.codexSidebarShortcutName,active:b.dataset.active}))})");
    throw new Error(`${error.message}; ${JSON.stringify(state)}`, { cause: error });
  }
  await client.evaluate("new Promise(resolve=>{window.addEventListener('message',function seen(e){if(e.source===window&&e.data?.fixtureStaleOpen){window.removeEventListener('message',seen);resolve(true)} });window.postMessage({type:'codex-workspace-panel:open',panel:'taskboard',fixtureStaleOpen:true},location.origin)})");
  assert.equal(await client.evaluate(shown(skillsSelector)), true, "A delayed Taskboard open event cannot close the new Skills panel");
  await click(shortcut("Skills 分组"));
  await waitForBrowserState(client, `!${shown(skillsSelector)}`, "Second Skills click collapses");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(shortcut("Skills 分组"))}).getAttribute('aria-expanded')`), "false");
  await click(shortcut("Skills 分组"));
  await waitForBrowserState(client, shown(skillsSelector), "Third Skills click reopens");
  await client.evaluate(`${api}.setSkillCatalog([])`);
  await click(shortcut("Skills 分组"));
  await waitForBrowserState(client, `!${shown(skillsSelector)}`, "Empty catalog panel can still be collapsed");
  await click(shortcut("资产控制台"));
  await waitForBrowserState(client, "document.documentElement.hasAttribute('data-codex-asset-console-open')", "Asset popup opens even with service not connected");
  await click(shortcut("资产控制台"));
  assert.equal(await client.evaluate("document.documentElement.hasAttribute('data-codex-asset-console-open')"), false, "Asset loading/error state also collapses");
  await click(shortcut("Fixture Tool"));
  await waitForBrowserState(client, "!!document.querySelector('iframe[data-codex-custom-shortcut-frame]')", "Managed tool opens");
  await client.evaluate("window.fixtureTool=document.querySelector('iframe[data-codex-custom-shortcut-frame]')");
  await click(shortcut("Fixture Tool"));
  await waitForBrowserState(client, "!document.documentElement.hasAttribute('data-codex-custom-shortcut-open')", "Managed tool parks on repeat click");
  await click(shortcut("Fixture Tool"));
  assert.equal(await client.evaluate("document.documentElement.hasAttribute('data-codex-custom-shortcut-open')&&window.fixtureTool===document.querySelector('iframe[data-codex-custom-shortcut-frame]')"), true);
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "Keep my draft", "Menu interaction never edits or sends chat content");
});
