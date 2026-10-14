import assert from 'node:assert/strict';
import test from 'node:test';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {EfficiencyBridge} from '../lib/efficiency-bridge.mjs';
import {createDeepSeekSettingsController} from '../lib/deepseek-settings.mjs';
import {connectFixtureBrowser, waitForBrowserState} from './helpers/browser-state.mjs';

const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
let executable;
for (const candidate of [process.env.AIYOUCODEX_TEST_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .map(root => path.join(root, 'Google/Chrome/Application/chrome.exe'))].filter(Boolean)) {
  try {await access(candidate); executable = candidate; break;} catch {}
}

test('DeepSeek settings uses the host binding, clears secrets, and reports confirmed saves and failures', {
  timeout: 35000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Chrome/Chromium required for isolated renderer fixture',
}, async t => {
  assert.ok(executable, 'Required Chrome/Chromium browser must be installed');
  const root = await mkdtemp(path.join(tmpdir(), 'aiyou-deepseek-settings-'));
  await mkdir(path.join(root, '.codex'));
  const credentials = path.join(root, '.codex', 'keys.md');
  await writeFile(credentials, 'DEEPSEEK_API_KEY=sk-fictionalPreviouslySavedCredential\n', {mode: 0o600});
  const controller = createDeepSeekSettingsController({home: root, env: {}});
  const fixture = '<style>body{display:flex;height:100vh;margin:0}nav{width:64px}aside{width:240px}main{display:flex;flex:1;min-width:0;position:relative}button{min-height:28px}</style><nav data-app-navigation-rail><button aria-label="首页">首页</button></nav><aside><button aria-label="搜索">搜索</button></aside><main data-app-shell-main-surface="default"><div data-app-shell-main-content-layout style="flex:1"><div id="composer" contenteditable="true">Keep this draft</div></div></main>';
  const server = createServer((_req, res) => {res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(fixture);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(root, 'browser');
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1506,1100', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    {stdio: ['ignore', 'ignore', 'pipe']});
  let client, bridge, finishSave, saveCount = 0, failSave = false;
  const fakeKey = 'sk-fixtureOnlyDeepSeekCredential12345678';
  t.after(async () => {
    finishSave?.(); bridge?.dispose(); client?.close(); browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  ({client} = await connectFixtureBrowser({browser, profile, url: `http://127.0.0.1:${server.address().port}`}));
  bridge = new EfficiencyBridge({async request(payload) {
    if (payload.action === 'save') {
      saveCount++;
      assert.equal(payload.apiKey, fakeKey);
      if (failSave) throw Object.assign(new Error('凭证文件无法保存，请检查文件权限后重试。'), {code: 'DEEPSEEK_SETTINGS_ERROR'});
      await new Promise(resolve => {finishSave = resolve;});
    }
    return controller.request(payload);
  }}, {binding: '__AIYOUCODEX_DEEPSEEK_SETTINGS_REQUEST__', resolver: 'resolveDeepSeekSettingsRequest',
    publicErrorCodes: ['DEEPSEEK_SETTINGS_ERROR'], fallbackError: 'DeepSeek 设置尚未确认保存。'});
  await bridge.install(client);
  await client.evaluate(source);
  const api = 'window.__codexConversationPreviewInjection__';
  await client.evaluate(`${api}.openShortcutSettings()`);
  await waitForBrowserState(client, "!!document.querySelector('[data-deepseek-settings-form]')", 'Settings contains the DeepSeek key form');
  await waitForBrowserState(client, "document.querySelector('[data-deepseek-status]').textContent.includes('已配置')", 'The saved status comes from the host');
  assert.equal(await client.evaluate("document.querySelector('[data-deepseek-key]').type"), 'password');
  assert.equal(await client.evaluate("document.querySelector('[data-deepseek-key]').value"), '');
  await client.evaluate("document.querySelector('[data-deepseek-key]').focus()");
  await client.send('Input.insertText', {text: fakeKey});
  await client.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'});
  await client.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
  await waitForBrowserState(client, "document.querySelector('[data-deepseek-key]').value===''&&document.querySelector('[data-deepseek-save]').disabled", 'Submitting immediately clears the key and prevents duplicate saves');
  assert.equal(saveCount, 1);
  finishSave();
  await waitForBrowserState(client, "document.querySelector('[data-deepseek-message]').textContent.includes('已保存')", 'Only the host acknowledgement confirms saving');
  assert.equal(await readFile(credentials, 'utf8'), `DEEPSEEK_API_KEY=${fakeKey}\n`);
  assert.equal(await client.evaluate(`JSON.stringify(localStorage).includes(${JSON.stringify(fakeKey)})||document.body.innerHTML.includes(${JSON.stringify(fakeKey)})`), false);
  failSave = true;
  await client.evaluate(`document.querySelector('[data-deepseek-key]').value=${JSON.stringify(fakeKey)};document.querySelector('[data-deepseek-settings-form]').requestSubmit()`);
  await waitForBrowserState(client, "document.querySelector('[data-deepseek-message]').textContent.includes('无法保存')", 'A host failure remains an explicit failure');
  assert.equal(await client.evaluate("document.querySelector('[data-deepseek-key]').value"), '');
  await client.evaluate(`document.querySelector('[data-deepseek-key]').value=${JSON.stringify(fakeKey)};document.getElementById('codex-sidebar-shortcut-settings-dialog').close();${api}.openShortcutSettings()`);
  assert.equal(await client.evaluate("document.querySelector('[data-deepseek-key]').value"), '', 'Closing settings discards an unsaved credential');
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), 'Keep this draft');
  await client.evaluate(`${api}.destroy()`);
});
