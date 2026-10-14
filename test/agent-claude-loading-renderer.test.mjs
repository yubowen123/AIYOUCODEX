import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {connectFixtureBrowser,waitForBrowserState} from './helpers/browser-state.mjs';

const base=await readFile(new URL('../inject/conversation-preview.user.js',import.meta.url),'utf8');
const agent=await readFile(new URL('../inject/agent-workspace.user.js',import.meta.url),'utf8');
const claude=await readFile(new URL('../inject/claude-code.user.js',import.meta.url),'utf8');
const candidates=[process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium',
 ...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;for(const candidate of candidates)try{await access(candidate);executable=candidate;break}catch{}

test('Agent and Claude loading reflects real pending reads, preserves content, retries reads only and isolates closed/stale views',{
 timeout:45_000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome/Chromium required',
},async t=>{
 assert.ok(executable);
 const root=await realpath(await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'agent-claude-loading-'))),profile=path.join(root,'browser');
 const fixture=`<style>body{margin:0;display:flex;height:100vh;--aiyou-text:#234567;--aiyou-link:#456abc}nav[data-app-navigation-rail]{width:64px;flex:none}aside{width:220px;flex:none}main{display:flex;flex:1;min-width:0;height:100vh}#chat{flex:1;min-width:0}button{min-height:28px}</style>
 <nav data-app-navigation-rail><button aria-label="首页">首页</button></nav><aside id="app-shell-sidebar"><nav><div>Codex<button aria-label="搜索">搜索</button></div><div id="native-actions"><button data-sidebar-destination="builtin:orbit">裤兜</button></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="Projects"><button data-app-action-sidebar-section-toggle>Projects</button></section></div></nav></aside><main><div id="chat"><textarea id="native-draft">原生草稿保持</textarea></div></main>`;
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--window-size=1500,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let client;t.after(async()=>{client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1500)]);if(browser.exitCode==null)browser.kill('SIGKILL');server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 await client.evaluate(base);
 await client.evaluate(`window.__agentCalls=[];window.__agentPending=[];window.__claudeCalls=[];window.__claudePending=[];window.__errors=[];window.__panelEvents=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.type==='codex-workspace-panel:open')queueMicrotask(()=>window.__panelEvents.push({panel:e.data.panel,claudeHidden:document.querySelector('#aiyoucodex-claude-panel')?.hidden,agentHidden:document.querySelector('#aiyoucodex-agent-workspace')?.hidden}))});
 window.__agentView={version:0,agents:[{id:'codex',name:'已读取 Agent',root:'/fixture',skillsRoot:'/fixture/skills',installed:true,discovered:true,contentCount:1,sessionCount:1,sessionsSupported:true,installEvidence:[]}],receipts:[],scan:{}};
 window.__AIYOUCODEX_AGENT_REQUEST__=raw=>{const p=JSON.parse(raw);window.__agentCalls.push(p);if(p.action==='list')window.__aiyouAgentWorkspace__.resolve({requestId:p.requestId,ok:true,data:{resources:[{id:'fixture-skill',name:'原有内容',kind:'skill',source:'/fixture/skill'}],warnings:[]}});else window.__agentPending.push(p)};
 window.__claudeView={available:true,interactionVersion:1,version:'fixture',projectId:'a',projects:[{id:'a',name:'项目A',cwd:'/a'},{id:'b',name:'项目B',cwd:'/b'}],skills:[],mcps:[],sessions:[{id:'s1',title:'会话一',projectName:'A'},{id:'s2',title:'会话二',projectName:'A'}],session:null};
 window.__AIYOUCODEX_CLAUDE_REQUEST__=raw=>{const p=JSON.parse(raw);window.__claudeCalls.push(p);if(p.action==='persona-get')window.__aiyouClaudeInjection__.resolve({requestId:p.requestId,ok:true,data:{persona:{name:'Claude Code',logo:'',description:'',revision:0}}});else window.__claudePending.push(p)};`);
 await client.evaluate(agent+'\n'+claude);
 const a='#aiyoucodex-agent-workspace',al=`${a} [data-agent-module-loading]`,c='#aiyoucodex-claude-panel',cl=`${c} [data-claude-module-loading]`;
 async function click(selector){await waitForBrowserState(client,`!!document.querySelector(${JSON.stringify(selector)})`,'Button exists');const p=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await client.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
 async function waitPending(kind,action){await waitForBrowserState(client,`window.__${kind}Pending.some(p=>p.action===${JSON.stringify(action)})`,'Request really pending');return client.evaluate(`window.__${kind}Pending.find(p=>p.action===${JSON.stringify(action)})`)}
 async function reply(kind,p,data,error){await client.evaluate(`window.__${kind}Pending=window.__${kind}Pending.filter(p=>p.requestId!==${JSON.stringify(p.requestId)});window.${kind==='agent'?'__aiyouAgentWorkspace__':'__aiyouClaudeInjection__'}.resolve({requestId:${JSON.stringify(p.requestId)},ok:${!error},${error?'error:'+JSON.stringify(error):'data:'+JSON.stringify(data)}})`)}
 async function settled(selector){await waitForBrowserState(client,`document.querySelector(${JSON.stringify(selector)}).hidden&&!document.querySelector(${JSON.stringify(selector)}).hasAttribute('aria-busy')`,'Ready clears status target')}
 await client.evaluate('void window.__aiyouAgentWorkspace__.open();true');let p=await waitPending('agent','refresh');
 assert.equal(await client.evaluate(`document.querySelector('${al}').dataset.loadingLayout`),'panel');assert.equal(await client.evaluate(`!!document.querySelector('${al} .aiyou-loading-fill')&&document.querySelector('${al}').getAttribute('aria-busy')==='true'`),true);
 const av=await client.evaluate('window.__agentView');await reply('agent',p,av);await settled(al);
 await click(`${a} [data-action=refresh]`);p=await waitPending('agent','refresh');
 assert.equal(await client.evaluate(`document.querySelector('${al}').dataset.loadingLayout`),'compact');assert.equal(await client.evaluate(`document.querySelector('${a}').textContent.includes('已读取 Agent')`),true,'Refreshing retains prior directory');
 await reply('agent',p,null,'目录读取失败，请核对连接');await waitForBrowserState(client,`document.querySelector('${al}').dataset.loadingState==='error'`,'Accurate Agent failure');
 await click(`${al} .aiyou-loading-retry`);p=await waitPending('agent','refresh');await reply('agent',p,av);await settled(al);
 await click(`${a} [data-agent=codex]`);p=await waitPending('agent','sessions');assert.equal(await client.evaluate(`document.querySelector('${al}').textContent.includes('正在读取来源会话')`),true);
 await reply('agent',p,{sessions:[],projects:[],total:0,nextOffset:null,warnings:[],supported:true});await settled(al);
 await client.evaluate('void window.__aiyouAgentWorkspace__.open();true');const oldAgent=await waitPending('agent','refresh');await click(`${a} [data-close]`);
 await client.evaluate('void window.__aiyouAgentWorkspace__.open();true');p=await client.evaluate('window.__agentPending.at(-1)');await reply('agent',oldAgent,null,'旧错误不得出现');assert.equal(await client.evaluate(`document.querySelector('${al}').dataset.loadingState`),'loading');
 await reply('agent',p,{...av,agents:[{...av.agents[0],name:'最新目录'}]});await settled(al);assert.equal(await client.evaluate(`document.querySelector('${a}').textContent.includes('旧错误')`),false);
 await click(`${a} [data-close]`);assert.equal(await client.evaluate(`document.querySelector('${al}').hidden`),true);
 assert.deepEqual(new Set(await client.evaluate('window.__agentCalls.map(p=>p.action)')),new Set(['refresh','list','sessions']),'Agent retries never replay migration or writes');

 await click('[data-aiyou-claude]');p=await waitPending('claude','refresh');assert.equal(await client.evaluate(`document.querySelector('${cl}').dataset.loadingLayout`),'panel',JSON.stringify(await client.evaluate(`({panelHidden:document.querySelector('${c}').hidden,loadingHidden:document.querySelector('${cl}').hidden,claude:window.__aiyouClaudeInjection__.getState(),panelEvents:window.__panelEvents})`)));assert.equal(await client.evaluate(`!!document.querySelector('${cl} .aiyou-loading-fill')`),true);
 const cv=await client.evaluate('window.__claudeView');await reply('claude',p,cv);await settled(cl);
 await client.evaluate("document.querySelector('[data-claude-prompt]').value='保留未发送草稿';document.querySelector('[data-claude-session]').value='s1';document.querySelector('[data-claude-session]').dispatchEvent(new Event('change'))");
 const s1=await waitPending('claude','refresh');await client.evaluate("document.querySelector('[data-claude-session]').value='s2';document.querySelector('[data-claude-session]').dispatchEvent(new Event('change'))");
 p=await client.evaluate('window.__claudePending.at(-1)');const session={id:'s2',projectId:'a',cwd:'/a',status:'idle',messages:[{role:'assistant',text:'已保存的答复'}],permissions:[]};
 await reply('claude',p,{...cv,session});await settled(cl);await reply('claude',s1,null,'旧会话错误不得出现');assert.equal(await client.evaluate(`document.querySelector('${cl}').hidden`),true,'Older session error cannot change newer ready state');
 await client.evaluate('window.__aiyouClaudeInjection__.onBridgeReady();true');p=await waitPending('claude','refresh');assert.equal(await client.evaluate(`document.querySelector('${cl}').dataset.loadingLayout`),'compact');assert.equal(await client.evaluate("document.querySelector('[data-claude-log]').textContent.includes('已保存的答复')"),true);
 await reply('claude',p,null,'连接断开，结果未确认');await waitForBrowserState(client,`document.querySelector('${cl}').dataset.loadingState==='error'`,'Claude failure remains visible');
 await click(`${cl} .aiyou-loading-retry`);p=await waitPending('claude','refresh');await reply('claude',p,{...cv,session});await settled(cl);
 assert.equal(await client.evaluate("document.querySelector('[data-claude-prompt]').value"),'保留未发送草稿');
 await client.evaluate('window.__aiyouClaudeInjection__.onBridgeReady();true');const oldClaude=await waitPending('claude','refresh');await click('[data-claude-close]');await click('[data-aiyou-claude]');p=await client.evaluate('window.__claudePending.at(-1)');await reply('claude',oldClaude,null,'关闭后的错误');assert.equal(await client.evaluate(`document.querySelector('${cl}').dataset.loadingState`),'loading');
 await reply('claude',p,{...cv,session:{...session,status:'running'}});await waitForBrowserState(client,`document.querySelector('${cl}').textContent.includes('正在处理当前会话')`,'Server running state keeps actual processing indication');
 await click('[data-claude-close]');assert.equal(await client.evaluate(`document.querySelector('${cl}').hidden&&!document.querySelector('${cl}').hasAttribute('aria-busy')`),true);
 assert.deepEqual(new Set(await client.evaluate('window.__claudeCalls.map(p=>p.action)')),new Set(['persona-get','refresh']),'Claude loading and retries never send, answer or save');
 assert.equal(await client.evaluate("document.getElementById('native-draft').value"),'原生草稿保持');assert.deepEqual(await client.evaluate('window.__errors'),[]);
 // An earlier real Agent open notification may arrive after a faster Claude open.
 const eventCount=await client.evaluate('window.__panelEvents.length');
 await client.evaluate('void window.__aiyouAgentWorkspace__.open();window.__aiyouAgentWorkspace__.close();window.__aiyouClaudeInjection__.open();true');
 await waitForBrowserState(client,`window.__panelEvents.length>=${eventCount+2}`,'Both real workspace open notifications delivered');
 assert.equal(await client.evaluate(`document.querySelector('${c}').hidden`),false,JSON.stringify(await client.evaluate('window.__panelEvents.slice(-2)')));
 assert.equal(await client.evaluate(`document.querySelector('${cl}').dataset.loadingState`),'loading');
 const switchedAgent=await client.evaluate('window.__agentPending.at(-1)'),switchedClaude=await client.evaluate('window.__claudePending.at(-1)');
 await reply('agent',switchedAgent,av);await reply('claude',switchedClaude,{...cv,session});await settled(cl);
 const staleTaskboardEvent=await client.evaluate('window.__panelEvents.length');
 await client.evaluate(`window.postMessage({type:'codex-workspace-panel:open',panel:'taskboard'},location.origin);true`);
 await waitForBrowserState(client,`window.__panelEvents.length>${staleTaskboardEvent}`,'Closed Taskboard notification delivered');
 assert.equal(await client.evaluate(`document.querySelector('${c}').hidden`),false,'Closed Taskboard notification cannot close newer Claude view');
 await client.evaluate(`document.documentElement.setAttribute('data-codex-taskboard-open','true');window.postMessage({type:'codex-workspace-panel:open',panel:'taskboard'},location.origin);true`);
 await waitForBrowserState(client,`document.querySelector('${c}').hidden`,'Live Taskboard still closes Claude');
 await client.evaluate(`document.documentElement.removeAttribute('data-codex-taskboard-open');true`);
 // Older hosts retain useful plain text and safe retry without the new API.
 await client.evaluate('window.__savedLoading=window.__codexConversationPreviewInjection__.renderModuleLoadingState;window.__codexConversationPreviewInjection__.renderModuleLoadingState=undefined;void window.__aiyouAgentWorkspace__.open();true');p=await waitPending('agent','refresh');assert.equal(await client.evaluate(`document.querySelector('${al}').textContent.includes('正在检测本机')`),true);await reply('agent',p,av);await settled(al);
 await client.evaluate('window.__aiyouAgentWorkspace__.destroy();window.__aiyouClaudeInjection__.destroy();window.__codexConversationPreviewInjection__.destroy();true');
});
