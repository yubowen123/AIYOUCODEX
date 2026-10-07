import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {connectFixtureBrowser,waitForBrowserState} from './helpers/browser-state.mjs';
const candidates=[process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium',...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;for(const p of candidates){try{await access(p);executable=p;break;}catch{}}
const source=await readFile(new URL('../inject/conversation-preview.user.js',import.meta.url),'utf8');
const taskboard=await readFile(new URL('../vendor/codex-taskboard/inject/codex-taskboard.user.js',import.meta.url),'utf8');

test('real project panel and common plugin controls drag, expand, restore, persist width and retain iframe/draft', {timeout:30000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome required'},async t=>{
 assert.ok(executable);const profile=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'aiyou-panel-controls-'));
 const html=`<style>body{margin:0;height:100vh;display:flex}aside{width:200px;flex:none}main{height:100vh;flex:1;min-width:0;display:flex}#native-chat{flex:1;min-width:0}header{display:flex;align-items:center;gap:8px;padding:12px;height:50px;box-sizing:border-box}button{min-height:30px}iframe{width:100%;height:220px}</style><aside><nav id="app-shell-sidebar"><button aria-label="插件">插件</button></nav></aside><main><div id="native-chat"><div data-composer-body><div contenteditable id="draft">保留输入草稿</div><button>发送</button></div></div></main>`;
 const server=createServer((_,r)=>{r.setHeader('content-type','text/html;charset=utf-8');r.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--window-size=1500,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let client;t.after(async()=>{client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1000)]);if(browser.exitCode==null)browser.kill('SIGKILL');await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 await client.evaluate(source);await client.evaluate("window.__CODEX_TASKBOARD_SOURCE_HASH__='fixture-controls'");await client.evaluate(taskboard);
 await client.evaluate('window.__codexTaskboardInjection__.open()');
 await waitForBrowserState(client,"document.querySelector('#codex-taskboard-page [data-aiyou-panel-expand]')!==null",'Taskboard adopts the common controls');
 const api='window.__codexConversationPreviewInjection__';
 async function click(selector){const point=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);assert.equal(point.hit,true,selector);await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});}
 const page='#codex-taskboard-page';
 const width=()=>client.evaluate(`document.querySelector('${page}').getBoundingClientRect().width`);
 const before=await width();const start=await client.evaluate(`(()=>{const r=document.querySelector('${page} [data-aiyou-panel-resize]').getBoundingClientRect();return{x:r.x+3,y:r.y+100}})()`);
 await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
 await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+110,y:start.y,buttons:1});
 await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+110,y:start.y,button:'left',clickCount:1});
 const resized=await width();assert.ok(before-resized>90,{before,resized});assert.equal(Number(await client.evaluate("localStorage.getItem('codex-workspace-enhancer:side-panel-width-v1')")),Math.round(resized));
 await click(`${page} [data-aiyou-panel-expand]`);
 assert.equal(Math.round(await width()),await client.evaluate('Math.round(document.querySelector("main").getBoundingClientRect().width)'));
 assert.equal(await client.evaluate('getComputedStyle(document.querySelector("#native-chat")).visibility'),'hidden');
 assert.equal(await client.evaluate('document.querySelector("#draft").textContent'),'保留输入草稿');
 await click(`${page} [data-aiyou-panel-expand]`);assert.ok(Math.abs((await width())-resized)<1);
 await click(`${page} [data-aiyou-panel-expand]`);await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.ok(Math.abs((await width())-resized)<1);assert.equal(await client.evaluate("document.querySelector('#codex-taskboard-page').hidden"),false);
 await click('#codex-taskboard-close');assert.equal(await client.evaluate("getComputedStyle(document.querySelector('#native-chat')).visibility"),'visible');
 // Every plugin shell, including iframe pages, uses the same opt-in contract.
 for(const name of ['skills','claude','custom','asset','reset','settings','efficiency','skill-details','conversation-settings']){
  await client.evaluate(`(()=>{const p=document.createElement('section');p.id='fixture-panel';p.innerHTML='<header><span>${name}</span><button aria-label="关闭面板">×</button></header><iframe src="about:blank"></iframe>';document.querySelector('main').append(p);${api}.initializeWorkspacePanel(p,'${name}');window.__frameBefore=p.querySelector('iframe');})()`);
  await click('#fixture-panel [data-aiyou-panel-expand]');await click('#fixture-panel [data-aiyou-panel-expand]');
  assert.equal(await client.evaluate("document.querySelector('#fixture-panel iframe')===window.__frameBefore"),true);
  assert.equal(await client.evaluate("document.querySelector('#fixture-panel').querySelectorAll('[data-aiyou-panel-expand]').length"),1);
  await client.evaluate("document.querySelector('#fixture-panel').remove()");
 }
 await client.evaluate(`${api}.openEfficiencyPanel()`);assert.equal(await client.evaluate("!!document.querySelector('#aiyoucodex-efficiency-panel [data-aiyou-panel-expand]')"),true);
 await client.evaluate(`${api}.closeEfficiencyPanel();${api}.openShortcutSettings()`);assert.equal(await client.evaluate("!!document.querySelector('#codex-sidebar-shortcut-settings-dialog [data-aiyou-panel-resize]')"),true);
 assert.equal(await client.evaluate("document.querySelector('#draft').textContent"),'保留输入草稿');
 await client.evaluate(`${api}.destroy()`);assert.equal(await client.evaluate("document.querySelectorAll('[data-aiyou-panel-expand],[data-aiyou-panel-resize]').length"),0);
});
