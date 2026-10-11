import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AssetConsoleBridge } from '../lib/asset-console-bridge.mjs';
import { EfficiencyBridge } from '../lib/efficiency-bridge.mjs';
import { connectFixtureBrowser, waitForBrowserState } from './helpers/browser-state.mjs';

const [mainSource, editingSource] = await Promise.all([
  readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8'),
  readFile(new URL('../inject/openchatcut.user.js', import.meta.url), 'utf8'),
]);
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

const threadId = '11111111-1111-4111-8111-111111111111';
const mainApi = 'window.__codexConversationPreviewInjection__';
const editingApi = 'window.__aiyouOpenChatCut__';
const panel = '#aiyoucodex-openchatcut';
const iframe = `${panel} iframe`;

// These servers are deterministic transport fixtures, not OpenChatCut or real editing.
test('OpenChatCut panel fixture uses the production CSP proxy, keeps editors alive and shares installation UX', {
  timeout: 45_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Requires isolated Chrome/Chromium',
}, async t => {
  assert.ok(executable, 'Required isolated browser is installed');
  const directory = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'openchatcut-panel-fixture-'));
  const profile = path.join(directory, 'browser');
  const staticRoot = path.join(directory, 'assets');
  const tokenPath = path.join(directory, 'fixture-asset-token');
  const assetToken = randomBytes(24).toString('hex');
  await mkdir(staticRoot);
  await writeFile(tokenPath, assetToken);
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><html><head><title>Fixture assets</title><script src="/app.js"></script></head><body><p>Fixture asset panel</p></body></html>');
  await writeFile(path.join(staticRoot, 'app.js'), 'window.assetFixture={instanceId:crypto.randomUUID()};');
  for (const file of ['asset-metadata-ui.js', 'asset-library-state.js', 'asset-media-lifecycle.js', 'ui-v3.css']) await writeFile(path.join(staticRoot, file), '');

  const editorRequests = [], assetRequests = [], calls = [], networkFailures = [];
  let upstreamOffline = false, restartRecovery = false;
  const editorScript = `window.editorFixture={instanceId:crypto.randomUUID(),hashes:[location.hash],ticks:0,settingsRequests:[],settingsOpens:0,settingsMode:'normal',fakeSettingsReceiver:false};
    addEventListener('hashchange',()=>editorFixture.hashes.push(location.hash));
    setInterval(()=>editorFixture.ticks++,50);
    window.openFixtureModelSettings=()=>{editorFixture.settingsOpens++;let dialog=document.getElementById('fixture-native-model-settings');if(!dialog){dialog=document.createElement('dialog');dialog.id='fixture-native-model-settings';dialog.setAttribute('aria-label','Fixture native model settings');dialog.innerHTML='<p>Native model and API settings fixture</p><button id="fixture-close-model-settings">Close</button>';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();}if(!dialog.open)dialog.showModal();return dialog;};
    addEventListener('message',event=>{if(event.source!==parent||!/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(event.origin)||event.data?.type!=='aiyou-openchatcut:open-model-settings')return;
      editorFixture.settingsRequests.push({requestId:event.data.requestId,origin:event.origin});
      if(!editorFixture.fakeSettingsReceiver||editorFixture.settingsMode==='hold')return;
      const ok=editorFixture.settingsMode!=='error';if(ok)openFixtureModelSettings();parent.postMessage({type:'aiyou-openchatcut:model-settings-result',requestId:event.data.requestId,ok,...(ok?{}:{error:'Fixture native model settings unavailable'})},event.origin);
    });`;
  const editorHtml = `<!doctype html><html><head><title>Fixture editor</title><script src="/fixture-editor.js"></script>
    <style>body{margin:0}.cc-editor-shell{display:grid;height:100vh;grid-template-rows:40px 1fr 1fr 160px}.cc-topbar{display:flex;align-items:center;grid-column:1/6}.cc-chat-panel{grid-column:1;grid-row:2/5}.cc-preview-workspace{grid-column:5;grid-row:2/4}</style></head><body>
    <div class="cc-editor-shell" style="grid-template-columns:25vw 0 28vw 0 minmax(0, 1fr)">
      <header class="cc-topbar"><div class="cc-topbar-actions"><button id="fixture-export">Export</button></div></header>
      <aside class="cc-chat-panel" data-cc-shortcut-surface="agent-chat"><p>Agent workbench</p></aside>
      <div style="grid-column:2;grid-row:2/5"></div>
      <div id="fixture-media" data-cc-shortcut-surface="media-pool" style="grid-column:3;grid-row:2/4">Media<div class="cc-media-export-guide" role="note">Music models guide</div><div class="cc-media-export-guide">Download guide</div><div class="cc-media-error">Missing file</div></div><div style="grid-column:4;grid-row:2/4"></div>
      <div class="cc-preview-workspace">Preview</div><div id="fixture-timeline" style="grid-column:3/6;grid-row:4/5">Timeline</div>
    </div></body></html>`;
  let editorOrigin;
  const editorServer = createServer(async (request, response) => {
    if (upstreamOffline) { request.socket.destroy(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    editorRequests.push({ url: request.url, method: request.method, origin: request.headers.origin, host: request.headers.host, body: Buffer.concat(chunks).toString() });
    if (request.url.startsWith('/api/')) {
      if (request.headers.origin !== editorOrigin) { response.writeHead(403); response.end('Fixture rejected an incorrect Origin'); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ kind: 'editor', route: request.url, origin: request.headers.origin, receivedBody: Buffer.concat(chunks).toString() }));
    } else if (request.url === '/fixture-editor.js') {
      response.setHeader('content-type', 'text/javascript;charset=utf-8'); response.end(editorScript);
    } else if (request.url.endsWith('/SettingsDialog-8GsumHR8.js')) {
      response.setHeader('content-type', 'text/javascript;charset=utf-8');
      response.end('export function SettingsDialog(){return window.openFixtureModelSettings()}');
    } else if (request.url.endsWith('/react-DUVq_3mI.js')) {
      response.setHeader('content-type', 'text/javascript;charset=utf-8');
      response.end('export function i(){return{createElement(Component,props){return{Component,props}}}}export function n(){return{createRoot(host){return{render(view){const dialog=view.Component(view.props);host.append(dialog);if(!dialog.open)dialog.showModal();dialog.querySelector("button").onclick=()=>{dialog.close();view.props.onClose()};},unmount(){host.replaceChildren()}}}}}');
    } else {
      response.setHeader('content-type', 'text/html;charset=utf-8');
      response.end(editorHtml);
    }
  });
  const assetServer = createServer((request, response) => {
    assetRequests.push({ url: request.url, token: request.headers['x-asset-console-token'], origin: request.headers.origin });
    if (request.url.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ kind: 'asset', route: request.url }));
    } else { response.setHeader('content-type', 'text/html'); response.end('<p>Fixture asset service ready</p>'); }
  });
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src https://web-sandbox.oaiusercontent.com; connect-src 'self' https://web-sandbox.oaiusercontent.com; img-src 'self' data: https:";
  const nativeHtml = `<style>*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;font:14px sans-serif}aside{width:220px;flex:none}main{height:100vh;flex:1;min-width:0;display:flex}#native-chat{flex:1;min-width:0}#native-rail{width:52px;display:flex;flex-direction:column;flex:none}#rail-scroll{display:flex;flex-direction:column;flex:1;overflow:auto}button{min-height:28px}</style>
    <nav id="native-rail" data-app-navigation-rail="true" aria-label="App navigation"><div id="rail-scroll"><button data-sidebar-destination="Home">Home</button></div><button aria-label="Profile">P</button></nav>
    <aside id="app-shell-sidebar"><nav><button aria-label="New chat">New chat</button><div data-app-action-sidebar-scroll><button aria-label="Plugins">Plugins</button><div data-app-action-sidebar-thread-row data-app-action-sidebar-thread-active="true" data-app-action-sidebar-thread-id="${threadId}" data-app-action-sidebar-thread-title="Fixture conversation">Fixture conversation</div></div></nav></aside>
    <main><div id="native-chat"><div data-composer-body><div id="draft" contenteditable="true">保留原有聊天草稿</div><button>发送</button></div></div></main>`;
  const nativeServer = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html;charset=utf-8'); response.setHeader('content-security-policy', csp); response.end(nativeHtml);
  });
  const servers = [editorServer, assetServer, nativeServer];
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  editorOrigin = `http://127.0.0.1:${editorServer.address().port}`;
  const nativeOrigin = `http://127.0.0.1:${nativeServer.address().port}`;
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1100', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let client, assetBridge, editingBridge, finishInstall, finishOpen, holdOpen = false;
  t.after(async () => {
    finishInstall?.({ state: 'installed', installed: true, version: 'fixture' });
    finishOpen?.();
    editingBridge?.dispose();
    await assetBridge?.dispose();
    client?.close();
    browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: nativeOrigin }));
  client.on('Network.loadingFailed', (event, meta) => networkFailures.push({ ...event, sessionId: meta.sessionId }));
  await client.evaluate(mainSource); await client.evaluate(editingSource);
  assetBridge = new AssetConsoleBridge({ staticRoot, tokenPath, port: assetServer.address().port,
    openChatCutStatus: async () => ({ installed: true, baseUrl: editorOrigin }) });
  await assetBridge.install(client);
  let installation = { state: 'not-installed', installed: false, message: '尚未安装 OpenChatCut' };
  let editingProject = 'project-a';
  editingBridge = new EfficiencyBridge({ request: async request => {
    calls.push(request);
    if (request.action === 'stop') return { ...installation, type: 'stopped', state: 'stopped', stopped: true, running: false,
      message: 'OpenChatCut 已彻底关闭，项目已保留', session: { projectId: editingProject, threadId: request.threadId, connected: false } };
    if (request.action === 'install') return new Promise(resolve => { finishInstall = resolve; });
    if (request.action !== 'open' || !installation.installed) return installation;
    if (holdOpen) await new Promise(resolve => { finishOpen = resolve; });
    const editorUrl = await assetBridge.embedOpenChatCut(`${editorOrigin}/#/editor/${editingProject}`);
    return { ...installation, type: 'editing', threadId: request.threadId, projectId: editingProject, editorUrl,
      ...(restartRecovery ? { reconnectEditor: true, serviceRestarted: true, editorDisconnected: true, reconnectId: 'menu-restart-fixture',
        session: { threadId: request.threadId, projectId: editingProject, editSessionId: 'durable-pending-draft' } } : {}) };
  } }, { binding: '__AIYOUCODEX_OPENCHATCUT_REQUEST__', resolver: 'resolveOpenChatCutRequest' });
  await editingBridge.install(client);
  await client.evaluate(`${editingApi}.update(${JSON.stringify(installation)})`);

  async function click(selector) {
    const action = /\[data-occ-(settings|close|stop)\]/.exec(selector)?.[1] || (selector.includes('[data-aiyou-panel-expand]') ? 'expand' : null);
    if (action && await client.evaluate(`!!document.querySelector('${iframe}')`)) {
      const proxy = assetBridge.openChatCutProxy;
      // Resize crosses the OOPIF compositor boundary. Wait for its new
      // surface and move the mouse before issuing a second toolbar click.
      const painted = 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))';
      await client.evaluate(painted); await evaluateFrame(proxy, painted);
      const target = `[data-aiyou-openchatcut-host-action="${action}"]`;
      const point = await evaluateFrame(proxy, `(()=>{const e=document.querySelector(${JSON.stringify(target)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),disabled:e.disabled}})()`);
      if (point) {
        assert.ok(point.hit, 'The native toolbar action receives a real mouse click');
        const offset = await client.evaluate(`(()=>{const r=document.querySelector('${iframe}').getBoundingClientRect();return{x:r.x,y:r.y}})()`);
        const parentHit = await client.evaluate(`document.elementFromPoint(${offset.x + point.x},${offset.y + point.y})===document.querySelector('${iframe}')`);
        assert.ok(parentHit, `Native ${action} mouse coordinate is inside the visible iframe: ${JSON.stringify({ point, offset })}`);
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: offset.x + point.x, y: offset.y + point.y });
        for (const type of ['mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x: offset.x + point.x, y: offset.y + point.y, button: 'left', clickCount: 1 });
      } else {
        // Fault-injection sections deliberately destroy the child receiver.
        // Invoke the retained parent action to test its bounded error handling.
        await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      }
      return;
    }
    const point = await client.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2,hit:element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))}})()`);
    assert.ok(point?.hit, `${selector} receives a real mouse click`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  async function evaluateFrame(proxy, expression) {
    assert.ok(proxy.assetSessions.size, 'The production proxy activated the embedded iframe session');
    let lastError;
    for (const sessionId of proxy.assetSessions) {
      try {
        const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Fixture iframe evaluation failed');
        return result.result?.value;
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }
  async function waitForFrame(proxy, expression, message) {
    await waitForBrowserState({ evaluate: value => evaluateFrame(proxy, value) }, expression, message, 7000);
  }
  async function messageListenerCount() {
    const { result } = await client.send('Runtime.evaluate', { expression: 'window' });
    try { return (await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.filter(listener => listener.type === 'message').length; }
    finally { await client.send('Runtime.releaseObject', { objectId: result.objectId }); }
  }

  await waitForBrowserState(client, "!!document.querySelector('[data-codex-shortcut-sort-key=\"enhancement:openchatcut\"]')", 'The production sidebar exposes OpenChatCut');
  // The local URL is rejected by CSP before the production proxy is used.
  await client.evaluate(`window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>cspViolations.push(e.violatedDirective));const forbidden=document.createElement('iframe');forbidden.id='fixture-denied-local';forbidden.src=${JSON.stringify(editorOrigin)};document.getElementById('native-chat').append(forbidden)`);
  await waitForBrowserState(client, "cspViolations.some(value=>value.startsWith('frame-src'))", 'Native-style CSP blocks a direct localhost editor');
  assert.equal(editorRequests.length, 0, 'No denied localhost iframe reached the fixture upstream');
  await client.evaluate("document.getElementById('fixture-denied-local').remove()");

  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState(client, `document.querySelector('${panel}')?.hidden===false&&document.querySelector('${panel} [data-occ-primary]')?.textContent==='一键下载安装'`, 'An uninstalled sidebar entry offers installation');
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')===null`), true);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').disabled`), true, 'The native model gear is disabled before installation and connection');
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').getAttribute('aria-label')`), 'OpenChatCut 模型与 API 设置');
  await click(`${panel} [data-occ-settings]`);
  assert.equal(await client.evaluate("!!document.querySelector('#codex-sidebar-shortcut-settings-dialog')?.open"), false, 'The disabled model gear never opens AIYOUcodex settings');
  await click('[aria-label="打开 AIYOUcodex 设置"]');
  await waitForBrowserState(client, "document.querySelector('[data-aiyou-openchatcut-settings] [data-occ-install]')?.disabled===false", 'Settings contains the enabled one-click installation entry');
  await client.evaluate(`${editingApi}.update({state:'unsupported',installed:false,supported:false,message:'Fixture platform needs manual installation'})`);
  assert.equal(await client.evaluate("document.querySelector('[data-occ-install]').disabled&&document.querySelector('[data-occ-open]').disabled"), true);
  assert.equal(await client.evaluate("document.querySelector('[data-aiyou-openchatcut-settings] a')?.href"), 'https://github.com/0xsline/OpenChatCut/releases/latest', 'Unsupported platforms get the official manual installation entry');
  await client.evaluate(`${editingApi}.update({state:'failed',installed:false,supported:true,message:'Fixture download failed'})`);
  assert.equal(await client.evaluate("document.querySelector('[data-occ-install]').textContent"), '重试安装');
  assert.equal(await client.evaluate("document.querySelector('[data-occ-install]').disabled"), false);
  assert.equal(calls.filter(request => request.action === 'install').length, 0, 'A failed status does not resubmit installation automatically');
  await client.evaluate(`${editingApi}.update({state:'installed',installed:true})`);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').disabled`), true, 'Installation alone does not enable an unconnected model gear');
  await client.evaluate(`${editingApi}.update(${JSON.stringify(installation)})`);
  await click('[data-aiyou-openchatcut-settings] [data-occ-install]');
  await waitForBrowserState(client, "document.querySelector('[data-aiyou-openchatcut-settings] [data-occ-install]')?.disabled===true", 'Installation locks its initiating button');
  assert.equal(calls.filter(request => request.action === 'install').length, 1);
  installation = { state: 'downloading', installed: false, progress: { percent: 37 }, message: '正在下载官方组件' };
  await client.evaluate(`${editingApi}.update(${JSON.stringify(installation)})`);
  assert.match(await client.evaluate("document.querySelector('[data-occ-setting-status]').textContent"), /37%/);
  assert.match(await client.evaluate(`document.querySelector('${panel} [data-occ-status]').textContent`), /37%/);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-primary]').disabled`), true, 'Both panel and settings use the same installation state');
  await client.evaluate(`document.querySelector('[data-occ-install]').click();document.querySelector('${panel} [data-occ-primary]').click()`);
  assert.equal(calls.filter(request => request.action === 'install').length, 1, 'Repeated disabled clicks cannot request another download');
  installation = { state: 'installed', installed: true, version: 'fixture', message: 'Fixture component ready' };
  finishInstall(installation); finishInstall = null;
  await waitForBrowserState(client, "document.querySelector('[data-occ-install]')?.textContent==='已安装'", 'The same installation completion is shown in settings');
  await click('[data-codex-shortcut-settings-close]');

  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState(client, `document.querySelector('${iframe}')?.src.startsWith('https://web-sandbox.oaiusercontent.com/__codex_asset_console__/')&&document.querySelector('${panel}').dataset.editorLoaded==='true'`, 'The real proxy opens an opaque HTTPS iframe under the native CSP', 10000);
  const editorProxy = assetBridge.openChatCutProxy;
  await waitForFrame(editorProxy, '!!window.editorFixture', 'The upstream fixture script loads through the production HTML proxy');
  let instance = await evaluateFrame(editorProxy, 'editorFixture.instanceId');
  await waitForFrame(editorProxy, 'getComputedStyle(document.querySelector(".cc-chat-panel")).display==="none"', 'The hosted editor hides its Agent workbench');
  await waitForFrame(editorProxy, '!document.querySelector("[data-aiyou-openchatcut-host-action=settings]").disabled', 'The exact owned parent enables the native toolbar controls');
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('${panel} .occ-header')).display`), 'none', 'The redundant outer header is removed from the loaded editor layout');
  assert.deepEqual(await evaluateFrame(editorProxy, '[...document.querySelector(".cc-topbar").firstElementChild.children].map(e=>e.getAttribute("data-aiyou-openchatcut-host-action"))'), ['stop', 'settings', 'close', 'expand'], 'All host controls occupy the native topbar left side');
  await client.evaluate(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://web-sandbox.oaiusercontent.com',data:{type:'aiyou-openchatcut:host-action',action:'stop'}}));window.dispatchEvent(new MessageEvent('message',{source:document.querySelector('${iframe}').contentWindow,origin:'https://unrelated.test',data:{type:'aiyou-openchatcut:host-action',action:'close'}}))`);
  assert.equal(calls.filter(request => request.action === 'stop').length, 0, 'Forged child actions cannot stop the backend');
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), false, 'A forged origin cannot close the panel');
  await click(`${panel} [data-aiyou-panel-expand]`);
  await waitForBrowserState(client, `document.querySelector('${panel}').dataset.aiyouPanelExpanded==='true'`, 'The native left toolbar expands the host panel');
  await waitForFrame(editorProxy, 'document.querySelector("[data-aiyou-openchatcut-host-action=expand]").getAttribute("aria-pressed")==="true"', 'Expanded state is returned to the child control');
  await click(`${panel} [data-aiyou-panel-expand]`);
  await waitForBrowserState(client, `document.querySelector('${panel}').dataset.aiyouPanelExpanded!=='true'`, 'The same native action restores the sidebar');
  const layout = await evaluateFrame(editorProxy, '(()=>{const s=document.querySelector(".cc-editor-shell");return{columns:getComputedStyle(s).gridTemplateColumns,media:document.getElementById("fixture-media").getBoundingClientRect().width,preview:document.querySelector(".cc-preview-workspace").getBoundingClientRect().width,timeline:document.getElementById("fixture-timeline").getBoundingClientRect().width,exportVisible:document.getElementById("fixture-export").getBoundingClientRect().width>0};})()');
  assert.match(layout.columns, /^0px 0px /);
  assert.ok(layout.media > 0 && layout.preview > 0 && layout.timeline > layout.media && layout.exportVisible, 'Media, preview, timeline and native export remain usable');
  await client.evaluate(`window.firstEditorFrame=document.querySelector('${iframe}')`);
  await waitForBrowserState(client, `document.querySelector('${panel} [data-occ-settings]').disabled===false`, 'The loaded controlled editor enables native model settings');
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').title`), 'OpenChatCut 模型与 API 设置');
  await click(`${panel} [data-occ-settings]`);
  await waitForFrame(editorProxy, "document.getElementById('fixture-native-model-settings')?.open===true", 'A real native topbar gear click opens the fixture native model settings dialog');
  await waitForBrowserState(client, `document.querySelector('${panel} [data-occ-settings]').disabled===false`, 'The owned iframe acknowledges the model settings request');
  assert.equal(await evaluateFrame(editorProxy, 'editorFixture.settingsOpens'), 1, 'A model settings click invokes the native opener once');
  assert.equal(await client.evaluate("!!document.querySelector('#codex-sidebar-shortcut-settings-dialog')?.open"), false, 'Native model settings never open the AIYOUcodex installation dialog');
  await evaluateFrame(editorProxy, "document.getElementById('fixture-close-model-settings').click()");
  assert.equal(await evaluateFrame(editorProxy, "document.getElementById('fixture-native-model-settings')?.open||false"), false);
  assert.equal(await evaluateFrame(editorProxy, 'editorFixture.instanceId'), instance, 'Closing native model settings preserves the active editor document');
  assert.equal(await evaluateFrame(editorProxy, 'location.hash'), '#/editor/project-a');

  // Replace only the fixture's native receiver to exercise held and failed
  // replies. The production CSP, iframe and upstream proxy remain intact.
  await evaluateFrame(editorProxy, 'window.__aiyouOpenChatCutHostMode__.destroy();editorFixture.fakeSettingsReceiver=true;editorFixture.settingsMode="error"');
  await click(`${panel} [data-occ-settings]`);
  await waitForBrowserState(client, `document.querySelector('${panel} [data-occ-model-settings-error]')?.textContent==='Fixture native model settings unavailable'`, 'Native settings failures are visible outside the hidden welcome screen');
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-model-settings-error]').hidden`), false);
  assert.equal(await client.evaluate("!!document.querySelector('#codex-sidebar-shortcut-settings-dialog')?.open"), false);

  const listeners = await messageListenerCount();
  await client.evaluate(`window.originalEditingApi=${editingApi};delete ${editingApi}.version;window.__aiyouOpenChatCutModelSettings__.dispose();delete document.querySelector('${panel}').dataset.editorLoaded;const gear=document.querySelector('${panel} [data-occ-settings]');gear.onclick=()=>${mainApi}.openShortcutSettings();gear.title='Legacy installation settings'`);
  await client.evaluate(editingSource);
  assert.equal(await client.evaluate(`${editingApi}===window.originalEditingApi&&document.querySelector('${iframe}')===window.firstEditorFrame`), true, 'Upgrading a legacy action helper preserves the original API and iframe');
  assert.equal(await messageListenerCount(), listeners, 'Legacy action upgrade restores one settings listener');
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').disabled`), false, 'A retained legacy editor without a load marker receives a working native settings action');
  await evaluateFrame(editorProxy, 'editorFixture.settingsMode="hold"');
  const requestCount = await evaluateFrame(editorProxy, 'editorFixture.settingsRequests.length');
  await click(`${panel} [data-occ-settings]`);
  await waitForFrame(editorProxy, `editorFixture.settingsRequests.length===${requestCount + 1}`, 'The model action sends one request to the current owned iframe');
  const settingsRequest = await evaluateFrame(editorProxy, 'editorFixture.settingsRequests.at(-1)');
  assert.match(settingsRequest.requestId, /^occ-settings-[a-f0-9-]{36}$/);
  assert.equal(settingsRequest.origin, nativeOrigin);
  await client.evaluate(editingSource); await client.evaluate(editingSource);
  assert.equal(await messageListenerCount(), listeners, 'Warm reexecution adds no duplicate model settings listeners');
  assert.equal(await client.evaluate(`${editingApi}===window.originalEditingApi&&document.querySelector('${iframe}')===window.firstEditorFrame&&document.querySelector('${panel} [data-occ-settings]').disabled`), true, 'Warm reexecution retains the pending request and mounted editor');
  assert.equal(await evaluateFrame(editorProxy, 'editorFixture.instanceId'), instance);
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');
  const forgedResult = { type: 'aiyou-openchatcut:model-settings-result', requestId: settingsRequest.requestId, ok: false, error: 'Forged settings failure' };
  await client.evaluate(`window.dispatchEvent(new MessageEvent('message',{source:window.firstEditorFrame.contentWindow,origin:'https://unrelated.test',data:${JSON.stringify(forgedResult)}}));window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://web-sandbox.oaiusercontent.com',data:${JSON.stringify(forgedResult)}}))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').disabled&&document.querySelector('${panel} [data-occ-model-settings-error]').hidden`), true, 'Replies with a forged origin or a different source cannot settle the request');
  await evaluateFrame(editorProxy, `parent.postMessage({type:'aiyou-openchatcut:model-settings-result',requestId:${JSON.stringify(settingsRequest.requestId)},ok:true},${JSON.stringify(nativeOrigin)})`);
  await waitForBrowserState(client, `document.querySelector('${panel} [data-occ-settings]').disabled===false`, 'The current owned iframe can settle the retained request after a warm upgrade');
  await evaluateFrame(editorProxy, 'editorFixture.settingsMode="normal"');
  const opens = await evaluateFrame(editorProxy, 'editorFixture.settingsOpens');
  await click(`${panel} [data-occ-settings]`);
  await waitForFrame(editorProxy, `document.getElementById('fixture-native-model-settings').open&&editorFixture.settingsOpens===${opens + 1}`, 'The upgraded gear still opens one native dialog per mouse click');
  await evaluateFrame(editorProxy, "document.getElementById('fixture-close-model-settings').click()");
  assert.equal(editorRequests.filter(request => request.url === '/').length, 1, 'Warm script upgrades do not reload the current project');
  const bootstrap = await evaluateFrame(editorProxy, "fetch('/api/external-agent/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixture:true})}).then(r=>r.json())");
  assert.equal(bootstrap.kind, 'editor'); assert.equal(bootstrap.origin, editorOrigin);
  assert.equal(JSON.parse(bootstrap.receivedBody).fixture, true, 'POST data is preserved while Origin is rewritten to the local upstream');
  assert.equal(editorRequests.find(request => request.url === '/api/external-agent/bootstrap').host, new URL(editorOrigin).host);

  const switchedUrl = await assetBridge.embedOpenChatCut(`${editorOrigin}/#/editor/project-b`);
  editingProject = 'project-b';
  await client.evaluate(`${editingApi}.update(${JSON.stringify({ type: 'editing', threadId, projectId: 'project-b', editorUrl: switchedUrl })})`);
  await waitForFrame(editorProxy, "location.hash==='#/editor/project-b'&&editorFixture.hashes.includes('#/editor/project-b')", 'A trusted conversation project change creates a newly bound document');
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')===window.firstEditorFrame`), false);
  assert.notEqual(await evaluateFrame(editorProxy, 'editorFixture.instanceId'), instance, 'The previous project document cannot silently rebind');
  assert.equal(editorRequests.filter(request => request.url === '/').length, 2, 'A changed project receives its own document binding');
  instance = await evaluateFrame(editorProxy, 'editorFixture.instanceId');
  await client.evaluate(`window.firstEditorFrame=document.querySelector('${iframe}')`);

  const ticks = await evaluateFrame(editorProxy, 'editorFixture.ticks');
  await click(`${panel} [data-occ-close]`);
  await client.evaluate(`${editingApi}.update({type:'editing',autoOpen:false,threadId:${JSON.stringify(threadId)},editorUrl:document.querySelector('${iframe}').src})`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true, 'A late sidebar controller event preserves the explicit close');
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden&&window.firstEditorFrame.isConnected`), true);
  await waitForFrame(editorProxy, `editorFixture.ticks>${ticks}`, 'Closing the view keeps the mounted editor alive');
  await client.evaluate(`${mainApi}.openAssetConsolePanel()`);
  await waitForBrowserState(client, "document.querySelector('#codex-asset-console-page')?.hidden===false&&!!document.querySelector('#codex-asset-console-frame')", 'The asset panel opens alongside the retained editor', 10000);
  const assetProxy = assetBridge.proxy;
  await waitForFrame(assetProxy, '!!window.assetFixture', 'The asset proxy remains operational after the editor proxy starts');
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden&&window.firstEditorFrame.isConnected`), true);
  const [editorData, assetData] = await Promise.all([
    evaluateFrame(editorProxy, "fetch('/api/shared').then(r=>r.json())"),
    evaluateFrame(assetProxy, "fetch('/api/shared').then(r=>r.json())"),
  ]);
  assert.equal(editorData.kind, 'editor'); assert.equal(assetData.kind, 'asset', 'Same-path requests stay bound to their respective iframe transports');
  assert.equal(assetRequests.find(request => request.url === '/api/shared').token, assetToken);
  assert.equal(assetRequests.find(request => request.url === '/api/shared').origin, undefined, 'Asset transport retains its existing Origin policy');
  await client.evaluate(`${editingApi}.update(${JSON.stringify({ type: 'editing', threadId, projectId: 'project-b', editorUrl: switchedUrl, toolName: 'fixture_split' })})`);
  await waitForBrowserState(client, `document.querySelector('${panel}').hidden===false&&document.querySelector('#codex-asset-console-page').hidden===true`, 'An editing event brings the editor back and hides other panels');
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')===window.firstEditorFrame`), true);
  assert.equal(await evaluateFrame(editorProxy, 'editorFixture.instanceId'), instance);
  assert.equal((await evaluateFrame(assetProxy, "fetch('/api/shared?retained=1').then(r=>r.json())")).kind, 'asset', 'The hidden asset frame also keeps its transport');
  assert.match(await client.evaluate(`document.querySelector('${panel} .occ-sync').textContent`), /fixture_split/);
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');
  assert.equal(networkFailures.filter(event => editorProxy.assetSessions.has(event.sessionId) || assetProxy.assetSessions.has(event.sessionId)).length, 0, 'The coexisting proxies do not fail each other’s iframe requests');

  // Rebuild only the CDP proxy transport. The mounted UI and editor document
  // must stay intact; assigning another iframe src would conceal this failure.
  await evaluateFrame(editorProxy, 'window.__aiyouOpenChatCutHostMode__?.destroy();editorFixture.settingsMode="hold"');
  assert.notEqual(await evaluateFrame(editorProxy, 'getComputedStyle(document.querySelector(".cc-chat-panel")).display'), 'none');
  await click(`${panel} [data-occ-settings]`);
  await waitForBrowserState(client, `document.querySelector('${panel} [data-occ-model-settings-error]')?.textContent==='OpenChatCut 模型设置未响应，请稍后重试。'`, 'An unanswered settings request times out visibly within ten seconds', 11_000);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-settings]').disabled`), false, 'A timed-out settings action can be retried');
  await evaluateFrame(editorProxy, 'editorFixture.fakeSettingsReceiver=false;editorFixture.settingsMode="normal"');
  await assetBridge.dispose();
  await assetBridge.install(client);
  assert.ok(assetBridge.openChatCutProxy, 'A new host install restores the retained OpenChatCut transport without an open/tool request');
  const restoredUrl = await assetBridge.embedOpenChatCut(`${editorOrigin}/#/editor/project-b`);
  assert.equal(restoredUrl, switchedUrl, 'Transport reconstruction reuses the mounted editor’s opaque URL');
  const restoredEditorProxy = assetBridge.openChatCutProxy;
  const restoredAssetProxy = assetBridge.proxy;
  assert.equal(restoredEditorProxy.token, editorProxy.token);
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')===window.firstEditorFrame&&window.firstEditorFrame.src===${JSON.stringify(switchedUrl)}`), true);
  await waitForFrame(restoredEditorProxy, '!!window.editorFixture', 'The reconstructed transport adopts the existing editor iframe session');
  await waitForFrame(restoredEditorProxy, 'getComputedStyle(document.querySelector(".cc-chat-panel")).display==="none"&&document.querySelectorAll("#aiyou-openchatcut-host-style").length===1', 'Adoption reapplies the host mode in the retained document');
  assert.equal(await evaluateFrame(restoredEditorProxy, 'editorFixture.instanceId'), instance, 'CDP transport reconstruction does not reload the editor document');
  const reconnected = await evaluateFrame(restoredEditorProxy, "fetch('/api/reconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reconnected:true})}).then(r=>r.json())");
  assert.equal(reconnected.kind, 'editor'); assert.equal(reconnected.origin, editorOrigin);
  assert.equal(JSON.parse(reconnected.receivedBody).reconnected, true, 'POST APIs work after adoption without manually reloading the iframe');
  assert.equal((await evaluateFrame(restoredAssetProxy, "fetch('/api/shared?transport-restored=1').then(r=>r.json())")).kind, 'asset');
  assert.equal(editorRequests.filter(request => request.url === '/').length, 2, 'Proxy restoration never fetched a new editor document');

  // Loading a new document after transport restoration must still reach the
  // local editor. Merely preserving an old DOM would miss BlobNotFound pages.
  await evaluateFrame(restoredEditorProxy, 'location.reload();true');
  await waitForFrame(restoredEditorProxy, `!!window.editorFixture&&editorFixture.instanceId!==${JSON.stringify(instance)}&&location.hash==='#/editor/project-b'`, 'A cold reload after host reconnection reaches the same local project');
  await waitForFrame(restoredEditorProxy, 'getComputedStyle(document.querySelector(".cc-chat-panel")).display==="none"', 'The reloaded editor installs host mode');
  assert.equal(editorRequests.filter(request => request.url === '/').length, 3);
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')===window.firstEditorFrame`), true, 'Cold reload retains the iframe element and project URL');
  await click(`${panel} [data-occ-settings]`);
  await waitForFrame(restoredEditorProxy, "document.getElementById('fixture-native-model-settings')?.open===true", 'The model gear also works in a new editor document');
  await evaluateFrame(restoredEditorProxy, "document.getElementById('fixture-close-model-settings').click()");
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');

  // A full feature teardown intentionally removes the view. A fresh install
  // must reconnect through a new transport and reopen the current project.
  await client.evaluate(`${editingApi}.destroy();${mainApi}.destroy()`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}')===null&&document.getElementById('aiyou-openchatcut-style')===null`), true);
  editingBridge.dispose();
  await assetBridge.dispose();
  assert.equal(assetBridge.proxies.size, 0);
  assert.equal(restoredEditorProxy.cancelled && restoredAssetProxy.cancelled, true, 'Full teardown cancels both owned transports');
  await client.evaluate(mainSource); await client.evaluate(editingSource);
  await assetBridge.install(client); await editingBridge.install(client);
  await client.evaluate(`${editingApi}.update(${JSON.stringify(installation)})`);
  await waitForBrowserState(client, "!!document.querySelector('[data-codex-shortcut-sort-key=\"enhancement:openchatcut\"]')", 'Reinstallation restores the sidebar entry');
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState(client, `document.querySelector('${panel}')?.dataset.editorLoaded==='true'`, 'A fresh feature installation can reopen the editor', 10000);
  const recoveredProxy = assetBridge.openChatCutProxy;
  await waitForFrame(recoveredProxy, "!!window.editorFixture&&location.hash==='#/editor/project-b'", 'Explicit reopening recovers the current project through a fresh transport');
  assert.notEqual(recoveredProxy.token, editorProxy.token);
  assert.equal(await client.evaluate(`document.querySelectorAll('${iframe}').length`), 1);
  assert.equal(await client.evaluate("document.querySelectorAll('#aiyou-openchatcut-style').length"), 1);
  assert.equal(await client.evaluate("window.firstEditorFrame.isConnected"), false);
  assert.equal((await evaluateFrame(recoveredProxy, "fetch('/api/shared?recovered=1').then(r=>r.json())")).kind, 'editor');
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');
  // Retain a previous conversation's mounted editor while a new open is slow.
  // The real sidebar must stay visible across the one-second route guard.
  await client.evaluate(`window.fixtureActiveThread='22222222-2222-4222-8222-222222222222';${mainApi}.getActiveTaskContext=()=>({threadId:window.fixtureActiveThread});${editingApi}.close()`);
  editingProject = 'project-c'; holdOpen = true;
  const openCount = calls.filter(request => request.action === 'open').length;
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState({ evaluate: async () => calls.filter(request => request.action === 'open').length > openCount }, 'true', 'The new conversation sends an open request');
  await delay(1300);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), false, 'A slow open after changing conversation stays visible instead of closing on the old owner');
  finishOpen(); finishOpen = null; holdOpen = false;
  await waitForBrowserState(client, `document.querySelector('${panel}').hidden===false&&${editingApi}.snapshot().state.threadId===window.fixtureActiveThread&&document.querySelector('${iframe}').src.endsWith('#/editor/project-c')`, 'The matching completed open installs the new conversation editor');
  await delay(1100);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), false);

  // Closing the panel while an open is in flight must also remain closed.
  holdOpen = true;
  await client.evaluate(`${editingApi}.close()`);
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState({ evaluate: async () => !!finishOpen }, 'true', 'The delayed reopen is pending');
  await click(`${panel} [data-occ-close]`);
  await client.evaluate(`${editingApi}.update({type:'editing',autoOpen:false,threadId:window.fixtureActiveThread,editorUrl:document.querySelector('${iframe}').src})`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true);
  finishOpen(); finishOpen = null; holdOpen = false;
  await delay(1400);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true, 'Late completion never reopens an explicitly closed view');
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState(client, `document.querySelector('${panel}').hidden===false`, 'The user can reopen after cancelling visibility');
  // A second conversation open queues behind a pending first one, and its
  // old response cannot close or navigate the new visible view.
  holdOpen = true;
  await client.evaluate(`window.fixtureActiveThread='33333333-3333-4333-8333-333333333333';${editingApi}.close()`);
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForBrowserState({ evaluate: async () => !!finishOpen }, 'true', 'A first conversation open waits');
  await client.evaluate(`window.fixtureActiveThread='44444444-4444-4444-8444-444444444444';${editingApi}.open();${editingApi}.update({type:'editing',autoOpen:false,threadId:'33333333-3333-4333-8333-333333333333',editorUrl:document.querySelector('${iframe}').src})`);
  await delay(1200);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), false, 'The queued latest open stays visible while the previous request finishes');
  holdOpen = false; finishOpen(); finishOpen = null;
  await waitForBrowserState(client, `${editingApi}.snapshot().state.threadId===window.fixtureActiveThread&&document.querySelector('${panel}').hidden===false`, 'The queued open completes for the current conversation');
  assert.equal(calls.filter(request => request.action === 'open').at(-1).threadId, '44444444-4444-4444-8444-444444444444');
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');
  await waitForFrame(recoveredProxy, "!!window.editorFixture&&location.hash==='#/editor/project-c'", 'The current conversation editor is loaded');
  const beforeReconnect = await evaluateFrame(recoveredProxy, 'editorFixture.instanceId');
  await client.evaluate(`window.fixtureRecovery={type:'editing',state:'connecting',autoOpen:false,threadId:window.fixtureActiveThread,
    editorUrl:document.querySelector('${iframe}').src,reconnectEditor:true,reconnectId:'fixture-reconnect',
    session:{threadId:window.fixtureActiveThread,projectId:'project-c',editSessionId:'pending-draft'}};${editingApi}.update(window.fixtureRecovery)`);
  assert.equal(await evaluateFrame(recoveredProxy, 'editorFixture.instanceId'), beforeReconnect, 'A pending draft prevents automatic document reload');
  await client.evaluate(`window.fixtureRecovery.session.editSessionId=null;${editingApi}.update(window.fixtureRecovery)`);
  await waitForFrame(recoveredProxy, `!!window.editorFixture&&editorFixture.instanceId!==${JSON.stringify(beforeReconnect)}&&location.hash==='#/editor/project-c'`, 'A verified disconnection reloads only the current original project');
  const recoveredDocumentId = await evaluateFrame(recoveredProxy, 'editorFixture.instanceId');
  assert.equal(await client.evaluate(`new URL(document.querySelector('${iframe}').src).searchParams.has('aiyou_occ_reconnect')`), false, 'Recovery uses the unchanged host-approved address without a synthetic query');
  await client.evaluate(`${editingApi}.update(window.fixtureRecovery)`);
  assert.equal(await evaluateFrame(recoveredProxy, 'editorFixture.instanceId'), recoveredDocumentId, 'A repeated recovery event does not reload again');
  await client.evaluate(`delete ${editingApi}.version`);
  await client.evaluate(editingSource);
  await client.evaluate(`${editingApi}.update({...window.fixtureRecovery,reconnectEditor:false})`);
  assert.equal(await evaluateFrame(recoveredProxy, 'editorFixture.instanceId'), recoveredDocumentId, 'A runtime handoff retains the recovered document and its logical project URL');

  // Reproduce the user's failed document after the desktop process goes away.
  // A real sidebar click must restore this same address after cold start,
  // even with a durable draft pointer and no usable error-page JS runtime.
  upstreamOffline = true;
  await client.evaluate(`document.querySelector('${iframe}').src=document.querySelector('${iframe}').src`);
  await delay(300);
  await waitForBrowserState({ evaluate: async () => recoveredProxy.transfers.size === 0 }, 'true', 'The failed navigation finishes');
  const failedFrame = await client.evaluate(`window.failedMenuFrame=document.querySelector('${iframe}');true`);
  assert.equal(failedFrame, true);
  upstreamOffline = false; restartRecovery = true;
  await click('[data-codex-shortcut-sort-key="enhancement:openchatcut"]');
  await waitForFrame(recoveredProxy, `!!window.editorFixture&&location.hash==='#/editor/project-c'&&editorFixture.instanceId!==${JSON.stringify(recoveredDocumentId)}`, 'Menu cold-start restores a failed document on the original project');
  assert.equal(await client.evaluate(`document.querySelector('${iframe}')!==window.failedMenuFrame&&${editingApi}.snapshot().state.session.editSessionId==='durable-pending-draft'`), true, 'Cold restart reloads the failed document while preserving its durable draft');
  restartRecovery = false;
  assert.equal(await client.evaluate("document.getElementById('draft').textContent"), '保留原有聊天草稿');
  assert.equal(calls.filter(request => request.action === 'stop').length, 0, 'Normal panel closes and reconnects never stop the service');
  assert.equal(await evaluateFrame(recoveredProxy, 'document.querySelector("[data-aiyou-openchatcut-host-action=stop]").nextElementSibling.getAttribute("data-aiyou-openchatcut-host-action")==="settings"'), true, 'Power button is immediately left of the gear inside the native topbar');
  await evaluateFrame(recoveredProxy, `window.fixtureDirty=true;addEventListener('beforeunload',event=>{if(fixtureDirty)event.preventDefault()});addEventListener('pagehide',()=>setTimeout(()=>fixtureDirty=false,250));`);
  await click(`${panel} [data-occ-stop]`);
  assert.equal(calls.filter(request => request.action === 'stop').length, 0, 'Pending persistence is flushed before requesting process shutdown');
  await waitForBrowserState(client, `${editingApi}.snapshot().state.state==='stopped'&&document.querySelector('${iframe}')===null`, 'Successful complete shutdown removes the dead editor');
  assert.equal(calls.filter(request => request.action === 'stop').length, 1);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [data-occ-stop]').disabled&&document.querySelector('${panel} [data-occ-settings]').disabled`), true);
  await click(`${panel} [data-occ-primary]`);
  await waitForBrowserState(client, `document.querySelector('${iframe}')?.src.endsWith('#/editor/project-c')&&${editingApi}.snapshot().state.state!=='stopped'`, 'Explicit reopen restores the same project');
});

test('OpenChatCut iframe dedicated Worker requests use the production upstream proxy', {
  timeout: 30_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Requires isolated Chrome/Chromium',
}, async t => {
  assert.ok(executable, 'Required isolated browser is installed');
  const directory = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'openchatcut-worker-fixture-'));
  const profile = path.join(directory, 'browser');
  const staticRoot = path.join(directory, 'assets');
  const tokenPath = path.join(directory, 'fixture-asset-token');
  await mkdir(staticRoot); await writeFile(tokenPath, randomBytes(24).toString('hex'));
  const requests = [], targets = [], fetchEnables = [], failures = [], pausedRequests = [];
  const workerScript = `self.onmessage=async()=>{try{const response=await fetch('/api/worker-smoke');postMessage({ok:response.ok,scope:self.constructor.name,workerUrl:self.location.href,...await response.json()})}catch(error){postMessage({ok:false,error:error.message})}};`;
  const editorServer = createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, origin: request.headers.origin, host: request.headers.host });
    if (request.url === '/assets/fixture-worker.js') {
      response.setHeader('content-type', 'text/javascript;charset=utf-8'); response.end(workerScript);
    } else if (request.url === '/fixture-init.js') {
      response.setHeader('content-type', 'text/javascript;charset=utf-8'); response.end('window.fixtureDocumentReady=true;');
    } else if (request.url === '/api/worker-smoke') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ kind: 'worker-upstream', route: request.url, origin: request.headers.origin }));
    } else {
      response.setHeader('content-type', 'text/html;charset=utf-8');
      response.end('<!doctype html><html><head><script src="/fixture-init.js"></script></head><body><p>Dedicated Worker transport fixture</p></body></html>');
    }
  });
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-src https://web-sandbox.oaiusercontent.com; connect-src 'self' https://web-sandbox.oaiusercontent.com";
  const nativeServer = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html;charset=utf-8'); response.setHeader('content-security-policy', csp);
    response.end('<!doctype html><html><body><main id="aiyoucodex-openchatcut"></main></body></html>');
  });
  const servers = [editorServer, nativeServer];
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const editorOrigin = `http://127.0.0.1:${editorServer.address().port}`;
  const nativeOrigin = `http://127.0.0.1:${nativeServer.address().port}`;
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let client, bridge;
  t.after(async () => {
    await bridge?.dispose(); client?.close(); browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: nativeOrigin }));
  const send = client.send.bind(client);
  client.send = async (method, params, sessionId) => {
    try {
      const result = await send(method, params, sessionId);
      if (method === 'Fetch.enable') fetchEnables.push({ sessionId, ok: true });
      return result;
    } catch (error) {
      if (method === 'Fetch.enable') fetchEnables.push({ sessionId, ok: false, error: error.message });
      throw error;
    }
  };
  client.on('Target.attachedToTarget', (event, meta) => targets.push({ type: event.targetInfo?.type, url: event.targetInfo?.url,
    targetId: event.targetInfo?.targetId, sessionId: event.sessionId, parentSessionId: meta.sessionId }));
  client.on('Network.loadingFailed', (event, meta) => failures.push({ errorText: event.errorText, sessionId: meta.sessionId }));
  client.on('Fetch.requestPaused', (event, meta) => pausedRequests.push({ url: event.request.url, sessionId: meta.sessionId, frameId: event.frameId }));
  await client.send('Target.setDiscoverTargets', { discover: true });
  bridge = new AssetConsoleBridge({ staticRoot, tokenPath, port: editorServer.address().port });
  await bridge.install(client);
  const editorUrl = await bridge.embedOpenChatCut(`${editorOrigin}/#/editor/worker-fixture`);
  await client.evaluate(`const frame=document.createElement('iframe');frame.src=${JSON.stringify(editorUrl)};document.getElementById('aiyoucodex-openchatcut').append(frame)`);
  const proxy = bridge.openChatCutProxy;
  await waitForBrowserState(client, 'document.querySelector("iframe")?.contentWindow!==null', 'Worker fixture iframe is mounted');
  try {
    await waitForBrowserState({ evaluate: async () => proxy.assetSessions.size > 0 }, 'true', 'Production proxy activates the Worker owner iframe', 3000);
  } catch (error) {
    t.diagnostic(JSON.stringify({ editorUrl, targets, fetchEnables, failures, upstreamRequests: requests, inventory: await client.send('Target.getTargets') }));
    throw error;
  }
  const frameSession = [...proxy.assetSessions][0];
  const evaluateFrame = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, frameSession);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Worker owner iframe evaluation failed');
    return result.result?.value;
  };
  await waitForBrowserState({ evaluate: evaluateFrame }, `location.href===${JSON.stringify(editorUrl)}&&document.readyState==='complete'`, 'Worker owner document loads through the production proxy');
  const outcome = await evaluateFrame(`new Promise(resolve=>{let settled=false;const finish=value=>{if(!settled){settled=true;resolve(value)}};window.fixtureWorker=new Worker('/assets/fixture-worker.js',{type:'module'});fixtureWorker.onmessage=e=>finish(e.data);fixtureWorker.onerror=e=>finish({ok:false,error:e.message||'Worker startup failed'});fixtureWorker.postMessage('fetch');setTimeout(()=>finish({ok:false,error:'Worker response timed out'}),3000)})`);
  if (!outcome?.ok) {
    const inventory = await client.send('Target.getTargets');
    const workerTargets = inventory.targetInfos.filter(target => target.type === 'worker' && target.url.includes('fixture-worker'));
    const workerDiagnostics = [];
    for (const target of workerTargets) {
      const attached = targets.find(entry => entry.targetId === target.targetId);
      let diagnosticSession = attached?.sessionId;
      try {
        diagnosticSession ??= (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
        await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, diagnosticSession);
        workerDiagnostics.push({ type: target.type, url: target.url, sessionId: diagnosticSession, automaticAttachment: Boolean(attached), fetchSupported: true });
      } catch (error) { workerDiagnostics.push({ type: target.type, sessionId: diagnosticSession, fetchSupported: false, error: error.message }); }
    }
    t.diagnostic(JSON.stringify({ outcome, targets, fetchEnables, failures, workerDiagnostics, upstreamRequests: requests }));
  }
  assert.equal(outcome?.ok, true, `The dedicated Worker API request succeeds through the production bridge: ${JSON.stringify(outcome)}`);
  assert.equal(outcome.scope, 'DedicatedWorkerGlobalScope', 'The fetch ran inside a real dedicated Worker');
  assert.equal(new URL(outcome.workerUrl).pathname, '/assets/fixture-worker.js');
  assert.equal(outcome.kind, 'worker-upstream'); assert.equal(outcome.origin, editorOrigin);
  assert.equal(requests.find(request => request.url === '/api/worker-smoke')?.method, 'GET');
  assert.equal(requests.find(request => request.url === '/api/worker-smoke')?.host, new URL(editorOrigin).host);
  const inventory = await client.send('Target.getTargets');
  const workerTargets = inventory.targetInfos.filter(target => target.type === 'worker' && target.url.includes('fixture-worker'));
  t.diagnostic(JSON.stringify({ workerTargets: workerTargets.map(target => ({ type: target.type, url: target.url, targetId: target.targetId })),
    ownerSession: frameSession, apiRequests: pausedRequests.filter(request => request.url.endsWith('/api/worker-smoke')),
    automaticWorkerAttachment: targets.some(target => target.type === 'worker'), fetchEnables }));
});
