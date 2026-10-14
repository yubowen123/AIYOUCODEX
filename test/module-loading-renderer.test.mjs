import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { connectFixtureBrowser, waitForBrowserState } from './helpers/browser-state.mjs';

const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
let executable;
for (const candidate of [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean)) {
  try { await access(candidate); executable = candidate; break; } catch {}
}
const api = 'window.__codexConversationPreviewInjection__', panel = '#codex-asset-console-page', frame = '#codex-asset-console-frame';

test('Shared loading preserves accessibility and theme motion; module readiness is document-, source- and generation-bound', {
  timeout: 30_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Chrome/Chromium required',
}, async t => {
  assert.ok(executable);
  const directory = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'module-loading-fixture-')), profile = path.join(directory, 'browser');
  const html = '<!doctype html><style>body{margin:0;display:flex;height:100vh}aside{width:220px;flex:none}main{display:flex;flex:1;min-width:0;height:100vh}#chat{flex:1;padding:20px}</style><nav data-app-navigation-rail style="width:64px"><button aria-label="首页">首页</button></nav><aside id="app-shell-sidebar"><nav><div><button class="sidebar-item">新对话</button></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header></section></div></nav></aside><main><div id="chat"><div contenteditable="true" data-codex-composer="true">原有草稿</div></div></main>';
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(req.url.startsWith('/module') ? '<!doctype html><p>Module document</p>' : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions', '--window-size=1400,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill('SIGTERM'); await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: origin }));
  await client.evaluate(source);
  await client.evaluate(`window.fixtureMotion=true;window.__AIYOUCODEX_THEME__={getState:()=>({prefs:{motion:fixtureMotion}})};window.fixtureRequests=[];window.codexSidebarOpenAssetConsole=payload=>fixtureRequests.push(JSON.parse(payload));const loading=document.createElement('div');loading.id='fixture-loading';loading.setAttribute('role','log');loading.setAttribute('aria-live','off');document.body.append(loading);${api}.renderModuleLoadingState(loading,{title:'<img src=x onerror=window.unsafe=true>',message:'等待真实响应',layout:'panel'});window.fixtureChild=loading.firstChild`);
  assert.equal(await client.evaluate("document.querySelector('#fixture-loading img')===null&&window.unsafe!==true"), true, 'Status text is inert');
  assert.equal(await client.evaluate("document.querySelector('#fixture-loading [role=progressbar]').hasAttribute('aria-valuenow')"), false, 'Unknown duration does not fabricate progress');
  await client.evaluate(`${api}.renderModuleLoadingState(document.getElementById('fixture-loading'),{title:'<img src=x onerror=window.unsafe=true>',message:'等待真实响应',layout:'panel'})`);
  assert.equal(await client.evaluate("fixtureChild===document.getElementById('fixture-loading').firstChild"), true, 'Unchanged refresh retains the animation and live-region nodes');
  await client.evaluate(`${api}.renderModuleLoadingState(document.getElementById('fixture-loading'),{progress:.01})`);
  assert.equal(await client.evaluate("document.querySelector('#fixture-loading [role=progressbar]').getAttribute('aria-valuenow')"), '1');
  await client.evaluate('fixtureMotion=false');
  await waitForBrowserState(client, "document.getElementById('fixture-loading').dataset.loadingMotion==='off'", 'Theme motion preference applied');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('#fixture-loading .aiyou-loading-fill')).animationName"), 'none');
  await client.evaluate('fixtureMotion=true');
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('#fixture-loading .aiyou-loading-fill')).animationName"), 'none');
  await client.send('Emulation.setEmulatedMedia', { features: [] });
  if (process.env.AIYOU_LOADING_PREVIEW_OUTPUT) {
    for (const [name, background, text, accent] of [['深色', '#0c151e', '#edf4fa', '#78bde6'], ['浅色', '#f5f8fc', '#1d2c3d', '#2878b7']]) {
      await client.evaluate(`(()=>{const e=document.getElementById('fixture-loading');document.body.style.setProperty('--aiyou-link',${JSON.stringify(accent)});e.style.cssText='position:fixed;top:60px;left:60px;z-index:99999;background:${background};color:${text};border-radius:16px;border:1px solid ${accent}44';${api}.renderModuleLoadingState(e,{title:'正在连接本机剪辑工具',message:'正在检查组件与服务连接，请稍候。',layout:'panel'});fixtureMotion=true})()`);
      await waitForBrowserState(client, "document.getElementById('fixture-loading').dataset.loadingMotion==='on'", 'Preview animates with enabled theme motion');
      const clip = await client.evaluate("(()=>{const r=document.getElementById('fixture-loading').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
      const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip });
      await writeFile(path.join(process.env.AIYOU_LOADING_PREVIEW_OUTPUT, `模块加载-浏览器${name}预览.png`), Buffer.from(data, 'base64'));
    }
    await client.evaluate("document.getElementById('fixture-loading').style.cssText='';document.body.style.removeProperty('--aiyou-link')");
  }
  await client.evaluate(`${api}.clearModuleLoadingState(document.getElementById('fixture-loading'))`);
  assert.deepEqual(await client.evaluate("(()=>{const e=document.getElementById('fixture-loading');return[e.getAttribute('role'),e.getAttribute('aria-live'),e.hasAttribute('aria-busy'),e.children.length]})()"), ['log', 'off', false, 0]);

  await client.evaluate(`${api}.openAssetConsolePanel({kind:'asset'});${api}.setAssetConsolePanel({kind:'asset',state:'ready',url:${JSON.stringify(origin + '/module?document=1')}})`);
  await waitForBrowserState(client, `document.querySelector('${frame}')?.dataset.assetDocumentLoaded==='true'`, 'Real iframe document loaded');
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.state`), 'loading', 'Loading HTML alone does not establish working controls');
  await client.evaluate(`window.fixtureFrame=document.querySelector('${frame}');window.fixtureLoad=fixtureFrame.onload;window.fixtureReady={type:'aiyoucodex:module-ready',module:'asset',loadingKey:new URL(fixtureFrame.src).searchParams.get('aiyou_loading_key')};window.dispatchEvent(new MessageEvent('message',{source:window,origin:${JSON.stringify(origin)},data:fixtureReady}));window.dispatchEvent(new MessageEvent('message',{source:fixtureFrame.contentWindow,origin:'https://foreign.test',data:fixtureReady}));window.dispatchEvent(new MessageEvent('message',{source:fixtureFrame.contentWindow,origin:${JSON.stringify(origin)},data:{...fixtureReady,loadingKey:'stale'}}));window.dispatchEvent(new MessageEvent('message',{source:fixtureFrame.contentWindow,origin:${JSON.stringify(origin)},data:{...fixtureReady,module:'arena'}}))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.state`), 'loading', 'Wrong source, origin, generation and module remain pending');
  await client.evaluate(`window.dispatchEvent(new MessageEvent('message',{source:fixtureFrame.contentWindow,origin:${JSON.stringify(origin)},data:fixtureReady}))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.state`), 'ready');
  await client.evaluate(`${api}.setAssetConsolePanel({kind:'asset',state:'ready',url:${JSON.stringify(origin + '/module?document=2')}});fixtureLoad();window.dispatchEvent(new MessageEvent('message',{source:fixtureFrame.contentWindow,origin:${JSON.stringify(origin)},data:fixtureReady}))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.state`), 'loading', 'Removed frame cannot finish its replacement');
  await waitForBrowserState(client, `document.querySelector('${frame}')?.dataset.assetDocumentLoaded==='true'`, 'Replacement document loaded');
  await client.evaluate(`document.querySelector('${frame}').dispatchEvent(new Event('error'))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.state`), 'error');
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('${panel} .codex-asset-console-retry')).display!=='none'`), true, 'Error exposes explicit reconnection');
  await client.evaluate(`window.fixtureBeforeRetry=fixtureRequests.length;document.querySelector('${panel} .codex-asset-console-retry').click()`);
  assert.equal(await client.evaluate('fixtureRequests.length===fixtureBeforeRetry+1&&fixtureRequests.at(-1).action===\'open\''), true, 'Retry requests a read-only connection');
  await client.evaluate(`window.fixtureLate=document.querySelector('${frame}').onload;document.querySelector('${panel} .codex-asset-console-close').click();fixtureLate()`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true, 'Late document completion never reopens the closed page');

  await client.evaluate(`window.__AIYOUCODEX_SKILLS_REQUEST__=payload=>fixtureRequests.push(JSON.parse(payload));${api}.openSkillsGrouping()`);
  assert.equal(await client.evaluate("document.querySelector('#codex-skill-organizer .codex-skill-grid').classList.contains('aiyou-module-loading')"), true, 'Unknown directory has a first-load state');
  await client.evaluate(`${api}.setSnapshot({skillOrganization:{version:0,catalog:[],groups:[]}})`);
  assert.equal(await client.evaluate("document.querySelector('#codex-skill-organizer .codex-skill-grid').classList.contains('aiyou-module-loading')"), false, 'A confirmed empty directory ends waiting');
  assert.equal(await client.evaluate("document.querySelector('[contenteditable=true]').textContent"), '原有草稿');
  await client.evaluate(`${api}.destroy()`);
});
