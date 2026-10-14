import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { connectFixtureBrowser, waitForBrowserState } from './helpers/browser-state.mjs';
import { EfficiencyBridge } from '../lib/efficiency-bridge.mjs';
import { createEnhancementController, isEnhancementEnabled, setEnhancementEnabled, guardEnhancementSource,
  ENHANCEMENT_TEARDOWN_EXPRESSION, ENHANCEMENT_RESUME_EXPRESSION } from '../lib/enhancement-state.mjs';
import { registerRendererSource, evaluateRendererSource } from '../lib/renderer-source.mjs';

const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test('settings disable preserves native draft, reports failure, tears down both windows and stays off across reload', {
  timeout: 60000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1',
}, async t => {
  assert.ok(executable, 'An isolated fixture browser is required');
  const dir = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'enhancement-renderer-'));
  const file = path.join(dir, 'state.json');
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html;charset=utf-8');
    res.end(`<style>body{margin:0;display:flex;height:100vh}aside{width:260px}main{flex:1;min-width:0}</style><aside id="app-shell-sidebar"><nav><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button><div data-app-action-sidebar-scroll></div></nav></aside><main><textarea id="native-draft">Keep my native draft</textarea></main>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const clients = [], bridges = [];
  t.after(async () => {
    for (const bridge of bridges) bridge.dispose();
    for (const client of clients) client.close();
    browser.kill('SIGTERM');
    if (browser.exitCode == null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const files = ['inject/conversation-preview.user.js', 'inject/claude-code.user.js', 'inject/agent-workspace.user.js',
    'inject/openchatcut.user.js', 'vendor/codex-taskboard/inject/codex-taskboard.user.js'];
  const source = guardEnhancementSource(`window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__=[];window.__CODEX_TASKBOARD_SOURCE_HASH__='fixture-hash';window.__CODEX_TASKBOARD_URL__=${JSON.stringify(origin + '/taskboard')};\n`
    + (await Promise.all(files.map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n'));
  let fail = true, disabledCalls = 0;
  const controller = createEnhancementController({ file, platform: 'darwin', onDisabled: async () => { disabledCalls++; } });
  const requestController = { request: payload => {
    if (payload.action === 'disable' && fail) { fail = false; throw Object.assign(new Error('Fixture persistence failure; retry'), { code: 'ENHANCEMENT_ERROR' }); }
    return controller.request(payload);
  } };
  for (let index = 0; index < 2; index++) {
    const { client } = await connectFixtureBrowser({ browser, profile: dir, url: origin + '/window-' + index });
    clients.push(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await registerRendererSource(client, source); await evaluateRendererSource(client, source);
    const bridge = new EfficiencyBridge(requestController, { binding: '__AIYOUCODEX_ENHANCEMENT_REQUEST__', resolver: 'resolveEnhancementRequest', publicErrorCodes: ['ENHANCEMENT_ERROR'] });
    bridges.push(bridge); await bridge.install(client);
    await client.evaluate(`localStorage.setItem('fixture-theme-preferences','keep');window.__codexConversationPreviewInjection__.openShortcutSettings()`);
    await waitForBrowserState(client, "!!document.querySelector('[data-aiyou-enhancement-disable]')&&!document.querySelector('[data-aiyou-enhancement-disable]').disabled", 'Disable entry becomes ready');
  }
  const first = clients[0];
  async function clickDisable() {
    const { x, y } = await first.evaluate(`(()=>{const b=document.querySelector('[data-aiyou-enhancement-disable]');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(document.elementFromPoint(x,y)!==b)throw Error('Disable button is covered');return{x,y}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await first.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await clickDisable();
  await waitForBrowserState(first, "document.querySelector('[data-aiyou-enhancement-message]').textContent.includes('Fixture persistence failure')", 'Failed save stays visible and can retry');
  assert.equal(await isEnhancementEnabled(file), true); assert.equal(disabledCalls, 0);
  assert.equal(await first.evaluate("document.getElementById('native-draft').value"), 'Keep my native draft');
  await clickDisable();
  await waitForBrowserState(first, "document.querySelector('[data-aiyou-enhancement-message]').textContent.includes('关闭状态已保存')", 'Successful save is acknowledged');
  assert.equal(await isEnhancementEnabled(file), false); assert.equal(disabledCalls, 1);
  for (const client of clients) {
    const result = await client.evaluate(ENHANCEMENT_TEARDOWN_EXPRESSION);
    assert.deepEqual(result.failures, []);
    assert.equal(await client.evaluate("!!document.getElementById('native-draft')&&document.getElementById('native-draft').value==='Keep my native draft'"), true);
    assert.equal(await client.evaluate("!!window.__codexConversationPreviewInjection__||!!window.__codexTaskboardInjection__||!!window.__aiyouAgentWorkspace__||!!window.__aiyouOpenChatCut__||!!document.getElementById('codex-sidebar-shortcut-settings-dialog')"), false);
    // Deliberately retain preloads, to test the final guard against a concurrent
    // worker connection. Production also removes the owned registrations.
    await client.send('Page.reload', { ignoreCache: true });
    await waitForBrowserState(client, "document.readyState==='complete'&&!!document.getElementById('native-draft')", 'Native page stays available');
    assert.equal(await client.evaluate("!!window.__codexConversationPreviewInjection__||!!window.__codexTaskboardInjection__"), false);
    assert.equal(await client.evaluate("localStorage.getItem('fixture-theme-preferences')"), 'keep');
  }
  await setEnhancementEnabled(true, file);
  for (const client of clients) {
    await client.evaluate(ENHANCEMENT_RESUME_EXPRESSION); await evaluateRendererSource(client, source);
    assert.equal(await client.evaluate("typeof window.__codexConversationPreviewInjection__?.openShortcutSettings==='function'"), true);
  }
  assert.equal(browser.exitCode, null, 'The native-equivalent host was never terminated');
});
