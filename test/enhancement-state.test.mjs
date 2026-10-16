import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { enhancementStatePath, isEnhancementEnabled, setEnhancementEnabled, createEnhancementController } from '../lib/enhancement-state.mjs';
import { createInstallPlan } from '../lib/install-config.mjs';

test('pause survives a new controller, coalesces windows and preserves unrelated data', async t => {
  const dir = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'enhancement-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json'), config = path.join(dir, 'theme.json');
  await writeFile(config, 'preserve theme, account and history');
  assert.equal(await isEnhancementEnabled(file), true);
  let calls = 0, release;
  const controller = createEnhancementController({ file, platform: 'darwin', onDisabled: async () => {
    calls++; await new Promise(resolve => { release = resolve; });
  } });
  const first = controller.request({ action: 'disable', file: '/untrusted/path' });
  const second = controller.request({ action: 'disable' });
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  release();
  assert.deepEqual(await first, { supported: true, enabled: false });
  assert.deepEqual(await second, { supported: true, enabled: false });
  assert.equal(calls, 1);
  const fresh = createEnhancementController({ file, platform: 'darwin' });
  assert.equal((await fresh.request({ action: 'snapshot' })).enabled, false);
  assert.equal(await readFile(config, 'utf8'), 'preserve theme, account and history');
  await setEnhancementEnabled(true, file);
  assert.equal(await isEnhancementEnabled(file), true);
  await writeFile(file, '{invalid');
  assert.equal(await isEnhancementEnabled(file), false, 'Corruption cannot silently re-enable the plugin');
});

test('failed persistence leaves the renderer running and retries after the failure is removed', async t => {
  const dir = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'enhancement-error-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blocker = path.join(dir, 'blocker'), file = path.join(blocker, 'state.json');
  await writeFile(blocker, 'not a directory');
  let calls = 0;
  const controller = createEnhancementController({ file, platform: 'win32', onDisabled: async () => { calls++; } });
  await assert.rejects(controller.request({ action: 'disable' }), { code: 'ENHANCEMENT_ERROR' });
  assert.equal(calls, 0);
  await rm(blocker); await mkdir(blocker);
  await controller.request({ action: 'disable' });
  assert.equal(calls, 1);
  await assert.rejects(controller.request({ action: 'erase-config' }), { code: 'ENHANCEMENT_ERROR' });
});

test('state lives outside replaceable installs on both supported platforms', () => {
  assert.equal(enhancementStatePath({ platform: 'darwin', home: '/Users/fixture', environment: {} }), '/Users/fixture/Library/Application Support/Codex Sidebar Enhancer Data/enhancement-state.json');
  assert.equal(enhancementStatePath({ platform: 'win32', home: 'C:\\Users\\fixture', environment: { LOCALAPPDATA: 'D:\\Data' } }), 'D:\\Data\\CodexSidebarEnhancer\\Data\\enhancement-state.json');
});

test('macOS login preserves pause; explicit launcher resumes without quitting native Codex', { skip: process.platform !== 'darwin' }, async t => {
  const dir = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'enhancement-launch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const file = path.join(dir, 'state.json'), log = path.join(dir, 'commands');
  const plan = createInstallPlan({ home: dir, installDir: root });
  await mkdir(plan.launchAgentsDir, { recursive: true });
  await writeFile(plan.plistPath, 'fixture');
  const script = `function mock_launchctl(){ print -r -- "service $*" >> "$AIYOU_TEST_LOG"; return 0; }\nfunction mock_curl(){ return 0; }\nfunction mock_open(){ print -r -- "open $*" >> "$AIYOU_TEST_LOG"; }\n` + plan.launcherScript
    .replaceAll('/bin/launchctl', 'mock_launchctl').replaceAll('/usr/bin/curl', 'mock_curl').replaceAll('/usr/bin/open', 'mock_open');
  const scriptFile = path.join(dir, 'launcher.zsh'); await writeFile(scriptFile, script);
  const env = { ...process.env, AIYOUCODEX_ENHANCEMENT_STATE_FILE: file, AIYOU_TEST_LOG: log };
  await setEnhancementEnabled(false, file);
  const login = spawnSync('/bin/zsh', [scriptFile, '--login'], { env, encoding: 'utf8' });
  assert.equal(login.status, 0, login.stderr); assert.equal(await isEnhancementEnabled(file), false);
  await assert.rejects(readFile(log), { code: 'ENOENT' });
  const explicit = spawnSync('/bin/zsh', [scriptFile], { env, encoding: 'utf8' });
  assert.equal(explicit.status, 0, explicit.stderr); assert.equal(await isEnhancementEnabled(file), true);
  assert.match(await readFile(log, 'utf8'), /service enable/);
  assert.doesNotMatch(await readFile(log, 'utf8'), /quit|kill|-na/);
  assert.match(plan.loginPlist, /<string>--login<\/string>/);
});

test('disabled native hook emits no enhancement context', async t => {
  const dir = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), 'enhancement-hook-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json'); await setEnhancementEnabled(false, file);
  const result = spawnSync(process.execPath, ['scripts/efficiency-hook.mjs'], { encoding: 'utf8',
    env: { ...process.env, AIYOUCODEX_ENHANCEMENT_STATE_FILE: file }, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture', cwd: dir }) });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), {});
});
