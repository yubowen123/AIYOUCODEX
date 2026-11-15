import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';
import {configuredExtraModel} from '../lib/codex-model-proxy.mjs';
import {DEEPSEEK_CATALOG_PATH, DEEPSEEK_AUTH_HELPER, deepSeekProviderOverrides, readBundledDeepSeekModel} from '../lib/deepseek-config.mjs';
import {createDeepSeekSettingsController, readDeepSeekCredential} from '../lib/deepseek-settings.mjs';

const execFileAsync = promisify(execFile);
const KEY = 'sk-fictionalPortableProviderCredential';

async function fixture(t) {
  const home = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'deepseek-portable-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  return {home, env: {CODEX_HOME: home}, configPath: path.join(home, 'config.toml')};
}

async function seedNativeModels(home) {
  const publicModel = {...await readBundledDeepSeekModel(), slug: 'gpt-fixture', display_name: 'Synthetic GPT'};
  await writeFile(path.join(home, 'models_cache.json'), JSON.stringify({models: [publicModel]}));
}

test('a fresh user without native metadata keeps GPT and does not expose an unsafe DeepSeek fallback', async t => {
  const f = await fixture(t);
  assert.deepEqual(await configuredExtraModel(f.env), {catalogUnavailable: true});
  assert.deepEqual(await readdir(f.home), []);
});

test('a fresh user with native metadata receives the bundled model without editing configuration or login files', async t => {
  const f = await fixture(t);
  await seedNativeModels(f.home);
  const routing = await configuredExtraModel(f.env);
  assert.equal(routing.extraModel.model, 'deepseek-flash');
  assert.equal(routing.extraModel.isDefault, false);
  assert.equal(routing.catalogPath, DEEPSEEK_CATALOG_PATH);
  assert.deepEqual((await readdir(f.home)).sort(), ['models', 'models_cache.json']);
  const provider = parse(routing.providerArgs[1]).model_providers.deepseek;
  assert.equal(provider.base_url, 'https://api.deepseek.com');
  assert.equal(provider.wire_api, 'responses');
  assert.equal(provider.requires_openai_auth, false);
  assert.equal(provider.auth.command, process.execPath);
  assert.deepEqual(provider.auth.args, [DEEPSEEK_AUTH_HELPER, '--codex-auth']);
  assert.equal(provider.env_key, undefined);
  assert.equal(provider.experimental_bearer_token, undefined);
});

test('bundled model metadata supplies only supported choices and neutral provider identity', async () => {
  const model = await readBundledDeepSeekModel();
  assert.equal(model.context_window, 1048576);
  assert.equal(model.max_context_window, 1048576);
  assert.equal(model.comp_hash, null);
  assert.deepEqual(model.input_modalities, ['text', 'image']);
  assert.deepEqual(model.supported_reasoning_levels.map(x => x.effort), ['low', 'high', 'max']);
  assert.match(model.model_messages.instructions_template, /powered by DeepSeek/);
  assert.doesNotMatch(JSON.stringify(model), /\/Users\/|sk-[A-Za-z0-9]{16}|based on GPT/);
});

test('native helper paths with spaces, quotes, unicode and Windows separators remain valid TOML arguments', () => {
  for (const [nodePath, helperPath] of [
    ['/Applications/Node Runtime/node', '/Shared/含空格 路径/deepseek-auth.mjs'],
    ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Example\\AIYOUcodex\\deepseek-auth.mjs'],
    ['/tmp/node"test', '/tmp/quote" helper.mjs'],
  ]) {
    const args = deepSeekProviderOverrides({nodePath, helperPath});
    const provider = parse(args[1]).model_providers.deepseek;
    assert.equal(provider.auth.command, nodePath);
    assert.equal(provider.auth.args[0], helperPath);
  }
});

test('existing official provider credentials, default GPT and login files remain untouched', async t => {
  const f = await fixture(t);
  const config = 'model="gpt-fixture"\nmodel_provider="openai"\n[model_providers.deepseek]\nname="My existing DeepSeek"\nbase_url="https://api.deepseek.com"\nwire_api="responses"\nenv_key="MY_EXISTING_KEY"\n';
  const authPath = path.join(f.home, 'auth.json');
  const auth = '{"fixture":"synthetic-login"}\n';
  await writeFile(f.configPath, config);
  await writeFile(authPath, auth);
  await seedNativeModels(f.home);
  const routing = await configuredExtraModel(f.env);
  assert.equal(routing.extraModel.model, 'deepseek-flash');
  assert.deepEqual(routing.providerArgs, ['-c', 'thread_unload_delay_secs=0']);
  assert.equal(await readFile(f.configPath, 'utf8'), config);
  assert.equal(await readFile(authPath, 'utf8'), auth);
});

test('explicit custom providers and profiles remain authoritative and malformed config fails closed', async t => {
  const f = await fixture(t);
  for (const config of [
    'model_provider="custom"\n',
    '[model_providers.deepseek]\nbase_url="https://example.invalid"\nwire_api="responses"\n',
    '[model_providers.deepseek]\nbase_url="https://api.deepseek.com"\nwire_api="chat"\n',
    'not valid toml',
  ]) {
    await writeFile(f.configPath, config);
    assert.deepEqual(await configuredExtraModel(f.env), {});
    assert.equal(await readFile(f.configPath, 'utf8'), config);
  }
  await writeFile(f.configPath, '[profiles.custom]\nmodel_provider="custom"\n');
  for (const args of [['-p', 'custom'], ['--profile=custom'], ['--profile', 'missing'],
    ['-c', 'model_provider="custom"'], ['--config=model_provider="custom"'],
    ['-c', 'model_providers.deepseek.base_url="https://example.invalid"']]) {
    assert.deepEqual(await configuredExtraModel(f.env, args), {});
  }
  assert.deepEqual(await configuredExtraModel({...f.env, AIYOUCODEX_MODEL_ROUTER_ENABLED: '0'}), {});
});

test('settings and the provider read the same portable private credential file', async t => {
  const f = await fixture(t);
  const controller = createDeepSeekSettingsController({home: path.join(f.home, 'unused'), env: f.env});
  const result = await controller.request({action: 'save', apiKey: KEY});
  assert.equal(result.configured, true);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(await readDeepSeekCredential({env: f.env}), KEY);
  assert.deepEqual(await readdir(f.home), ['keys.md']);
  const child = await execFileAsync(process.execPath, [DEEPSEEK_AUTH_HELPER, '--codex-auth'], {env: f.env});
  assert.equal(child.stdout, KEY + '\n');
  assert.equal(child.stderr, '');
});

test('the provider checks its environment first and never falls back from a malformed environment key', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.home, 'keys.md'), 'DEEPSEEK_API_KEY=invalid\n');
  assert.equal(await readDeepSeekCredential({env: {...f.env, DEEPSEEK_API_KEY: KEY}}), KEY);
  await assert.rejects(readDeepSeekCredential({env: {...f.env, DEEPSEEK_API_KEY: 'invalid'}}), error =>
    error.code === 'DEEPSEEK_SETTINGS_ERROR' && !error.message.includes('invalid'));
});

test('missing keys and direct helper invocation fail with controlled diagnostics and no stdout', async t => {
  const f = await fixture(t);
  for (const args of [[DEEPSEEK_AUTH_HELPER, '--codex-auth'], [DEEPSEEK_AUTH_HELPER]]) {
    await assert.rejects(execFileAsync(process.execPath, args, {env: f.env}), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.doesNotMatch(error.stderr, /stack|keys\.md|ENOENT|sk-/);
      return true;
    });
  }
  assert.deepEqual(await readdir(f.home), []);
});
