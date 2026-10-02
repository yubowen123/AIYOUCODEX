import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const base = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const source = await readFile(new URL("../inject/claude-code.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("Dot and Claude real clicks: native forwarding, project/Skills/MCP, independent draft, tool approval and redraw", {
  timeout: 35000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Requires isolated Chrome/Chromium",
}, async t => {
  assert.ok(executable);
  const profile = await mkdtemp(path.join(tmpdir(), "aiyou-claude-ui-"));
  const fixture = `<style>body{margin:0;height:100vh;display:flex}aside{width:330px}main{flex:1;display:flex;min-width:0;height:100vh}#chat{flex:1;min-width:0}button{min-height:30px}</style>
    <aside id="app-shell-sidebar"><nav><div>Codex<button aria-label="搜索">搜索</button></div><div id="native-actions"><button data-sidebar-destination="builtin:orbit"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg><span>裤兜</span></button></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="Projects"><button data-app-action-sidebar-section-toggle>Projects</button></section></div></nav></aside>
    <div data-app-shell-active-page="false" style="display:none"><main><div data-app-shell-main-content-layout><div class="app-shell-main-content-frame">hidden retained product</div></div></main></div>
    <main id="active-main"><div id="chat"><textarea id="native-draft">Codex 输入不能改变</textarea></div></main><div class="_header_fixture"><div class="group/orbit-profile">Dot 悬浮头像</div></div>`;
  const server = createServer((req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(fixture); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1500,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => { client?.close(); browser.kill("SIGTERM"); await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]); if (browser.exitCode == null) browser.kill("SIGKILL"); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  await client.evaluate(base + "\n" + source);
  await client.evaluate(`window.__dotClicks=0;document.querySelector('[data-sidebar-destination="builtin:orbit"]').onclick=()=>window.__dotClicks++;
    window.__calls=[];window.__session=null;window.__view={available:true,version:'fixture',persona:{name:'Claude Code',logo:'',description:'',revision:0},projectId:'a',projects:[{id:'a',name:'项目A',cwd:'/a'},{id:'b',name:'项目B',cwd:'/b'}],skills:[{id:'skill1',title:'Skill One',description:'example'}],mcps:[{id:'docs',name:'docs',available:true},{id:'native',name:'native',available:false,reason:'宿主专用'}],sessions:[]};
    window.__AIYOUCODEX_CLAUDE_REQUEST__=raw=>{const p=JSON.parse(raw);window.__calls.push(p);let value;
      if(p.action==='send'){window.__session={id:'s1',projectId:p.projectId,projectName:'项目B',cwd:'/b',skillIds:p.skillIds,mcpIds:p.mcpIds,status:'running',messages:[{role:'user',text:p.prompt}],permissions:[]};value={session:window.__session};}
      else if(p.action==='persona-get')value={persona:window.__view.persona};
      else if(p.action==='persona-save'){window.__view.persona={...p.persona,revision:p.persona.revision+1};value={persona:window.__view.persona};}
      else if(p.action==='stop'){window.__session.status='stopped';value={session:window.__session};}
      else if(p.action==='permission'){window.__session.permissions=[];value={session:window.__session};}
      else value={...window.__view,session:p.sessionId?window.__session:null,sessions:window.__session?[{id:'s1',title:'任务',projectName:'项目B',status:window.__session.status}]:[]};
      window.__codexConversationPreviewInjection__.resolveClaudeRequest({requestId:p.requestId,ok:true,data:value});};`);
  async function click(selector) {
    const rect = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  await waitForBrowserState(client, "document.querySelectorAll('#aiyoucodex-agent-launchers button').length===2", "Two native-position launchers exist");
  const geometry = await client.evaluate("[...document.querySelectorAll('#aiyoucodex-agent-launchers button')].map(b=>b.getBoundingClientRect().toJSON())");
  assert.equal(geometry[0].y, geometry[1].y); assert.ok(geometry[0].right < geometry[1].left);
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('[data-aiyou-claude]')).color"), "rgb(89, 89, 89)");
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('[data-aiyou-claude]')).fontSize"), "12px");
  assert.equal(geometry[0].height, 44); assert.equal(geometry[1].height, 44);
  await click("[data-aiyou-dot]"); assert.equal(await client.evaluate("window.__dotClicks"), 1);
  await click("[data-aiyou-claude]");
  await waitForBrowserState(client, "document.querySelector('[data-claude-project]').options.length===3", "Backend resource choices mounted");
  assert.ok(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').getBoundingClientRect().height>0"));
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').parentElement.id"), "active-main");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-setup] [data-claude-skills]')"), null);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-reference-menu]').hidden"), true);
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('._header_fixture')).visibility"),"hidden","Dot overlay is isolated while Claude is open");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-name]').textContent"),"Claude Code");
  await click("[data-claude-identity]");
  const settingsGeometry=await client.evaluate("(()=>{const p=document.querySelector('#aiyoucodex-claude-panel').getBoundingClientRect(),r=document.querySelector('[data-claude-persona]').getBoundingClientRect();return {inside:r.x>=p.x&&r.right<=p.right,nearHeader:r.y-p.y<150};})()");
  assert.equal(settingsGeometry.inside,true);assert.equal(settingsGeometry.nearHeader,true);
  await client.evaluate("document.querySelector('[data-persona-name]').value='小克';document.querySelector('[data-persona-description]').value='回答简洁，擅长开发。'");
  await client.evaluate("(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const blob=await new Promise(r=>canvas.toBlob(r));const transfer=new DataTransfer();transfer.items.add(new File([blob],'logo.png',{type:'image/png'}));const input=document.querySelector('[data-persona-file]');input.files=transfer.files;input.dispatchEvent(new Event('change'));return true;})()");
  await waitForBrowserState(client,"!!document.querySelector('[data-persona-preview] img')&&!document.querySelector('[data-claude-persona-save]').disabled","Uploaded logo is decoded before saving");
  await click("[data-claude-persona-save]");
  await waitForBrowserState(client,"document.querySelector('[data-claude-name]').textContent==='小克'&&document.querySelector('[data-claude-persona]').hidden","Saved persona updates header");
  assert.equal(await client.evaluate("document.querySelector('[data-aiyou-claude]').textContent"),"小克");
  assert.equal(await client.evaluate("window.__calls.find(c=>c.action==='persona-save').persona.description"),"回答简洁，擅长开发。");
  assert.ok(await client.evaluate("document.querySelector('[data-claude-identity] img').src.startsWith('data:image/png;base64,')"));
  await client.evaluate("document.querySelector('[data-claude-project]').value='b';document.querySelector('[data-claude-project]').dispatchEvent(new Event('change'));document.querySelector('#native-draft').value='Codex 输入不能改变'");
  await waitForBrowserState(client, "window.__aiyouClaudeInjection__.getState().projectId==='b'&&window.__aiyouClaudeInjection__.getState().pending===0", "Project is selected");
  await click("[data-claude-add]");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-reference-menu]').hidden"), false);
  await click("[data-claude-skills] input"); await click('[data-claude-tab="mcps"]'); await click("[data-claude-mcps] input:not(:disabled)");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-claude-reference]').length"), 2);
  await client.evaluate("document.querySelector('[data-claude-prompt]').value='独立 Claude 任务'"); await click("[data-claude-send]");
  await waitForBrowserState(client, "window.__aiyouClaudeInjection__.getState().sessionId==='s1'", "Send acknowledged exact session");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-reference-menu]').hidden"), true);
  const sent = await client.evaluate("window.__calls.find(p=>p.action==='send')");
  assert.equal(sent.projectId, "b"); assert.deepEqual(sent.skillIds, ["skill1"]); assert.deepEqual(sent.mcpIds, ["docs"]);
  assert.equal(await client.evaluate("document.querySelector('#native-draft').value"), "Codex 输入不能改变");
  await client.evaluate("window.__session.permissions=[{id:'permit1',tool:'Edit',input:'file.txt'}]");
  await waitForBrowserState(client, "!!document.querySelector('[data-permission=permit1]')", "Permission surfaced without auto approval", 5000);
  await click("[data-permission=permit1] button");
  assert.equal(await client.evaluate("window.__calls.find(p=>p.action==='permission').allow"), true);
  await click("[data-claude-stop]");
  await waitForBrowserState(client, "window.__aiyouClaudeInjection__.getState().data.session.status==='stopped'", "Only Claude session stopped");
  await client.evaluate("document.querySelector('#aiyoucodex-agent-launchers').remove();window.__codexConversationPreviewInjection__.refresh()");
  await waitForBrowserState(client, "document.querySelectorAll('#aiyoucodex-agent-launchers').length===1", "Host redraw restores one launcher row");
  await click("[data-aiyou-dot]"); assert.equal(await client.evaluate("window.__dotClicks"), 2);
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').hidden"), true);
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('._header_fixture')).visibility"),"visible","Dot overlay is restored when returning to Dot");
  await client.evaluate("(()=>{const main=document.getElementById('active-main'),workspace=document.createElement('div');workspace.id='dot-workspace';workspace.className='_WorkspaceContent_fixture';workspace.style.cssText='display:flex;flex:1;min-height:0';workspace.append(document.getElementById('chat'));main.style.flexDirection='column';main.append(workspace);})()");
  await client.evaluate(source);
  await click("[data-aiyou-claude]");
  await waitForBrowserState(client,"document.querySelector('[data-claude-name]').textContent==='小克'","Profile survives renderer reinjection");
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').parentElement.id"),"dot-workspace","Dot column mounts inside horizontal workspace");
  assert.ok(await client.evaluate("document.querySelector('[data-claude-identity]').getBoundingClientRect().top>=0"),"Identity remains in viewport");
  assert.ok(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').getBoundingClientRect().right<=innerWidth"),"Panel cannot be pushed outside the native Dot workspace");
  await client.evaluate("(()=>{const native=document.createElement('aside');native.textContent='Native editor';native.style.cssText='position:absolute;right:0;top:0;width:650px;height:100%;z-index:41';document.getElementById('dot-workspace').append(native);})()");
  await click("[data-claude-identity]");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-persona]').hidden"),false,"Native editor cannot cover Claude identity");
  await click("[data-persona-cancel]");
  await client.evaluate("window.__workingClaudeBinding=window.__AIYOUCODEX_CLAUDE_REQUEST__;window.__AIYOUCODEX_CLAUDE_REQUEST__=()=>{};window.__aiyouClaudeInjection__.open();");
  await waitForBrowserState(client,"window.__aiyouClaudeInjection__.getState().pending>0","Reconnect fixture drops the initial read");
  await client.evaluate("window.__AIYOUCODEX_CLAUDE_REQUEST__=window.__workingClaudeBinding;delete window.__workingClaudeBinding;window.__aiyouClaudeInjection__.onBridgeReady();");
  await waitForBrowserState(client,"window.__aiyouClaudeInjection__.getState().pending===0","Bridge readiness recovers pending reads without waiting for timeout");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='send').length"),1,"Reconnect never repeats a message send");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='persona-save').length"),1,"Reconnect never repeats a profile write");
  await client.evaluate("window.__codexConversationPreviewInjection__.destroy()");
  assert.equal(await client.evaluate("document.querySelectorAll('#aiyoucodex-agent-launchers,#aiyoucodex-claude-panel').length"), 0);
  assert.ok(await client.evaluate("document.querySelector('[data-sidebar-destination=\"builtin:orbit\"]').getBoundingClientRect().height>0"));
});
