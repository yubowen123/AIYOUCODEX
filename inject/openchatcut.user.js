(() => {
  'use strict';
  const KEY = '__aiyouOpenChatCut__', ID = 'aiyoucodex-openchatcut';
  const RUNTIME_VERSION = '2026-10-12.1';
  const SETTINGS_KEY = '__aiyouOpenChatCutModelSettings__';
  function validEditorUrl(value) {
    try {
      const url = new URL(value);
      // Normalize only the legacy owned reload marker. New mounts always use
      // the exact editor address supplied by the host bridge.
      url.searchParams.delete('aiyou_occ_reconnect');
      return url.origin === 'https://web-sandbox.oaiusercontent.com'
        && /^\/__codex_asset_console__\/[a-f0-9]{48}\//.test(url.pathname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function installModelSettings(runtime, { legacy = false } = {}) {
    const existing = window[SETTINGS_KEY];
    if (existing?.runtime === runtime) { existing.refresh(); return; }
    existing?.dispose?.();
    const pending = new Map();
    let disposed = false, errorMessage = '', button, trackedFrame, trackedUrl, frameLoaded = false, removeFrameLoad;
    const currentPanel = () => document.getElementById(ID);
    const legacyFrame = legacy ? currentPanel()?.querySelector('iframe') : null;
    function connection() {
      const panel = currentPanel(), frame = panel?.querySelector('iframe');
      const url = frame?.isConnected && !frame.hidden && validEditorUrl(frame.src);
      if (frame !== trackedFrame) {
        removeFrameLoad?.(); trackedFrame = frame; frameLoaded = false;
        // Older live runtimes did not keep a load marker. Adopt only that
        // retained controlled frame; newly created frames wait for their load.
        if (frame === legacyFrame && url && runtime.snapshot?.().state?.installed && panel?.dataset.editorLoaded === undefined) frameLoaded = true;
        if (frame) {
          const onLoad = () => {
            if (trackedFrame !== frame || !frame.isConnected || !validEditorUrl(frame.src)) return;
            frameLoaded = true; panel.dataset.editorLoaded = 'true'; refresh();
          };
          const frameObserver = new MutationObserver(refresh);
          frameObserver.observe(frame, { attributes: true, attributeFilter: ['src'] });
          frame.addEventListener('load', onLoad);
          removeFrameLoad = () => { frame.removeEventListener('load', onLoad); frameObserver.disconnect(); };
        }
      } else if (url && trackedUrl && (new URL(url).pathname !== new URL(trackedUrl).pathname || new URL(url).search !== new URL(trackedUrl).search)) {
        frameLoaded = false; panel.dataset.editorLoaded = 'false';
      }
      trackedUrl = url;
      return runtime.snapshot?.().state?.installed && runtime.snapshot?.().editor?.ready !== false && panel?.dataset.editorLoaded !== 'false' && (frameLoaded || panel?.dataset.editorLoaded === 'true') && url
        ? { frame, origin: new URL(url).origin } : null;
    }
    function refresh() {
      if (disposed) return;
      const panel = currentPanel(), next = panel?.querySelector('[data-occ-settings]');
      if (!next) return;
      button = next;
      const label = 'OpenChatCut 模型与 API 设置';
      if (button.title !== label) button.title = label;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      button.onclick = openModelSettings;
      button.disabled = !connection() || pending.size > 0;
      if (button.getAttribute('aria-busy') !== String(pending.size > 0)) button.setAttribute('aria-busy', String(pending.size > 0));
      runtime.syncHostControls?.();
      let status = panel.querySelector('[data-occ-model-settings-error]');
      if (!status) {
        status = document.createElement('p');
        status.setAttribute('data-occ-model-settings-error', '');
        status.setAttribute('role', 'alert');
        status.style.cssText = 'margin:0;padding:8px 14px;font-size:12px;flex-shrink:0';
        panel.querySelector('.occ-header').after(status);
      }
      if (status.textContent !== errorMessage) status.textContent = errorMessage;
      status.hidden = !errorMessage;
    }
    function finish(requestId, result) {
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId); clearTimeout(request.timer); request.resolve(result);
    }
    function openModelSettings() {
      const active = connection();
      if (disposed || !active || pending.size) return Promise.resolve(false);
      errorMessage = '';
      const requestId = `occ-settings-${crypto.randomUUID()}`;
      const operation = new Promise(resolve => {
        const timer = setTimeout(() => finish(requestId, { ok: false, error: 'OpenChatCut 模型设置未响应，请稍后重试。' }), 10_000);
        pending.set(requestId, { ...active, resolve, timer });
        refresh();
        try { active.frame.contentWindow.postMessage({ type: 'aiyou-openchatcut:open-model-settings', requestId }, active.origin); }
        catch { finish(requestId, { ok: false, error: 'OpenChatCut 模型设置连接失败，请重新连接编辑器。' }); }
      });
      return operation.then(result => {
        if (!disposed) {
          errorMessage = result.ok ? '' : typeof result.error === 'string' ? result.error.slice(0, 500) : 'OpenChatCut 模型设置未能打开，请重试。';
          refresh();
        }
        return result.ok;
      });
    }
    const onMessage = event => {
      const active = connection(), data = event.data;
      if (disposed || !active || event.source !== active.frame.contentWindow || event.origin !== active.origin
        || data?.type !== 'aiyou-openchatcut:model-settings-result' || typeof data.requestId !== 'string' || typeof data.ok !== 'boolean') return;
      const request = pending.get(data.requestId);
      if (!request || request.frame !== active.frame || request.origin !== event.origin) return;
      finish(data.requestId, { ok: data.ok, error: data.error });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-editor-loaded'] });
    window.addEventListener('message', onMessage);
    const originalDestroy = runtime.destroy;
    const wrappedDestroy = function (...args) { dispose(); return originalDestroy?.apply(this, args); };
    function dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect(); removeFrameLoad?.(); window.removeEventListener('message', onMessage);
      for (const requestId of pending.keys()) finish(requestId, { ok: false });
      if (button?.onclick === openModelSettings) button.onclick = null;
      if (runtime.destroy === wrappedDestroy) runtime.destroy = originalDestroy;
      if (runtime.openModelSettings === openModelSettings) delete runtime.openModelSettings;
      if (window[SETTINGS_KEY]?.runtime === runtime) delete window[SETTINGS_KEY];
    }
    runtime.destroy = wrappedDestroy;
    runtime.openModelSettings = openModelSettings;
    window[SETTINGS_KEY] = { runtime, refresh, dispose };
    refresh();
  }
  // A source update also re-executes this script. Upgrade the settings action
  // in place so an active editor, its project and pending MCP work stay mounted.
  if (window[KEY]?.version === RUNTIME_VERSION && document.getElementById(ID)) {
    installModelSettings(window[KEY], { legacy: true });
    return;
  }
  const retainedRuntime = window[KEY], retainedPanel = document.getElementById(ID);
  const prior = retainedRuntime?.snapshot?.();
  // Retire the old route timer and requests without disconnecting its iframe.
  // The old destroy calls this panel's remove synchronously; retain only this
  // owned element during the handoff and restore its normal remove method.
  const retainedRemove = retainedPanel && Object.getOwnPropertyDescriptor(retainedPanel, 'remove');
  if (retainedPanel) retainedPanel.remove = () => {};
  try { retainedRuntime?.destroy?.(); }
  finally { if (retainedPanel) { if (retainedRemove) Object.defineProperty(retainedPanel, 'remove', retainedRemove); else delete retainedPanel.remove; } }
  const requests = new Map();
  let state = prior?.state || { state: 'connecting', installed: false, message: '正在连接本机剪辑服务…' };
  let panel = retainedPanel, frame = panel?.querySelector('iframe'), frameUrl = validEditorUrl(frame?.src) || '', destroyed = false, busy = false, busyAction = '', error = '', returnFocus;
  let visibleThreadId = panel?.dataset.occViewThread || prior?.state?.threadId || '', viewGeneration = 0, queuedOpen, stopping = false;
  let frameGeneration = 0, documentLoaded = Boolean(frame && (prior?.editor?.loaded || panel?.dataset.editorLoaded === 'true'));
  let controlsReady = Boolean(frame && (prior?.editor?.ready || panel?.dataset.editorReady === 'true')), verifiedReady = false;
  let frameError = '', slowLoading = false, loadingTimer, editorDeadline;
  const reconnectIds = new Set();
  const api = () => window.__codexConversationPreviewInjection__;
  const context = () => api()?.getActiveTaskContext?.() || {};
  const installing = () => ['downloading', 'verifying', 'installing', 'extracting'].includes(state.state);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20 4M12 12h.01"/></svg>';
  const editorReady = () => Boolean(frame?.isConnected && documentLoaded && (controlsReady || verifiedReady) && !frameError);
  function loadingDetails() {
    const failure = error || frameError || (['error', 'failed'].includes(state.state) ? state.message : '');
    if (failure) return { title: '剪辑工具未能连接', message: `${failure} 请重试连接；已保存的工程会保留。`, state: 'error', onRetry: () => state.installed ? open() : act('install'), retryLabel: state.installed ? '重试连接' : '重试安装' };
    if (installing()) {
      const raw = typeof state.progress === 'number' ? state.progress : state.progress?.percent;
      const progress = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / 100)) : undefined;
      return { title: '正在准备剪辑工具', message: state.message || '正在安装本机组件，请保持当前页面打开。', state: 'loading', progress };
    }
    if (stopping || state.state === 'stopping') return { title: '正在关闭剪辑工具', message: '正在保存工程并结束本机后台进程，请稍候。', state: 'loading' };
    const connecting = ['checking', 'launching', 'running', 'connecting', 'opening'].includes(state.state);
    if (frame && !editorReady() || busyAction === 'open' || !frame && state.installed && connecting) {
      const title = frame ? documentLoaded ? '正在连接剪辑工程' : '正在加载剪辑界面' : state.state === 'launching' || state.state === 'running' ? '正在启动本机剪辑工具' : state.state === 'checking' || busyAction === 'open' && !connecting ? '正在检查本机剪辑工具' : '正在连接本机剪辑工具';
      const message = slowLoading ? '连接所需时间较久，仍在等待本机编辑器响应。请保持面板打开；若持续无响应，可重试连接。'
        : frame ? documentLoaded ? '剪辑界面已加载，正在等待当前对话的工程连接。' : '正在载入素材、预览和时间线，请稍候。'
        : state.state === 'launching' || state.state === 'running' ? '本机服务正在启动，随后会加载当前对话的剪辑工程。' : '正在检查组件与服务连接，请稍候。';
      return { title, message, state: 'loading', ...(slowLoading && !busy ? { onRetry: open, retryLabel: '重试连接' } : {}) };
    }
    if (busyAction === 'status') return { title: '正在检查剪辑工具状态', message: '正在读取本机服务和当前工程的连接状态。', state: 'loading' };
    return null;
  }
  function renderLoading(target, details, layout) {
    if (!target) return;
    target.hidden = !details;
    if (details) api()?.renderModuleLoadingState?.(target, { ...details, layout });
    else api()?.clearModuleLoadingState?.(target);
  }
  function syncLoadingClock(details) {
    if (details?.state === 'loading' && !panel?.hidden) {
      if (!loadingTimer && !slowLoading) loadingTimer = setTimeout(() => { loadingTimer = null; slowLoading = true; render(); }, 8000);
    } else {
      clearTimeout(loadingTimer); loadingTimer = null; slowLoading = false;
    }
  }
  function watchFrame(target) {
    const generation = ++frameGeneration, expectedUrl = frameUrl;
    clearTimeout(editorDeadline);
    const current = () => !destroyed && frame === target && target.isConnected && generation === frameGeneration && validEditorUrl(target.src) === expectedUrl;
    target.onload = () => {
      if (!current()) return;
      documentLoaded = true; panel.dataset.editorLoaded = 'true'; render();
    };
    target.onerror = () => {
      if (!current()) return;
      frameError = '剪辑界面加载失败。'; render();
    };
    if (!editorReady()) editorDeadline = setTimeout(() => {
      if (!current() || editorReady()) return;
      frameError = '剪辑界面迟迟未响应。请确认本机工具仍在运行。'; render();
    }, 60_000);
  }
  function request(action, extra = {}) {
    return new Promise((resolve, reject) => {
      if (typeof window.__AIYOUCODEX_OPENCHATCUT_REQUEST__ !== 'function') return reject(new Error('本机剪辑服务尚未连接，请稍后重试。'));
      const requestId = `occ-${crypto.randomUUID()}`;
      const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('操作仍在进行，请刷新状态核对进度。')); }, action === 'install' ? 30 * 60_000 : 180_000);
      requests.set(requestId, { resolve, reject, timer });
      window.__AIYOUCODEX_OPENCHATCUT_REQUEST__(JSON.stringify({ requestId, action, ...context(), ...extra }));
    });
  }
  function resolve(response) {
    const r = requests.get(response.requestId);
    if (!r) return;
    requests.delete(response.requestId); clearTimeout(r.timer);
    if (response.ok) r.resolve(response.data); else r.reject(new Error(response.error || 'OpenChatCut 操作未完成。'));
  }
  function statusText() {
    if (error) return error;
    if (installing()) {
      const raw = typeof state.progress === 'number' ? state.progress : state.progress?.percent;
      const p = Number.isFinite(raw) ? ` ${Math.round(Math.max(0, Math.min(100, raw)))}%` : '';
      return `${state.message || '正在安装 OpenChatCut…'}${p}`;
    }
    return state.message || (state.installed ? `OpenChatCut ${state.version || ''} 已安装` : '尚未安装 OpenChatCut');
  }
  function renderSettings(root) {
    const hosts = root ? [root] : [...document.querySelectorAll('[data-aiyou-openchatcut-settings]')];
    for (const host of hosts) {
      const unavailable = state.supported === false && !state.installed;
      host.innerHTML = `<h3>${icon} OpenChatCut 剪辑</h3><p>对话剪辑与右侧时间线同步。首次使用下载官方桌面组件，之后在本机运行。</p><p role="status" aria-live="polite" data-occ-setting-status>${escape(statusText())}</p><div class="occ-actions"><button type="button" data-occ-install ${state.installed || unavailable || busy || installing() ? 'disabled' : ''}>${installing() ? '正在安装…' : state.installed ? '已安装' : unavailable ? '请手动安装' : ['error', 'failed'].includes(state.state) ? '重试安装' : '一键下载安装'}</button><button type="button" data-occ-open ${busy || installing() || unavailable ? 'disabled' : ''}>打开剪辑工具</button><button type="button" data-occ-refresh ${busy ? 'disabled' : ''}>刷新状态</button>${unavailable ? '<a href="https://github.com/0xsline/OpenChatCut/releases/latest" target="_blank" rel="noopener noreferrer">官方下载安装</a>' : ''}</div>`;
      const loading = document.createElement('div'); loading.setAttribute('data-occ-setting-loading', ''); host.querySelector('[data-occ-setting-status]').after(loading);
      renderLoading(loading, loadingDetails(), 'compact');
      host.querySelector('[data-occ-install]').onclick = () => act('install');
      host.querySelector('[data-occ-open]').onclick = open;
      host.querySelector('[data-occ-refresh]').onclick = () => act('status');
    }
  }
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('section'); panel.id = ID; panel.hidden = true;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'OpenChatCut 剪辑');
    panel.innerHTML = `<header class="occ-header"><strong>${icon} OpenChatCut</strong><span class="occ-sync" role="status" aria-live="polite"></span><button type="button" data-occ-settings title="OpenChatCut 模型与 API 设置" aria-label="OpenChatCut 模型与 API 设置" disabled>⚙</button><button type="button" data-occ-close aria-label="关闭 OpenChatCut">×</button></header><div class="occ-body"><div class="occ-welcome"><div class="occ-mark">${icon}</div><h2>在对话中完成剪辑</h2><p>导入素材、裁剪镜头、添加字幕和配乐。AI 的操作会同步到这里的时间线。</p><p data-occ-status role="status" aria-live="polite"></p><button type="button" data-occ-primary>一键下载安装</button><button type="button" data-occ-retry>刷新状态</button></div></div>`;
    bindPanel();
    api()?.initializeWorkspacePanel?.(panel, 'openchatcut');
    return panel;
  }
  function bindPanel() {
    const body = panel.querySelector('.occ-body');
    if (!body.querySelector('[data-occ-loading]')) {
      const loading = document.createElement('div'); loading.setAttribute('data-occ-loading', ''); loading.hidden = true; body.append(loading);
    }
    const header = panel.querySelector('.occ-header');
    let stopButton = header.querySelector('[data-occ-stop]');
    if (!stopButton) {
      stopButton = document.createElement('button'); stopButton.type = 'button'; stopButton.dataset.occStop = '';
      stopButton.title = '彻底关闭 OpenChatCut · 结束后台进程'; stopButton.setAttribute('aria-label', '彻底关闭 OpenChatCut');
      stopButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 2v10M6.3 5.7a9 9 0 1 0 11.4 0"/></svg>';
      header.insertBefore(stopButton, header.querySelector('[data-occ-settings]'));
    }
    stopButton.onclick = stop;
    panel.querySelector('[data-occ-close]').onclick = close;
    panel.querySelector('[data-occ-close]').setAttribute('aria-label', '收起 OpenChatCut');
    panel.querySelector('[data-occ-close]').title = '收起面板 · 后台继续运行';
    panel.querySelector('[data-occ-primary]').onclick = () => state.installed ? open() : act('install');
    panel.querySelector('[data-occ-retry]').onclick = () => act('status');
    panel.close = close;
    if (frame) watchFrame(frame);
  }
  if (panel) bindPanel();
  function show({ visible = true, threadId = context().threadId } = {}) {
    const mount = api()?.getWorkspacePanelMount?.();
    if (!mount) { error = '请先打开一个对话，再使用剪辑工具。'; renderSettings(); return false; }
    ensurePanel();
    if (panel.parentElement !== mount.surface) mount.surface.append(panel);
    if (visible) {
      visibleThreadId = threadId || visibleThreadId;
      panel.dataset.occViewThread = visibleThreadId;
      returnFocus = document.activeElement;
      window.postMessage({ type: 'codex-workspace-panel:open', panel: 'openchatcut' }, window.location.origin);
      api()?.closeOtherWorkspacePanels?.('openchatcut');
      panel.hidden = false; panel.open = true;
    } else if (visibleThreadId && context().threadId && context().threadId !== visibleThreadId) {
      panel.hidden = true; panel.open = false;
    }
    render(); return true;
  }
  function setEditor(value, recovery) {
    const url = validEditorUrl(value);
    const recoverOnce = url && recovery?.reconnectEditor === true
      && typeof recovery.reconnectId === 'string' && !reconnectIds.has(recovery.reconnectId)
      && (!recovery.session?.editSessionId || recovery.serviceRestarted === true || recovery.editorDisconnected === true) && recovery.session?.projectId
      && new URL(url).hash === `#/editor/${encodeURIComponent(recovery.session.projectId)}`;
    if (recoverOnce) {
      reconnectIds.add(recovery.reconnectId);
      if (reconnectIds.size > 64) reconnectIds.delete(reconnectIds.values().next().value);
    }
    if (recoverOnce && url === frameUrl && frame?.isConnected) {
      // The host allocates a fresh routing generation for a restarted service.
      // Simple browser registration recovery keeps the existing guarded route.
      frame.remove(); frame = null; frameUrl = '';
    }
    if (!url || url === frameUrl && frame?.isConnected) return;
    // A changed controlled address gets a new browsing context, so a queued
    // readiness message from its previous document cannot settle this load.
    frame?.remove();
    frame = document.createElement('iframe'); frame.title = 'OpenChatCut 实时编辑器';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; autoplay; fullscreen');
    // Only the native bridge supplies the local editor URL. Provider keys and
    // the MCP bearer token never enter the view or the conversation.
    frame.referrerPolicy = 'no-referrer';
    frameUrl = url; documentLoaded = false; controlsReady = false; verifiedReady = false; frameError = '';
    watchFrame(frame); frame.src = url; panel.querySelector('.occ-body').append(frame);
    panel.dataset.editorLoaded = 'false';
  }
  function render() {
    if (destroyed) return;
    renderSettings();
    if (!panel) return;
    panel.querySelector('[data-occ-status]').textContent = statusText();
    const primary = panel.querySelector('[data-occ-primary]');
    primary.disabled = busy || stopping || installing() || state.supported === false && !state.installed;
    primary.textContent = installing() ? '正在安装…' : state.installed ? '连接编辑器' : state.supported === false ? '请从设置手动安装' : ['error', 'failed'].includes(state.state) ? '重试安装' : '一键下载安装';
    panel.querySelector('[data-occ-retry]').disabled = busy;
    panel.querySelector('[data-occ-stop]').disabled = stopping || installing() || !state.installed || state.state === 'stopped';
    panel.querySelector('.occ-sync').textContent = state.toolName ? `${state.state === 'ready' ? '已同步' : state.state === 'awaiting-confirmation' ? '等待确认' : 'AI 正在执行'}：${state.toolName}` : state.projectId || state.session?.projectId ? '与对话同步' : state.installed ? '本机剪辑' : '首次使用需安装';
    if (['stopping', 'stopped'].includes(state.state)) panel.querySelector('.occ-sync').textContent = error || state.message;
    const frameOwner = state.session?.threadId || state.threadId;
    if (frame) frame.hidden = Boolean(visibleThreadId && frameOwner && visibleThreadId !== frameOwner);
    const ready = editorReady();
    panel.dataset.editorReady = String(ready);
    if (ready) { clearTimeout(editorDeadline); editorDeadline = null; }
    const details = loadingDetails();
    if (details) panel.querySelector('.occ-sync').textContent = details.title;
    panel.dataset.occEditorView = String(Boolean(frame && !frame.hidden && ready && !details));
    panel.querySelector('.occ-welcome').hidden = Boolean(frame && !frame.hidden);
    syncLoadingClock(details);
    renderLoading(panel.querySelector('[data-occ-loading]'), panel.hidden ? null : details, 'panel');
    window[SETTINGS_KEY]?.refresh?.();
    syncHostControls();
  }
  function syncHostControls() {
    const url = frame?.isConnected && validEditorUrl(frame.src);
    if (!url || !panel) return;
    frame.contentWindow.postMessage({ type: 'aiyou-openchatcut:host-state',
      stopDisabled: panel.querySelector('[data-occ-stop]')?.disabled !== false,
      settingsDisabled: panel.querySelector('[data-occ-settings]')?.disabled !== false,
      expanded: panel.dataset.aiyouPanelExpanded === 'true',
      status: (error || panel.querySelector('.occ-sync')?.textContent || '').slice(0, 500),
    }, new URL(url).origin);
  }
  const onHostAction = event => {
    const url = frame?.isConnected && validEditorUrl(frame.src);
    if (destroyed || !url || event.source !== frame.contentWindow || event.origin !== new URL(url).origin) return;
    if (event.data?.type === 'aiyou-openchatcut:host-controls-ready') { controlsReady = true; frameError = ''; render(); syncHostControls(); return; }
    if (event.data?.type !== 'aiyou-openchatcut:host-action' || panel?.hidden || frame.hidden) return;
    const selectors = { stop: '[data-occ-stop]', settings: '[data-occ-settings]', close: '[data-occ-close]', expand: '[data-aiyou-panel-expand]' };
    const selector = Object.hasOwn(selectors, event.data.action) && selectors[event.data.action];
    if (selector) { panel.querySelector(selector)?.click(); syncHostControls(); }
  };
  window.addEventListener('message', onHostAction);
  function update(value) {
    if (!value || typeof value !== 'object' || destroyed) return;
    if (value.type === 'stopped' || value.state === 'stopped') {
      viewGeneration += 1; queuedOpen = null;
      frame?.remove(); frame = null; frameUrl = '';
      frameGeneration += 1; documentLoaded = controlsReady = verifiedReady = false; frameError = ''; clearTimeout(editorDeadline); editorDeadline = null;
      if (panel) panel.dataset.editorLoaded = 'false';
      state = { ...state, ...value, editorUrl: null, toolName: null }; error = ''; render(); return;
    }
    if (stopping && value.type !== 'stopping') return;
    const url = value.editorUrl || value.session?.editorUrl;
    const eventThread = value.threadId || value.session?.threadId;
    // An old open or a different conversation cannot replace the user's
    // visible editor while its current open is waiting for a response.
    if (panel && !panel.hidden && visibleThreadId && eventThread
      && eventThread !== visibleThreadId && eventThread !== context().threadId) return;
    state = { ...state, ...value }; error = '';
    if (url) {
      const matches = !value.threadId || context().threadId === value.threadId;
      const opening = ['editing', 'opening', 'editor', 'ready'].includes(value.type) || value.autoOpen === true;
      const owner = value.threadId || value.session?.threadId;
      const unrelatedVisible = !matches && panel && !panel.hidden && visibleThreadId && owner && visibleThreadId !== owner;
      if (!unrelatedVisible && (opening || panel && !panel.hidden)) { show({ visible: opening && matches && value.autoOpen !== false, threadId: owner }); setEditor(url, value); }
    }
    if (frame && (!eventThread || eventThread === visibleThreadId) && (value.state === 'ready' || value.session?.connected === true)
      && (!url || validEditorUrl(url) === frameUrl)) verifiedReady = true;
    render();
  }
  async function act(action, intent) {
    if (action === 'open') intent ||= { threadId: context().threadId, generation: viewGeneration };
    if (busy) { if (action === 'open') queuedOpen = intent; return; }
    busy = true; busyAction = action; error = '';
    if (action === 'open') { frameError = ''; if (frame && !editorReady()) watchFrame(frame); }
    render();
    try {
      const result = await request(action, intent ? { threadId: intent.threadId } : {});
      if (action === 'open' && (intent.generation !== viewGeneration || intent.threadId !== context().threadId || panel?.hidden)) return;
      if (stopping || result.state !== 'stopped' && state.state === 'stopped' && action !== 'open') return;
      update(result);
      if (action === 'install' && result?.installed && panel && !panel.hidden) {
        open();
      }
      if (action === 'open') {
        show({ threadId: intent.threadId });
        const url = result?.editorUrl || result?.session?.editorUrl;
        if (url) setEditor(url, result);
      }
    } catch (e) { if (!intent || intent.generation === viewGeneration && intent.threadId === context().threadId) error = e.message; }
    finally {
      busy = false; busyAction = ''; render();
      const next = queuedOpen; queuedOpen = null;
      if (next && next.generation === viewGeneration && next.threadId === context().threadId && !panel?.hidden) void act('open', next);
    }
  }
  function open() { if (stopping) return false; viewGeneration += 1; if (show()) void act('open'); return Boolean(panel && !panel.hidden); }
  async function stop() {
    if (stopping || !state.installed) return;
    stopping = true; viewGeneration += 1; queuedOpen = null; error = '';
    state = { ...state, state: 'stopping', toolName: null, message: '正在彻底关闭 OpenChatCut…' }; render();
    try {
      const target = frame, url = target?.isConnected && validEditorUrl(target.src);
      if (url) await new Promise((resolve, reject) => {
        const origin = new URL(url).origin, requestId = `occ-shutdown-${crypto.randomUUID()}`;
        const finish = (error) => { clearTimeout(timer); window.removeEventListener('message', ready); error ? reject(error) : resolve(); };
        const ready = event => {
          if (event.source !== target.contentWindow || event.origin !== origin || event.data?.type !== 'aiyou-openchatcut:shutdown-ready'
            || event.data.requestId !== requestId || typeof event.data.ok !== 'boolean') return;
          finish(event.data.ok ? null : new Error(event.data.error || '工程尚未保存，后台仍在运行。'));
        };
        const timer = setTimeout(() => finish(new Error('未确认工程已保存，后台仍在运行，请重试。')), 12000);
        window.addEventListener('message', ready);
        target.contentWindow.postMessage({ type: 'aiyou-openchatcut:prepare-shutdown', requestId }, origin);
      });
      update(await request('stop'));
    }
    catch (failure) { error = failure.message; }
    finally { stopping = false; render(); }
  }
  function close() {
    viewGeneration += 1; queuedOpen = null;
    if (panel) { panel.hidden = true; panel.open = false; }
    clearTimeout(loadingTimer); loadingTimer = null; slowLoading = false;
    renderLoading(panel?.querySelector('[data-occ-loading]'), null, 'panel');
    // Keep the live editor mounted: closing a view must not interrupt an MCP
    // operation or discard staged edits.
    returnFocus?.focus?.({ preventScroll: true }); returnFocus = null;
  }
  const onPanel = e => {
    if (e.source === window && e.origin === window.location.origin && e.data?.type === 'codex-workspace-panel:open' && e.data.panel !== 'openchatcut') close();
  };
  window.addEventListener('message', onPanel);
  const routeTimer = setInterval(() => {
    const active = context().threadId;
    if (panel && !panel.hidden && visibleThreadId && active && active !== visibleThreadId) close();
  }, 1000);
  const style = document.createElement('style'); style.id = 'aiyou-openchatcut-style';
  style.textContent = `#${ID}{display:flex;flex-direction:column;overflow:hidden!important;--codex-workspace-panel-width:760px}#${ID}[hidden]{display:none!important}#${ID} .occ-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--color-border-default,#8884);flex-shrink:0}#${ID} .occ-header strong{display:flex;align-items:center;gap:8px;white-space:nowrap}#${ID} svg,[data-aiyou-openchatcut-settings] svg{width:20px;height:20px;vertical-align:middle}#${ID} .occ-sync{font-size:11px;opacity:.65;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${ID} button,[data-aiyou-openchatcut-settings] button{border:1px solid var(--color-border-default,#8885);border-radius:var(--aiyou-radius-button,8px);background:var(--color-background-panel,Canvas);color:inherit;padding:7px 12px;cursor:pointer}#${ID} button:disabled,[data-aiyou-openchatcut-settings] button:disabled{opacity:.55;cursor:default}#${ID} .occ-body{flex:1;min-height:0;position:relative}#${ID} iframe{display:block;width:100%;height:100%;border:0}#${ID} .occ-welcome{padding:36px 28px;max-width:460px;margin:0 auto;text-align:center}#${ID} .occ-welcome[hidden]{display:none}#${ID} .occ-welcome p{font-size:13px;line-height:1.7;opacity:.8}#${ID} .occ-mark svg{width:48px;height:48px;opacity:.7}#${ID} [data-occ-primary]{background:var(--color-text-primary,CanvasText);color:var(--color-background-panel,Canvas)}[data-aiyou-openchatcut-settings]{padding:8px 0 20px}[data-aiyou-openchatcut-settings] .occ-actions{display:flex;gap:8px;flex-wrap:wrap}`;
  document.head.append(style);
  style.textContent += `#${ID} iframe[hidden]{display:none}`;
  style.textContent += `#${ID} [data-occ-loading]{position:absolute;inset:0;z-index:2;width:100%;max-width:none;min-height:180px;align-content:center;justify-items:center;background:var(--color-background-panel,Canvas);color:var(--color-text-primary,CanvasText)}#${ID} [data-occ-loading][hidden]{display:none!important}[data-aiyou-openchatcut-settings] [data-occ-setting-loading][hidden]{display:none!important}`;
  // Live editors use their native topbar. The welcome/install screen keeps
  // controls available when there is no editor document to host the actions.
  style.textContent += `#${ID}[data-occ-editor-view="true"]>.occ-header{display:none!important}`;
  function destroy() {
    destroyed = true;
    for (const r of requests.values()) { clearTimeout(r.timer); r.reject(new Error('剪辑视图重新连接。')); }
    requests.clear(); window.removeEventListener('message', onPanel); window.removeEventListener('message', onHostAction); panel?.remove(); style.remove();
    frameGeneration += 1; clearTimeout(loadingTimer); clearTimeout(editorDeadline); clearInterval(routeTimer);
  }
  window[KEY] = Object.assign(retainedRuntime || {}, { version: RUNTIME_VERSION, open, close, stop, update, resolve, renderSettings, syncHostControls, onBridgeReady: () => act('status'), snapshot: () => ({ state, editor: { loaded: documentLoaded, ready: editorReady() } }), destroy });
  installModelSettings(window[KEY], { legacy: Boolean(retainedPanel) });
})();
