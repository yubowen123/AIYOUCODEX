import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";
import { claudeCommandCatalog } from "../lib/claude-commands.mjs";

const base = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const source = await readFile(new URL("../inject/claude-code.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("Dot and Claude real clicks: folded process, preserved answers and approvals, native forwarding and redraw", {
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
    window.__calls=[];window.__session=null;window.__view={available:true,interactionVersion:1,commandVersion:1,commands:${JSON.stringify(claudeCommandCatalog([{name:"plugin:lint",description:"检查文件",argumentHint:"<file>"}]))},version:'fixture',persona:{name:'Claude Code',logo:'',description:'',revision:0},projectId:'a',projects:[{id:'a',name:'项目A',cwd:'/a'},{id:'b',name:'项目B',cwd:'/b'}],skills:[{id:'skill1',title:'Skill One',description:'example'}],mcps:[{id:'docs',name:'docs',available:true},{id:'native',name:'native',available:false,reason:'宿主专用'}],sessions:[]};
    window.__AIYOUCODEX_CLAUDE_REQUEST__=raw=>{const p=JSON.parse(raw);window.__calls.push(p);let value;
      if(p.action==='send'){window.__session={id:'s1',projectId:p.projectId,projectName:'项目B',cwd:'/b',skillIds:p.skillIds,mcpIds:p.mcpIds,status:'running',messages:[{role:'user',text:p.prompt}],permissions:[]};value={session:window.__session};}
      else if(p.action==='persona-get')value={persona:window.__view.persona};
      else if(p.action==='persona-save'){window.__view.persona={...p.persona,revision:p.persona.revision+1};value={persona:window.__view.persona};}
      else if(p.action==='stop'){window.__session.status='stopped';value={session:window.__session};}
      else if(p.action==='permission'){window.__session.permissions=[];value={session:window.__session};}
      else if(p.action==='permission-mode'){window.__session.permissionMode=p.mode;window.__session.permissions=window.__session.permissions.filter(x=>!x.autoEligible);value={session:window.__session};}
      else if(p.action==='question-answer'){window.__session.permissions=[];value={session:window.__session};}
      else if(p.action==='choice'){window.__session.replyChoices=null;window.__session.messages.push({id:'reply',role:'user',text:p.value});window.__session.status='running';value={session:window.__session};}
      else value={...window.__view,session:p.sessionId?window.__session:null,sessions:window.__session?[{id:'s1',title:'任务',projectName:'项目B',status:window.__session.status}]:[]};
      window.__codexConversationPreviewInjection__.resolveClaudeRequest({requestId:p.requestId,ok:true,data:value});};`);
  async function click(selector) {
    const rect = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  async function key(key, code, virtualKey, modifiers = 0) {
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey, modifiers });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey, modifiers });
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
  await click('[data-claude-prompt]'); await client.send("Input.insertText",{text:"/"});
  await waitForBrowserState(client,"document.querySelectorAll('[data-claude-command]').length>10&&!document.querySelector('[data-claude-command-menu]').hidden","Slash trigger renders command descriptions");
  const menuGeometry=await client.evaluate("(()=>{const c=document.querySelector('[data-claude-compose]').getBoundingClientRect(),m=document.querySelector('[data-claude-command-menu]').getBoundingClientRect();return{above:m.bottom<c.top,inside:m.top>=0&&m.right<=innerWidth};})()");
  assert.deepEqual(menuGeometry,{above:true,inside:true});
  await key("ArrowDown","ArrowDown",40);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-command][aria-selected=true]').dataset.claudeCommand"),"clear");
  await key("Escape","Escape",27);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-command-menu]').hidden"),true);
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-claude-panel').hidden"),false,"Escape dismisses menu, not panel");
  await client.evaluate("document.querySelector('[data-claude-prompt]').value='';document.querySelector('[data-claude-prompt]').dispatchEvent(new Event('input'))");
  await client.send("Input.insertText",{text:"/sk"});
  assert.equal(await client.evaluate("document.querySelectorAll('[data-claude-command]').length"),1);
  await key("Enter","Enter",13);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),"/skills ");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='send').length"),0,"Selecting a command does not send it");
  await key("Enter","Enter",13);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-reference-menu]').hidden"),false,"Second Enter executes the panel command");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-tab=skills]').getAttribute('aria-selected')"),"true");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-claude-reference]').length"),2,"Slash action preserves Skill/MCP references");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='send').length"),0,"Panel command never reaches model");
  await click('[data-claude-prompt]'); await client.send("Input.insertText",{text:"/plugin"});
  await key("Tab","Tab",9);
  assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),"/plugin:lint ");
  assert.match(await client.evaluate("document.querySelector('[data-claude-command-hint]').textContent"),/<file>/);
  await client.evaluate("document.querySelector('[data-claude-prompt]').value='/Users/example/file';document.querySelector('[data-claude-prompt]').dispatchEvent(new Event('input'))");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-command-menu]').hidden"),true,"Absolute file paths do not open slash menu");
  await client.evaluate("document.querySelector('[data-claude-prompt]').value='独立 Claude 任务'"); await click("[data-claude-send]");
  await waitForBrowserState(client, "window.__aiyouClaudeInjection__.getState().sessionId==='s1'", "Send acknowledged exact session");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-reference-menu]').hidden"), true);
  const sent = await client.evaluate("window.__calls.find(p=>p.action==='send')");
  assert.equal(sent.projectId, "b"); assert.deepEqual(sent.skillIds, ["skill1"]); assert.deepEqual(sent.mcpIds, ["docs"]);
  assert.equal(await client.evaluate("document.querySelector('#native-draft').value"), "Codex 输入不能改变");
  await client.evaluate("window.__session.messages.push({id:'pre-call',role:'assistant',text:'准备核对文件'},{id:'tool-one',role:'tool',text:'调用 Skill'},{id:'thinking-one',role:'thinking',text:'过程记录示例'},{id:'progress-two',role:'progress',text:'正在检查输入'},{id:'tool-two',role:'tool',text:'调用 Bash'},{id:'final',role:'assistant',text:'核对完成，最终答复'});");
  await waitForBrowserState(client,"document.querySelectorAll('[data-claude-process]').length===1","Consecutive process and tools group into one compact status row");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-process]').open"),false,"Process defaults to collapsed");
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('[data-claude-process-content]')).display"),'none');
  assert.equal(await client.evaluate("document.querySelectorAll('[data-claude-log]>article[data-role=tool]').length"),0);
  assert.ok(await client.evaluate("[...document.querySelectorAll('[data-claude-log]>article')].some(e=>e.textContent==='核对完成，最终答复')"));
  if(process.env.AIYOUCODEX_THEME_FIXTURE_DIR){const themeRoot=process.env.AIYOUCODEX_THEME_FIXTURE_DIR,theme=await import(path.join(themeRoot,'theme-package.mjs')),palette=JSON.parse(await readFile(path.join(themeRoot,'colors.json'),'utf8')),design=JSON.parse(await readFile(path.join(themeRoot,'design.json'),'utf8')),controls=theme.createThemeCustomization();const css=(await Promise.all(['tokens.css','theme.css','customization.css'].map(file=>readFile(path.join(themeRoot,file),'utf8')))).join('\n')+'\n'+theme.buildThemePaletteCss(palette,'mecha-control')+'\n'+theme.buildThemeDesignCss(design,palette,'mecha-control')+'\n'+controls.css(controls.defaults);await client.evaluate(`document.documentElement.dataset.aiyouTheme='mecha-control';const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);`);assert.deepEqual(await client.evaluate("(()=>{const c=document.createElement('canvas'),x=c.getContext('2d');x.fillStyle=getComputedStyle(document.querySelector('[data-claude-process]')).color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data]})()"),[169,190,207,255]);assert.equal(await client.evaluate("getComputedStyle(document.querySelector('[data-claude-process]')).opacity"),'1');}
  if(process.env.AIYOUCODEX_RENDERER_EVIDENCE_DIR){await mkdir(process.env.AIYOUCODEX_RENDERER_EVIDENCE_DIR,{recursive:true});const screenshot=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(process.env.AIYOUCODEX_RENDERER_EVIDENCE_DIR,'v1.4.0-claude-collapsed-fixture.png'),Buffer.from(screenshot.data,'base64'));}
  await click('[data-claude-process]>summary');
  await waitForBrowserState(client,"document.querySelector('[data-claude-process]').open","Process expands with actual pointer click");
  if(process.env.AIYOUCODEX_THEME_FIXTURE_DIR){assert.ok(await client.evaluate("getComputedStyle(document.querySelector('[data-claude-process-content]')).borderRadius!=='0px'"));assert.equal(await client.evaluate("getComputedStyle(document.querySelector('[data-claude-process-content]')).opacity"),'1');}
  await client.evaluate("window.__session.messages.push({id:'followup',role:'assistant',text:'下一步答复'})");
  await waitForBrowserState(client,"document.querySelector('[data-claude-log]').textContent.includes('下一步答复')","Streaming redraw updated");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-process]').open"),true,"Redraw keeps user's expanded selection");
  await client.evaluate("window.__session.messages.push({id:'visible-error',role:'error',text:'网络错误示例'},{id:'after-error-tool',role:'tool',text:'调用 Read'})");
  await waitForBrowserState(client,"!!document.querySelector('[data-claude-log]>article[data-role=error]')","Explicit errors remain visible outside process groups");
  assert.equal(await client.evaluate("[...document.querySelectorAll('[data-claude-process]')].at(-1).open"),false,"New process groups default to collapsed");
  await client.evaluate("window.__session.permissions=[{id:'permit1',tool:'Edit',input:'file.txt'}]");
  await waitForBrowserState(client, "!!document.querySelector('[data-permission=permit1]')", "Permission surfaced without auto approval", 5000);
  await click("[data-permission=permit1] button");
  assert.equal(await client.evaluate("window.__calls.find(p=>p.action==='permission').allow"), true);
  await client.evaluate("document.querySelector('[data-claude-prompt]').value='保留的未发送草稿';window.__session.permissions=[{id:'auto1',tool:'Bash',input:'fixture only',autoEligible:true}]");
  await waitForBrowserState(client,"!!document.querySelector('[data-permission=auto1]')","Auto confirmation action is available");
  await click("[data-permission=auto1] button:last-child");
  await waitForBrowserState(client,"document.querySelector('[data-claude-mode]').dataset.auto==='true'&&!document.querySelector('[data-permission=auto1]')","Auto ACK updates mode and pending tool");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='permission').length"),1,"Auto is a mode change, not repeated one-shot approval");
  await click("[data-claude-mode]"); await click('[data-set-mode="manual"]');
  await waitForBrowserState(client,"document.querySelector('[data-claude-mode]').dataset.auto==='false'","Manual mode restored by pointer click");
  await click("[data-claude-mode]"); await click('[data-set-mode="auto"]');
  await waitForBrowserState(client,"document.querySelector('[data-claude-mode]').dataset.auto==='true'","Auto mode selected from anchored composer menu");
  await client.evaluate(`window.__session.permissions=[{id:'q1',kind:'question',tool:'AskUserQuestion',questions:[{id:'0',header:'方式',question:'如何处理？',multiSelect:false,options:[{id:'0',label:'自动填写',description:'停在发布前'},{id:'1',label:'仅存草稿',description:''}]},{id:'1',header:'素材',question:'选择素材',multiSelect:true,options:[{id:'0',label:'横版',description:''},{id:'1',label:'竖版',description:''}]}]}]`);
  await waitForBrowserState(client,"!!document.querySelector('[data-permission=q1]')","Auto still presents business choices");
  await click('[data-question="0"] label:last-of-type input');
  await click('[data-question="1"] label:first-of-type input');
  await click('[data-question="1"] label:last-of-type input');
  await click('[data-question="1"] [data-question-custom]'); await client.send("Input.insertText",{text:"自制封面"});
  await delay(1200);
  assert.equal(await client.evaluate("document.querySelector('[data-question=\"1\"] [data-question-custom]').value"),"自制封面","Polling does not reset pending selections");
  await click("[data-permission=q1] button[type=submit]");
  await waitForBrowserState(client,"!document.querySelector('[data-permission=q1]')","Question answers returned through callback");
  assert.deepEqual(await client.evaluate("window.__calls.find(p=>p.action==='question-answer').answers"),[{selected:["1"],custom:""},{selected:["0","1"],custom:"自制封面"}]);
  await client.evaluate(String.raw`window.__session.status='idle';window.__session.messages.push({id:'choice-message',role:'assistant',text:'1. 自动填写\n2. 仅存草稿\n回复 1、2。'},{id:'after-choice-tool',role:'tool',text:'调用 Read'});window.__session.replyChoices={messageId:'choice-message',options:[{value:'1',label:'自动填写'},{value:'2',label:'仅存草稿'}]};window.__aiyouClaudeInjection__.open()`);
  await waitForBrowserState(client,"document.querySelectorAll('[data-claude-choice]').length===2","Explicit textual options are clickable");
  await click('[data-claude-choice="2"]');
  await waitForBrowserState(client,"!document.querySelector('[data-claude-choice]')","Answered options disappear");
  assert.equal(await client.evaluate("window.__calls.filter(p=>p.action==='choice').length"),1);
  assert.equal(await client.evaluate("window.__calls.find(p=>p.action==='choice').value"),"2");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),"保留的未发送草稿","Clicking a quick reply never consumes the composer draft");
  await client.evaluate(base + "\n" + source);
  await waitForBrowserState(client,"window.__aiyouClaudeInjection__.getState().pending===0&&!document.querySelector('#aiyoucodex-claude-panel').hidden","Full renderer update restores open Claude panel");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),"保留的未发送草稿","Full renderer update retains draft");
  assert.equal(await client.evaluate("window.__aiyouClaudeInjection__.getState().sessionId"),"s1","Full renderer update keeps selected session without replay");
  assert.equal(await client.evaluate("document.querySelector('[data-claude-process]').open"),true,"Hot update preserves expanded process selection");
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
  assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),"保留的未发送草稿","Renderer update retains unsent draft");
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
  if(process.env.AIYOUCODEX_RENDERER_EVIDENCE_DIR)await writeFile(path.join(process.env.AIYOUCODEX_RENDERER_EVIDENCE_DIR,'claude-process-result.json'),JSON.stringify({checkedAt:new Date().toISOString(),pass:true,fixtureOnly:true,nativeVisualAccepted:false,checks:['tools/progress/thinking grouped and collapsed by default','pre-call narration folded; final answer visible','pointer expands details','streaming redraw preserves expanded state','explicit error visible; new groups collapsed','permission and Auto acknowledgement remain visible and actionable','questions and business choices clickable, even before tool record','hot update retains process expansion, session and unsent draft','no replay of send or persona write','native Dot forwarding and independent draft preserved']},null,2)+'\n');
});
