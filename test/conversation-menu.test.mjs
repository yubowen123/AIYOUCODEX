import assert from 'node:assert/strict';
import {access,readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {connectFixtureBrowser,waitForBrowserState} from './helpers/browser-state.mjs';
import {buildThemePaletteCss,createThemeCustomization} from '../lib/theme-package.mjs';
const source=await readFile(new URL('../inject/conversation-preview.user.js',import.meta.url),'utf8');
let executable;
for(const p of [process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean)) {
  try {await access(p);executable=p;break;}catch{}
}
test('conversation menu uses card theme on its first open, preserves native targets and handles keyboard, clipping and failed writes',{
  timeout:30000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Browser unavailable'
},async t=>{
  assert.ok(executable);
  const profile=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'aiyou-menu-'));
  const server=createServer((req,res)=>{res.setHeader('content-type','text/javascript');res.end(`export const host={projects:{},threadProjectAssignments:{setMembership(){}},pinnedThreads:{async set(p){window.calls.push(['pin',p]);if(window.failWrite)throw Error('写入失败');window.pinned=p.pinned?[p.threadId]:[];},async list(){return {threadIds:window.pinned||[]};}}};`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1200,900','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let client;
  t.after(async()=>{client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(2000)]);if(browser.exitCode==null)browser.kill('SIGKILL');await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  ({client}=await connectFixtureBrowser({browser,profile,url:origin}));
  await waitForBrowserState(client,`location.origin===${JSON.stringify(origin)}`,'Fixture origin');
  const {frameTree}=await client.send('Page.getFrameTree');
  const id='11111111-1111-4111-8111-111111111111';
  await client.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:`<div id="root"></div><aside id="app-shell-sidebar"><nav><button class="sidebar-item">新对话</button><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle>项目</button></header><button id="target" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="remote:host-a:${id}" data-app-action-sidebar-thread-title="Same title">Same title</button></section></div></nav></aside><main><div contenteditable="true" id="draft">我的草稿</div></main><link rel="modulepreload" href="${origin}/assets/app-shared-deadbeef.js">`});
  await client.evaluate(source);
  const api='window.__codexConversationPreviewInjection__';
  await client.evaluate(`window.calls=[];window.failWrite=false;window.errors=[];window.addEventListener('error',e=>errors.push(e.message));
    const managers=['local','host-a'].map(hostId=>({getHostId:()=>hostId,getThreadSummaries:()=>[],async setThreadTitle(...args){calls.push(['rename',hostId,...args]);if(failWrite)throw Error('写入失败');return true;},async archiveConversation(...args){calls.push(['archive',hostId,...args]);if(failWrite)throw Error('写入失败');}}));
    const atom={scope:{id:'menu'},resolve:()=>null};window.__aiyouNativeRemoteCatalogAdapter__={atom};document.getElementById('root').__reactContainerFixture={memoizedProps:{value:new Map([['menu',{store:{get:()=>managers}}]])}};
    ${api}.setSnapshot({recentCatalog:[{threadId:'remote:host-a:${id}',remote:true,hostId:'host-a',nativeThreadId:'${id}',nativeProjectId:'p',title:'Same title',updatedAt:'2026-10-09T00:00:00Z'}],searchCatalog:[{threadId:'remote:host-a:${id}',remote:true,hostId:'host-a',nativeThreadId:'${id}',nativeProjectId:'p',title:'Same title',projectId:'remote:host-a:p'}]});`);
  async function open(){await client.evaluate(`document.getElementById('target').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))`);}
  async function click(selector){const r=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});}
  // No panel/settings has been opened: the right-click path itself must load CSS.
  for(const theme of ['mecha-control','pink-candy',null]){
    let css='';
    if(theme){const root=new URL(`../themes/${theme}/`,import.meta.url);const palette=JSON.parse(await readFile(new URL('colors.json',root),'utf8'));css=buildThemePaletteCss(palette)+createThemeCustomization(palette).css;}
    await client.evaluate(`(()=>{let s=document.getElementById('theme');if(!s){s=document.createElement('style');s.id='theme';document.head.append(s);}s.textContent=${JSON.stringify(css)};})()`);
    await open();
    const view=await client.evaluate(`(()=>{const m=document.getElementById('aiyou-conversation-menu'),s=getComputedStyle(m),r=m.getBoundingClientRect();return{background:s.backgroundColor,ink:s.color,border:s.borderColor,radius:s.borderRadius,buttonDisplay:getComputedStyle(m.querySelector("button")).display,labels:[...m.querySelectorAll('[role=menuitem]')].map(b=>b.textContent),fits:r.left>=8&&r.right<=innerWidth-8&&r.top>=8&&r.bottom<=innerHeight-8,hit:[...m.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})}})()`);
    assert.equal(view.labels.length,5);assert.notEqual(view.radius,"0px");assert.equal(view.buttonDisplay,"flex");assert.ok(view.fits&&view.hit,`${theme}: bounded and clickable`);
    assert.ok(view.labels.includes('归档对话')&&view.labels.includes('重命名')&&view.labels.includes('置顶对话'));
    if(theme){assert.notEqual(view.background,'rgb(17, 17, 17)');assert.notEqual(view.background,'rgba(0, 0, 0, 0)');assert.notEqual(view.border,'rgb(0, 0, 0)');}
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    assert.equal(await client.evaluate('document.activeElement.dataset.conversationAction'),'pin');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await client.evaluate('!!document.getElementById("aiyou-conversation-menu")'),false);
  }
  await open();await click('[data-conversation-action=pin]');
  await waitForBrowserState(client,'!document.getElementById("aiyou-conversation-menu")','Pin persistence acknowledged');
  assert.deepEqual((await client.evaluate('calls'))[0],['pin',{threadId:id,pinned:true,hostId:'host-a',useAppServerPins:true}]);
  await client.evaluate(`${api}.setPinnedThreads([])`);await open();
  assert.match(await client.evaluate('document.querySelector("[data-conversation-action=pin]").textContent'),/取消置顶/,'Delayed snapshots cannot revert a confirmed pin');
  await click('[data-conversation-action=pin]');await waitForBrowserState(client,'!document.getElementById("aiyou-conversation-menu")','Unpin acknowledgement');
  await open();await click('[data-conversation-action=rename]');
  await client.evaluate(`document.querySelector('#aiyou-conversation-menu input').value='';document.querySelector('#aiyou-conversation-menu form').requestSubmit()`);
  await waitForBrowserState(client,'document.querySelector("#aiyou-conversation-menu [role=status]").textContent.includes("1–60")','Empty names rejected without writing');
  await client.evaluate(`document.querySelector('#aiyou-conversation-menu input').value='新名称';document.querySelector('#aiyou-conversation-menu form').requestSubmit()`);
  await waitForBrowserState(client,'!document.getElementById("aiyou-conversation-menu")','Rename acknowledged');
  const rename=(await client.evaluate('calls')).find(c=>c[0]==='rename');assert.deepEqual(rename,['rename','host-a',id,'新名称',{requireAcknowledgement:true}]);
  assert.equal(await client.evaluate('document.getElementById("target").getAttribute("data-app-action-sidebar-thread-title")'),'新名称');
  await client.evaluate('window.failWrite=true');await open();await click('[data-conversation-action=archive]');
  await waitForBrowserState(client,'document.querySelector("#aiyou-conversation-menu [role=status]").textContent.includes("写入失败")','Failed archive reports failure');
  assert.ok(await client.evaluate('!!document.getElementById("target")'),'Failed archive never removes the chat');
  await client.evaluate('window.failWrite=false');await click('[data-conversation-action=archive]');
  await waitForBrowserState(client,'!document.getElementById("aiyou-conversation-menu")','Archive acknowledged');
  const archived=(await client.evaluate('calls')).filter(c=>c[0]==='archive').at(-1);assert.deepEqual(archived,['archive','host-a',id,{useAppServerPins:true,cleanupWorktree:false,source:'aiyou_sidebar_context_menu'}]);
  assert.equal(await client.evaluate('document.getElementById("draft").textContent'),'我的草稿');
  assert.deepEqual(await client.evaluate('errors'),[]);
});
