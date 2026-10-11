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
const themes={};
for(const name of ['mecha-control','pink-candy']) themes[name]=(await Promise.all(['tokens.css','theme.css','customization.css'].map(file=>readFile(new URL(`../themes/${name}/${file}`,import.meta.url),'utf8')))).join('\n');

test('long-press menus reorder without opening, cancel safely, persist hidden entries and settings fill themed panels',{timeout:40000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome required'},async t=>{
 assert.ok(executable);const profile=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'aiyou-menu-order-'));
 const html=`<style>*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;font:14px sans-serif}aside{width:240px;flex:none}main{height:100vh;flex:1;min-width:0;display:flex}#native-chat{flex:1;min-width:0}#native-rail{display:flex;flex-direction:column;align-items:center;flex:0 0 52px;width:52px;height:100vh;padding:4px 8px}#rail-scroll{display:flex;flex-direction:column;align-items:center;flex:1;min-height:0;overflow-y:auto;width:100%;gap:8px}button{min-height:28px}#rail-scroll::-webkit-scrollbar{width:15px}</style>
 <nav id="native-rail" data-app-navigation-rail="true" aria-label="App navigation"><div id="rail-scroll"><button data-sidebar-destination="Home"><span class="sr-only">Home</span></button></div><button aria-label="Profile">P</button></nav>
 <aside id="app-shell-sidebar"><nav><div><button aria-label="New chat">New chat</button></div><div data-app-action-sidebar-scroll><button aria-label="Plugins">Plugins</button></div></nav></aside><main><div id="native-chat"><div data-composer-body><div contenteditable id="draft">保留草稿</div><button>发送</button></div></div></main>`;
 const server=createServer((_,r)=>{r.setHeader('content-type','text/html;charset=utf-8');r.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--window-size=1500,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let client;t.after(async()=>{client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1000)]);if(browser.exitCode==null)browser.kill('SIGKILL');await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 const api='window.__codexConversationPreviewInjection__';
 const grid='#codex-sidebar-shortcut-grid',panel='#codex-sidebar-shortcut-settings-dialog';
 const storage="localStorage.getItem('codex-conversation-preview:shortcut-settings')";
 await client.evaluate(`localStorage.setItem('codex-conversation-preview:shortcut-settings',JSON.stringify({schemaVersion:4,hidden:['enhancement:asset-console'],custom:[{id:'example',name:'Example',url:'https://example.test',icon:'link',openMode:'internal'}],order:['managed:moke-aigc','managed:moke-aigc',null]}));window.opens=0;window.__aiyouAgentWorkspace__={open:()=>window.opens++};`);
 await client.evaluate(source);
 await waitForBrowserState(client,`document.querySelector('${grid}')?.dataset.codexShortcutLayout==='rail'`,'rail ready');
 const order=()=>client.evaluate(`[...document.querySelectorAll('${grid} [data-codex-shortcut-sort-key]')].map(n=>n.dataset.codexShortcutSortKey)`);
 assert.equal((await order())[0],'managed:moke-aigc');
 async function point(key,where='rail',offset=.5){const selector=where==='rail'?`${grid} [data-codex-shortcut-sort-key="${key}"]`:`${panel} [data-codex-shortcut-sort-key="${key}"] [data-codex-shortcut-drag-handle]`;return client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height*${offset}}})()`);}
 async function press(p){await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});}
 async function release(p){await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
 async function longPress(p){await press(p);await waitForBrowserState(client,"document.documentElement.hasAttribute('data-aiyou-menu-sorting')",'long press activated');}
 async function drag(key,target,where='rail'){const a=await point(key,where);const b=await point(target,where,.9);await longPress(a);await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...b,buttons:1});await waitForBrowserState(client,`!!document.querySelector('[data-codex-shortcut-sort-key="${target}"][data-aiyou-menu-drop]')`,'drop target highlighted');await release(b);}
 await drag('enhancement:agent-workspace','managed:moke-aigc');
 await waitForBrowserState(client,`[...document.querySelectorAll('${grid} [data-codex-shortcut-sort-key]')][1]?.dataset.codexShortcutSortKey==='enhancement:agent-workspace'`,'order saved');
 assert.deepEqual((await order()).slice(0,2),['managed:moke-aigc','enhancement:agent-workspace']);
 assert.equal(await client.evaluate('window.opens'),0,'drag must not activate menu');
 const saved=await client.evaluate(storage);
 assert.equal(new Set(JSON.parse(saved).order).size,JSON.parse(saved).order.length,'deduplicate saved keys');
 // Long press without moving and Escape / outside / cancellation do not save.
 const a=await point('enhancement:agent-workspace');await longPress(a);await release(a);assert.equal(await client.evaluate(storage),saved);
 await longPress(a);await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await release(a);assert.equal(await client.evaluate(storage),saved);assert.equal(await client.evaluate('window.opens'),0);
 await longPress(a);await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:900,y:200,buttons:1});await release({x:900,y:200});assert.equal(await client.evaluate(storage),saved);
 await longPress(a);await client.evaluate("document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true,clientX:0,clientY:0}))");await release(a);assert.equal(await client.evaluate("document.documentElement.hasAttribute('data-aiyou-menu-sorting')"),false);assert.equal(await client.evaluate(storage),saved);
 // A normal click immediately afterwards still works.
 await press(a);await release(a);assert.equal(await client.evaluate('window.opens'),1);
 await client.evaluate(`${api}.destroy()`);await client.evaluate(source);
 await waitForBrowserState(client,`document.querySelector('${grid} [data-codex-shortcut-sort-key="enhancement:agent-workspace"]')!==null`,'reinject loaded');
 assert.deepEqual((await order()).slice(0,2),['managed:moke-aigc','enhancement:agent-workspace']);
 await client.send('Page.reload');
 await waitForBrowserState(client,"document.readyState==='complete'&&!!document.querySelector('#draft')&&!window.__codexConversationPreviewInjection__",'new document loaded');
 await client.evaluate(source);
 await waitForBrowserState(client,`!!document.querySelector('${grid}')`,'menus loaded after full reload');
 assert.deepEqual((await order()).slice(0,2),['managed:moke-aigc','enhancement:agent-workspace'],'full reload retains order');
 // Holding near the rail edge scrolls a long menu; cancelling never commits.
 await client.send('Emulation.setDeviceMetricsOverride',{width:1500,height:260,deviceScaleFactor:1,mobile:false});
 const top=await point('managed:moke-aigc');await longPress(top);
 const edge=await client.evaluate("(()=>{const e=document.querySelector('#rail-scroll'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.bottom-2,initial:e.scrollTop}})()");
 await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:edge.x,y:edge.y,buttons:1});
 await waitForBrowserState(client,`document.querySelector('#rail-scroll').scrollTop>${edge.initial}+20`,'long rail auto-scrolls');
 await client.evaluate("document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))");await release(edge);
 assert.equal(await client.evaluate(storage),saved,'auto-scroll cancellation does not save');
 await client.send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
 await client.evaluate(`${api}.openShortcutSettings()`);
 await waitForBrowserState(client,`!!document.querySelector('${panel} [data-codex-shortcut-drag-handle]')`,'settings sort handles ready');
 await client.evaluate(`document.querySelector('${panel} [data-codex-shortcut-custom-form] input[name="name"]').value='入口草稿'`);
 await drag('enhancement:asset-console','managed:moke-aigc','settings');
 assert.equal(await client.evaluate(`document.querySelector('${panel} [data-codex-shortcut-custom-form] input[name="name"]').value`),'入口草稿','sorting preserves unsaved form');
 assert.equal(JSON.parse(await client.evaluate(storage)).order[1],'enhancement:asset-console','hidden entries also reorder');
 assert.equal((await order()).includes('enhancement:asset-console'),false);
 await client.evaluate(`document.querySelector('${panel} [data-codex-shortcut-visible="enhancement:asset-console"]').click()`);
 await waitForBrowserState(client,`document.querySelector('${grid} [data-codex-shortcut-sort-key="enhancement:asset-console"]')!==null`,'restored menu');
 assert.deepEqual((await order()).slice(0,3),['managed:moke-aigc','enhancement:asset-console','enhancement:agent-workspace']);
 assert.equal(await client.evaluate(`document.querySelector('${panel} [data-codex-shortcut-visible="native:设置"]').disabled`),true,'settings cannot be hidden');
 // Settings itself is sortable, and keyboard adjustment remains available.
 await client.evaluate(`document.querySelector('${panel} [data-codex-shortcut-sort-key="native:设置"] [data-codex-shortcut-drag-handle]').focus()`);
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',modifiers:1,windowsVirtualKeyCode:38});
 assert.notEqual(JSON.parse(await client.evaluate(storage)).order.at(-1),'native:设置');
 for(const theme of ['default','mecha-control','pink-candy']){
  await client.evaluate(`(()=>{document.getElementById('fixture-theme')?.remove();document.documentElement.dataset.aiyouTheme=${JSON.stringify(theme)};const s=document.createElement('style');s.id='fixture-theme';s.textContent=${JSON.stringify(themes[theme]||'')};document.head.append(s)})()`);
  for(const height of [650,1300]){
   await client.send('Emulation.setDeviceMetricsOverride',{width:1500,height,deviceScaleFactor:1,mobile:false});
   const geometry=await client.evaluate(`(()=>{const p=document.querySelector('${panel}'),shell=p.querySelector('.codex-shortcut-settings-shell'),b=p.querySelector('.codex-shortcut-settings-body'),h=p.querySelector('header');b.scrollTop=b.scrollHeight;const s=p.querySelector('[data-codex-shortcut-save]').getBoundingClientRect(),br=b.getBoundingClientRect(),pr=p.getBoundingClientRect();return{ph:pr.height,sh:shell.getBoundingClientRect().height,bh:br.height,hh:h.getBoundingClientRect().height,bottom:s.bottom,bodyBottom:br.bottom,headerTop:h.getBoundingClientRect().top,panelTop:pr.top,saveHit:p.querySelector('[data-codex-shortcut-save]').contains(document.elementFromPoint(s.x+s.width/2,s.y+s.height/2))}})()`);
   assert.ok(Math.abs(geometry.ph-geometry.sh)<=2,`${theme} fills height ${height}: ${JSON.stringify(geometry)}`);
   assert.ok(Math.abs(geometry.ph-geometry.hh-geometry.bh)<=3,`${theme} body occupies remaining height`);
   assert.ok(geometry.bottom<=geometry.bodyBottom+1&&geometry.saveHit,`${theme} bottom form reachable`);
   assert.ok(Math.abs(geometry.headerTop-geometry.panelTop)<=2,`${theme} header remains fixed`);
  }
 }
 await client.evaluate(`document.querySelector('${panel} [data-aiyou-panel-expand]').click()`);
 const expanded=await client.evaluate(`({p:document.querySelector('${panel}').getBoundingClientRect().width,m:document.querySelector('main').getBoundingClientRect().width})`);
 assert.ok(Math.abs(expanded.p-expanded.m)<1);
 assert.equal(await client.evaluate("document.querySelector('#draft').textContent"),'保留草稿');
 await client.evaluate(`${api}.destroy()`);
 assert.equal(await client.evaluate("document.querySelectorAll('[data-aiyou-menu-dragging],[data-aiyou-menu-drop]').length"),0);
});
