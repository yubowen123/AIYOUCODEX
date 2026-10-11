import http from 'node:http';
import { ASSET_CONSOLE_EMBED_ORIGIN, assetConsoleEmbedPrefix } from './asset-console-embed.mjs';
import { boundedMediaRange, assetResponseByteLimit, MAX_MEDIA_CHUNK_BYTES } from './asset-console-media.mjs';
import { OPENCHATCUT_SETTINGS_MODULES, createOpenChatCutSettingsOpener } from './openchatcut-settings.mjs';

const RUNTIME_ASSETS = new Set([
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
].map(name => `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/${name}`));

export const OPENCHATCUT_HOST_STYLE_ID = 'aiyou-openchatcut-host-style';
export const OPENCHATCUT_HOST_CSS = `
html[data-aiyou-openchatcut-host="codex"] .cc-editor-shell[data-aiyou-openchatcut-editor="v0.2.16"] {
  grid-template-columns: 0 0 var(--aiyou-openchatcut-library-width) 0 minmax(0, 1fr) !important;
}
html[data-aiyou-openchatcut-host="codex"] .cc-editor-shell[data-aiyou-openchatcut-editor="v0.2.16"] > aside.cc-chat-panel[data-cc-shortcut-surface="agent-chat"],
html[data-aiyou-openchatcut-host="codex"] .cc-editor-shell[data-aiyou-openchatcut-editor="v0.2.16"] > aside.cc-chat-panel[data-cc-shortcut-surface="agent-chat"] + div[data-aiyou-openchatcut-agent-divider] {
  display: none !important;
}
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-project-home] { display: none !important; }
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-host-controls] {
  display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-right: 8px;
}
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-host-action] {
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px;
  display: inline-grid; place-items: center; flex-shrink: 0; cursor: pointer;
  background: transparent; color: var(--cc-text-dim); font-size: 17px;
}
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-host-action] svg { width: 18px; height: 18px; }
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-host-action]:hover {
  background: var(--cc-panel-alt); color: var(--cc-text);
}
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-host-action]:disabled { opacity: .4; cursor: default; }
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-dismissible-hint] { position: relative; padding-right: 28px; }
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-hint-hidden] { display: none !important; }
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-dismiss-hint] {
  position: absolute; right: 4px; top: 4px; width: 20px; height: 20px; padding: 0;
  border: 0; border-radius: 3px; background: transparent; color: var(--cc-text-dim); cursor: pointer;
}
html[data-aiyou-openchatcut-host="codex"] [data-aiyou-openchatcut-dismiss-hint]:hover { background: var(--cc-panel-alt); color: var(--cc-text); }
`;

// Serialized into the owned editor document, including retained frames after a
// host reconnect. Keep this independent of Electron preload and React internals.
function installOpenChatCutHostMode({ origin, prefix, css, styleId, settingsModules, createSettingsOpener }) {
  if (location.origin !== origin || !new RegExp(`^${prefix}[a-f0-9]{32,128}/(?:index\\.html)?$`, 'i').test(location.pathname)) {
    return { applied: false, reason: 'outside-controlled-embed' };
  }
  const previous = window.__aiyouOpenChatCutHostMode__;
  if (previous?.version === '5') { previous.refresh(); return { applied: true }; }
  previous?.destroy?.();
  const root = document.documentElement;
  root.setAttribute('data-aiyou-openchatcut-host', 'codex');
  let style = document.getElementById(styleId);
  if (!style) { style = document.createElement('style'); style.id = styleId; (document.head || root).appendChild(style); }
  style.textContent = css;
  const shells = new Map();
  let queued = false;
  let disposed = false;
  const settings = createSettingsOpener(settingsModules);
  let parentOrigin = null;
  let hostState = { stopDisabled: true, settingsDisabled: true, expanded: false, status: '' };
  const allowedParent = event => event.source === window.parent && (event.origin === 'app://-' || /^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)
    || window.parent === window && event.origin === location.origin);
  const hintsKey = 'aiyou-openchatcut-dismissed-media-hints-v1';
  const dismissedHints = new Set();
  try { for (const key of JSON.parse(localStorage.getItem(hintsKey) || '[]')) if (['music-models', 'media-export'].includes(key)) dismissedHints.add(key); } catch {}
  // v0.2.16 TopBar: its sole direct button.cc-tip is onHome; toolbar
  // actions live in a separate div. Locale-independent and shell-scoped.
  const homeSelector = '.cc-editor-shell > .cc-topbar > button.cc-tip[aria-label]';
  const originalURL = location.href;
  const originalHash = location.hash;
  const projectMatch = /^#\/?editor\/([a-zA-Z0-9_.-]{1,200})(?:[?/]|$)/.exec(originalHash);
  const boundProjectId = projectMatch?.[1];
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const sameProjectURL = value => {
    const url = new URL(value, location.href);
    const initial = new URL(originalURL);
    return url.origin === initial.origin && url.pathname === initial.pathname
      && /^#\/?editor\/([a-zA-Z0-9_.-]{1,200})(?:[?/]|$)/.exec(url.hash)?.[1] === boundProjectId;
  };
  const guardRoute = event => {
    if (!boundProjectId || sameProjectURL(event?.newURL || location.href)) return;
    event?.stopImmediatePropagation();
    originalReplace.call(history, history.state, '', originalURL);
  };
  const push = function(state, title, url) {
    if (!boundProjectId || url == null || sameProjectURL(url)) return originalPush.call(this, state, title, url);
  };
  const replace = function(state, title, url) {
    if (!boundProjectId || url == null || sameProjectURL(url)) return originalReplace.call(this, state, title, url);
  };
  if (boundProjectId) {
    root.setAttribute('data-aiyou-openchatcut-project', boundProjectId);
    history.pushState = push; history.replaceState = replace;
    window.addEventListener('hashchange', guardRoute, true);
    window.addEventListener('popstate', guardRoute, true);
  }
  const guardHome = event => {
    if (event.target instanceof Element && event.target.closest(homeSelector)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  document.addEventListener('click', guardHome, true);
  const panelSelector = ':scope > aside.cc-chat-panel[data-cc-shortcut-surface="agent-chat"]';
  const settingsSelector = `${panelSelector} > .cc-chat-capability-banner > button[type="button"]:not(.cc-chat-capability-banner-close)`;
  const controlsSelector = '[data-aiyou-openchatcut-host-controls]';
  function updateControls(shell) {
    const toolbar = shell.querySelector(':scope > .cc-topbar');
    if (!toolbar) return;
    let controls = toolbar.querySelector(controlsSelector);
    if (controls && controls.querySelectorAll('[data-aiyou-openchatcut-host-action]').length !== 4) { controls.remove(); controls = null; }
    if (!controls) {
      controls = document.createElement('div'); controls.setAttribute('data-aiyou-openchatcut-host-controls', '');
      const icons = {
        stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 2v10M6.3 5.7a9 9 0 1 0 11.4 0"/></svg>',
        settings: '⚙', close: '×',
        expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/></svg>',
      };
      for (const action of ['stop', 'settings', 'close', 'expand']) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'cc-header-btn cc-tip cc-tip-r';
        button.setAttribute('data-aiyou-openchatcut-host-action', action); button.innerHTML = icons[action];
        if (action === 'settings') button.setAttribute('data-aiyou-openchatcut-tool-settings', '');
        button.onclick = async () => {
          if (disposed) return;
          if (parentOrigin && window.parent !== window) {
            window.parent.postMessage({ type: 'aiyou-openchatcut:host-action', action }, parentOrigin);
          } else if (window.parent === window && action === 'settings') {
            const native = shell.querySelector(settingsSelector);
            if (native) native.click(); else try { await settings.open(); } catch {}
          }
        };
        controls.appendChild(button);
      }
      toolbar.prepend(controls);
      // Readiness contains no project/configuration data. The owned parent
      // answers at the exact iframe origin before any host action is enabled.
      if (window.parent !== window) window.parent.postMessage({ type: 'aiyou-openchatcut:host-controls-ready' }, '*');
    }
    const labels = { stop: '彻底关闭 OpenChatCut', settings: 'OpenChatCut 模型与 API 设置', close: '收起 OpenChatCut', expand: hostState.expanded ? '还原侧栏' : '展开面板' };
    const titles = { stop: '保存工程后结束后台进程', close: '收起面板 · 后台继续运行', expand: hostState.expanded ? '还原侧栏宽度' : '展开至整个工作区' };
    for (const button of controls.querySelectorAll('[data-aiyou-openchatcut-host-action]')) {
      const action = button.getAttribute('data-aiyou-openchatcut-host-action');
      const label = labels[action], title = titles[action] || label;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (button.getAttribute('data-tip') !== title) button.setAttribute('data-tip', title);
      if (button.title !== title) button.title = title;
      button.disabled = window.parent === window ? action !== 'settings' : !parentOrigin || Boolean(hostState[`${action}Disabled`]);
      if (action === 'expand' && button.getAttribute('aria-pressed') !== String(hostState.expanded)) button.setAttribute('aria-pressed', String(hostState.expanded));
    }
    if (controls.title !== hostState.status) controls.title = hostState.status;
  }
  function updateHints(shell) {
    // These two v0.2.16 guide cards are identified by their pinned role,
    // independent of locale. Do not hide missing-media errors/status messages.
    for (const hint of shell.querySelectorAll('[data-cc-shortcut-surface="media-pool"] .cc-media-export-guide')) {
      const key = hint.getAttribute('role') === 'note' ? 'music-models' : 'media-export';
      if (hint.getAttribute('data-aiyou-openchatcut-dismissible-hint') !== key) hint.setAttribute('data-aiyou-openchatcut-dismissible-hint', key);
      if (dismissedHints.has(key)) {
        if (!hint.hasAttribute('data-aiyou-openchatcut-hint-hidden')) hint.setAttribute('data-aiyou-openchatcut-hint-hidden', '');
      }
      if (hint.querySelector('[data-aiyou-openchatcut-dismiss-hint]')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '×';
      button.setAttribute('data-aiyou-openchatcut-dismiss-hint', key);
      button.setAttribute('aria-label', key === 'music-models' ? '关闭音乐分析模型提示' : '关闭素材下载提示'); button.title = button.getAttribute('aria-label');
      button.onclick = event => {
        event.preventDefault(); event.stopPropagation(); dismissedHints.add(key);
        try { localStorage.setItem(hintsKey, JSON.stringify([...dismissedHints])); } catch {}
        updateHints(shell);
      };
      hint.appendChild(button);
    }
  }
  function clean(shell) {
    shell.removeAttribute('data-aiyou-openchatcut-editor');
    shell.style.removeProperty('--aiyou-openchatcut-library-width');
    for (const divider of shell.querySelectorAll(':scope > [data-aiyou-openchatcut-agent-divider]')) divider.removeAttribute('data-aiyou-openchatcut-agent-divider');
    shell.querySelector(controlsSelector)?.remove();
    for (const hint of shell.querySelectorAll('[data-aiyou-openchatcut-dismissible-hint]')) {
      hint.removeAttribute('data-aiyou-openchatcut-dismissible-hint'); hint.removeAttribute('data-aiyou-openchatcut-hint-hidden');
      hint.querySelector('[data-aiyou-openchatcut-dismiss-hint]')?.remove();
    }
    for (const home of shell.querySelectorAll('[data-aiyou-openchatcut-project-home]')) home.removeAttribute('data-aiyou-openchatcut-project-home');
  }
  function update(shell) {
    const panel = shell.querySelector(panelSelector);
    const divider = panel?.nextElementSibling;
    // These tracks and the adjacent divider are the pinned official editor
    // contract. Unknown layouts stay visible instead of hiding another tool.
    const tracks = /^(?:[\d.]+(?:px|vw))\s+0(?:px)?\s+([\d.]+(?:px|vw))\s+0(?:px)?\s+minmax\(0(?:px)?,\s*1fr\)$/.exec(shell.style.gridTemplateColumns);
    if (!panel || divider?.tagName !== 'DIV' || divider.style.gridColumn !== '2' || divider.style.gridRow !== '2 / 5' || !tracks) { clean(shell); return; }
    if (shell.getAttribute('data-aiyou-openchatcut-editor') !== 'v0.2.16') shell.setAttribute('data-aiyou-openchatcut-editor', 'v0.2.16');
    if (shell.style.getPropertyValue('--aiyou-openchatcut-library-width') !== tracks[1]) shell.style.setProperty('--aiyou-openchatcut-library-width', tracks[1]);
    if (!divider.hasAttribute('data-aiyou-openchatcut-agent-divider')) divider.setAttribute('data-aiyou-openchatcut-agent-divider', '');
    for (const home of shell.querySelectorAll(':scope > .cc-topbar > button.cc-tip[aria-label]')) {
      if (!home.hasAttribute('data-aiyou-openchatcut-project-home')) home.setAttribute('data-aiyou-openchatcut-project-home', '');
    }
    updateControls(shell); updateHints(shell);
  }
  function refresh() {
    if (disposed) return;
    for (const [shell, observer] of shells) {
      if (!shell.isConnected) { observer.disconnect(); clean(shell); shells.delete(shell); }
    }
    for (const shell of document.querySelectorAll('.cc-editor-shell')) {
      if (!shells.has(shell)) {
        const observer = new MutationObserver(() => update(shell));
        observer.observe(shell, { attributes: true, attributeFilter: ['style'] });
        shells.set(shell, observer);
      }
      update(shell);
    }
  }
  function schedule() {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => { queued = false; refresh(); });
  }
  const observer = new MutationObserver(records => {
    // Timeline/playback DOM churn does not require a full layout rescan.
    if (records.some(record => {
      const target = record.target;
      if (target instanceof Element && (target.matches('.cc-editor-shell') || target.closest('.cc-chat-panel, .cc-topbar, [data-cc-shortcut-surface="media-pool"]'))) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('.cc-editor-shell') || node.querySelector('.cc-editor-shell')));
    })) schedule();
  });
  observer.observe(root, { childList: true, subtree: true });
  const hostStateMessage = event => {
    if (disposed || !allowedParent(event) || event.data?.type !== 'aiyou-openchatcut:host-state') return;
    parentOrigin = event.origin;
    hostState = { stopDisabled: event.data.stopDisabled !== false, settingsDisabled: event.data.settingsDisabled !== false,
      expanded: event.data.expanded === true, status: typeof event.data.status === 'string' ? event.data.status.slice(0, 500) : '' };
    for (const shell of shells.keys()) updateControls(shell);
  };
  window.addEventListener('message', hostStateMessage);
  const settingsMessage = async event => {
    if (disposed || event.source !== window.parent || event.data?.type !== 'aiyou-openchatcut:open-model-settings'
      || !/^occ-settings-[a-f0-9-]{36}$/i.test(event.data.requestId || '')) return;
    // The caller is the owned iframe's parent. Allow the native app origin and
    // isolated loopback browser fixtures, plus top-level controlled test pages.
    if (event.origin !== 'app://-' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)
      && !(window.parent === window && event.origin === location.origin)) return;
    const requestId = event.data.requestId;
    let ok = false;
    const editor = document.querySelector('.cc-editor-shell[data-aiyou-openchatcut-editor="v0.2.16"]');
    if (editor) {
      try { await settings.open(); ok = !disposed; } catch { /* Report a bounded UI error without exposing configuration. */ }
    }
    if (!disposed) window.parent.postMessage({ type: 'aiyou-openchatcut:model-settings-result', requestId, ok,
      ...(ok ? {} : { error: 'OpenChatCut 模型设置入口尚未就绪，请重新连接编辑器。' }) }, event.origin);
  };
  window.addEventListener('message', settingsMessage);
  const shutdownMessage = async event => {
    if (disposed || event.source !== window.parent || event.data?.type !== 'aiyou-openchatcut:prepare-shutdown'
      || !/^occ-shutdown-[a-f0-9-]{36}$/i.test(event.data.requestId || '')
      || event.origin !== 'app://-' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) return;
    // v0.2.16 flushes pending project persistence on pagehide, and its
    // beforeunload guard stays cancelled while dirty/saving/error state exists.
    window.dispatchEvent(new Event('pagehide'));
    let ok = false;
    for (const deadline = Date.now() + 8000; !disposed && Date.now() < deadline;) {
      const guard = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(guard);
      if (!guard.defaultPrevented) { ok = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!disposed) window.parent.postMessage({ type: 'aiyou-openchatcut:shutdown-ready', requestId: event.data.requestId, ok,
      ...(ok ? {} : { error: '工程尚未保存成功，后台仍保留运行，请稍后重试。' }) }, event.origin);
  };
  window.addEventListener('message', shutdownMessage);
  window.__aiyouOpenChatCutHostMode__ = { version: '5', refresh, destroy() {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('message', settingsMessage);
    window.removeEventListener('message', shutdownMessage);
    window.removeEventListener('message', hostStateMessage);
    document.removeEventListener('click', guardHome, true);
    window.removeEventListener('hashchange', guardRoute, true);
    window.removeEventListener('popstate', guardRoute, true);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
    root.removeAttribute('data-aiyou-openchatcut-project');
    settings.destroy();
    for (const [shell, shellObserver] of shells) { shellObserver.disconnect(); clean(shell); }
    shells.clear();
    style.remove();
    root.removeAttribute('data-aiyou-openchatcut-host');
    delete window.__aiyouOpenChatCutHostMode__;
  } };
  refresh();
  return { applied: true };
}

export function openChatCutHostModeExpression() {
  const options = JSON.stringify({
    origin: ASSET_CONSOLE_EMBED_ORIGIN, prefix: '/__codex_asset_console__/', css: OPENCHATCUT_HOST_CSS, styleId: OPENCHATCUT_HOST_STYLE_ID,
    settingsModules: OPENCHATCUT_SETTINGS_MODULES,
  });
  return `(${installOpenChatCutHostMode.toString()})({...${options},createSettingsOpener:(${createOpenChatCutSettingsOpener.toString()})})`;
}

export function isOpenChatCutRuntimeAsset(request) {
  return request?.method === 'GET' && RUNTIME_ASSETS.has(request.url);
}

export function openChatCutEmbedRoute(requestUrl, { token, editorSession = false } = {}) {
  const url = new URL(requestUrl);
  if (url.origin !== ASSET_CONSOLE_EMBED_ORIGIN) return null;
  const prefix = assetConsoleEmbedPrefix(token);
  if (url.pathname.startsWith(prefix)) return `${url.pathname.slice(prefix.length - 1) || '/'}${url.search}`;
  return editorSession ? `${url.pathname}${url.search}` : null;
}

export function transformOpenChatCutBody(route, body, contentType, token) {
  if (!contentType?.includes('text/html')) return body;
  const prefix = assetConsoleEmbedPrefix(token);
  const hostMode = /^\/(?:index\.html)?(?:\?|$)/.test(route)
    ? `<style id="${OPENCHATCUT_HOST_STYLE_ID}">${OPENCHATCUT_HOST_CSS}</style><script>${openChatCutHostModeExpression()}</script>` : '';
  return Buffer.from(body.toString('utf8')
    .replace(/\b(src|href)=(['"])\/(?!\/)/g, (_, attribute, quote) => `${attribute}=${quote}${prefix}`)
    // The serialized host script can exceed the browser's early encoding scan
    // and contains Chinese strings. Declare our UTF-8 bytes before that script,
    // retaining a single declaration when upstream starts with its own meta.
    .replace(/(<head\b[^>]*>)(?:\s*<meta\b[^>]*\bcharset\s*=[^>]*>)?/i,
      (_, head) => `${head}<meta charset="UTF-8"><base href="${prefix}">${hostMode}`));
}

export function requestOpenChatCut(origin, { method = 'GET', route = '/', headers = {}, body, signal } = {}) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password) throw new Error('Invalid OpenChatCut loopback origin');
  return new Promise((resolve, reject) => {
    const forwarded = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    Object.assign(forwarded, { host: base.host, origin: base.origin, 'sec-fetch-site': 'same-origin', 'accept-encoding': 'identity' });
    for (const key of ['referer', 'connection', 'content-length']) delete forwarded[key];
    const isMedia = /^\/media\//.test(route);
    if (isMedia && method === 'GET') {
      const range = boundedMediaRange(forwarded.range);
      if (range) forwarded.range = range;
      else if (/\.(mp4|mov|webm|mkv|m4v|avi|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)/i.test(route)) {
        forwarded.range = `bytes=0-${MAX_MEDIA_CHUNK_BYTES - 1}`;
      }
    }
    const request = http.request({ hostname: base.hostname, port: base.port, path: route, method, headers: forwarded }, response => {
      const chunks = []; let bytes = 0;
      const limit = isMedia ? assetResponseByteLimit(response.headers['content-type']) : 64 * 1024 * 1024;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) request.destroy(new Error('OpenChatCut response exceeds embedded transfer limit'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode || 502, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(150_000, () => request.destroy(new Error('OpenChatCut local request timed out')));
    const abort = () => request.destroy(new Error('OpenChatCut request canceled'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('close', () => signal?.removeEventListener('abort', abort));
    request.on('error', reject);
    if (signal?.aborted) return abort();
    if (body) request.write(body); request.end();
  });
}
