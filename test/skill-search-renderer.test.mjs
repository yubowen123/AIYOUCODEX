import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {EfficiencyBridge} from '../lib/efficiency-bridge.mjs';
import {LAYA_SEARCH_BINDING} from '../lib/laya-search.mjs';
import {SkillOrganizationBridge,createSkillOrganizationController,createSkillOrganizationStore} from '../lib/skill-organization.mjs';
import {readInstalledSkillCatalog} from '../lib/skill-catalog.mjs';
import {createSkillDetailsReader} from '../lib/skill-details.mjs';
import {connectFixtureBrowser,waitForBrowserState} from './helpers/browser-state.mjs';

const source=await readFile(new URL('../inject/conversation-preview.user.js',import.meta.url),'utf8');
const candidates=[process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium',
 ...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;for(const candidate of candidates)try{await access(candidate);executable=candidate;break}catch{}

test('Skills Laya search is scoped, debounced, stale-safe, exact-ID only, and never opens from chat or old storage',{
 timeout:55_000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome/Chromium required',
},async t=>{
 assert.ok(executable);
 const root=await realpath(await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'skill-search-ui-'))),profile=path.join(root,'browser'),skillsRoot=path.join(root,'skills');
 for(const name of ['imagegen','video-gen','voice']){
  await mkdir(path.join(skillsRoot,name),{recursive:true});
  await writeFile(path.join(skillsRoot,name,'SKILL.md'),`---\nname: ${name}\ndescription: ${name} 的真实本地说明\n---\n## 使用方法\n准备材料再执行\n`);
 }
 const catalog=await readInstalledSkillCatalog({roots:[skillsRoot]}),image=catalog.find(s=>s.name==='imagegen'),video=catalog.find(s=>s.name==='video-gen');
 const skillController=createSkillOrganizationController({store:createSkillOrganizationStore({filePath:path.join(root,'state','organization.json')}),readCatalog:async()=>catalog,describe:createSkillDetailsReader()});
 const snapshot=await skillController.snapshot(),calls=[],holds=new Map(),heldQueries=new Set();
 const skillActions=[],skillRequest=skillController.request;skillController.request=payload=>{skillActions.push(payload);return skillRequest(payload)};
 let failSearch=false;
 const searchController={request:async payload=>{
  assert.equal(payload.action,'search-skills');calls.push(payload);
  if(['等待旧查询','等待分类','等待目录','等待关闭'].includes(payload.query)&&!heldQueries.has(payload.query)){
   heldQueries.add(payload.query);await new Promise(resolve=>holds.set(payload.query,resolve));
  }
  if(failSearch)throw Object.assign(new Error('synthetic unavailable'),{code:'LAYA_SEARCH_ERROR'});
  const id=payload.skillIds.includes(image.id)?image.id:payload.skillIds[0];
  const resultIds=payload.query==='连续卡片几何'?payload.skillIds:[id];
  return {query:payload.query,engine:payload.query==='普通正文匹配'?'keyword':'laya',fallback:payload.query==='普通正文匹配',
   results:[...resultIds.map(id=>({id,title:'模型给的假名称不得替换原卡片',snippet:'正文命中：小说场面转换成分镜。\u0000\n<img src=x onerror="window.__unsafeSnippet=true">'+ '资料'.repeat(200),score:9,decision:'keep'})),
    {id:'skill:'+'f'.repeat(64),title:'虚构卡片不得出现',path:'/untrusted/fake',score:10}],
   message:'fixture implementation details must not appear',elapsedMs:1,coverage:{total:catalog.length,indexed:catalog.length,candidates:payload.skillIds.length}};
 }};
 const fixture=`<style>body{margin:0;display:flex;height:100vh}aside{width:220px;flex:none}main{display:flex;flex:1;min-width:0;height:100vh}#chat{flex:1;min-width:200px;padding:20px}button{min-height:28px}#codex-skill-organizer .codex-skill-row{height:80px;max-height:80px}</style>
 <nav data-app-navigation-rail style="width:64px;height:100vh;flex:none"><button aria-label="首页">首页</button></nav><aside id="app-shell-sidebar"><nav><div><div><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button></div></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header></section></div></nav></aside>
 <main><div id="chat"><div id="composer" contenteditable="true" data-codex-composer="true">请打开 Skills 搜索视频工具</div><button id="send" aria-label="发送">发送</button><iframe src="/frame"></iframe></div></main>`;
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(req.url==='/frame'?'<p>frame</p>':fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--window-size=1400,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let client,bridge,searchBridge;
 t.after(async()=>{
  for(const release of holds.values())release();bridge?.dispose();searchBridge?.dispose();client?.close();browser.kill('SIGTERM');
  await Promise.race([new Promise(r=>browser.once('exit',r)),delay(2000)]);if(browser.exitCode==null)browser.kill('SIGKILL');
  server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 });
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 bridge=new SkillOrganizationBridge(skillController);await bridge.install(client);
 searchBridge=new EfficiencyBridge(searchController,{binding:LAYA_SEARCH_BINDING,resolver:'resolveLayaSearchRequest',actionPayloadLimits:{'search-skills':750000}});await searchBridge.install(client);
 const api='window.__codexConversationPreviewInjection__',panel='#codex-skill-organizer',input=`${panel} input[type=search]`,status=`${panel} [data-skill-search-status]`,storage='codex-workspace-enhancer:skill-open-request-v1';
 const row=id=>`${panel} [data-skill-id='${id}']`;
 const rows=()=>client.evaluate(`Array.from(document.querySelectorAll('${panel} .codex-skill-row')).map(e=>e.dataset.skillId)`);
 const query=value=>client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(input)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 async function click(selector){
  await waitForBrowserState(client,`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector('${panel}[aria-busy=true]')`,'Click target ready');
  const p=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})===e}})()`);
  assert.equal(p.hit,true,selector);for(const type of ['mousePressed','mouseReleased'])await client.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});
 }
 async function matched(){await waitForBrowserState(client,`document.querySelector(${JSON.stringify(status)})?.textContent.includes('已找到')`,'Search response rendered')}
 async function held(query){for(let n=0;n<100&&!holds.has(query);n++)await delay(20);assert(holds.has(query),`Delayed ${query}`)}
 await client.evaluate(`localStorage.setItem(${JSON.stringify(storage)},String(Date.now()));window.__added=[];window.__codexTaskboardInjection__={addSkillToComposer:async value=>{window.__added.push(value);return true}}`);
 await client.evaluate(source);
 await delay(250);
 assert.equal(await client.evaluate(`!document.querySelector('${panel}')||document.querySelector('${panel}').hidden`),true,'Legacy open request never opens Skills');
 assert.equal(await client.evaluate(`localStorage.getItem(${JSON.stringify(storage)})`),null,'Legacy request discarded');
 await client.evaluate(`localStorage.setItem(${JSON.stringify(storage)},String(Date.now()));window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(storage)},newValue:String(Date.now())}));document.getElementById('composer').focus()`);
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await click('#send');await delay(150);
 assert.equal(await client.evaluate(`!document.querySelector('${panel}')||document.querySelector('${panel}').hidden`),true,'Enter and send on Skills chat remain in chat');
 assert.equal(await client.evaluate(`${api}.routeWorkspaceCommand('/skills 视频')`),false,'Text-command path also rejects Skills');
 await client.evaluate(`${api}.setSnapshot({skillOrganization:${JSON.stringify(snapshot)}});${api}.setLayaSearchData({ready:true,enabled:false,message:'项目搜索已关闭'})`);
 await waitForBrowserState(client,`!!document.querySelector('[data-codex-sidebar-shortcut-name="Skills 分组"]')`,'Explicit Skills button ready');
 await click('[data-codex-sidebar-shortcut-name="Skills 分组"]');
 assert.equal((await rows()).length,3,'Explicit click opens all existing Skills');
 await query('第一');await query('第二');await query('把小说变成镜头');await matched();
 assert.equal(calls.length,1,'Rapid input only submits the latest query');assert.equal(calls[0].query,'把小说变成镜头');
 assert.deepEqual(new Set(calls[0].skillIds),new Set(catalog.map(s=>s.id)));assert.deepEqual(await rows(),[image.id]);
 assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(row(image.id))}+' .codex-skill-name').textContent`),image.title,'Canonical title retained');
 assert.equal(await client.evaluate(`document.querySelector('${panel}').textContent.includes('虚构卡片')`),false);
 const evidence=await client.evaluate(`document.querySelector(${JSON.stringify(row(image.id))}+' .codex-skill-search-snippet').textContent`);
 assert(evidence.startsWith('命中资料：正文命中：小说场面转换成分镜。'),'Body match excerpt is separate and visible');
 assert.equal(evidence.length,305,'Cleaned snippet is bounded to 300 characters plus its label');assert(!evidence.includes('\u0000')&&!evidence.includes('\n'));
 assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(row(image.id))}+' .codex-skill-description').textContent`),image.description,'Original description remains unchanged');
 assert.equal(await client.evaluate(`document.querySelectorAll('${panel} .codex-skill-search-snippet img').length`),0,'Untrusted snippet stays inert text');
 assert.equal(await client.evaluate('window.__unsafeSnippet===true'),false);
 assert.equal(await client.evaluate(`document.querySelector('${panel}').textContent.includes('fixture implementation')`),false);
 await client.evaluate(`window.__matchedRow=document.querySelector(${JSON.stringify(row(image.id))});${api}.setSnapshot({skillOrganization:${JSON.stringify(snapshot)}})`);
 await delay(400);assert.equal(calls.length,1,'Unchanged host snapshots do not repeat inference');
 assert.equal(await client.evaluate(`window.__matchedRow===document.querySelector(${JSON.stringify(row(image.id))})`),true,'Matched card identity survives unchanged snapshots');
 await click(`${row(image.id)} .codex-skill-use`);assert.equal(await client.evaluate('window.__added[0].skillPath'),image.path);
 await click(row(image.id));await waitForBrowserState(client,"document.querySelector('[data-skill-detail-status]')?.textContent.includes('来自本地')",'Matched card retains exact local details');
 assert.equal(skillActions.at(-1).skillId,image.id);await click('[data-skill-detail-close]');await matched();
 await query('等待旧查询');await held('等待旧查询');await query('');holds.get('等待旧查询')();await delay(100);assert.equal((await rows()).length,3,'Clear restores all rows and rejects late results');
 assert.equal(await client.evaluate(`document.querySelectorAll('${panel} .codex-skill-search-snippet').length`),0,'Clear removes match excerpts');
 await query('等待分类');await held('等待分类');await click(`${panel} [data-codex-skill-filter=video]`);holds.get('等待分类')();await matched();
 assert.deepEqual(calls.at(-1).skillIds,[video.id]);assert.deepEqual(await rows(),[video.id],'Category changes isolate prior responses');
 await query('');await click(`${panel} [data-codex-skill-filter=all]`);
 await query('等待目录');await held('等待目录');const updated={...snapshot,catalog:snapshot.catalog.filter(s=>s.id!==image.id)};
 await client.evaluate(`${api}.setSnapshot({skillOrganization:${JSON.stringify(updated)}})`);holds.get('等待目录')();await matched();
 assert(!calls.at(-1).skillIds.includes(image.id));assert(!(await rows()).includes(image.id),'Changed directory invalidates pending hits');
 await client.evaluate(`${api}.setSnapshot({skillOrganization:${JSON.stringify(snapshot)}})`);await matched();
 await query('');await click(`${row(image.id)} .codex-skill-favorite`);await click(`${panel} [data-codex-skill-filter=common]`);
 await query('匹配常用用途');await matched();assert.equal(calls.at(-1).skillIds.length,2);assert(!calls.at(-1).skillIds.includes(image.id),'Favorites scope also uses exact current IDs');
 await query('');await click(`${panel} [data-codex-skill-filter=all]`);await click(`${row(image.id)} .codex-skill-favorite`);
 await query('连续卡片几何');await matched();assert.equal((await rows()).length,3);
 const geometry=await client.evaluate(`Array.from(document.querySelectorAll('${panel} .codex-skill-row')).map(row=>{
  const rect=e=>e.getBoundingClientRect().toJSON(),snippet=row.querySelector('.codex-skill-search-snippet'),style=getComputedStyle(snippet);
  return {card:rect(row),snippet:rect(snippet),title:rect(row.querySelector('.codex-skill-name')),description:rect(row.querySelector('.codex-skill-description')),category:rect(row.querySelector('.codex-skill-category')),buttons:[...row.querySelectorAll('button')].map(rect),lineHeight:parseFloat(style.lineHeight),clamp:style.webkitLineClamp};
 })`);
 assert.equal(new Set(geometry.map(g=>Math.round(g.card.top))).size,2,'Three cards occupy two actual grid rows');
 for(const g of geometry){
  assert(g.card.height>80,'Matched cards grow beyond the legacy fixed height');
  assert(g.snippet.left>=g.card.left&&g.snippet.right<=g.card.right+1&&g.snippet.top>=g.card.top&&g.snippet.bottom<=g.card.bottom+1,'Match excerpt bounds remain inside its card');
  assert.equal(g.clamp,'3');assert(g.snippet.height<=g.lineHeight*3+1,'Only three match excerpt lines are shown');
  assert(g.title.bottom<=g.description.top+1&&g.description.bottom<=g.category.top+1&&g.category.bottom<=g.snippet.top+1,'Title, description, category and excerpt never overlap');
  for(const button of g.buttons)assert(button.left>=g.snippet.right&&button.top>=g.card.top&&button.bottom<=g.card.bottom+1,'Action buttons remain separate inside the card');
 }
 for(let a=0;a<geometry.length;a++)for(let b=a+1;b<geometry.length;b++){
  const x=geometry[a].card,y=geometry[b].card;
  assert(x.bottom<=y.top+1||y.bottom<=x.top+1||x.right<=y.left+1||y.right<=x.left+1,'Adjacent cards never cover each other');
 }
 await query('普通正文匹配');await waitForBrowserState(client,`document.querySelector(${JSON.stringify(status)}).textContent.includes('普通搜索')&&!document.querySelector(${JSON.stringify(status)}).textContent.includes('正在')`,'Keyword fallback clearly labelled');
 assert.deepEqual(await rows(),[image.id],'Backend keyword body matches also map to existing cards');
 failSearch=true;await query('video-gen');await waitForBrowserState(client,`document.querySelector(${JSON.stringify(status)}).textContent.includes('普通搜索')&&document.querySelector(${JSON.stringify(row(video.id))})!==null`,'Failure falls back to local keyword rows');
 assert.deepEqual(await rows(),[video.id]);failSearch=false;
 await query('等待关闭');await held('等待关闭');await click(`${panel} .codex-skill-close`);holds.get('等待关闭')();await delay(100);
 assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`),true,'Late result never reopens a closed page');
 await client.evaluate(`${api}.openSkillsGrouping({query:${JSON.stringify('字'.repeat(250))}})`);await matched();assert.equal(calls.at(-1).query.length,200);
 await query('');const before=calls.length;await delay(400);assert.equal(calls.length,before,'Empty search does not call Laya');assert.equal((await rows()).length,3);
 await client.evaluate(`${api}.destroy();localStorage.setItem(${JSON.stringify(storage)},String(Date.now()))`);await client.evaluate(source);await delay(150);
 assert.equal(await client.evaluate(`!document.querySelector('${panel}')||document.querySelector('${panel}').hidden`),true,'History/reinjection cannot resume an old Skills request');
 await client.evaluate(`${api}.destroy()`);
});
