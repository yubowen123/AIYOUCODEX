import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeModelFromCatalog, isStdioAppServer, runModelProxy, threadHasBackingStorage,
  createContextWindowResolver, resolveNativeCodex } from '../lib/codex-model-proxy.mjs';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {EventEmitter, once} from 'node:events';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {copyFile, mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('a desktop-only installation without npm dependencies still starts native GPT unchanged', {timeout: 10000}, async t => {
  const root = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'model-proxy-no-dependencies-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'lib'));
  for (const file of ['codex-model-proxy.mjs', 'codex-model-router.mjs', 'deepseek-config.mjs']) {
    await copyFile(new URL('../lib/' + file, import.meta.url), path.join(root, 'lib', file));
  }
  const fixture = `
    import assert from 'node:assert/strict';
    import {PassThrough} from 'node:stream';
    import {EventEmitter, once} from 'node:events';
    import {configuredExtraModel, runModelProxy} from './lib/codex-model-proxy.mjs';
    await assert.rejects(import('smol-toml'), {code: 'ERR_MODULE_NOT_FOUND'});
    assert.deepEqual(await configuredExtraModel({CODEX_HOME: process.cwd()}), {});
    const input = new PassThrough(), output = new PassThrough(), errorOutput = new PassThrough();
    const native = new EventEmitter();
    native.stdin = new PassThrough(); native.stdout = new PassThrough(); native.stderr = new PassThrough();
    native.kill = () => native.emit('exit', 0);
    const expectedArgs = ['-c', 'features.fixture=true', 'app-server'];
    let forwardedArgs;
    native.stdin.on('data', chunk => {
      const request = JSON.parse(chunk.toString());
      assert.equal(request.method, 'model/list');
      native.stdout.write(JSON.stringify({id: request.id, result: {data: [{model: 'gpt-fixture'}], nextCursor: null}}) + '\\n');
    });
    const running = runModelProxy({args: expectedArgs, env: {CODEX_HOME: process.cwd()}, input, output, errorOutput,
      nativeBinary: '/fixture/native-codex', spawnProcess(binary, args) {
        assert.equal(binary, '/fixture/native-codex'); forwardedArgs = args; return native;
      }});
    while (!input.listenerCount('data')) await new Promise(resolve => setImmediate(resolve));
    const replied = once(output, 'data');
    input.write(JSON.stringify({id: 17, method: 'model/list', params: {}}) + '\\n');
    const [chunk] = await replied;
    assert.deepEqual(JSON.parse(chunk.toString()), {id: 17, result: {data: [{model: 'gpt-fixture'}], nextCursor: null}});
    assert.deepEqual(forwardedArgs, expectedArgs);
    native.emit('exit', 0);
    assert.equal(await running, 0);
    process.stdout.write('native GPT passthrough confirmed\\n');
  `;
  await writeFile(path.join(root, 'fixture.mjs'), fixture);
  const result = await promisify(execFile)(process.execPath, ['fixture.mjs'], {cwd: root, timeout: 7000});
  assert.equal(result.stdout, 'native GPT passthrough confirmed\n');
  assert.equal(result.stderr, '');
});

test('an explicitly bound native CLI never falls back to a different installed application', async () => {
  assert.equal(await resolveNativeCodex({AIYOUCODEX_NATIVE_CODEX_BINARY: process.execPath}, '/fixture/proxy'), await realpath(process.execPath));
  await assert.rejects(resolveNativeCodex({AIYOUCODEX_NATIVE_CODEX_BINARY: '/nonexistent-selected-app/codex'}, '/fixture/proxy'), /unavailable/);
  await assert.rejects(resolveNativeCodex({AIYOUCODEX_NATIVE_CODEX_BINARY: process.execPath}, process.execPath), /unavailable/);
});

async function contextFixture(t, models) {
  const home = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'model-context-window-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const filename = path.join(home, 'models_cache.json');
  if (models !== undefined) await writeFile(filename, JSON.stringify({models}));
  return {home, filename};
}

test('context windows use exact cached model slugs and their default rather than maximum window', async t => {
  const f = await contextFixture(t, [
    {slug: 'gpt-fixture-small', context_window: 270000, max_context_window: 1048576},
    {slug: 'gpt-fixture-large', context_window: 1048576, max_context_window: 1048576},
  ]);
  const resolve = createContextWindowResolver({home: f.home});
  assert.equal(await resolve('gpt-fixture-small'), 270000);
  assert.equal(await resolve('gpt-fixture-large'), 1048576);
  for (const model of ['gpt-fixture', 'GPT-FIXTURE-SMALL', 'gpt-fixture-small-extra', '', null]) {
    assert.equal(await resolve(model), null);
  }
});

test('explicit windows override the global window and may exceed defaults only up to the published maximum', async t => {
  const f = await contextFixture(t, [{slug: 'gpt-fixture', context_window: 270000, max_context_window: 1048576}]);
  const resolve = createContextWindowResolver({home: f.home, globalContextWindow: 500000});
  assert.equal(await resolve('gpt-fixture'), 500000);
  assert.equal(await resolve('gpt-fixture', {model_context_window: 1048576}), 1048576);
  assert.equal(await resolve('gpt-fixture', {model_context_window: 270000}), 270000);
  assert.equal(await resolve('gpt-fixture', {model_context_window: 1048577}), null);
  assert.equal(await resolve('gpt-fixture', {model_context_window: null}), null);
  assert.equal(await createContextWindowResolver({home: f.home, globalContextWindow: 1048577})('gpt-fixture'), null);
});

test('invalid numeric configuration fails closed rather than falling back to the default or global window', async t => {
  const f = await contextFixture(t, [{slug: 'gpt-fixture', context_window: 270000, max_context_window: 1048576}]);
  const resolve = createContextWindowResolver({home: f.home, globalContextWindow: 300000});
  for (const value of [0, -1, 1.5, '270000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await resolve('gpt-fixture', {model_context_window: value}), null);
    assert.equal(await createContextWindowResolver({home: f.home, globalContextWindow: value})('gpt-fixture'), null);
  }
});

test('missing, corrupt, ambiguous or invalid cached metadata returns no inferred window', async t => {
  const f = await contextFixture(t);
  const resolve = createContextWindowResolver({home: f.home});
  assert.equal(await resolve('gpt-fixture'), null);
  for (const content of ['not-json', '{}', '{"models":{}}', JSON.stringify({models: [
    {slug: 'gpt-fixture', context_window: 10}, {slug: 'gpt-fixture', context_window: 20},
  ]})]) {
    await writeFile(f.filename, content);
    assert.equal(await resolve('gpt-fixture'), null);
  }
  for (const entry of [
    {context_window: 0}, {context_window: '270000'}, {context_window: 1.5},
    {context_window: 270000, max_context_window: null},
    {context_window: 270000, max_context_window: 100000},
  ]) {
    await writeFile(f.filename, JSON.stringify({models: [{slug: 'gpt-fixture', ...entry}]}));
    assert.equal(await resolve('gpt-fixture'), null);
  }
});

test('an absent published maximum permits the model default but cannot authorize an explicit window', async t => {
  const f = await contextFixture(t, [{slug: 'gpt-fixture', context_window: 270000}]);
  const resolve = createContextWindowResolver({home: f.home});
  assert.equal(await resolve('gpt-fixture'), 270000);
  assert.equal(await resolve('gpt-fixture', {model_context_window: 270000}), null);
});

test('context resolution reads updated public metadata without retaining stale model windows', async t => {
  const f = await contextFixture(t, [{slug: 'gpt-fixture', context_window: 270000, max_context_window: 1048576}]);
  const resolve = createContextWindowResolver({home: f.home});
  assert.equal(await resolve('gpt-fixture'), 270000);
  await writeFile(f.filename, JSON.stringify({models: [{slug: 'gpt-fixture', context_window: 400000, max_context_window: 1048576}]}));
  assert.equal(await resolve('gpt-fixture'), 400000);
});

test('only the stdio app-server is wrapped; runtime commands and protocol generators stay native', () => {
  assert.equal(isStdioAppServer(['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled']), true);
  assert.equal(isStdioAppServer(['app-server', '--listen', 'stdio://']), true);
  assert.equal(isStdioAppServer(['app-server', '--listen', 'ws://127.0.0.1:5555']), false);
  assert.equal(isStdioAppServer(['app-server', 'generate-ts', '--out', '/tmp']), false);
  assert.equal(isStdioAppServer(['exec', 'app-server']), false);
  assert.equal(isStdioAppServer(['--version']), false);
  assert.equal(isStdioAppServer(['app-server', '--help']), false);
  assert.equal(isStdioAppServer(['app-server', '--listen=ws://127.0.0.1:5555']), false);
});

test('DeepSeek catalog entry becomes a native picker model with its actual supported effort choices', () => {
  const converted = nativeModelFromCatalog({slug: 'deepseek-flash', display_name: 'DeepSeek V4.1 Flash',
    description: 'Official DeepSeek', input_modalities: ['text', 'image'], default_reasoning_level: 'high',
    supported_reasoning_levels: [{effort: 'low', description: 'Low'}, {effort: 'high', description: 'High'}, {effort: 'max', description: 'Max'}]});
  assert.equal(converted.model, 'deepseek-flash');
  assert.equal(converted.displayName, 'DeepSeek V4.1 Flash');
  assert.deepEqual(converted.supportedReasoningEfforts.map(x => x.reasoningEffort), ['low', 'high', 'max']);
  assert.deepEqual(converted.inputModalities, ['text', 'image']);
  assert.equal(converted.defaultReasoningEffort, 'high');
  assert.equal(converted.hidden, false);
});

test('both legacy and paginated empty threads need actual backing storage before unloading', async () => {
  for (const historyMode of ['legacy', 'paginated']) {
    assert.equal(await threadHasBackingStorage({historyMode, path: '/nonexistent-model-router-session'}), false);
    assert.equal(await threadHasBackingStorage({historyMode, path: fileURLToPath(import.meta.url)}), true);
  }
  assert.equal(await threadHasBackingStorage({ephemeral: true, path: fileURLToPath(import.meta.url)}), false);
});

test('stdio transport preserves native server approval IDs and maps frontend request responses back to their original IDs', async () => {
  const input = new PassThrough(), output = new PassThrough(), stderr = new PassThrough();
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  let upstreamRequest, upstreamReply, received = '';
  child.stdin.on('data', chunk => {
    for (const line of chunk.toString().trim().split('\n')) {
      const message = JSON.parse(line);
      if (message.method) {
        upstreamRequest = message;
        child.stdout.write(JSON.stringify({id: message.id, result: {account: {type: 'chatgpt'}}}) + '\n');
      } else upstreamReply = message;
    }
  });
  output.on('data', chunk => {received += chunk.toString();});
  const running = runModelProxy({args: ['app-server', '--stdio'], env: {CODEX_HOME: '/nonexistent-model-proxy-fixture'},
    input, output, errorOutput: stderr, nativeBinary: '/native-fixture', spawnProcess: () => child});
  // Wait for the transport listeners without timing assumptions.
  while (!child.stdout.listenerCount('data')) await new Promise(resolve => setImmediate(resolve));
  input.write(JSON.stringify({id: 42, method: 'account/read', params: {refreshToken: false}}) + '\n');
  while (!received.includes('42')) await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(upstreamRequest.id, 42);
  assert.deepEqual(JSON.parse(received.trim()), {id: 42, result: {account: {type: 'chatgpt'}}});
  child.stdout.write(JSON.stringify({id: 7, method: 'item/commandExecution/requestApproval', params: {}}) + '\n');
  while (!received.includes('requestApproval')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(received.trim().split('\n').at(-1)).id, 7);
  input.write(JSON.stringify({id: 7, result: {decision: 'decline'}}) + '\n');
  while (!upstreamReply) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(upstreamReply, {id: 7, result: {decision: 'decline'}});
  child.emit('exit', 0);
  assert.equal(await running, 0);
});
