import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { rendererScriptParts, registerRendererSource, evaluateRendererSource, removeRendererScripts } from '../lib/renderer-source.mjs';

const source = '/*' + ('x'.repeat(256 * 1024 - 3) + '😀\n').repeat(5) + '*/window.loaded=(window.loaded||0)+1;window.result="中文\\n🦊";';
function documentContext() { const window = {}; window.top = window; return vm.createContext({ window }); }

test('preload reconstructs the exact Unicode program through bounded transfers', () => {
  const parts = rendererScriptParts(source);
  const context = documentContext();
  for (const script of parts) vm.runInContext(script, context);
  assert.equal(context.window.loaded, 1);
  assert.equal(context.window.result, '中文\n🦊');
  assert.equal(context.window.__AIYOUCODEX_RENDERER_SOURCE_PARTS__, undefined);
  assert.ok(parts.every(part => Buffer.byteLength(JSON.stringify({ source: part })) < 2 * 1024 * 1024));
});

test('partial programs and subframes do not execute the renderer', () => {
  const parts = rendererScriptParts(source), context = documentContext();
  for (const part of parts.slice(0, -1)) vm.runInContext(part, context);
  assert.equal(context.window.loaded, undefined);
  const subframe = documentContext(); subframe.window.top = {};
  for (const part of parts) vm.runInContext(part, subframe);
  assert.equal(subframe.window.loaded, undefined);
});

test('failed preload registration removes only this attempted batch', async () => {
  let added = 0; const removed = [];
  const client = { send: async (method, params) => {
    if (method === 'Page.removeScriptToEvaluateOnNewDocument') { removed.push(params.identifier); return {}; }
    if (++added === 3) throw new Error('Registration failed');
    return { identifier: `new-${added}` };
  } };
  await assert.rejects(registerRendererSource(client, source), /Registration failed/);
  assert.deepEqual(removed, ['new-1', 'new-2']);
  await removeRendererScripts(client, 'legacy-id');
  assert.equal(removed.at(-1), 'legacy-id');
  await removeRendererScripts(client, ['old-id', 'new-1'], { except: ['new-1'] });
  assert.equal(removed.at(-1), 'old-id', 'Reconnect ID reuse cannot remove the new preload');
});

test('current-document transfer preserves execution and restores the request timeout', async () => {
  const context = documentContext(), client = { requestTimeoutMs: 5000, evaluate: async script => vm.runInContext(script, context) };
  await evaluateRendererSource(client, source);
  assert.equal(context.window.loaded, 1); assert.equal(client.requestTimeoutMs, 5000);
  client.evaluate = async () => { throw new Error('Transfer failed'); };
  await assert.rejects(evaluateRendererSource(client, source), /Transfer failed/);
  assert.equal(client.requestTimeoutMs, 5000);
});
