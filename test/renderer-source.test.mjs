import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { readRendererSource, rendererScriptParts, registerRendererSource, evaluateRendererSource, removeRendererScripts } from '../lib/renderer-source.mjs';

const source = '/*' + ('x'.repeat(256 * 1024 - 3) + '😀\n').repeat(5) + '*/window.loaded=(window.loaded||0)+1;window.result="中文\\n🦊";';
function documentContext() { const window = {}; window.top = window; return vm.createContext({ window }); }

test('renderer fingerprint covers the complete script, optional theme and managed shortcuts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiyou-renderer-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'inject'));
  await mkdir(path.join(root, 'themes'));
  const names = ['conversation-preview', 'claude-code', 'agent-workspace', 'openchatcut'];
  await Promise.all(names.map(name => writeFile(path.join(root, 'inject', `${name}.user.js`), `// ${name}`)));
  const shortcuts = [{ id: 'fixture' }];
  const base = '// conversation-preview\n// claude-code\n// agent-workspace\n// openchatcut\n';
  assert.equal((await readRendererSource(root, shortcuts)).source, base);

  await writeFile(path.join(root, 'themes', 'active-theme.js'), '// theme');
  const loaded = await readRendererSource(root, shortcuts);
  assert.equal(loaded.source, base + '// theme');
  const expected = createHash('sha256').update(base + '// theme').update('[{"id":"fixture"}]').digest('hex');
  assert.equal(loaded.sourceHash, expected);
  assert.notEqual((await readRendererSource(root, [])).sourceHash, expected);
});

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
