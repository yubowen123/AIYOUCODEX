import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import { MODELS, IMAGE_MODELS, PROTOCOLS, defaults } from '../lib/model-arena/catalog.mjs';
import { connectFixtureBrowser, waitForBrowserState } from './helpers/browser-state.mjs';

async function fixture(t, publicRoot, api) {
  const outputRoot = process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir();
  await mkdir(outputRoot, {recursive:true});
  const root = await mkdtemp(path.join(outputRoot, 'module-loading-'));
  const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
  let executable; for (const candidate of candidates) if (await access(candidate).then(()=>true,()=>false)) { executable = candidate; break; }
  assert.ok(executable, 'Loading UI regression requires isolated Chrome');
  const pending = [], methods = [];
  const json = (res, value, status = 200) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(value)); };
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://fixture');
    if (url.pathname.startsWith('/api/')) {
      methods.push({ method:req.method, path:url.pathname, query:url.search });
      if (api?.(req,res,url,json)) return;
      pending.push({url,res,resolve:(value,status)=>json(res,value,status)}); return;
    }
    try {
      const file = url.pathname === '/' || url.pathname === '/model-arena/' ? 'index.html' : path.basename(url.pathname);
      const content = await readFile(path.join(publicRoot,file));
      res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
      if (file==='index.html' && publicRoot.includes('asset-browser')) res.end(content.toString().replace('<head>','<head><script>window.__CODEX_ASSET_CONSOLE_EMBEDDED__=true;</script>'));
      else res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile = path.join(root,'browser');
  const browser = spawn(executable, ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1440,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let client;
  t.after(async()=>{client?.close(); if(browser.exitCode===null && browser.signalCode===null) {const done=once(browser,'exit');browser.kill('SIGTERM');await done;} server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
  ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}${publicRoot.includes('model-arena')?'/model-arena/':'/'}`}));
  const wait=(expression,message)=>waitForBrowserState(client,expression,message,6000);
  const take=async(predicate)=>{ for(let i=0;i<240;i++){const index=pending.findIndex(predicate);if(index>=0)return pending.splice(index,1)[0];await new Promise(r=>setTimeout(r,25));}assert.fail('Expected fixture request was not made');};
  return {client,wait,take,pending,methods};
}
const publicRoot=fileURLToPath(new URL('../vendor/codex-workspace-enhancer/asset-browser/public/',import.meta.url));
const project={id:'fixture',name:'测试资产项目',folders:[]};
const config={system:{platform:'darwin',name:'macOS'},assetManager:{columns:4,tags:[],taxonomy:{}}};
const asset=(id='fixture-text')=>({id,name:'角色设定.md',title:'角色设定',kind:'text',extension:'MD',preview:'人物设定资料',category:'文档',smartGroup:'asset',tags:[],autoTags:[],size:120,mtimeMs:1,confidence:100});
const page=(assets,total=assets.length)=>({assets,total,filteredTotal:total,counts:{all:total,text:total},smartCounts:{asset:total},settings:config.assetManager,index:{revision:'r1',updatedAt:1},page:{hasMore:false}});

test('asset page: bootstrap, retained cards, read-only error recovery, document preview, stale requests and themed motion', {timeout:30000}, async t=>{
  const f=await fixture(t,publicRoot,(req,res,url,json)=>{if(url.pathname==='/api/library/revision'){json(res,{revision:'r1'});return true;}});
  const evaluate=e=>f.client.evaluate(e);
  assert.equal(await evaluate("document.getElementById('libraryLoadingState').getAttribute('aria-busy')"),'true');
  assert.equal(await evaluate("document.getElementById('emptyLibraryState').hidden"),true);
  (await f.take(x=>x.url.pathname==='/api/config')).resolve(config);
  (await f.take(x=>x.url.pathname==='/api/projects')).resolve({projects:[project]});
  await f.wait("document.getElementById('libraryLoadingState').textContent.includes('正在读取资产索引')",'Index stage is visible');
  (await f.take(x=>x.url.pathname==='/api/library')).resolve(page([asset()]));
  await f.wait("document.getElementById('libraryLoadingState').hidden&&document.querySelector('.asset-card')!==null",'Success removes loader and shows actual cards');
  await evaluate("document.getElementById('librarySearchInput').value='alpha';document.getElementById('librarySearchInput').dispatchEvent(new Event('input'))");
  const old=await f.take(x=>x.url.searchParams.get('query')==='alpha');
  assert.equal(await evaluate("document.querySelectorAll('.asset-card').length"),1,'Existing cards remain during search');
  await evaluate("document.getElementById('librarySearchInput').value='beta';document.getElementById('librarySearchInput').dispatchEvent(new Event('input'))");
  const newest=await f.take(x=>x.url.searchParams.get('query')==='beta');
  old.resolve({error:'old failure'},503);
  assert.equal(await evaluate("document.getElementById('libraryLoadingState').classList.contains('is-error')"),false);
  newest.resolve({error:'本机索引暂不可用'},503);
  await f.wait("document.querySelector('[data-loading-retry=library]')!==null",'Failure exposes explicit read-only retry');
  assert.equal(await evaluate("document.querySelectorAll('.asset-card').length"),1);
  await evaluate("document.querySelector('[data-loading-retry=library]').click()");
  const retry=await f.take(x=>x.url.pathname==='/api/library');
  assert.equal(retry.url.searchParams.has('rescan'),false);retry.resolve(page([asset('beta-match')]));
  await f.wait("document.getElementById('libraryLoadingState').hidden&&document.querySelector('[data-asset-id=beta-match]')!==null",'Read retry resolves current query');
  await evaluate("document.querySelector('.text-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await f.wait("document.querySelector('#textViewerPreview [aria-busy=true]')!==null",'Document read has themed loader');
  (await f.take(x=>x.url.pathname==='/api/text')).resolve({error:'原文件不可访问'},404);
  await f.wait("document.querySelector('[data-loading-retry=text]')!==null",'Document failure is distinct from empty content');
  await evaluate("document.querySelector('[data-loading-retry=text]').click()");
  (await f.take(x=>x.url.pathname==='/api/text')).resolve({content:'已经读取的正文',editable:false});
  await f.wait("document.getElementById('textViewerPreview').textContent==='已经读取的正文'",'Document success clears loader');
  await evaluate("document.getElementById('textViewerDialog').close();document.getElementById('refreshLibraryButton').click()");
  const scan=await f.take(x=>x.url.searchParams.has('rescan'));
  assert.equal(await evaluate("document.getElementById('libraryLoadingState').textContent.includes('正在扫描关联文件夹')"),true);
  const color=await evaluate("document.documentElement.style.setProperty('--accent','rgb(118, 42, 164)');getComputedStyle(document.querySelector('#libraryLoadingState .aiyou-loading-art')).color");
  assert.equal(color,'rgb(118, 42, 164)');
  await evaluate("window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'https://untrusted.example',data:{type:'aiyoucodex:theme-state',preferences:{motion:false}}}))");
  assert.notEqual(await evaluate("document.documentElement.dataset.aiyouMotion"),'off');
  await evaluate("window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'app://-',data:{type:'aiyoucodex:theme-state',preferences:{motion:false}}}))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#libraryLoadingState .aiyou-loading-fill')).animationName"),'none');
  await evaluate("window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'null',data:{type:'aiyoucodex:theme-state',preferences:{motion:true}}}))");
  await f.client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#libraryLoadingState .aiyou-loading-track i')).animationName"),'none');
  scan.resolve({error:'扫描目录暂不可用'},503);
  await f.wait("document.querySelector('[data-loading-retry=library]')!==null",'Failed scan permits index read, not scan replay');
  await evaluate("document.querySelector('[data-loading-retry=library]').click()");
  const read=await f.take(x=>x.url.pathname==='/api/library');assert.equal(read.url.searchParams.has('rescan'),false);read.resolve(page([]));
  await f.wait("document.getElementById('libraryLoadingState').hidden&&!document.getElementById('emptyLibraryState').hidden",'An empty completed search is not loading or failure');
  assert.ok(f.methods.every(x=>x.method==='GET'),'Loading retries do not introduce writes');
});

test('model arena: config loading, honest failure and user read retry, empty configuration, theme motion and picker stages', {timeout:30000}, async t=>{
  const f=await fixture(t,fileURLToPath(new URL('../model-arena/public/',import.meta.url)));
  const evaluate=e=>f.client.evaluate(e);
  assert.equal(await evaluate("document.getElementById('arena-loading').hidden"),false);
  (await f.take(x=>x.url.pathname==='/api/arena/state')).resolve({error:'本机服务启动中'},503);
  await f.wait("!document.getElementById('retry-connect').hidden&&document.getElementById('arena-loading').classList.contains('is-error')",'Failure is visible with safe explicit connect retry');
  await evaluate("document.getElementById('retry-connect').click()");
  assert.equal(await evaluate("document.getElementById('arena-loading').getAttribute('aria-busy')"),'true');
  const state={models:MODELS,imageModels:IMAGE_MODELS,protocols:PROTOCOLS,settings:defaults(),assets:[],runs:[],runPage:{hasMore:false}};
  (await f.take(x=>x.url.pathname==='/api/arena/state')).resolve(state);
  await f.wait("document.getElementById('arena-loading').hidden&&!document.getElementById('generate-view').hidden",'Loaded unconfigured state is distinct from connecting');
  assert.equal(await evaluate("document.getElementById('model-empty').hidden"),false);
  await evaluate("document.getElementById('library-open').click()");
  await f.wait("document.getElementById('library-list').textContent.includes('正在读取项目列表')",'Picker shows project-list stage before waiting');
  (await f.take(x=>x.url.pathname==='/api/projects')).resolve({projects:[project]});
  await f.wait("document.getElementById('picker-loading')?.textContent.includes('正在读取资产索引')",'Picker then shows asset-index stage');
  (await f.take(x=>x.url.pathname==='/api/library')).resolve({assets:[],page:{hasMore:false}});
  await f.wait("document.getElementById('picker-loading').hidden&&document.getElementById('library-list').textContent.includes('当前筛选没有素材')",'Empty material result is not a perpetual loader');
  await evaluate("document.getElementById('library-dialog').close();document.getElementById('refresh').click()");
  const pending=await f.take(x=>x.url.pathname==='/api/arena/state');
  await evaluate("window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'null',data:{type:'aiyoucodex:theme-state',preferences:{motion:false}}}))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#arena-loading .aiyou-loading-fill')).animationName"),'none');
  pending.resolve({error:'暂时不可连接'},503);
  await f.wait("document.querySelector('[data-loading-retry=state]')!==null",'Record failure retains initialized view with read-only retry');
  assert.equal(await evaluate("document.getElementById('generate-view').hidden"),false);
  await evaluate("document.querySelector('[data-loading-retry=state]').click()");
  (await f.take(x=>x.url.pathname==='/api/arena/state')).resolve(state);
  await f.wait("document.getElementById('arena-loading').hidden",'Record retry clears status');
  assert.ok(f.methods.every(x=>x.method==='GET'),'No credential, import, provider, or generation request is submitted');
});

test('asset bootstrap recovery and media/prompt stages remain owned by the open preview', {timeout:30000}, async t=>{
  const f=await fixture(t,publicRoot);
  const evaluate=e=>f.client.evaluate(e);
  (await f.take(x=>x.url.pathname==='/api/config')).resolve({error:'配置读取失败'},503);
  (await f.take(x=>x.url.pathname==='/api/projects')).resolve({projects:[]});
  await f.wait("document.querySelector('[data-loading-retry=bootstrap]')!==null",'Bootstrap failure offers explicit config/project reads');
  await evaluate("document.querySelector('[data-loading-retry=bootstrap]').click()");
  (await f.take(x=>x.url.pathname==='/api/config')).resolve(config);
  (await f.take(x=>x.url.pathname==='/api/projects')).resolve({projects:[project]});
  const image={...asset('fixture-image'),kind:'image',extension:'SVG',mediaUrl:'/api/fixture-media',promptAssociation:{available:true}};
  (await f.take(x=>x.url.pathname==='/api/library')).resolve(page([image]));
  await f.wait("document.querySelector('.image-card')!==null",'Image exists only after index readback');
  await evaluate("document.querySelector('.image-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await f.wait("document.querySelector('#mediaPreviewStage .media-loading')?.getAttribute('aria-busy')==='true'&&document.querySelector('#mediaPromptText [aria-busy=true]')!==null",'Media and registered prompt reads have independent loading states');
  const prompt=await f.take(x=>x.url.pathname==='/api/assets/prompt');
  const media=await f.take(x=>x.url.pathname==='/api/fixture-media');
  media.res.writeHead(200,{'content-type':'image/svg+xml'});media.res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="purple"/></svg>');
  // Chrome may issue one shared image request or separate card/preview requests.
  for (let i=f.pending.length-1;i>=0;i--) if(f.pending[i].url.pathname==='/api/fixture-media') {const item=f.pending.splice(i,1)[0];item.res.writeHead(200,{'content-type':'image/svg+xml'});item.res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"></svg>');}
  await f.wait("document.querySelector('#mediaPreviewStage .media-loading')===null",'Decoded media removes only its loading state');
  assert.equal(await evaluate("document.querySelector('#mediaPromptText [aria-busy=true]')!==null"),true,'Prompt can still be reading after media has loaded');
  prompt.resolve({error:'关联资料暂不可读取'},503);
  await f.wait("document.querySelector('#mediaPromptText [data-loading-retry=media]')!==null",'Prompt failure has a read-only retry');
  await evaluate("document.getElementById('mediaPreviewDialog').close()");
  await f.wait("document.getElementById('mediaPreviewStage').children.length===0", 'Dialog close releases the previous media before reopen');
  await evaluate("document.querySelector('.image-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  const stale=await f.take(x=>x.url.pathname==='/api/assets/prompt');
  await evaluate("document.getElementById('mediaPreviewDialog').close()");
  stale.resolve({prompt:'关闭后才抵达的旧提示词'});
  await f.wait("document.getElementById('mediaPreviewStage').children.length===0", 'Closed dialog releases stale preview');
  assert.equal(await evaluate("document.getElementById('mediaPreviewStage').children.length"),0,'Closed preview does not resume stale media');
  assert.equal(await evaluate("document.getElementById('mediaPreviewDialog').open"),false);
  assert.ok(f.methods.every(x=>x.method==='GET'));
});


test('body timeouts become visible read errors and write operations keep their existing request contract', async () => {
  const sources = [
    { file: new URL('../vendor/codex-workspace-enhancer/asset-browser/public/app.js', import.meta.url), start: 'async function api(', end: 'function showToast(', name: 'api' },
    { file: new URL('../model-arena/public/app.js', import.meta.url), start: 'async function request(', end: '  function loadingMarkup(', name: 'request' },
  ];
  for (const item of sources) {
    const source = await readFile(item.file, 'utf8');
    const timeout = { aborted: false }, signals = []; let deadlines = 0, abortBody = true;
    const context = vm.createContext({ URL, API: new URL('http://fixture/api/arena/'),
      AbortSignal: { timeout: () => { deadlines++; timeout.aborted = false; return timeout; }, any: values => values[0] },
      fetch: async (_route, options) => { signals.push(options.signal); return {ok:true,
        text: async()=>{if(abortBody){timeout.aborted=true;throw Object.assign(new Error('body aborted'),{name:'AbortError'});}return '{}';},
        json: async()=>{if(abortBody){timeout.aborted=true;throw Object.assign(new Error('body aborted'),{name:'AbortError'});}return {};},
      }; },
    });
    vm.runInContext(source.slice(source.indexOf(item.start), source.indexOf(item.end)), context);
    await assert.rejects(context[item.name]('/read'), /读取超时/);
    assert.equal(deadlines, 1);
    abortBody = false;
    if (item.name === 'api') await context.api('/write', {method:'POST',body:'{}'});
    else await context.request('write', 'POST', {});
    assert.equal(deadlines, 1, 'The loading change does not abort or replay a write');
    assert.equal(signals[1], undefined);
  }
});
