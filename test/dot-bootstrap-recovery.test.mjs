import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../inject/claude-code.user.js', import.meta.url), 'utf8');
const match = source.match(/  async function recoverDotBootstrap\([\s\S]*?(?=  async function dotRouter\()/);
// Removing the recovery must fail this regression before any fixture runs.
test('renderer includes recovery for failed native Dot bootstrap', () => assert.ok(match, 'Missing official bootstrap recovery'));
const recover = match && vm.runInNewContext(`(${match[0].trim()})`, { AbortSignal });
const gates = ['codex-app-aeon-cloud-mode', 'codex-app-aeon-cloud-mode-no-executor', 'codex-app-side-orb-enabled'];
function fixture({ enabled = true } = {}) {
  let user = { userID: 'user-a', appVersion: '26.test', locale: 'zh-CN', customIDs: { account_id: 'account-a', stableID: 'stable-a' }, custom: { auth_method: 'chatgpt', brand_name: 'codex', codex_build_flavor: 'prod', codex_app_session_id: 'session-a', systemName: 'macOS', systemVersion: '26', codex_window_type: 'electron', desktop_app_beta_enabled: false } };
  let values = Object.fromEntries(gates.map(n => [n, false])), pending;
  const applied = [], calls = [];
  const payload = { user: { ...structuredClone(user), custom: { ...user.custom, is_paid: true, server_only: 'preserve' } }, feature_gates: Object.fromEntries(gates.map(n => [n, { value: enabled && n !== gates[1] }])) };
  const client = { loadingStatus: 'Ready', getContext: () => ({ user }), getFeatureGate: n => ({ value: values[n] }), dataAdapter: { setData(raw) { pending = JSON.parse(raw); } }, updateUserSync(next, options) { applied.push({ next, options }); user = next; values = Object.fromEntries(gates.map(n => [n, pending.feature_gates[n].value])); return { success: true }; } };
  const api = { async safePost(path, options) { calls.push({ path, options }); return { statsigPayload: JSON.stringify(payload) }; } };
  return { client, api, payload, applied, calls };
}
test('failed fallback recovers full server identity and real gate values', { skip: !recover }, async () => {
  const f = fixture(), result = await recover(f);
  assert.equal(result.phase, 'recovered');
  assert.equal(f.calls[0].path, '/wham/statsig/bootstrap');
  assert.equal(f.calls[0].options.retry, false);
  assert.equal('desktop_app_beta_enabled' in f.calls[0].options.requestBody, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.applied[0].next)), f.payload.user);
  assert.equal(f.applied[0].options.disableBackgroundCacheRefresh, true);
  assert.equal(f.client.getFeatureGate(gates[0]).value, true);
  assert.equal(f.client.getFeatureGate(gates[1]).value, false);
});
test('official denial stays disabled, and already enabled clients make no request', { skip: !recover }, async () => {
  const denied = fixture({ enabled: false });
  assert.equal((await recover(denied)).phase, 'disabled');
  assert.equal(denied.client.getFeatureGate(gates[0]).value, false);
  const enabled = fixture();
  await recover(enabled);
  const count = enabled.calls.length;
  assert.equal((await recover(enabled)).phase, 'available');
  assert.equal(enabled.calls.length, count);
});
test('wrong account response and account switches never apply configuration', { skip: !recover }, async () => {
  const wrong = fixture(); wrong.payload.user.customIDs.account_id = 'other-account';
  assert.equal((await recover(wrong)).phase, 'identity-changed');
  assert.equal(wrong.applied.length, 0);
  const switched = fixture();
  assert.equal((await recover({ ...switched, isCurrent: () => false })).phase, 'identity-changed');
  assert.equal(switched.applied.length, 0);
});
test('network failures remain bounded and never expose response details', { skip: !recover }, async () => {
  const f = fixture(); f.api.safePost = async () => { throw Error('private server details'); };
  const result = await recover(f);
  assert.equal(result.phase, 'failed');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(f.applied.length, 0);
});
test('startup recovery waits for the delayed native fallback and stops after recovery', () => {
  const scheduleSource = source.match(/  function scheduleDotRecovery\([\s\S]*?(?=  function dotNotice\()/)?.[0];
  assert.ok(scheduleSource);
  const pending = [];
  let attempts = 0;
  const context = vm.createContext({ destroyed: false, dotRecovery: { phase: 'idle' }, dotRecoveryTimer: null,
    setTimeout(callback) { pending.push(callback); return pending.length; },
    async recoverDotConfiguration() { if (++attempts === 4) context.dotRecovery = { phase: 'recovered' }; } });
  vm.runInContext(`${scheduleSource};scheduleDotRecovery()`, context);
  return (async () => {
    while (pending.length) await pending.shift()();
    assert.equal(attempts, 4);
    context.destroyed = true;
    vm.runInContext('scheduleDotRecovery()', context);
    await pending.shift()();
    assert.equal(attempts, 4, 'Destroyed renderer never retries background work');
  })();
});
