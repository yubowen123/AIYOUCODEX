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
let executable;
for (const candidate of [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean)) {
  try { await access(candidate); executable = candidate; break; } catch {}
}
const runtime = 'window.__aiyouOpenChatCut__', panel = '#aiyoucodex-openchatcut', status = `${panel} [data-occ-loading]`;
const threadId = '11111111-1111-4111-8111-111111111111';

test('OpenChatCut loading follows actual requests and controlled editor readiness, with retry and stale frame isolation', {
  timeout: 45_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Requires isolated Chrome/Chromium',
}, async t => {
  assert.ok(executable);
  const outputRoot = process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || process.env.AIYOU_TEST_OUTPUT || os.tmpdir();
  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(path.join(outputRoot, 'openchatcut-loading-fixture-')), profile = path.join(directory, 'browser');
  const staticRoot = path.join(directory, 'assets'), tokenPath = path.join(directory, 'fixture-token');
  await mkdir(staticRoot); await writeFile(tokenPath, randomBytes(24).toString('hex'));
  let releaseEditor, finishOpen, failOpen = true, opens = 0, client, assetBridge, editingBridge;
  const editorHtml = '<!doctype html><html><head><title>Fixture editor</title></head><body><div class="cc-editor-shell" style="display:grid;grid-template-columns:260px 0px 320px 0px minmax(0,1fr)"><header class="cc-topbar"><div class="cc-topbar-actions"></div></header><aside class="cc-chat-panel" data-cc-shortcut-surface="agent-chat">Agent</aside><div style="grid-column:2;grid-row:2/5"></div><div class="cc-preview-workspace">Preview</div></div></body></html>';
  const editorServer = createServer((_req, res) => {
    releaseEditor = (html = editorHtml) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(html); };
  });
  const nativeServer = createServer((_req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><html><head><style>body{margin:0}main{height:900px;width:760px}section{height:100%}</style></head><body><main></main></body></html>'); });
  const servers = [editorServer, nativeServer];
  for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${editorServer.address().port}`, nativeOrigin = `http://127.0.0.1:${nativeServer.address().port}`;
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    releaseEditor?.(); finishOpen?.(); editingBridge?.dispose(); await assetBridge?.dispose(); client?.close(); browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: nativeOrigin }));
  await client.evaluate(mainSource);
  await client.evaluate(`window.fixtureThread=${JSON.stringify(threadId)};Object.assign(window.__codexConversationPreviewInjection__,{getActiveTaskContext:()=>({threadId:fixtureThread}),getWorkspacePanelMount:()=>({surface:document.querySelector('main')}),initializeWorkspacePanel:()=>{},closeOtherWorkspacePanels:()=>{}})`);
  await client.evaluate(editingSource);
  assetBridge = new AssetConsoleBridge({ staticRoot, tokenPath, port: editorServer.address().port, openChatCutStatus: async () => ({ installed: true, baseUrl: origin }) });
  await assetBridge.install(client);
  const editorUrl = await assetBridge.embedOpenChatCut(`${origin}/#/editor/fixture-project`);
  editingBridge = new EfficiencyBridge({ request: async request => {
    if (request.action !== 'open') return { state: 'installed', installed: true };
    opens++;
    await new Promise(resolve => { finishOpen = resolve; });
    if (failOpen) throw new Error('Fixture connection refused');
    return { state: 'connecting', installed: true, type: 'editing', threadId: request.threadId, editorUrl, session: { threadId: request.threadId, projectId: 'fixture-project' } };
  } }, { binding: '__AIYOUCODEX_OPENCHATCUT_REQUEST__', resolver: 'resolveOpenChatCutRequest', fallbackError: 'Fixture connection refused' });
  await editingBridge.install(client);
  await client.evaluate(`const settings=document.createElement('div');settings.setAttribute('data-aiyou-openchatcut-settings','');document.body.append(settings);${runtime}.update({state:'downloading',installed:false,progress:1,message:'正在读取发行信息'});`);
  assert.equal(await client.evaluate(`document.querySelector('[data-occ-setting-loading] [role=progressbar]').getAttribute('aria-valuenow')`), '1', 'Installer 1 percent is not displayed as completion');
  await client.evaluate(`document.querySelector('[data-aiyou-openchatcut-settings]').remove()`);
  await client.evaluate(`${runtime}.update({state:'installed',installed:true});${runtime}.open()`);
  await waitForBrowserState({ evaluate: async () => Boolean(finishOpen) }, 'true', 'Open reaches the real bridge');
  assert.equal(await client.evaluate(`document.querySelector('${status}')?.hidden`), false, 'Pending request fills the panel');
  assert.match(await client.evaluate(`document.querySelector('${status}').textContent`), /检查|连接/);
  assert.equal(await client.evaluate(`document.querySelector('${status}').textContent.includes('%')`), false, 'Connection never invents a percentage');
  assert.equal(await client.evaluate(`document.querySelector('${status} [role=progressbar]').hasAttribute('aria-valuenow')`), false);
  assert.equal(await client.evaluate(`(()=>{const a=document.querySelector('${status}').getBoundingClientRect(),b=document.querySelector('${panel} .occ-body').getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1})()`), true, 'The themed loading target fills the blank editor body');
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('${status} .aiyou-loading-fill')).animationName`), 'none');
  await client.send('Emulation.setEmulatedMedia', { features: [] });
  for (const [phase, phrase] of [['launching', '启动'], ['connecting', '连接']]) {
    await client.evaluate(`${runtime}.update({state:${JSON.stringify(phase)},installed:true})`);
    assert.match(await client.evaluate(`document.querySelector('${status}').textContent`), new RegExp(phrase));
  }
  finishOpen(); finishOpen = null;
  await waitForBrowserState(client, `!!document.querySelector('${status} button')`, 'Request failure exposes a retry');
  assert.match(await client.evaluate(`document.querySelector('${status}').textContent`), /Fixture connection refused/);
  failOpen = false;
  await client.evaluate(`document.querySelector('${status} button').click()`);
  await waitForBrowserState({ evaluate: async () => opens === 2 && Boolean(finishOpen) }, 'true', 'Only explicit retry starts another open');
  finishOpen(); finishOpen = null;
  await waitForBrowserState(client, `!!document.querySelector('${panel} iframe')`, 'Bridge mounts the controlled iframe');
  await waitForBrowserState({ evaluate: async () => Boolean(releaseEditor) }, 'true', 'The real upstream document is held');
  assert.equal(await client.evaluate(`document.querySelector('${status}').hidden`), false, 'Receiving an editor URL does not settle readiness');
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.editorLoaded`), 'false');
  await client.evaluate(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://web-sandbox.oaiusercontent.com',data:{type:'aiyou-openchatcut:host-controls-ready'}}));window.dispatchEvent(new MessageEvent('message',{source:document.querySelector('${panel} iframe').contentWindow,origin:'https://unrelated.test',data:{type:'aiyou-openchatcut:host-controls-ready'}}))`);
  assert.equal(await client.evaluate(`${runtime}.snapshot().editor.ready`), false, 'Foreign sources and origins cannot settle readiness');
  await delay(8500);
  assert.match(await client.evaluate(`document.querySelector('${status}').textContent`), /较久|较慢|仍在/);
  // The real editor shell supplies the existing authenticated host signal.
  const releaseRealEditor = releaseEditor;
  releaseEditor = null;
  releaseRealEditor();
  await waitForBrowserState(client, `document.querySelector('${panel}').dataset.editorLoaded==='true'`, 'The controlled document load completes');
  await waitForBrowserState(client, `document.querySelector('${status}').hidden===true`, 'Actual controlled editor shell readiness dismisses loading');
  await client.evaluate(`window.fixtureOldFrame=document.querySelector('${panel} iframe');window.fixtureOldLoad=fixtureOldFrame.onload;${runtime}.close();fixtureOldLoad();`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true, 'A late load cannot reopen a closed panel');
  await client.evaluate(`${runtime}.open()`);
  await waitForBrowserState({ evaluate: async () => Boolean(finishOpen) }, 'true', 'Reopen is checked through the bridge');
  const changedUrl = await assetBridge.embedOpenChatCut(`${origin}/#/editor/fixture-new-project`);
  await client.evaluate(`${runtime}.update({type:'editing',autoOpen:false,state:'connecting',installed:true,threadId:fixtureThread,editorUrl:${JSON.stringify(changedUrl)},session:{threadId:fixtureThread,projectId:'fixture-new-project'}});fixtureOldLoad();window.dispatchEvent(new MessageEvent('message',{source:fixtureOldFrame.contentWindow,origin:'https://web-sandbox.oaiusercontent.com',data:{type:'aiyou-openchatcut:host-controls-ready'}}))`);
  assert.equal(await client.evaluate(`document.querySelector('${panel}').dataset.editorLoaded`), 'false', 'The replaced frame cannot mark the new document loaded');
  assert.equal(await client.evaluate(`document.querySelector('${status}').hidden`), false, 'Stale callbacks cannot dismiss the current loading state');
  await waitForBrowserState({ evaluate: async () => Boolean(releaseEditor) }, 'true', 'The replacement document is held');
  releaseEditor('<!doctype html><html><head><title>Fixture error</title></head><body>Editor unavailable</body></html>'); releaseEditor = null;
  await waitForBrowserState(client, `document.querySelector('${panel}').dataset.editorLoaded==='true'`, 'The error document fires a real load');
  assert.equal(await client.evaluate(`${runtime}.snapshot().editor.ready`), false, 'Loading an error document is not editor readiness');
  assert.equal(await client.evaluate(`document.querySelector('${status}').hidden`), false);
  await client.evaluate(`document.querySelector('${panel} iframe').dispatchEvent(new Event('error'))`);
  assert.equal(await client.evaluate(`document.querySelector('${status}').dataset.loadingState`), 'error', 'Iframe errors show a retryable failure');
  assert.equal(await client.evaluate(`!!document.querySelector('${status} button')`), true);
  await client.evaluate(`${runtime}.close()`);
  finishOpen(); finishOpen = null;
  assert.equal(await client.evaluate(`document.querySelector('${panel}').hidden`), true);
});
