import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { isOpenChatCutRuntimeAsset, openChatCutEmbedRoute, requestOpenChatCut, transformOpenChatCutBody, OPENCHATCUT_HOST_STYLE_ID, openChatCutHostModeExpression } from '../lib/openchatcut-embed.mjs';
import { assetConsoleEmbedUrl } from '../lib/asset-console-embed.mjs';
import { connectFixtureBrowser, waitForBrowserState } from './helpers/browser-state.mjs';
const token = 'a'.repeat(48);

test('runtime assets permit only four pinned CDN GETs', () => {
  const prefix = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
  for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    const url = prefix + name;
    assert.equal(isOpenChatCutRuntimeAsset({ url, method: 'GET' }), true);
    for (const method of ['POST', 'HEAD', 'DELETE', undefined]) assert.equal(isOpenChatCutRuntimeAsset({ url, method }), false);
    for (const changed of [url + '?token=fixture', url + '#fragment', url.replace('@1.29.0', '@latest'), url.replace('cdn.jsdelivr.net', 'other.test'), url.replace('/dist/', '/private/'), url.replace('https://', 'https://user@')]) {
      assert.equal(isOpenChatCutRuntimeAsset({ url: changed, method: 'GET' }), false);
    }
  }
});

test('OpenChatCut routes are limited to the opaque editor frame, including model and media paths', () => {
  const url = assetConsoleEmbedUrl(token);
  assert.equal(openChatCutEmbedRoute(url + 'assets/editor.js', { token }), '/assets/editor.js');
  assert.equal(openChatCutEmbedRoute('https://web-sandbox.oaiusercontent.com/api/project-store', { token }), null);
  assert.equal(openChatCutEmbedRoute('https://web-sandbox.oaiusercontent.com/models/whisper.wasm', { token, editorSession: true }), '/models/whisper.wasm');
  assert.equal(openChatCutEmbedRoute('https://example.test/api/projects', { token, editorSession: true }), null);
  const html = transformOpenChatCutBody('/', Buffer.from('<head></head><script src="/assets/editor.js"></script>'), 'text/html', token).toString();
  assert.ok(html.includes(`<base href="/__codex_asset_console__/${token}/">`));
  assert.ok(html.includes(`src="/__codex_asset_console__/${token}/assets/editor.js"`));
  assert.ok(html.includes(`id="${OPENCHATCUT_HOST_STYLE_ID}"`));
  assert.ok(!transformOpenChatCutBody('/share/project', Buffer.from('<head></head>'), 'text/html', token).toString().includes(OPENCHATCUT_HOST_STYLE_ID));
  const javascript = Buffer.from('export const data = "<head>";');
  assert.equal(transformOpenChatCutBody('/', javascript, 'application/javascript', token), javascript);
});

// This is the installed official v0.2.16 index prefix: its charset originally
// starts at byte 46. Keep it in its upstream position, rather than fixing the
// fixture after transformation or supplying a response charset header.
const officialIndexPrefix = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n';
test('UTF-8 is the first head element before the long embedded host script', () => {
  assert.equal(Buffer.from(officialIndexPrefix).indexOf(Buffer.from('<meta charset')), 46);
  for (const upstream of [officialIndexPrefix, '<!doctype html><html><head>']) {
    const html = transformOpenChatCutBody('/', Buffer.from(`${upstream}<title>OpenChatCut</title></head><body>素材与时间线</body></html>`), 'text/html', token);
    const value = html.toString('utf8');
    assert.match(value, /<head><meta charset="UTF-8"><base /);
    assert.ok(html.indexOf(Buffer.from('<meta charset="UTF-8">')) < 1024);
    assert.equal((value.match(/<meta\b[^>]*\bcharset\s*=/gi) || []).length, 1);
    assert.ok(html.indexOf(Buffer.from('<meta charset')) < html.indexOf(Buffer.from('<script>')));
    assert.ok(html.indexOf(Buffer.from('</script>')) > 1024, 'The fixture exercises the real long host injection');
    assert.ok(value.includes('素材与时间线'));
  }
});

test('embedded editor requests preserve upstream Origin auth and bound video ranges', async t => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.headers['sec-fetch-site'] !== 'same-origin') { res.writeHead(403); res.end('{}'); return; }
    res.end(JSON.stringify({ origin: req.headers.origin, host: req.headers.host, range: req.headers.range, encoding: req.headers['accept-encoding'], site: req.headers['sec-fetch-site'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await requestOpenChatCut(origin, { method: 'GET', route: '/media/uploads/test.mp4',
    headers: { Origin: 'https://web-sandbox.oaiusercontent.com', Range: 'bytes=0-', 'Accept-Encoding': 'gzip' } });
  const value = JSON.parse(response.body);
  assert.equal(value.origin, origin); assert.equal(value.encoding, 'identity');
  assert.equal(value.site, 'same-origin');
  const write = await requestOpenChatCut(origin, { method: 'POST', route: '/api/project-store', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}' });
  assert.equal(write.status, 200); assert.equal(JSON.parse(write.body).site, 'same-origin');
  assert.equal(value.range, 'bytes=0-2097151');
  const defaultRange = await requestOpenChatCut(origin, { route: '/media/uploads/test.mp4' });
  assert.equal(JSON.parse(defaultRange.body).range, 'bytes=0-2097151');
  const still = await requestOpenChatCut(origin, { route: '/media/uploads/test.png' });
  assert.equal(JSON.parse(still.body).range, undefined);
  assert.throws(() => requestOpenChatCut('https://remote.test', {}), /loopback/);
});

const browserCandidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .map(root => path.join(root, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let browserExecutable;
for (const candidate of browserCandidates) { try { await access(candidate); browserExecutable = candidate; break; } catch {} }
const requireBrowser = process.env.AIYOUCODEX_REQUIRE_BROWSER === '1';

// The official v0.2.16 EditorWorkspaceView/ChatPanelView/useEditorPanelLayout
// contract: 5 grid tracks; chat in 1, chat divider in 2, library in 3, its
// divider in 4, preview+inspector in 5; timeline spans 3 / -1. No upstream app
// or project is loaded: this exercises real CSS/layout and native handlers.
const workspace = `<div class="cc-editor-shell" style="display:grid;grid-template-columns:24vw 0 28vw 0 minmax(0,1fr);grid-template-rows:41px 420px 0 200px;height:661px">
  <header class="cc-topbar" style="display:flex;align-items:center;grid-column:1 / -1;grid-row:1"><button id="project-home" class="cc-tip" aria-label="返回工程列表" onclick="window.homeClicks++">Home</button><div class="cc-topbar-actions"><button id="native-history">历史版本</button></div></header>
  <aside class="cc-chat-panel" data-cc-shortcut-surface="agent-chat" style="grid-column:1;grid-row:2 / 5;display:flex">
    <div class="cc-chat-header">Agent 工作台</div><div class="cc-chat-capability-banner"><span>未配置</span>
      <button type="button" onclick="window.settingsClicks.push('initial');openSettings()">去设置配置</button>
      <button type="button" class="cc-chat-capability-banner-close">×</button></div><textarea>剪辑目标</textarea></aside>
  <div id="chat-divider" style="grid-column:2;grid-row:2 / 5"><button>拖拽</button></div>
  <div id="library" data-cc-shortcut-surface="media-pool" style="grid-column:3;grid-row:2">素材<div class="cc-media-export-guide" role="note">本地音乐分析模型未安装</div><div class="cc-media-export-guide">素材可下载原文件</div><div class="cc-media-error">素材丢失</div></div>
  <div id="library-divider" style="grid-column:4;grid-row:2">素材拖拽</div>
  <div class="cc-preview-workspace" style="grid-column:5;grid-row:2"><div id="preview">预览</div><aside id="inspector">片段属性</aside></div>
  <div id="timeline-divider" style="grid-column:3 / -1;grid-row:3">时间线拖拽</div>
  <div id="timeline" data-cc-shortcut-surface="timeline" style="grid-column:3 / -1;grid-row:4"><button id="manual-edit" onclick="window.manualEdits++">手动剪切</button></div>
</div>`;
const documentFixture = `${officialIndexPrefix}<style>body{margin:0}button{min-width:28px;min-height:28px}#inspector{width:160px}</style></head><body>${workspace}
  <section id="unrelated-agent">普通素材名：Agent 工作台</section><script>
    window.settingsClicks=[]; window.manualEdits=0; window.homeClicks=0;
    window.editorRuntime={projectId:'owned-project',editSessionId:'owned-draft'};
    function openSettings(){if(document.getElementById('native-settings'))return;const dialog=document.createElement('section');dialog.id='native-settings';dialog.setAttribute('role','dialog');dialog.style.cssText='position:fixed;inset:70px 40px;background:white;z-index:1000';dialog.textContent='原生工具配置';document.querySelector('.cc-editor-shell').appendChild(dialog)}
    window.settingsResults=[];addEventListener('message',event=>{if(event.data?.type==='aiyou-openchatcut:model-settings-result')settingsResults.push(event.data)});
  </script></body></html>`;
const nativeSettingsFixture = `export function SettingsDialog({onClose}) {
  window.nativeSettingsMounts=(window.nativeSettingsMounts||0)+1;
  const dialog=document.createElement('section');dialog.id='native-settings';dialog.setAttribute('role','dialog');
  dialog.innerHTML='<b>原生模型设置</b><input aria-label="图片模型"><button type="button">关闭</button>';
  dialog.querySelector('button').onclick=onClose;
  return dialog;
}`;
const nativeReactFixture = `export const i=()=>({createElement:(component,props)=>({component,props})});
export const n=()=>({createRoot:host=>({render:({component,props})=>host.appendChild(component(props)),unmount:()=>host.replaceChildren()})});`;

test('isolated browser: cold UTF-8 loading and controlled host editing, settings, rerenders and reconnects', {
  timeout: 30_000,
  skip: !browserExecutable && !requireBrowser && 'Set AIYOUCODEX_TEST_BROWSER for real editor layout checks',
}, async t => {
  assert.ok(browserExecutable, 'A Chrome/Chromium binary is required for editor layout checks');
  const profile = await mkdtemp(path.join(tmpdir(), 'aiyou-openchatcut-host-'));
  const browser = spawn(browserExecutable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: 'about:blank' }));
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  const interceptedErrors = [];
  const moduleRequests = [];
  client.on('Fetch.requestPaused', event => {
    const route = new URL(event.request.url).pathname;
    const module = route.endsWith('/assets/SettingsDialog-8GsumHR8.js') ? nativeSettingsFixture
      : route.endsWith('/assets/react-DUVq_3mI.js') ? nativeReactFixture : null;
    if (module) {
      moduleRequests.push(route);
      client.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from(module).toString('base64') }).catch(error => interceptedErrors.push(error.message));
      return;
    }
    const html = route.startsWith('/__codex_asset_console__/')
      ? transformOpenChatCutBody('/', Buffer.from(documentFixture), 'text/html', token).toString() : documentFixture;
    client.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(html).toString('base64') }).catch(error => interceptedErrors.push(error.message));
  });
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // The owned HTML is the first real navigation in a fresh browser profile.
  // There is no inherited UTF-8 document or Content-Type charset to mask an
  // encoding problem introduced by the production HTML transformation.
  await client.send('Page.navigate', { url: assetConsoleEmbedUrl(token) + '#editor/cold-project' });
  await waitForBrowserState(client, "document.readyState==='complete'&&!!document.querySelector('[data-aiyou-openchatcut-tool-settings]')", 'First cold owned document activates host mode');
  assert.deepEqual(await client.evaluate(`({charset:document.characterSet,firstHeadElement:document.head.firstElementChild?.outerHTML,
    gearLabel:document.querySelector('[data-aiyou-openchatcut-tool-settings]').getAttribute('aria-label'),
    gearText:document.querySelector('[data-aiyou-openchatcut-tool-settings]').textContent,manualText:document.getElementById('manual-edit').textContent})`), {
    charset: 'UTF-8', firstHeadElement: '<meta charset="UTF-8">', gearLabel: 'OpenChatCut 模型与 API 设置', gearText: '⚙', manualText: '手动剪切',
  });
  await client.evaluate(`document.querySelector('.cc-editor-shell').remove();window.postMessage({type:'aiyou-openchatcut:open-model-settings',requestId:'occ-settings-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},location.origin)`);
  await waitForBrowserState(client, 'window.settingsResults.length===1', 'Cold HTML retains the bounded Chinese UI message');
  assert.equal(await client.evaluate('window.settingsResults[0].error'), 'OpenChatCut 模型设置入口尚未就绪，请重新连接编辑器。');
  await client.send('Page.navigate', { url: 'http://127.0.0.1:5199/#editor/standalone' });
  await waitForBrowserState(client, "!!document.querySelector('.cc-editor-shell')", 'Standalone fixture mounts');
  assert.deepEqual(await client.evaluate(openChatCutHostModeExpression()), { applied: false, reason: 'outside-controlled-embed' });
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.cc-chat-panel')).display"), 'flex');
  assert.equal(await client.evaluate(`!!document.getElementById(${JSON.stringify(OPENCHATCUT_HOST_STYLE_ID)})`), false);
  await client.send('Page.navigate', { url: 'https://web-sandbox.oaiusercontent.com/other-editor' });
  await waitForBrowserState(client, "location.pathname==='/other-editor'&&!!document.querySelector('.cc-editor-shell')", 'Unowned sandbox fixture mounts');
  assert.equal((await client.evaluate(openChatCutHostModeExpression())).applied, false);
  await client.send('Page.navigate', { url: assetConsoleEmbedUrl(token) + '#editor/owned-project?editSession=owned-draft' });
  await waitForBrowserState(client, "getComputedStyle(document.querySelector('.cc-chat-panel')).display==='none'&&!!document.querySelector('[data-aiyou-openchatcut-tool-settings]')", 'Controlled HTML activates host mode');
  const state = await client.evaluate(`(()=>{const shell=document.querySelector('.cc-editor-shell');const rect=id=>document.getElementById(id).getBoundingClientRect();return {
    tracks:getComputedStyle(shell).gridTemplateColumns,chat:getComputedStyle(document.querySelector('.cc-chat-panel')).display,
    divider:getComputedStyle(document.getElementById('chat-divider')).display,libraryX:rect('library').x,libraryWidth:rect('library').width,
    timelineX:rect('timeline').x,timelineWidth:rect('timeline').width,previewWidth:document.querySelector('.cc-preview-workspace').getBoundingClientRect().width,
    preserved:['library-divider','timeline-divider','preview','inspector','native-history','manual-edit','unrelated-agent'].every(id=>getComputedStyle(document.getElementById(id)).display!=='none'),runtime:window.editorRuntime};})()`);
  assert.equal(state.chat, 'none'); assert.equal(state.divider, 'none');
  assert.equal(state.libraryX, 0); assert.equal(state.libraryWidth, 336);
  assert.equal(state.timelineX, 0); assert.equal(state.timelineWidth, 1200);
  assert.equal(state.previewWidth, 864); assert.equal(state.preserved, true);
  assert.deepEqual(state.runtime, { projectId: 'owned-project', editSessionId: 'owned-draft' });
  assert.ok(state.tracks.startsWith('0px 0px '));
  assert.equal(await client.evaluate("getComputedStyle(document.getElementById('project-home')).display"), 'none');
  await client.evaluate("document.getElementById('project-home').click()");
  assert.equal(await client.evaluate('window.homeClicks'), 0, 'Native Home handler is blocked even for programmatic clicks');
  await client.evaluate("window.routeEvents=0;addEventListener('hashchange',()=>window.routeEvents++);location.hash='/'");
  await waitForBrowserState(client, "location.hash==='#editor/owned-project?editSession=owned-draft'", 'Home route is restored before upstream listeners');
  assert.equal(await client.evaluate('window.routeEvents'), 0);
  await client.evaluate("location.hash='/editor/another-project'");
  await waitForBrowserState(client, "location.hash==='#editor/owned-project?editSession=owned-draft'", 'Another project cannot replace this document binding');
  await client.evaluate("history.pushState({},'', '#/editor/another-project');history.replaceState({},'', '#/')");
  assert.equal(await client.evaluate('location.hash'), '#editor/owned-project?editSession=owned-draft');
  await client.evaluate("history.replaceState({},'', '#editor/owned-project?editSession=owned-draft&panel=media')");
  assert.equal(await client.evaluate('location.hash'), '#editor/owned-project?editSession=owned-draft&panel=media', 'Same-project URL state remains usable');

  async function click(selector) {
    const point = await client.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await click('#manual-edit'); assert.equal(await client.evaluate('window.manualEdits'), 1);
  await click('[data-aiyou-openchatcut-dismiss-hint="music-models"]');
  assert.equal(await client.evaluate('getComputedStyle(document.querySelector(".cc-media-export-guide[role=note]")).display'), 'none');
  assert.notEqual(await client.evaluate('getComputedStyle(document.querySelector(".cc-media-export-guide:not([role])")).display'), 'none', 'Each guide is dismissed independently');
  assert.notEqual(await client.evaluate('getComputedStyle(document.querySelector(".cc-media-error")).display'), 'none', 'Missing-media errors remain visible');
  await client.evaluate(`document.querySelector('.cc-media-export-guide[role=note]').outerHTML='<div class="cc-media-export-guide" role="note">重绘后的模型提示</div>'`);
  await waitForBrowserState(client, 'getComputedStyle(document.querySelector(".cc-media-export-guide[role=note]")).display==="none"', 'Guide dismissal survives React replacement');
  await click('[data-aiyou-openchatcut-dismiss-hint="media-export"]');
  assert.equal(await client.evaluate('getComputedStyle(document.querySelector(".cc-media-export-guide:not([role])")).display'), 'none');
  await click('[data-aiyou-openchatcut-tool-settings]');
  await waitForBrowserState(client, "!!document.querySelector('#native-settings')", 'Settings proxy opens the native overlay');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('#native-settings')).display==='none'"), false);
  await client.evaluate(`document.getElementById('native-settings').remove();window.oldHost=window.__aiyouOpenChatCutHostMode__;window.oldRuntime=window.editorRuntime`);
  await client.evaluate(openChatCutHostModeExpression()); await client.evaluate(openChatCutHostModeExpression());
  assert.equal(await client.evaluate(`document.querySelectorAll('#${OPENCHATCUT_HOST_STYLE_ID}').length`), 1);
  assert.equal(await client.evaluate("window.oldHost===window.__aiyouOpenChatCutHostMode__&&window.oldRuntime===window.editorRuntime&&document.querySelectorAll('[data-aiyou-openchatcut-tool-settings]').length===1"), true);
  await client.evaluate(`document.querySelector('.cc-editor-shell').style.gridTemplateColumns='46px 0 35vw 0 minmax(0, 1fr)'`);
  await waitForBrowserState(client, "document.getElementById('library').getBoundingClientRect().width===420", 'Native library resize updates the host track');
  await client.evaluate(`(()=>{const original=document.querySelector('.cc-chat-capability-banner button');const replacement=original.cloneNode(true);replacement.onclick=()=>{window.settingsClicks.push('replacement');openSettings()};original.replaceWith(replacement);document.querySelector('[data-aiyou-openchatcut-tool-settings]').remove()})()`);
  await waitForBrowserState(client, "!!document.querySelector('[data-aiyou-openchatcut-tool-settings]')", 'React toolbar replacement restores the settings proxy');
  await click('[data-aiyou-openchatcut-tool-settings]');
  assert.deepEqual(await client.evaluate('window.settingsClicks'), ['initial', 'replacement']);
  await client.evaluate("document.getElementById('native-settings').remove();document.querySelector('.cc-chat-capability-banner').remove()");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-aiyou-openchatcut-tool-settings]').length"), 1, 'The left model settings action survives a missing Agent banner');
  await client.evaluate(`window.postMessage({type:'aiyou-openchatcut:open-model-settings',requestId:'occ-settings-11111111-1111-4111-8111-111111111111'},location.origin)`);
  await waitForBrowserState(client, "!!document.querySelector('#native-settings')&&window.settingsResults.length===1", 'Owned UI action opens native settings even without an Agent banner');
  assert.equal(await client.evaluate('window.settingsResults[0].ok'), true);
  await client.evaluate(`document.querySelector('#native-settings input').value='unsaved-model-choice'`);
  await client.evaluate(`window.postMessage({type:'aiyou-openchatcut:open-model-settings',requestId:'occ-settings-22222222-2222-4222-8222-222222222222'},location.origin)`);
  await waitForBrowserState(client, "window.settingsResults.length===2", 'Repeated opening acknowledges the same native dialog');
  assert.equal(await client.evaluate("document.querySelectorAll('#native-settings').length"), 1);
  assert.equal(await client.evaluate('window.nativeSettingsMounts'), 1);
  assert.equal(await client.evaluate("document.querySelector('#native-settings input').value"), 'unsaved-model-choice');
  assert.deepEqual(moduleRequests.sort(), [`/__codex_asset_console__/${token}/assets/SettingsDialog-8GsumHR8.js`, `/__codex_asset_console__/${token}/assets/react-DUVq_3mI.js`].sort(), 'Imports reuse canonical editor module URLs');
  await client.evaluate(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://unrelated.test',data:{type:'aiyou-openchatcut:open-model-settings',requestId:'occ-settings-33333333-3333-4333-8333-333333333333'}}));document.querySelector('#native-settings button').click()`);
  assert.equal(await client.evaluate('window.settingsResults.length'), 2, 'An unrelated origin cannot open or receive settings');
  assert.equal(await client.evaluate("!!document.querySelector('[data-aiyou-openchatcut-model-settings]')"), false, 'Native close unmounts its own overlay');
  await client.evaluate(`(()=>{const overlay=document.createElement('div');overlay.id='already-open-native-settings';overlay.style.cssText='position:fixed;inset:0;z-index:200';overlay.innerHTML='<div><header><b>Settings · API Keys</b></header><div><input aria-label="pending native model" value="keep-existing-form"></div><footer><input type="checkbox"><button>Close</button><button>Save</button></footer></div>';document.body.appendChild(overlay);window.postMessage({type:'aiyou-openchatcut:open-model-settings',requestId:'occ-settings-44444444-4444-4444-8444-444444444444'},location.origin)})()`);
  await waitForBrowserState(client, "window.settingsResults.length===3", 'An existing native settings form is acknowledged');
  assert.equal(await client.evaluate("document.querySelector('#already-open-native-settings input').value"), 'keep-existing-form');
  assert.equal(await client.evaluate("!!document.querySelector('[data-aiyou-openchatcut-model-settings]')"), false, 'Existing native settings are reused without another root');
  assert.equal(await client.evaluate('window.nativeSettingsMounts'), 1);
  await client.evaluate("document.getElementById('already-open-native-settings').remove()");
  await client.evaluate(`document.querySelector('.cc-editor-shell').outerHTML=${JSON.stringify(workspace)}`);
  await waitForBrowserState(client, "getComputedStyle(document.querySelector('.cc-chat-panel')).display==='none'&&!!document.querySelector('[data-aiyou-openchatcut-tool-settings]')", 'A new project shell also retains host mode');
  assert.equal(await client.evaluate('[...document.querySelectorAll(".cc-media-export-guide")].every(e=>getComputedStyle(e).display==="none")'), true, 'Both dismissed guides stay hidden after an entire shell replacement');
  await client.evaluate('window.__aiyouOpenChatCutHostMode__.destroy()'); await client.evaluate(openChatCutHostModeExpression());
  assert.equal(await client.evaluate('[...document.querySelectorAll(".cc-media-export-guide")].every(e=>getComputedStyle(e).display==="none")'), true, 'Saved dismissals survive host-mode recreation');
  await client.evaluate("document.querySelector('.cc-editor-shell').style.gridTemplateColumns='1fr 1fr'");
  await waitForBrowserState(client, "getComputedStyle(document.querySelector('.cc-chat-panel')).display==='flex'", 'An unknown upstream layout remains untouched');
  await client.evaluate("document.querySelector('.cc-editor-shell').style.gridTemplateColumns='24vw 0 28vw 0 minmax(0, 1fr)'");
  await waitForBrowserState(client, "getComputedStyle(document.querySelector('.cc-chat-panel')).display==='none'", 'Known layout resumes without recreating the document');
  assert.equal(await client.evaluate(`(async()=>{let mutations=0;const watcher=new MutationObserver(records=>mutations+=records.length);watcher.observe(document.documentElement,{subtree:true,childList:true,attributes:true});await new Promise(resolve=>setTimeout(resolve,100));watcher.disconnect();return mutations})()`), 0, 'Idle observers do not cause a mutation feedback loop');
  await client.evaluate('window.__aiyouOpenChatCutHostMode__.destroy()');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.cc-chat-panel')).display"), 'flex');
  assert.equal(await client.evaluate(`!!document.getElementById('${OPENCHATCUT_HOST_STYLE_ID}')||!!document.querySelector('[data-aiyou-openchatcut-tool-settings]')||document.documentElement.hasAttribute('data-aiyou-openchatcut-host')`), false);
  assert.deepEqual(await client.evaluate('window.editorRuntime'), { projectId: 'owned-project', editSessionId: 'owned-draft' });
  assert.deepEqual(interceptedErrors, []);
});
