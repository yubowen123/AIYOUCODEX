import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isOpenChatCutRuntimeAsset, openChatCutEmbedRoute, openChatCutHostModeExpression, requestOpenChatCut, transformOpenChatCutBody } from './openchatcut-embed.mjs';
import { assetResponseByteLimit, boundedMediaRange, createMediaRequestLimiter } from "./asset-console-media.mjs";

import {
  ASSET_CONSOLE_EMBED_ORIGIN,
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleRoute,
  existingAssetConsoleEmbed,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "./asset-console-embed.mjs";

export const ASSET_CONSOLE_BINDING = "codexSidebarOpenAssetConsole";

export function assetConsoleTimeoutForRoute(route = "/") {
  if (String(route).startsWith("/api/arena/")) return 180_000;
  return String(route).startsWith("/api/library") ? 35_000 : 15_000;
}

const STATIC_FILES = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/asset-metadata-ui.js", { name: "asset-metadata-ui.js", type: "text/javascript; charset=utf-8" }],
  ["/asset-library-state.js", { name: "asset-library-state.js", type: "text/javascript; charset=utf-8" }],
  ["/asset-media-lifecycle.js", { name: "asset-media-lifecycle.js", type: "text/javascript; charset=utf-8" }],
  ["/ui-v3.css", { name: "ui-v3.css", type: "text/css; charset=utf-8" }],
]);

export class AssetConsoleBridge {
  constructor({ staticRoot, tokenPath, port = 5177, logger = () => {}, openChatCutStatus } = {}) {
    this.staticRoot = staticRoot;
    this.tokenPath = tokenPath;
    this.port = Number(port);
    this.client = null;
    this.removeBindingListener = null;
    this.proxy = null;
    this.openChatCutProxy = null;
    this.proxies = new Set();
    this.iframeSessions = new Map();
    this.proxyQueue = Promise.resolve();
    this.generation = 0;
    this.token = null;
    this.logger = logger;
    this.openChatCutStatus = openChatCutStatus;
    this.mediaRequests = createMediaRequestLimiter();
  }

  get available() {
    return Boolean(this.staticRoot
      && this.tokenPath
      && existsSync(path.join(this.staticRoot, "index.html"))
      && existsSync(path.join(this.staticRoot, "app.js"))
      && existsSync(path.join(this.staticRoot, "asset-metadata-ui.js"))
      && existsSync(path.join(this.staticRoot, "asset-library-state.js"))
      && existsSync(path.join(this.staticRoot, "asset-media-lifecycle.js"))
      && existsSync(path.join(this.staticRoot, "ui-v3.css")));
  }

  async apiToken() {
    if (!this.token) this.token = String(await readFile(this.tokenPath, "utf8")).trim();
    if (this.token.length < 32) throw new Error("资产控制台本机令牌无效");
    return this.token;
  }

  requestLocal({ method = "GET", route = "/", headers = {}, body = null, timeoutMs, signal } = {}) {
    const requestTimeoutMs = Number(timeoutMs) || assetConsoleTimeoutForRoute(route);
    return this.apiToken().then((apiToken) => new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("资产请求已取消")); return; }
      const requestHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      requestHeaders.host = `127.0.0.1:${this.port}`;
      for (const name of Object.keys(requestHeaders)) {
        if (["origin", "referer", "connection", "content-length"].includes(name.toLowerCase())) delete requestHeaders[name];
      }
      if (route.startsWith("/api/") || route === "/media" || route.startsWith("/media?")) {
        requestHeaders["x-asset-console-token"] = apiToken;
      }
      const isMedia = route === "/media" || route.startsWith("/media?") || route.startsWith("/api/arena/media/");
      if (isMedia) {
        requestHeaders["x-aiyoucodex-bounded-media"] = "1";
        const range = boundedMediaRange(requestHeaders.range);
        if (range) requestHeaders.range = range;
      }
      let settled = false, responseStream = null, totalBytes = 0;
      const chunks = [];
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
        if (error) { chunks.length = 0; reject(error); }
        else resolve(value);
      };
      const request = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: route,
        method,
        headers: requestHeaders,
      }, (response) => {
        responseStream = response;
        const limit = assetResponseByteLimit(response.headers["content-type"]);
        const fail = (error) => { finish(error); response.destroy(); request.destroy(); };
        const hasBody = method !== "HEAD" && ![204, 304].includes(response.statusCode);
        if (hasBody && Number(response.headers["content-length"]) > limit) {
          fail(new Error("资产响应超过安全传输上限，请使用分段读取"));
          return;
        }
        response.on("data", (chunk) => {
          if (settled) return;
          totalBytes += chunk.length;
          if (totalBytes > limit) { fail(new Error("资产响应超过安全传输上限")); return; }
          chunks.push(chunk);
        });
        response.on("aborted", () => finish(new Error("资产响应提前中断")));
        response.on("error", (error) => finish(error));
        response.on("close", () => { if (!response.complete) finish(new Error("资产连接提前关闭")); });
        response.on("end", () => {
          if (!settled) finish(null, { status: response.statusCode || 502, headers: response.headers, body: Buffer.concat(chunks, totalBytes) });
        });
      });
      const abort = () => { finish(new Error("资产请求已取消")); responseStream?.destroy(); request.destroy(); };
      const deadline = setTimeout(() => { finish(new Error("资产控制台请求超时")); responseStream?.destroy(); request.destroy(); }, requestTimeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      request.setTimeout(requestTimeoutMs, () => { finish(new Error("资产控制台请求超时")); request.destroy(); });
      request.on("error", (error) => finish(error));
      if (body) request.write(body);
      request.end();
    }));
  }

  async staticResponse(route, method) {
    if (method !== "GET") return null;
    let pathname;
    try { pathname = new URL(route, `http://127.0.0.1:${this.port}/`).pathname; } catch { return null; }
    const file = STATIC_FILES.get(pathname);
    if (!file) return null;
    return {
      status: 200,
      headers: { "content-type": file.type, "cache-control": "no-store" },
      body: await readFile(path.join(this.staticRoot, file.name)),
    };
  }

  async waitForService() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await this.requestLocal({ timeoutMs: 400 });
        if (response.status >= 200 && response.status < 500) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("资产控制台本机服务未启动");
  }

  queue(work) {
    const pending = this.proxyQueue.then(work, work);
    this.proxyQueue = pending.catch(() => {});
    return pending;
  }

  async failRequest(proxy, event, sessionId, { reasonCode = 'REQUEST_OUT_OF_SCOPE', errorReason = 'BlockedByClient' } = {}) {
    // Diagnostics are fixed classifications, never URLs, headers, body data,
    // exception messages or routing tokens. Bound repeated failures per proxy.
    const kind = proxy.kind === 'openchatcut' ? 'openchatcut' : 'asset';
    const code = /^[A-Z0-9_]{1,64}$/.test(reasonCode) ? reasonCode : 'REQUEST_FAILURE';
    proxy.loggedFailures ||= new Set();
    if (!proxy.loggedFailures.has(code) && proxy.loggedFailures.size < 32) {
      proxy.loggedFailures.add(code);
      try { this.logger(`proxy ${kind} failure ${code} (${errorReason})`); } catch {}
    }
    try {
      await proxy.client.send("Fetch.failRequest", {
        requestId: event.requestId,
        errorReason,
      }, sessionId);
    } catch {}
  }

  async activateSession(proxy, sessionId) {
    const info = proxy.sessionInfo.get(sessionId);
    if (!info || info.active || proxy.cancelled) return;
    info.active = true;
    proxy.assetSessions.add(sessionId);
    try {
      await proxy.client.send("Network.enable", {}, sessionId);
      await proxy.client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      }, sessionId);
      if (proxy.kind === 'openchatcut') await proxy.client.send('Runtime.evaluate', {
        expression: openChatCutHostModeExpression(), returnByValue: true,
      }, sessionId);
    } catch (error) {
      info.active = false;
      proxy.assetSessions.delete(sessionId);
      throw error;
    }
  }

  async proxyRequest(event, sessionId, proxy) {
    if (proxy.cancelled) return this.failRequest(proxy, event, sessionId, { reasonCode: 'PROXY_CANCELLED', errorReason: 'Aborted' });
    let url;
    try { url = new URL(event.request.url); } catch {
      return this.failRequest(proxy, event, sessionId, { reasonCode: 'INVALID_REQUEST_URL' });
    }
    const privateRequest = url.origin === ASSET_CONSOLE_EMBED_ORIGIN
      && url.pathname.startsWith(proxy.embedPrefix);
    if (!privateRequest && (!sessionId || !proxy.assetSessions.has(sessionId))) return;

    if (!sessionId) {
      if (!privateRequest || !event.frameId) return this.failRequest(proxy, event, sessionId, { reasonCode: 'MISSING_OWNED_FRAME' });
      if (proxy.allowedFrameId && proxy.allowedFrameId !== event.frameId) return this.failRequest(proxy, event, sessionId, { reasonCode: 'FRAME_OWNERSHIP_MISMATCH' });
      proxy.allowedFrameId = event.frameId;
      for (const [candidateSessionId, info] of proxy.sessionInfo) {
        if (info.targetId === proxy.allowedFrameId) {
          try { await this.activateSession(proxy, candidateSessionId); } catch {}
        }
      }
    } else {
      const info = proxy.sessionInfo.get(sessionId);
      if (privateRequest && !proxy.allowedFrameId && info && event.frameId === info.targetId) {
        proxy.allowedFrameId = event.frameId;
      }
      const frameMatches = Boolean(info && proxy.allowedFrameId
        && info.targetId === proxy.allowedFrameId
        && (!event.frameId || event.frameId === proxy.allowedFrameId));
      if (privateRequest && frameMatches) {
        try { await this.activateSession(proxy, sessionId); } catch {
          return this.failRequest(proxy, event, sessionId, { reasonCode: 'FRAME_ACTIVATION_FAILED', errorReason: 'Failed' });
        }
      } else if (!frameMatches || !proxy.assetSessions.has(sessionId)) {
        return privateRequest ? this.failRequest(proxy, event, sessionId, { reasonCode: 'FRAME_OWNERSHIP_MISMATCH' }) : undefined;
      }
    }

    const assetSession = Boolean(sessionId && proxy.assetSessions.has(sessionId));
    if (proxy.kind === 'openchatcut' && assetSession && isOpenChatCutRuntimeAsset(event.request)) {
      const headers = Object.entries(event.request.headers || {})
        .filter(([name]) => !/^(cookie|authorization|proxy-authorization|referer|x-asset-console-token)$/i.test(name))
        .map(([name, value]) => ({ name, value: String(value) }));
      return proxy.client.send('Fetch.continueRequest', { requestId: event.requestId, headers }, sessionId);
    }
    const route = proxy.kind === 'openchatcut'
      ? openChatCutEmbedRoute(event.request.url, { token: proxy.token, editorSession: assetSession })
      : assetConsoleRoute(event.request.url, { token: proxy.token, assetSession });
    if (!route) return this.failRequest(proxy, event, sessionId, { reasonCode: 'ROUTE_OUT_OF_SCOPE' });
    const controller = new AbortController();
    const transferKey = `${sessionId || "root"}:${event.networkId || event.requestId}`;
    proxy.transfers.set(transferKey, controller);
    const isMedia = route === "/media" || route.startsWith("/media?") || route.startsWith("/api/arena/media/")
      || proxy.kind === 'openchatcut' && route.startsWith('/media/');
    let phase = 'UPSTREAM';
    try {
      const transfer = async () => {
        if (controller.signal.aborted || proxy.cancelled) return;
        const response = proxy.kind === 'openchatcut' ? await requestOpenChatCut(proxy.origin, {
          method: event.request.method, route, headers: event.request.headers,
          body: event.request.postDataEntries?.length ? Buffer.concat(event.request.postDataEntries.map(entry => Buffer.from(entry.bytes || '', 'base64'))) : event.request.postData || null, signal: controller.signal,
        }) : await this.staticResponse(route, event.request.method)
          || await this.requestLocal({
            method: event.request.method, route, headers: event.request.headers,
            body: event.request.postData || null, signal: controller.signal,
          });
        if (controller.signal.aborted || proxy.cancelled) return;
        phase = 'TRANSFORM';
        const body = proxy.kind === 'openchatcut'
          ? transformOpenChatCutBody(route, response.body, response.headers['content-type'], proxy.token)
          : transformAssetConsoleBody(event.request.url, response.body, { token: proxy.token });
        phase = 'FULFILL';
        await proxy.client.send("Fetch.fulfillRequest", {
          requestId: event.requestId, responseCode: response.status,
          responseHeaders: responseHeadersForCdp(response.headers, body.length, { method: event.request.method }), body: body.toString("base64"),
        }, sessionId);
      };
      if (isMedia) await this.mediaRequests(transfer, controller.signal);
      else await transfer();
    } catch (error) {
      const knownCode = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EPIPE'].includes(error?.code) ? error.code : 'ERROR';
      const errorReason = error?.code === 'ECONNREFUSED' ? 'ConnectionRefused'
        : error?.code === 'ETIMEDOUT' ? 'TimedOut' : controller.signal.aborted ? 'Aborted' : 'Failed';
      await this.failRequest(proxy, event, sessionId, { reasonCode: `${phase}_${knownCode}`, errorReason });
    } finally {
      if (proxy.transfers.get(transferKey) === controller) proxy.transfers.delete(transferKey);
    }
  }

  async disposeProxy(proxy = this.proxy) {
    if (!proxy || proxy.disposed) return;
    proxy.cancelled = true;
    proxy.disposed = true;
    if (this.proxy === proxy) this.proxy = null;
    if (this.openChatCutProxy === proxy) this.openChatCutProxy = null;
    this.proxies.delete(proxy);
    proxy.removeAttachedListener?.();
    proxy.removePausedListener?.();
    proxy.removeFailedListener?.();
    for (const controller of proxy.transfers.values()) controller.abort();
    proxy.transfers.clear();
    try {
      if (this.proxies.size) await proxy.client.send('Fetch.enable', { patterns: [...this.proxies].map(p => ({ urlPattern: `${p.embedUrl}*`, requestStage: 'Request' })) });
      else await proxy.client.send("Fetch.disable");
    } catch {}
    for (const sessionId of proxy.sessions) {
      if ([...this.proxies].some(p => p.assetSessions.has(sessionId))) continue;
      try { await proxy.client.send("Fetch.disable", {}, sessionId); } catch {}
    }
    proxy.sessions.clear();
    proxy.assetSessions.clear();
    proxy.sessionInfo.clear();
    try {
      if (!this.proxies.size) await proxy.client.send("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
    } catch {}
  }

  async setupProxy(generation, { reuseToken = null, kind = 'asset', origin, restartId = null } = {}) {
    return this.queue(async () => {
      if (generation !== this.generation || !this.client) return null;
      const previous = kind === 'openchatcut' ? this.openChatCutProxy : this.proxy;
      if (previous && kind === 'openchatcut' && previous.origin === origin && !previous.cancelled
        && (!restartId || previous.restartId === restartId)) return previous;
      if (previous) await this.disposeProxy(previous);
      if (generation !== this.generation || !this.client) return null;
      // Only a validated app-owned iframe may retain its routing token across
      // transport reconnections. Never navigate/reload it merely to reconnect.
      const token = reuseToken == null ? randomBytes(24).toString("hex") : reuseToken;
      assetConsoleEmbedPrefix(token);
      const proxy = {
        client: this.client,
        kind, origin, restartId,
        token,
        embedPrefix: assetConsoleEmbedPrefix(token),
        embedUrl: assetConsoleEmbedUrl(token),
        allowedFrameId: null,
        sessions: new Set(),
        assetSessions: new Set(),
        sessionInfo: new Map(),
        transfers: new Map(),
        cancelled: false,
        disposed: false,
      };
      if (kind === 'openchatcut') this.openChatCutProxy = proxy;
      else this.proxy = proxy;
      this.proxies.add(proxy);
      proxy.removeAttachedListener = proxy.client.on("Target.attachedToTarget", async (event) => {
        const sessionId = event.sessionId;
        const targetUrl = event.targetInfo?.url || "";
        const candidate = Boolean(sessionId
          && event.targetInfo?.type === "iframe"
          && (!targetUrl || targetUrl.startsWith(proxy.embedUrl)));
        if (!candidate || proxy.cancelled) {
          if (sessionId) {
            try { await proxy.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch {}
          }
          return;
        }
        proxy.sessions.add(sessionId);
        proxy.sessionInfo.set(sessionId, { targetId: event.targetInfo.targetId, active: false });
        if (reuseToken && targetUrl.startsWith(proxy.embedUrl)
          && (!proxy.allowedFrameId || proxy.allowedFrameId === event.targetInfo.targetId)) {
          proxy.allowedFrameId = event.targetInfo.targetId;
          try { await this.activateSession(proxy, sessionId); } catch {}
        } else {
          try {
            await proxy.client.send("Fetch.enable", {
              patterns: [...this.proxies].map(p => ({ urlPattern: `${p.embedUrl}*`, requestStage: "Request" })),
            }, sessionId);
          } catch {}
        }
        try { await proxy.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch {}
      });
      proxy.removePausedListener = proxy.client.on("Fetch.requestPaused", (event, meta) => {
        this.proxyRequest(event, meta?.sessionId, proxy).catch(() => {});
      });
      proxy.removeFailedListener = proxy.client.on("Network.loadingFailed", (event, meta) => {
        proxy.transfers.get(`${meta?.sessionId || "root"}:${event.requestId}`)?.abort();
      });
      await proxy.client.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      if (reuseToken) {
        for (const [sessionId, targetInfo] of this.iframeSessions) {
          if (!targetInfo.url?.startsWith(proxy.embedUrl)
            || proxy.allowedFrameId && proxy.allowedFrameId !== targetInfo.targetId) continue;
          proxy.allowedFrameId = targetInfo.targetId;
          proxy.sessions.add(sessionId);
          if (!proxy.sessionInfo.has(sessionId)) proxy.sessionInfo.set(sessionId, { targetId: targetInfo.targetId, active: false });
          await this.activateSession(proxy, sessionId);
        }
      }
      await proxy.client.send("Fetch.enable", {
        patterns: [...this.proxies].map(p => ({ urlPattern: `${p.embedUrl}*`, requestStage: "Request" })),
      });
      if (proxy.cancelled || generation !== this.generation) {
        await this.disposeProxy(proxy);
        return null;
      }
      return proxy;
    });
  }

  async publish(value, method = "setAssetConsolePanel") {
    if (!this.client) return;
    await this.client.evaluate(`window.__codexConversationPreviewInjection__?.[${JSON.stringify(method)}]?.(${JSON.stringify(value)})`);
  }

  async embedOpenChatCut(editorUrl, recovery = {}) {
    const url = new URL(editorUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) throw new Error('Invalid OpenChatCut editor URL');
    let reuseToken = null;
    // A dead server/error document needs a new owned routing generation. Its
    // former frame id may survive a failed navigation or delayed detach; never
    // relax ownership checks to accept an unrelated frame under the old route.
    const restartId = recovery.reconnectEditor === true
      && (recovery.serviceRestarted === true || recovery.editorDisconnected === true)
      && /^[a-f0-9]{24}$/.test(recovery.reconnectId || '') ? recovery.reconnectId : null;
    if (!restartId && !this.openChatCutProxy && this.client) {
      const existingUrl = await this.client.evaluate(`(() => {
        const frame = document.querySelector('#aiyoucodex-openchatcut iframe');
        return frame?.isConnected ? frame.getAttribute('src') : null;
      })()`);
      reuseToken = existingAssetConsoleEmbed(existingUrl)?.token || null;
    }
    const proxy = await this.setupProxy(this.generation, { kind: 'openchatcut', origin: url.origin, reuseToken, restartId });
    if (!proxy) throw new Error('OpenChatCut renderer disconnected');
    await this.recoverOpenChatCutErrorDocument(proxy);
    const embedded = new URL(proxy.embedUrl); embedded.hash = url.hash; embedded.search = url.search;
    return embedded.href;
  }

  async recoverOpenChatCutErrorDocument(proxy) {
    // A reload while the old transport was disconnected may have reached the
    // sandbox's BlobNotFound XML. Repair only that known error after restoring
    // interception; healthy editors and their staged work never reload here.
    for (const [sessionId, info] of proxy.sessionInfo) {
      if (info.targetId !== proxy.allowedFrameId || !proxy.assetSessions.has(sessionId)) continue;
      const result = await proxy.client.send('Runtime.evaluate', {
        expression: `(() => {
          const root = document.documentElement;
          return location.origin === ${JSON.stringify(ASSET_CONSOLE_EMBED_ORIGIN)}
            && location.pathname.startsWith(${JSON.stringify(proxy.embedPrefix)})
            && root?.localName === 'Error' && root.querySelector('Code')?.textContent === 'BlobNotFound';
        })()`, returnByValue: true,
      }, sessionId);
      if (result.result?.value !== true) continue;
      await proxy.client.send('Runtime.evaluate', { expression: 'location.reload();true', returnByValue: true }, sessionId);
      this.logger('OpenChatCut sandbox error document reloaded after transport recovery');
    }
  }

  async restoreOpenChatCutTransport() {
    if (typeof this.openChatCutStatus !== 'function') return;
    const existingUrl = await this.client.evaluate(`(() => {
      const frame = document.querySelector('#aiyoucodex-openchatcut iframe');
      return frame?.isConnected ? frame.getAttribute('src') : null;
    })()`);
    const existing = existingAssetConsoleEmbed(existingUrl);
    if (!existing) return;
    // Resolve the upstream from the host controller, never a renderer-supplied
    // loopback address. This read does not start the App or create a project.
    const threadId = await this.client.evaluate(`(() => {
      const state = window.__aiyouOpenChatCut__?.snapshot?.()?.state;
      return state?.threadId || state?.session?.threadId || null;
    })()`);
    const status = await this.openChatCutStatus({ threadId });
    const upstream = status?.baseUrl || status?.session?.editorUrl;
    if (!status?.installed || !upstream) return;
    if (status.session?.projectId && new URL(existingUrl).hash !== `#/editor/${encodeURIComponent(status.session.projectId)}`) return;
    const origin = new URL(upstream);
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.username || origin.password) return;
    const proxy = await this.setupProxy(this.generation, { kind: 'openchatcut', origin: origin.origin, reuseToken: existing.token });
    if (proxy) {
      await this.recoverOpenChatCutErrorDocument(proxy);
      this.logger('existing OpenChatCut frame transport restored');
    }
  }

  async handleBinding(payload) {
    let message = {};
    try { message = JSON.parse(payload || "{}"); } catch {}
    const generation = ++this.generation;
    this.logger(`request ${message.action || "unknown"} (${generation})`);
    if (message.action === "close") {
      await this.queue(() => this.disposeProxy());
      return;
    }
    try {
      await this.waitForService();
      if (generation !== this.generation) return;
      const proxy = await this.setupProxy(generation);
      if (!proxy || generation !== this.generation) return;
      const kind = message.kind === "arena" ? "arena" : "asset";
      const url = new URL(kind === "arena" ? "model-arena/" : "", proxy.embedUrl);
      url.searchParams.set("embed", "codex");
      if (typeof message.threadId === "string" && message.threadId.length <= 160) url.searchParams.set("threadId", message.threadId);
      if (typeof message.threadTitle === "string" && message.threadTitle.length <= 300) url.searchParams.set("threadTitle", message.threadTitle);
      await this.publish({ state: "ready", kind, url: url.href });
      this.logger("ready (embedded)");
    } catch (error) {
      if (generation !== this.generation) return;
      await this.queue(() => this.disposeProxy());
      await this.publish({ state: "error", kind: message.kind === "arena" ? "arena" : "asset", message: error?.message || "资产控制台加载失败" }).catch(() => {});
      this.logger(`error ${error?.message || "资产控制台加载失败"}`);
    }
  }

  async install(client) {
    await this.dispose();
    this.client = client;
    this.removeIframeAttachedListener = client.on('Target.attachedToTarget', event => {
      if (event.sessionId && event.targetInfo?.type === 'iframe') this.iframeSessions.set(event.sessionId, event.targetInfo);
    });
    this.removeIframeDetachedListener = client.on('Target.detachedFromTarget', event => {
      this.iframeSessions.delete(event.sessionId);
      for (const proxy of this.proxies) {
        const targetId = proxy.sessionInfo.get(event.sessionId)?.targetId;
        proxy.sessions.delete(event.sessionId); proxy.assetSessions.delete(event.sessionId); proxy.sessionInfo.delete(event.sessionId);
        if (targetId && proxy.allowedFrameId === targetId && ![...proxy.sessionInfo.values()].some(info => info.targetId === targetId)) proxy.allowedFrameId = null;
      }
    });
    const available = this.available;
    if (available) {
      await client.send("Runtime.enable");
      try { await client.send("Runtime.removeBinding", { name: ASSET_CONSOLE_BINDING }); } catch {}
      await client.send("Runtime.addBinding", { name: ASSET_CONSOLE_BINDING });
      this.removeBindingListener = client.on("Runtime.bindingCalled", ({ name, payload }) => {
        if (name === ASSET_CONSOLE_BINDING) this.handleBinding(payload).catch((error) => this.logger(`binding error ${error.message}`));
      });
      const existingUrl = await client.evaluate(`(() => {
        const frame = document.querySelector('#codex-asset-console-page iframe#codex-asset-console-frame');
        return frame?.isConnected ? frame.getAttribute('src') : null;
      })()`);
      const existing = existingAssetConsoleEmbed(existingUrl);
      if (existing) {
        await this.setupProxy(this.generation, { reuseToken: existing.token });
        this.logger("existing embedded frame transport restored");
      }
    }
    await this.restoreOpenChatCutTransport();
    await this.publish({ available, label: "资产控制台", mode: "embedded" }, "setAssetConsole");
  }

  async dispose() {
    this.generation += 1;
    this.removeBindingListener?.();
    this.removeBindingListener = null;
    await this.queue(async () => { for (const proxy of [...this.proxies]) await this.disposeProxy(proxy); });
    this.removeIframeAttachedListener?.(); this.removeIframeAttachedListener = null;
    this.removeIframeDetachedListener?.(); this.removeIframeDetachedListener = null;
    this.iframeSessions.clear();
    this.client = null;
  }
}
