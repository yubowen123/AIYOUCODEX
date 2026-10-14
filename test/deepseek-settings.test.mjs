import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDeepSeekSettingsController} from '../lib/deepseek-settings.mjs';

const KEY_A = 'sk-fictionalsettingstestkeyalpha';
const KEY_B = 'sk-fictionalsettingstestkeybeta';
const EMPTY = {configured: false, source: null, fileConfigured: false, environmentOverrides: false};
const FILE = {configured: true, source: 'file', fileConfigured: true, environmentOverrides: false};

async function fixture(t, env = {}) {
  const home = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'deepseek-settings-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const directory = path.join(home, '.codex');
  const filename = path.join(directory, 'keys.md');
  return {home, directory, filename, controller: createDeepSeekSettingsController({home, env})};
}

async function fixedError(operation) {
  await assert.rejects(operation, error => {
    assert.equal(error.code, 'DEEPSEEK_SETTINGS_ERROR');
    assert.equal(error.message, 'DeepSeek 凭证设置失败，请检查 API Key 和本地凭证文件。');
    assert.equal(error.cause, undefined);
    return true;
  });
}

test('snapshot reports absence without creating credential storage', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.controller.request({action: 'snapshot'}), EMPTY);
  assert.deepEqual(await readdir(f.home), []);
});

test('save creates only keys.md atomically with private permissions and redacted state', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.controller.request({action: 'save', apiKey: KEY_A}), FILE);
  assert.equal(await readFile(f.filename, 'utf8'), `DEEPSEEK_API_KEY=${KEY_A}\n`);
  if (process.platform !== 'win32') assert.equal((await stat(f.filename)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(f.directory), ['keys.md']);
  assert.deepEqual(await f.controller.request({action: 'snapshot'}), FILE);
});

test('save replaces the sole independent assignment while preserving other files and CRLF', async t => {
  const f = await fixture(t);
  await mkdir(f.directory);
  const before = `# Private credentials\r\nOTHER_API_KEY=fictional_other_key\r\n  DEEPSEEK_API_KEY = ${KEY_A}\r\nTail without newline`;
  await writeFile(f.filename, before, {mode: 0o644});
  await writeFile(path.join(f.directory, 'config.toml'), 'model_provider="openai"\n');
  await writeFile(path.join(f.directory, 'auth.json'), '{"fixture":"unchanged"}\n');
  await f.controller.request({action: 'save', apiKey: KEY_B});
  assert.equal(await readFile(f.filename, 'utf8'), before.replace(`  DEEPSEEK_API_KEY = ${KEY_A}`, `DEEPSEEK_API_KEY=${KEY_B}`));
  assert.equal(await readFile(path.join(f.directory, 'config.toml'), 'utf8'), 'model_provider="openai"\n');
  assert.equal(await readFile(path.join(f.directory, 'auth.json'), 'utf8'), '{"fixture":"unchanged"}\n');
  if (process.platform !== 'win32') assert.equal((await stat(f.filename)).mode & 0o777, 0o600);
});

test('environment has precedence and saving does not mutate it or expose either key', async t => {
  const env = {DEEPSEEK_API_KEY: KEY_A};
  const f = await fixture(t, env);
  assert.deepEqual(await f.controller.request({action: 'snapshot'}), {
    configured: true, source: 'environment', fileConfigured: false, environmentOverrides: true,
  });
  const result = await f.controller.request({action: 'save', apiKey: KEY_B});
  assert.deepEqual(result, {configured: true, source: 'environment', fileConfigured: true, environmentOverrides: true});
  assert.equal(env.DEEPSEEK_API_KEY, KEY_A);
  assert.equal(JSON.stringify(result).includes(KEY_A), false);
  assert.equal(JSON.stringify(result).includes(KEY_B), false);
});

test('invalid keys, empty deletion and unknown actions fail without writes or secret reflection', async t => {
  const f = await fixture(t);
  for (const apiKey of ['', null, 42, 'sk-short', KEY_A + '\n', KEY_A + '\r\nOTHER=x', ' ' + KEY_A,
    'sk-fictional_settings_test_key', 'sk-fictional-settings-test-key', 'sk-' + 'a'.repeat(254)]) {
    await fixedError(f.controller.request({action: 'save', apiKey}));
  }
  await fixedError(f.controller.request({action: KEY_A}));
  await fixedError(f.controller.request(null));
  assert.deepEqual(await readdir(f.home), []);
});

test('duplicate assignments are rejected even when an environment key is available', async t => {
  const f = await fixture(t, {DEEPSEEK_API_KEY: KEY_A});
  await mkdir(f.directory);
  const before = `DEEPSEEK_API_KEY=${KEY_A}\n DEEPSEEK_API_KEY = ${KEY_B}\n`;
  await writeFile(f.filename, before);
  await fixedError(f.controller.request({action: 'snapshot'}));
  await fixedError(f.controller.request({action: 'save', apiKey: KEY_A}));
  assert.equal(await readFile(f.filename, 'utf8'), before);
});

test('symlink files are rejected and their target remains untouched', async t => {
  const f = await fixture(t);
  await mkdir(f.directory);
  const target = path.join(f.home, 'outside.md');
  const original = 'OTHER_API_KEY=fictional_unrelated_key\n';
  await writeFile(target, original);
  await symlink(target, f.filename);
  await fixedError(f.controller.request({action: 'snapshot'}));
  await fixedError(f.controller.request({action: 'save', apiKey: KEY_A}));
  assert.equal(await readFile(target, 'utf8'), original);
  assert.deepEqual(await readdir(f.directory), ['keys.md']);
});

test('multiple controllers serialize concurrent saves and keep unrelated credentials', async t => {
  const f = await fixture(t);
  await mkdir(f.directory);
  const unrelated = 'OTHER_API_KEY=fictional_unrelated_key\n';
  await writeFile(f.filename, unrelated);
  const other = createDeepSeekSettingsController({home: f.home, env: {}});
  const writes = Array.from({length: 20}, (_, i) => (i % 2 ? other : f.controller).request({
    action: 'save', apiKey: i === 19 ? KEY_B : KEY_A,
  }));
  assert.deepEqual(await Promise.all(writes), Array.from({length: 20}, () => FILE));
  assert.equal(await readFile(f.filename, 'utf8'), unrelated + `DEEPSEEK_API_KEY=${KEY_B}\n`);
  assert.deepEqual(await readdir(f.directory), ['keys.md']);
});

test('save repairs an empty or malformed single assignment without modifying surrounding text', async t => {
  const f = await fixture(t);
  await mkdir(f.directory);
  for (const value of ['', 'invalid-fixture-value']) {
    await writeFile(f.filename, `before\nDEEPSEEK_API_KEY=${value}\nafter\n`);
    assert.deepEqual(await f.controller.request({action: 'save', apiKey: KEY_A}), FILE);
    assert.equal(await readFile(f.filename, 'utf8'), `before\nDEEPSEEK_API_KEY=${KEY_A}\nafter\n`);
  }
});

test('filesystem and malformed environment failures have only the fixed public error', async t => {
  const f = await fixture(t);
  await mkdir(f.filename, {recursive: true});
  await fixedError(f.controller.request({action: 'snapshot'}));
  await fixedError(f.controller.request({action: 'save', apiKey: KEY_A}));
  const other = await fixture(t, {DEEPSEEK_API_KEY: 'invalid-fixture-key'});
  await fixedError(other.controller.request({action: 'snapshot'}));
  await fixedError(other.controller.request({action: 'save', apiKey: KEY_A}));
  assert.deepEqual(await readdir(other.home), []);
});
