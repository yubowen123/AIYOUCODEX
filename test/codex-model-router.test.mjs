import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelRouter } from '../lib/codex-model-router.mjs';

const deepseek = {
  id: 'deepseek-flash', model: 'deepseek-flash', displayName: 'DeepSeek V4.1 Flash',
  supportedReasoningEfforts: [{reasoningEffort: 'low'}, {reasoningEffort: 'high'}, {reasoningEffort: 'max'}],
};

function fixture({ busy = false, status = 'idle', unloadError = false, onUnsubscribe,
  compactionUsage = 10000, compactionStatus = 'completed', unrelatedCompletion = false,
  resolveContextWindow = async model => ({'gpt-6.1-sol': 500000, 'gpt-5.5': 272000}[model] ?? null)} = {}) {
  const calls = [], loaded = new Map(), stored = new Map();
  const call = async (method, params) => {
    calls.push({method, params: structuredClone(params)});
    if (method === 'model/list') return {data: [{id: 'gpt-6.1-sol', model: 'gpt-6.1-sol'}], nextCursor: null};
    if (method === 'thread/start') {
      const thread = {id: 'thread-one', modelProvider: params.modelProvider || 'openai', status: {type: 'idle'}};
      loaded.set(thread.id, thread); stored.set(thread.id, {...thread});
      return {thread, model: params.model, modelProvider: thread.modelProvider};
    }
    if (method === 'thread/read') return {thread: {...stored.get(params.threadId), status: {type: busy ? 'active' : status}}};
    if (method === 'thread/unsubscribe') {
      if (unloadError) throw new Error('unload failed');
      onUnsubscribe?.(params.threadId);
      loaded.delete(params.threadId); return {status: 'unsubscribed'};
    }
    if (method === 'thread/loaded/list') return {data: [...loaded.keys()]};
    if (method === 'thread/compact/start') {
      queueMicrotask(() => {
        router.notification({method: 'turn/started', params: {threadId: params.threadId, turn: {id: 'compact-one'}}});
        if (unrelatedCompletion) router.notification({method: 'turn/completed', params: {threadId: params.threadId, turn: {id: 'older-turn', status: 'failed'}}});
        router.notification({method: 'thread/tokenUsage/updated', params: {threadId: params.threadId, tokenUsage: {last: {totalTokens: compactionUsage}}}});
        router.notification({method: 'turn/completed', params: {threadId: params.threadId, turn: {id: 'compact-one', status: compactionStatus}}});
      });
      return {};
    }
    if (method === 'thread/resume') {
      if (loaded.has(params.threadId)) return {thread: loaded.get(params.threadId), modelProvider: loaded.get(params.threadId).modelProvider};
      const thread = {...stored.get(params.threadId), modelProvider: params.modelProvider || 'openai'};
      stored.set(thread.id, thread); loaded.set(thread.id, thread);
      return {thread, model: params.model, modelProvider: thread.modelProvider};
    }
    if (method === 'turn/start') return {turn: {id: 'turn-one'}, provider: loaded.get(params.threadId)?.modelProvider};
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    return {ok: true};
  };
  const router = createModelRouter({call, extraModel: deepseek, catalogPath: '/private/models/deepseek-flash.json', resolveContextWindow, sleep: async () => {}});
  return {router, calls, loaded};
}

test('native model menu preserves GPT and appends one DeepSeek entry only on the last page', async () => {
  const {router} = fixture();
  const menu = await router.request('model/list', {});
  assert.deepEqual(menu.data.map(x => x.model), ['gpt-6.1-sol', 'deepseek-flash']);
  assert.equal(menu.data[1].displayName, 'DeepSeek V4.1 Flash');
});

test('ordinary GPT requests and account login requests pass through unchanged', async () => {
  const {router, calls} = fixture();
  const params = {model: 'gpt-6.1-sol', cwd: '/workspace', developerInstructions: 'keep context', config: {foo: 1}};
  await router.request('thread/start', params);
  assert.deepEqual(calls[0], {method: 'thread/start', params});
  assert.deepEqual(await router.request('account/read', {refreshToken: false}), {account: {type: 'chatgpt'}});
});

test('unavailable native catalog prevents new and restored DeepSeek generation or compaction', async () => {
  const calls = [];
  const router = createModelRouter({catalogUnavailable: true, call: async (method, params) => {
    calls.push({method, params});
    if (method === 'thread/read') return {thread: {id: params.threadId, modelProvider: 'deepseek'}};
    throw new Error('Unexpected native mutation');
  }});
  await assert.rejects(router.request('thread/start', {model: 'deepseek-flash'}), /完整模型目录未加载/);
  await assert.rejects(router.request('thread/start', {modelProvider: 'deepseek'}), /完整模型目录未加载/);
  for (const method of ['thread/resume', 'thread/fork', 'turn/start', 'thread/settings/update', 'thread/compact/start']) {
    await assert.rejects(router.request(method, {threadId: 'stored-ds'}), /完整模型目录未加载/);
  }
  assert.ok(calls.every(x => x.method === 'thread/read'));
});

test('unavailable additive catalog preserves ordinary GPT operations and account access', async () => {
  const calls = [];
  const router = createModelRouter({catalogUnavailable: true, call: async (method, params) => {
    calls.push({method, params});
    return method === 'thread/read' ? {thread: {id: params.threadId, modelProvider: 'openai'}} : {ok: true};
  }});
  const params = {model: 'gpt-6.1-sol'};
  assert.deepEqual(await router.request('thread/start', params), {ok: true});
  await router.request('turn/start', {threadId: 'gpt', ...params});
  await router.request('account/read', {refreshToken: false});
  assert.deepEqual(calls[0], {method: 'thread/start', params});
  assert.equal(calls.at(-1).method, 'account/read');
});

test('the first turn of a new cached thread does not require a rollout to already exist', async () => {
  const calls = [];
  const call = async (method, params) => {
    calls.push(method);
    if (method === 'thread/start') return {thread: {id: 'new', modelProvider: 'openai'}, modelProvider: 'openai', model: 'gpt-6.1-sol'};
    if (method === 'thread/read') throw new Error('No rollout exists yet');
    return {turn: {id: 'first'}};
  };
  const router = createModelRouter({call, extraModel: deepseek, catalogPath: '/catalog'});
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  assert.deepEqual(await router.request('turn/start', {threadId: 'new', model: 'gpt-6.1-sol', input: []}), {turn: {id: 'first'}});
  assert.deepEqual(calls, ['thread/start', 'turn/start']);
});

test('a new DeepSeek conversation selects the DeepSeek provider without changing global config', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'deepseek-flash', cwd: '/workspace', config: {keep: 'yes'}});
  assert.equal(calls[0].params.modelProvider, 'deepseek');
  assert.deepEqual(calls[0].params.config, {
    keep: 'yes', model_catalog_json: '/private/models/deepseek-flash.json',
    web_search: 'disabled', model_reasoning_summary: 'none',
  });
});

test('GPT → DeepSeek → GPT unloads before reloading the same thread and preserves user settings', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'gpt-6.1-sol', cwd: '/workspace', developerInstructions: 'keep context', config: {keep: true}});
  const result = await router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: [{type: 'text', text: 'synthetic'}], effort: 'xhigh', serviceTier: 'priority'});
  assert.equal(result.provider, 'deepseek');
  const firstResume = calls.find(x => x.method === 'thread/resume');
  assert.equal(firstResume.params.threadId, 'thread-one');
  assert.equal(firstResume.params.developerInstructions, 'keep context');
  assert.equal(firstResume.params.cwd, '/workspace');
  assert.equal(firstResume.params.config.keep, true);
  const dsTurn = calls.filter(x => x.method === 'turn/start').at(-1).params;
  assert.equal(dsTurn.effort, 'max');
  assert.equal(dsTurn.summary, 'none');
  assert.equal(dsTurn.serviceTier, null);
  const back = await router.request('turn/start', {threadId: 'thread-one', model: 'gpt-6.1-sol', input: []});
  assert.equal(back.provider, 'openai');
  const lastResume = calls.filter(x => x.method === 'thread/resume').at(-1).params;
  assert.deepEqual(lastResume.config, {keep: true});
  assert.ok(calls.findIndex(x => x.method === 'thread/unsubscribe') < calls.findIndex(x => x.method === 'thread/resume'));
});

test('a long DeepSeek history compacts once on its original provider before switching to a smaller GPT', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'deepseek-flash', config: {keep: true}});
  router.notification({method: 'thread/tokenUsage/updated', params: {threadId: 'thread-one', tokenUsage: {last: {totalTokens: 600000}}}});
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'gpt-5.5'});
  const reload = calls.filter(x => x.method === 'thread/resume').at(-1).params;
  assert.equal(reload.model, 'gpt-5.5');
  assert.deepEqual(reload.config, {keep: true}, 'Ineffective thread-level window overrides must not alter native metadata');
  assert.equal(calls.filter(x => x.method === 'thread/compact/start').length, 1);
  assert.ok(calls.findIndex(x => x.method === 'thread/compact/start') < calls.findIndex(x => x.method === 'thread/unsubscribe'));
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'gpt-6.1-sol'});
  assert.equal(calls.filter(x => x.method === 'thread/unsubscribe').length, 1, 'Ordinary GPT model changes remain native');
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'deepseek-flash'});
  assert.equal(calls.filter(x => x.method === 'thread/resume').at(-1).params.config.model_context_window, undefined);
});

test('only the managed compaction turn can finish preparation for a provider switch', async () => {
  const {router, calls} = fixture({unrelatedCompletion: true});
  await router.request('thread/start', {model: 'deepseek-flash'});
  router.notification({method: 'thread/tokenUsage/updated', params: {threadId: 'thread-one', tokenUsage: {last: {totalTokens: 600000}}}});
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'gpt-5.5'});
  assert.equal(calls.filter(x => x.method === 'thread/compact/start').length, 1);
  assert.equal(calls.filter(x => x.method === 'thread/resume').at(-1).params.modelProvider, 'openai');
});

test('a short DeepSeek history returns to GPT without unnecessary compaction', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'deepseek-flash'});
  router.notification({method: 'thread/tokenUsage/updated', params: {threadId: 'thread-one', tokenUsage: {last: {totalTokens: 100000}}}});
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'gpt-6.1-sol'});
  assert.equal(calls.some(x => x.method === 'thread/compact/start'), false);
});

for (const options of [{compactionUsage: 300000}, {compactionStatus: 'interrupted'}]) {
  test(`a failed or insufficient compact never loops or switches providers: ${JSON.stringify(options)}`, async () => {
    const {router, calls} = fixture(options);
    await router.request('thread/start', {model: 'deepseek-flash'});
    router.notification({method: 'thread/tokenUsage/updated', params: {threadId: 'thread-one', tokenUsage: {last: {totalTokens: 600000}}}});
    await assert.rejects(router.request('thread/settings/update', {threadId: 'thread-one', model: 'gpt-5.5'}), /压缩/);
    assert.equal(calls.filter(x => x.method === 'thread/compact/start').length, 1);
    assert.equal(calls.some(x => x.method === 'thread/unsubscribe' || x.method === 'turn/start'), false);
  });
}

test('missing target window metadata rejects a return to GPT before releasing the original thread', async () => {
  const {router, calls} = fixture({resolveContextWindow: async () => null});
  await router.request('thread/start', {model: 'deepseek-flash'});
  await assert.rejects(router.request('turn/start', {threadId: 'thread-one', model: 'gpt-6.1-sol', input: []}), /上下文/);
  assert.equal(calls.some(x => x.method === 'thread/unsubscribe' || x.method === 'turn/start'), false);
});

test('a busy thread is never unloaded, interrupted or sent to a different provider', async () => {
  const {router, calls} = fixture({busy: true});
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  await assert.rejects(router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: []}), /生成|busy/);
  assert.ok(!calls.some(x => x.method === 'thread/unsubscribe' || x.method === 'turn/start'));
});

test('a finished provider error can recover by switching models while an active error cannot be unloaded', async () => {
  const {router, calls} = fixture({status: 'systemError'});
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  router.notification({method: 'turn/started', params: {threadId: 'thread-one'}});
  await assert.rejects(router.request('thread/settings/update', {threadId: 'thread-one', model: 'deepseek-flash'}), /生成/);
  assert.equal(calls.some(x => x.method === 'thread/unsubscribe'), false);
  router.notification({method: 'turn/completed', params: {threadId: 'thread-one', turn: {status: 'failed'}}});
  await router.request('thread/settings/update', {threadId: 'thread-one', model: 'deepseek-flash'});
  assert.equal(calls.filter(x => x.method === 'thread/resume').at(-1).params.modelProvider, 'deepseek');
});

test('failed unload fails closed and never submits the turn through the old provider', async () => {
  const {router, calls} = fixture({unloadError: true});
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  await assert.rejects(router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: []}), /unload failed/);
  assert.ok(!calls.some(x => x.method === 'turn/start'));
});

test('without a configured DeepSeek provider the original model menu is returned', async () => {
  let seen;
  const router = createModelRouter({call: async (method, params) => {seen = {method, params}; return {data: [{model: 'gpt-6.1-sol'}]};}});
  const menu = await router.request('model/list', {cursor: 'second'});
  assert.deepEqual(menu.data, [{model: 'gpt-6.1-sol'}]);
  assert.deepEqual(seen, {method: 'model/list', params: {cursor: 'second'}});
});

test('native provider-filtered history still includes conversations switched to DeepSeek', async () => {
  let captured;
  const router = createModelRouter({extraModel: deepseek, catalogPath: '/catalog', call: async (method, params) => {captured = params; return {data: []};}});
  await router.request('thread/list', {modelProviders: ['openai'], limit: 100});
  assert.deepEqual(captured, {modelProviders: ['openai', 'deepseek'], limit: 100});
});

test('desktop collaborationMode model takes precedence and its effort is normalized for DeepSeek', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  const result = await router.request('turn/start', {threadId: 'thread-one', model: null, input: [],
    collaborationMode: {mode: 'default', settings: {model: 'deepseek-flash', reasoning_effort: 'ultra', developer_instructions: 'preserve mode'}}});
  assert.equal(result.provider, 'deepseek');
  const turn = calls.filter(x => x.method === 'turn/start').at(-1).params;
  assert.equal(turn.collaborationMode.settings.model, 'deepseek-flash');
  assert.equal(turn.collaborationMode.settings.reasoning_effort, 'max');
  assert.equal(turn.collaborationMode.settings.developer_instructions, 'preserve mode');
});

test('latest sticky workspace and named permissions survive a provider reload', async () => {
  const {router, calls} = fixture();
  await router.request('thread/start', {model: 'gpt-6.1-sol', cwd: '/first', runtimeWorkspaceRoots: ['/first'], permissions: ':workspace'});
  await router.request('turn/start', {threadId: 'thread-one', model: 'gpt-6.1-sol', cwd: '/latest', runtimeWorkspaceRoots: ['/latest'], permissions: ':read-only', input: []});
  await router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: []});
  const reload = calls.find(x => x.method === 'thread/resume').params;
  assert.equal(reload.cwd, '/latest');
  assert.deepEqual(reload.runtimeWorkspaceRoots, ['/latest']);
  assert.equal(reload.permissions, ':read-only');
  assert.equal(reload.sandbox, undefined);
});

test('an exact sandbox override is restored for the first model turn after reloading', async () => {
  const {router, calls} = fixture();
  const policy = {type: 'workspaceWrite', writableRoots: ['/latest'], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true};
  await router.request('thread/start', {model: 'gpt-6.1-sol', permissions: ':full-access'});
  await router.request('turn/start', {threadId: 'thread-one', model: 'gpt-6.1-sol', sandboxPolicy: policy, input: []});
  await router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: []});
  const reload = calls.find(x => x.method === 'thread/resume').params;
  assert.equal(reload.permissions, undefined);
  assert.equal(reload.sandbox, 'read-only');
  const turn = calls.filter(x => x.method === 'turn/start').at(-1).params;
  assert.deepEqual(turn.sandboxPolicy, policy);
  assert.equal(turn.permissions, undefined);
});

test('a provider switch does not expose internal thread/closed notifications to the native view', async () => {
  let duringReload, router;
  const setup = fixture({onUnsubscribe(threadId) {
    duringReload = router.notification({method: 'thread/closed', params: {threadId}});
    assert.equal(router.notification({method: 'thread/closed', params: {threadId: 'unrelated'}}), true);
  }});
  router = setup.router;
  await router.request('thread/start', {model: 'gpt-6.1-sol'});
  assert.equal(router.notification({method: 'thread/closed', params: {threadId: 'thread-one'}}), true);
  await router.request('turn/start', {threadId: 'thread-one', model: 'deepseek-flash', input: []});
  assert.equal(duringReload, false);
  assert.equal(router.notification({method: 'thread/closed', params: {threadId: 'thread-one'}}), true);
});

for (const historyMode of ['legacy', 'paginated']) test(`an empty ${historyMode} thread is materialized without adding a message before the model menu changes provider`, async () => {
  const thread = {id: 'empty', modelProvider: 'openai', historyMode, ephemeral: false, name: null, section: null, status: {type: 'idle'}};
  let persisted = false;
  const calls = [];
  const router = createModelRouter({extraModel: deepseek, catalogPath: '/catalog', sleep: async () => {}, isPersisted: async () => persisted,
    call: async (method, params) => {
      calls.push(method);
      if (method === 'thread/read') return {thread: {...thread}};
      if (method === 'thread/section/move') {assert.equal(params.sectionId, null); persisted = true; return {};}
      if (method === 'thread/unsubscribe') {assert.equal(persisted, true); return {status: 'unsubscribed'};}
      if (method === 'thread/loaded/list') return {data: []};
      if (method === 'thread/resume') {thread.modelProvider = params.modelProvider; return {thread: {...thread}, modelProvider: params.modelProvider};}
      return {};
    }});
  await router.request('thread/settings/update', {threadId: 'empty', model: 'deepseek-flash'});
  assert.equal(thread.modelProvider, 'deepseek');
  assert.ok(calls.indexOf('thread/section/move') < calls.indexOf('thread/unsubscribe'));
  assert.ok(!calls.includes('turn/start'));
  assert.equal(thread.name, null);
});

test('native path-based resume keeps its own resolution precedence without inspecting a placeholder thread ID', async () => {
  const calls = [];
  const router = createModelRouter({extraModel: deepseek, catalogPath: '/catalog', call: async (method, params) => {
    calls.push({method, params});
    return {thread: {id: 'actual', modelProvider: 'openai'}, modelProvider: 'openai'};
  }});
  const params = {threadId: 'placeholder', path: '/rollout.jsonl', model: 'gpt-6.1-sol'};
  await router.request('thread/resume', params);
  assert.deepEqual(calls, [{method: 'thread/resume', params}]);
});
