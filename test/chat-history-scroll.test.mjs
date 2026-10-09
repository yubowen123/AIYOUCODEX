import assert from 'node:assert/strict';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {connectFixtureBrowser, waitForBrowserState} from './helpers/browser-state.mjs';

const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))].filter(Boolean);
let executable;
for (const candidate of candidates) {try {await access(candidate); executable = candidate; break;} catch {}}
const id = '11111111-1111-4111-8111-111111111111';
const api = 'window.__codexConversationPreviewInjection__';
const messages = Array.from({length: 35}, (_, i) => ({id: `message-${i}`, role: 'assistant', text: `Historical message ${i}.\nSecond line.\nThird line.`}));

async function fixture(t, direction, virtual = false) {
  assert.ok(executable, 'A real browser is required');
  const profile = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'aiyou-history-scroll-'));
  const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--window-size=1000,800', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let client;
  t.after(async () => {
    client?.close(); browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill('SIGKILL');
    await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  ({client} = await connectFixtureBrowser({browser, profile, url: 'about:blank'}));
  const {frameTree} = await client.send('Page.getFrameTree');
  await client.send('Page.setDocumentContent', {frameId: frameTree.frame.id, html: `
    <style>body{margin:0}.thread-scroll-container{display:flex;flex-direction:${direction};overflow:auto;height:300px;width:600px}
    .content{flex-shrink:0;width:100%}.flex-col{display:flex;flex-direction:column}.tail{height:700px;flex-shrink:0}
    [data-markdown-text-style]{padding:12px 0;white-space:pre-wrap}</style>
    <main data-app-shell-active-page="true"><div class="thread-scroll-container" data-app-action-timeline-scroll>
    <div class="content"><div data-thread-find-target="conversation"><div id="history" ${virtual ? 'style="height:2400px"' : ''}>
    <div class="flex flex-col" id="turns" ${virtual ? 'style="margin-top:1200px"' : ''}>
    <div ${virtual ? 'data-turn-key="history-content:turn:first"' : ''}><div data-markdown-text-style="assistant-message">Native loaded message.</div></div>
    <div class="tail" ${virtual ? 'data-turn-key="history-content:tail:last"' : ''}><div data-local-conversation-final-assistant="true"><div data-markdown-text-style="assistant-message">Native latest message.</div></div></div>
    </div></div></div></div></div></main>`});
  await client.evaluate(`document.querySelector('main').__reactFiber$fixture={memoizedProps:{route:{conversationId:'${id}',pathname:'/local/${id}'}}}`);
  await client.evaluate(source);
  const deliver = async values => {
    await client.evaluate(`${api}.setConversationHistory(${JSON.stringify({threadId: id, messages: values})})`);
    await client.evaluate(`${api}.refresh()`);
  };
  const position = selector => client.evaluate(`(()=>{const s=document.querySelector('.thread-scroll-container'),e=document.querySelector(${JSON.stringify(selector)});return {top:s.scrollTop,height:s.scrollHeight,offset:e&&e.getBoundingClientRect().top-s.getBoundingClientRect().top}})()`);
  return {client, deliver, position};
}

for (const direction of ['column', 'column-reverse']) {
  const options = {timeout: 30000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== '1' && 'Browser unavailable'};
  test(`native virtual history owns its heights and scroll position (${direction})`, options, async t => {
    const {client, deliver, position} = await fixture(t, direction, true);
    await client.evaluate(`document.body.insertAdjacentHTML('afterbegin','<div hidden><div data-thread-find-target="conversation"><div><div class="flex flex-col"><div>Retained inactive tab</div></div></div></div></div>')`);
    await client.evaluate(`document.querySelector('.thread-scroll-container').scrollTop=${direction === 'column' ? 650 : -650}`);
    await client.evaluate(`(()=>{const s=document.querySelector('.thread-scroll-container'),d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');window.fixtureScrollWrites=0;Object.defineProperty(s,'scrollTop',{get(){return d.get.call(this)},set(v){window.fixtureScrollWrites++;d.set.call(this,v)},configurable:true})})()`);
    await deliver(messages);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-codex-recovered-history-flow]').length`), 0,
      'Offscreen virtual messages are not missing history and must not be inserted again');
    assert.equal(await client.evaluate(`document.getElementById('history').getBoundingClientRect().height`), 2400);
    const initial = await position('#history');
    await client.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x: 300, y: 120, deltaX: 0, deltaY: direction === 'column' ? 350 : -350});
    await waitForBrowserState(client, `Math.abs(document.querySelector('.thread-scroll-container').scrollTop-(${initial.top}))>100`, 'Real wheel input scrolls toward older history');
    await delay(150);
    const before = await position('#history');
    for (let i = 0; i < 5; i++) {
      await client.evaluate(`document.getElementById('turns').style.marginTop='${1200 + i * 20}px';${api}.refresh()`);
      await deliver(messages);
    }
    assert.equal((await position('#history')).top, before.top, 'Refresh never writes a compensating scroll offset into a native virtual list');
    assert.equal(await client.evaluate('window.fixtureScrollWrites'), 0, 'The enhancer never competes with native virtual scroll control');
    await client.evaluate(`document.getElementById('history').removeAttribute('style');document.getElementById('turns').removeAttribute('style');document.querySelectorAll('[data-turn-key]').forEach(e=>e.removeAttribute('data-turn-key'))`);
    await deliver(messages);
    await waitForBrowserState(client, `!!document.querySelector('[data-codex-recovered-history-flow]')`, 'Fallback still restores non-virtual history');
    await client.evaluate(`document.getElementById('history').style.height='2400px';document.getElementById('turns').style.marginTop='1200px';document.querySelector('.tail').dataset.turnKey='history-content:tail:last';${api}.refresh()`);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-codex-recovered-history-flow],[data-codex-recovered-history-content]').length`), 0,
      'When native history takes over, both recovery copies and the height override are removed');
  });

  test(`fallback history preserves the visible message while older and newer messages arrive (${direction})`, options, async t => {
    const {client, deliver, position} = await fixture(t, direction);
    await deliver(messages);
    const selector = '[data-message-id="message-15"]';
    await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);
    const before = await position(selector);
    const older = [{id: 'older', role: 'assistant', text: 'Older message.\n'.repeat(7)}];
    const newer = [{id: 'newer', role: 'assistant', text: 'Newer message.\n'.repeat(11)}];
    await deliver([...older, ...messages, ...newer]);
    assert.ok(Math.abs((await position(selector)).offset - before.offset) < 1, 'Keep the reading anchor instead of compensating for the entire height change');
    await client.evaluate(`window.fixtureFlow=document.querySelector('[data-codex-recovered-history-flow]')`);
    const stable = await position(selector);
    await deliver([...older, ...messages, ...newer]);
    assert.equal(await client.evaluate(`window.fixtureFlow===document.querySelector('[data-codex-recovered-history-flow]')`), true);
    assert.equal((await position(selector)).top, stable.top);
    await client.evaluate(`document.querySelector('.thread-scroll-container').scrollTop=${direction === 'column' ? '100000' : '0'}`);
    await deliver([...older, ...messages, ...newer, {id:'latest',role:'assistant',text:'Newest output.\n'.repeat(8)}]);
    const end = await position(selector);
    assert.ok(direction === 'column-reverse' ? Math.abs(end.top) < 1 : Math.abs(end.height - end.top - 300) < 1, 'At the bottom, live output continues to follow normally');
  });
}
