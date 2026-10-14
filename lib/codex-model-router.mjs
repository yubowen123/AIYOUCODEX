const DEEPSEEK_MODEL = 'deepseek-flash';
const DEFAULT_PROVIDER = 'openai';
const RESUME_KEYS = ['cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'baseInstructions',
  'developerInstructions', 'personality', 'config', 'runtimeWorkspaceRoots', 'permissions',
  'serviceTier', 'excludeTurns', 'initialTurnsPage'];
const STICKY_TURN_KEYS = ['cwd', 'runtimeWorkspaceRoots', 'approvalPolicy', 'approvalsReviewer', 'permissions', 'serviceTier', 'personality'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const failure = message => Object.assign(new Error(message), {code: -32000});

/** Route only the additive DeepSeek model. Never write config, credentials or history. */
export function createModelRouter({call, extraModel, catalogPath, sleep = wait, unloadAttempts = 100,
  isPersisted = async () => true, resolveContextWindow = async () => null} = {}) {
  const enabled = Boolean(extraModel && catalogPath);
  const threads = new Map(), queues = new Map(), switching = new Set(), active = new Set();
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

  async function ensureProvider(threadId, provider, model, resumeOverride = {}) {
    const needsReload = current => current.provider !== provider
      || current.windowOverride && current.windowOverride.model !== model;
    const known = threads.get(threadId);
    if (known && !needsReload(known)) return;
    const thread = await inspect(threadId);
    const current = threads.get(threadId) || {provider: thread.modelProvider || DEFAULT_PROVIDER, resume: {}};
    const mergedResume = {...current.resume, ...resumeOverride};
    if (!needsReload(current)) return;
    if (active.has(threadId) || thread.status?.type === 'active') {
      throw failure('当前回答仍在生成，请结束后再切换模型；未中断或提交请求。');
    }
    // Native systemError is idle with an error flag; active turns/approvals
    // have already been excluded above, so a failed request can recover here.
    if (thread.status && !['idle', 'notLoaded', 'systemError'].includes(thread.status.type)) {
      throw failure('当前对话状态不可用于切换模型，请稍后重试。');
    }
    // Native model-downshift compaction otherwise pairs the previous model
    // with the new provider. An explicit, verified target window makes both
    // contexts use that window; normal budget compaction then uses the GPT model.
    let windowOverride = null;
    if (provider === DEFAULT_PROVIDER && (current.provider === 'deepseek' || current.windowOverride)) {
      const size = await resolveContextWindow(model, mergedResume.config || {});
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw failure('无法确认目标 GPT 模型的上下文上限，未释放对话或提交请求；请刷新模型目录后重试。');
      }
      windowOverride = {model, size};
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
        const nativeParams = windowOverride ? {...params, config: {...params.config, model_context_window: windowOverride.size}} : params;
        const result = await call('thread/resume', routedParams(nativeParams, provider));
        const actual = result.modelProvider || result.thread?.modelProvider;
        if (actual !== provider) throw failure('提供方回读不一致，未提交模型请求。');
        remember(result, params);
        threads.set(threadId, {...threads.get(threadId), windowOverride});
        return result;
      } catch (error) {
        // Restore the idle thread if possible; never send the failed turn elsewhere.
        const restore = {threadId, ...current.resume, model: current.model, modelProvider: current.provider};
        const restoreNative = current.windowOverride ? {...restore,
          config: {...restore.config, model_context_window: current.windowOverride.size}} : restore;
        try { remember(await call('thread/resume', routedParams(restoreNative, current.provider)), restore); } catch {}
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
    if (!enabled) return call(method, params);
    if (method === 'thread/list' && Array.isArray(params.modelProviders) && params.modelProviders.includes(DEFAULT_PROVIDER)) {
      return call(method, {...params, modelProviders: [...new Set([...params.modelProviders, 'deepseek'])]});
    }
    if (method === 'thread/start') {
      const provider = desiredProvider(params.model);
      const result = await call(method, routedParams(params, provider));
      remember(result, params);
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
      const known = threads.get(params.threadId);
      if (provider && ((known?.provider || thread.modelProvider) !== provider
          || known?.windowOverride && known.windowOverride.model !== model)) {
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
      return result;
    }
    return call(method, params);
  }

  return {
    request(method, params) {
      const threadId = ['thread/resume', 'turn/start', 'thread/settings/update', 'thread/unsubscribe', 'thread/archive'].includes(method) && params?.threadId;
      if (!threadId) return route(method, params);
      const pending = (queues.get(threadId) || Promise.resolve()).catch(() => {}).then(() => route(method, params));
      queues.set(threadId, pending);
      const cleanup = () => { if (queues.get(threadId) === pending) queues.delete(threadId); };
      pending.then(cleanup, cleanup);
      return pending;
    },
    notification(message) {
      const id = message.params?.threadId || message.params?.thread?.id;
      if (message.method === 'turn/started' && id) active.add(id);
      if (message.method === 'turn/completed' && id) active.delete(id);
      if (message.method === 'thread/closed' && switching.has(id)) return false;
      return true;
    },
  };
}
