const DEEPSEEK_MODEL = 'deepseek-flash';
const DEFAULT_PROVIDER = 'openai';
const RESUME_KEYS = ['cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'baseInstructions',
  'developerInstructions', 'personality', 'config', 'runtimeWorkspaceRoots', 'permissions',
  'serviceTier', 'excludeTurns', 'initialTurnsPage'];
const STICKY_TURN_KEYS = ['cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'permissions', 'serviceTier', 'personality'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const failure = message => Object.assign(new Error(message), {code: -32000});

/** Route only the additive DeepSeek model. Never write config, credentials or history. */
export function createModelRouter({call, extraModel, catalogPath, catalogUnavailable = false, sleep = wait, unloadAttempts = 100,
  isPersisted = async () => true, resolveContextWindow = async () => null, compactionTimeoutMs = 150000} = {}) {
  const enabled = Boolean(extraModel && catalogPath);
  const threads = new Map(), queues = new Map(), switching = new Set(), active = new Set();
  const compactions = new Map();
  const nativeModels = new Set();
  const desiredProvider = model => model === DEEPSEEK_MODEL ? 'deepseek'
    : typeof model === 'string' && (nativeModels.has(model) || model.startsWith('gpt-')) ? DEFAULT_PROVIDER : null;

  function routedParams(params, provider) {
    if (provider !== 'deepseek') return params;
    return {...params, model: DEEPSEEK_MODEL, modelProvider: 'deepseek', serviceTier: null,
      config: {...params.config, model_catalog_json: catalogPath, web_search: 'disabled', model_reasoning_summary: 'none'}};
  }

  function remember(result, params) {
    const thread = result?.thread;
    if (!thread?.id) return;
    const previous = threads.get(thread.id);
    const original = Object.fromEntries(RESUME_KEYS.filter(key => params[key] !== undefined).map(key => [key, params[key]]));
    const resume = {...previous?.resume, ...original};
    for (const key of ['cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer']) {
      if (result[key] != null) resume[key] = result[key];
    }
    if (result.activePermissionProfile?.id) {
      resume.permissions = result.activePermissionProfile.id;
      delete resume.sandbox;
    } else if (resume.permissions) delete resume.sandbox;
    threads.set(thread.id, {...previous, provider: result.modelProvider || thread.modelProvider || DEFAULT_PROVIDER,
      model: result.model || thread.model || params.model || previous?.model, resume});
  }

  function stickyOptions(current, params) {
    const resume = {...current.resume};
    const turnOptions = {...current.turnOptions};
    for (const key of STICKY_TURN_KEYS) if (params[key] != null) resume[key] = params[key];
    if (params.environments != null) turnOptions.environments = params.environments;
    if (params.permissions != null) {
      delete resume.sandbox;
      delete turnOptions.sandboxPolicy;
    } else if (params.sandboxPolicy != null) {
      // Legacy per-turn policies have no exact resume equivalent. Reload with
      // read-only access, then restore the exact policy before any model turn.
      delete resume.permissions;
      resume.sandbox = 'read-only';
      turnOptions.sandboxPolicy = params.sandboxPolicy;
    }
    return {resume, turnOptions};
  }

  async function inspect(threadId) {
    const {thread} = await call('thread/read', {threadId, includeTurns: false});
    if (!thread) throw failure('无法读取当前对话，未切换模型。');
    return thread;
  }

  async function compactBeforeSwitch(threadId, targetBudget) {
    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    const timer = setTimeout(() => finish({status: 'timeout'}), compactionTimeoutMs);
    timer.unref?.();
    compactions.set(threadId, {finish, turnId: null});
    try {
      // Compact on the original provider, once. Never retry or switch providers
      // if compaction was interrupted, failed, or did not make sufficient room.
      await call('thread/compact/start', {threadId});
      const result = await completion;
      if (result.status !== 'completed') throw failure('压缩未完成，保留原提供方；未切换模型或重复提交压缩。');
      const usage = threads.get(threadId)?.lastUsage;
      if (!Number.isSafeInteger(usage) || usage > targetBudget) {
        throw failure('压缩后上下文仍不适合目标模型，保留原提供方；未循环压缩或提交新请求。');
      }
      const thread = await inspect(threadId);
      if (active.has(threadId) || thread.status?.type === 'active') throw failure('压缩结束状态尚未确认，未释放原对话。');
    } finally { clearTimeout(timer); compactions.delete(threadId); }
  }

  async function ensureProvider(threadId, provider, model, resumeOverride = {}) {
    const known = threads.get(threadId);
    if (known?.provider === provider) return;
    const thread = await inspect(threadId);
    const current = {provider: thread.modelProvider || DEFAULT_PROVIDER, resume: {}, ...threads.get(threadId)};
    const mergedResume = {...current.resume, ...resumeOverride};
    if (current.provider === provider) return;
    if (active.has(threadId) || thread.status?.type === 'active') {
      throw failure('当前回答仍在生成，请结束后再切换模型；未中断或提交请求。');
    }
    // Native systemError is idle with an error flag; active turns/approvals
    // have already been excluded above, so a failed request can recover here.
    if (thread.status && !['idle', 'notLoaded', 'systemError'].includes(thread.status.type)) {
      throw failure('当前对话状态不可用于切换模型，请稍后重试。');
    }
    if (provider === DEFAULT_PROVIDER && current.provider === 'deepseek') {
      const size = await resolveContextWindow(model, mergedResume.config || {});
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw failure('无法确认目标 GPT 模型的上下文上限，未释放对话或提交请求；请刷新模型目录后重试。');
      }
      const budget = Math.floor(size * 0.8);
      if (current.hasTurns !== false && (!Number.isSafeInteger(current.lastUsage) || current.lastUsage > budget)) {
        if (thread.status?.type === 'notLoaded') {
          const original = {threadId, ...current.resume, model: DEEPSEEK_MODEL, modelProvider: 'deepseek'};
          remember(await call('thread/resume', routedParams(original, 'deepseek')), original);
        }
        await compactBeforeSwitch(threadId, budget);
      }
    }
    if (!await isPersisted(thread)) {
      if (thread.ephemeral || !['legacy', 'paginated'].includes(thread.historyMode) || thread.section !== null) {
        throw failure('当前对话尚不可安全重载，未释放或更改原对话。');
      }
      // A same-value section operation materializes only the session metadata;
      // it creates no user/assistant message and leaves title/order unchanged.
      await call('thread/section/move', {threadId, sectionId: null});
      const persisted = await inspect(threadId);
      if (!await isPersisted(persisted) || ['id', 'name', 'section', 'projectId', 'cwd', 'modelProvider']
        .some(key => JSON.stringify(thread[key]) !== JSON.stringify(persisted[key]))) {
        throw failure('对话保存尚未核验，未释放原对话。');
      }
    }
    switching.add(threadId);
    try {
      await call('thread/unsubscribe', {threadId});
      let unloaded = false;
      for (let attempt = 0; attempt < unloadAttempts; attempt++) {
        const loaded = await call('thread/loaded/list', {});
        if (!(loaded.data || []).includes(threadId)) { unloaded = true; break; }
        await sleep(50);
      }
      if (!unloaded) throw failure('对话尚未释放，未更改提供方，也未提交请求。');
      const params = {threadId, ...mergedResume, model, modelProvider: provider};
      try {
        const result = await call('thread/resume', routedParams(params, provider));
        const actual = result.modelProvider || result.thread?.modelProvider;
        if (actual !== provider) throw failure('提供方回读不一致，未提交模型请求。');
        remember(result, params);
        return result;
      } catch (error) {
        // Restore the idle thread if possible; never send the failed turn elsewhere.
        const restore = {threadId, ...current.resume, model: current.model, modelProvider: current.provider};
        try { remember(await call('thread/resume', routedParams(restore, current.provider)), restore); } catch {}
        throw error;
      }
    } finally { switching.delete(threadId); }
  }

  async function route(method, params = {}) {
    if (method === 'model/list') {
      const result = await call(method, params);
      for (const model of result.data || []) nativeModels.add(model.model);
      if (!enabled || result.nextCursor || nativeModels.has(DEEPSEEK_MODEL)) return result;
      return {...result, data: [...(result.data || []), structuredClone(extraModel)]};
    }
    if (!enabled) {
      if (catalogUnavailable && ['thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'thread/settings/update', 'thread/compact/start'].includes(method)) {
        const selected = params.collaborationMode?.settings?.model || params.model;
        const stored = params.threadId ? await inspect(params.threadId) : null;
        if (selected === DEEPSEEK_MODEL || params.modelProvider === 'deepseek' || stored?.modelProvider === 'deepseek') {
          throw failure('完整模型目录未加载，DeepSeek 暂不可用；未生成或压缩，请恢复模型目录后重启 AIYOUcodex。');
        }
      }
      return call(method, params);
    }
    if (method === 'thread/list' && Array.isArray(params.modelProviders) && params.modelProviders.includes(DEFAULT_PROVIDER)) {
      return call(method, {...params, modelProviders: [...new Set([...params.modelProviders, 'deepseek'])]});
    }
    if (method === 'thread/start') {
      const provider = desiredProvider(params.model);
      const result = await call(method, routedParams(params, provider));
      remember(result, params);
      if (result?.thread?.id) threads.set(result.thread.id, {...threads.get(result.thread.id), hasTurns: false});
      return result;
    }
    if (method === 'thread/resume') {
      if (Array.isArray(params.history) || typeof params.path === 'string' && params.path.trim()) {
        const provider = desiredProvider(params.model);
        const result = await call(method, routedParams(params, provider));
        remember(result, params);
        return result;
      }
      const thread = await inspect(params.threadId);
      const model = params.model || (thread.modelProvider === 'deepseek' ? DEEPSEEK_MODEL : null);
      const provider = desiredProvider(model);
      if (provider && (threads.get(params.threadId)?.provider || thread.modelProvider) !== provider) {
        const resume = Object.fromEntries(RESUME_KEYS.filter(key => params[key] !== undefined).map(key => [key, params[key]]));
        const reloaded = await ensureProvider(params.threadId, provider, model, resume);
        if (reloaded) {remember(reloaded, params); return reloaded;}
      }
      const result = await call(method, routedParams(provider ? {...params, model, modelProvider: provider} : params, provider));
      remember(result, params);
      return result;
    }
    if (method === 'turn/start' || method === 'thread/settings/update') {
      const current = threads.get(params.threadId);
      const selectedModel = params.collaborationMode?.settings?.model || params.model;
      const provider = desiredProvider(selectedModel) || current?.provider;
      const sticky = current ? stickyOptions(current, params) : null;
      if (provider && selectedModel) await ensureProvider(params.threadId, provider, selectedModel, sticky?.resume);
      let forwarded = {...sticky?.turnOptions, ...params};
      if (params.permissions != null) delete forwarded.sandboxPolicy;
      if (provider === 'deepseek') {
        const effort = params.collaborationMode?.settings?.reasoning_effort ?? params.effort;
        const normalizedEffort = ['none', 'minimal', 'low'].includes(effort) ? 'low'
          : ['xhigh', 'max', 'ultra'].includes(effort) ? 'max' : 'high';
        forwarded = {...forwarded, model: DEEPSEEK_MODEL, effort: normalizedEffort,
          summary: 'none', serviceTier: null, ...(method === 'turn/start' ? {serviceTierForTurn: 'default'} : {}),
          ...(params.collaborationMode ? {collaborationMode: {...params.collaborationMode,
            settings: {...params.collaborationMode.settings, model: DEEPSEEK_MODEL, reasoning_effort: normalizedEffort}}} : {}),
        };
      }
      const result = await call(method, forwarded);
      const latest = threads.get(params.threadId);
      if (latest && sticky) threads.set(params.threadId, {...latest, ...sticky, model: selectedModel || latest.model});
      if (method === 'turn/start' && result?.turn?.id && threads.has(params.threadId)) {
        threads.set(params.threadId, {...threads.get(params.threadId), hasTurns: true});
      }
      return result;
    }
    return call(method, params);
  }

  return {
    request(method, params) {
      const threadId = ['thread/resume', 'turn/start', 'thread/settings/update', 'thread/compact/start', 'thread/unsubscribe', 'thread/archive'].includes(method) && params?.threadId;
      if (!threadId) return route(method, params);
      const pending = (queues.get(threadId) || Promise.resolve()).catch(() => {}).then(() => route(method, params));
      queues.set(threadId, pending);
      const cleanup = () => { if (queues.get(threadId) === pending) queues.delete(threadId); };
      pending.then(cleanup, cleanup);
      return pending;
    },
    notification(message) {
      const id = message.params?.threadId || message.params?.thread?.id;
      if (message.method === 'thread/tokenUsage/updated' && id) {
        const usage = message.params.tokenUsage?.last?.totalTokens;
        if (Number.isSafeInteger(usage) && usage >= 0) threads.set(id, {...threads.get(id), lastUsage: usage, hasTurns: true});
      }
      if (message.method === 'turn/started' && id) {
        active.add(id);
        const compact = compactions.get(id);
        if (compact && !compact.turnId) compact.turnId = message.params.turn?.id;
        if (threads.has(id)) threads.set(id, {...threads.get(id), hasTurns: true});
      }
      if (message.method === 'turn/completed' && id) {
        const compact = compactions.get(id);
        if (!compact || compact.turnId && compact.turnId === message.params.turn?.id) {
          active.delete(id);
          compact?.finish(message.params.turn || {status: 'unknown'});
        }
      }
      if (message.method === 'thread/closed' && switching.has(id)) return false;
      return true;
    },
  };
}
