import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  ASSET_CONSOLE_EMBED_ORIGIN,
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleRoute,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "./asset-console-embed.mjs";

export const ASSET_CONSOLE_BINDING = "codexSidebarOpenAssetConsole";

const STATIC_FILES = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/ui-v3.css", { name: "ui-v3.css", type: "text/css; charset=utf-8" }],
]);

export class AssetConsoleBridge {
  constructor({ staticRoot, tokenPath, port = 5177, logger = () => {} } = {}) {
    this.staticRoot = staticRoot;
    this.tokenPath = tokenPath;
    this.port = Number(port);
    this.client = null;
    this.removeBindingListener = null;
    this.proxy = null;
    this.proxyQueue = Promise.resolve();
    this.generation = 0;
    this.token = null;
    this.logger = logger;
  }

  get available() {
    return Boolean(this.staticRoot
      && this.tokenPath
      && existsSync(path.join(this.staticRoot, "index.html"))
      && existsSync(path.join(this.staticRoot, "app.js"))
      && existsSync(path.join(this.staticRoot, "ui-v3.css")));
  }

  async apiToken() {
    if (!this.token) this.token = String(await readFile(this.tokenPath, "utf8")).trim();
    if (this.token.length < 32) throw new Error("资产控制台本机令牌无效");
    return this.token;
  }

  requestLocal({ method = "GET", route = "/", headers = {}, body = null, timeoutMs = 15_000 } = {}) {
    return this.apiToken().then((apiToken) => new Promise((resolve, reject) => {
      const requestHeaders = { ...headers, host: `127.0.0.1:${this.port}` };
      for (const name of Object.keys(requestHeaders)) {
        if (["origin", "referer", "connection", "content-length"].includes(name.toLowerCase())) delete requestHeaders[name];
      }
      if (route.startsWith("/api/") || route === "/media" || route.startsWith("/media?")) {
        requestHeaders["x-asset-console-token"] = apiToken;
      }
      const request = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: route,
        method,
        headers: requestHeaders,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode || 502,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }));
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error("资产控制台请求超时")));
      request.on("error", reject);
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

  async failRequest(proxy, event, sessionId) {
    try {
      await proxy.client.send("Fetch.failRequest", {
        requestId: event.requestId,
        errorReason: "BlockedByClient",
      }, sessionId);
    } catch {}
  }

  async activateSession(proxy, sessionId) {
    const info = proxy.sessionInfo.get(sessionId);
    if (!info || info.active || proxy.cancelled) return;
    info.active = true;
    proxy.assetSessions.add(sessionId);
    try {
      await proxy.client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      }, sessionId);
    } catch (error) {
      info.active = false;
      proxy.assetSessions.delete(sessionId);
      throw error;
    }
  }

  async proxyRequest(event, sessionId, proxy) {
    if (proxy.cancelled) return this.failRequest(proxy, event, sessionId);
    let url;
    try { url = new URL(event.request.url); } catch {
      return this.failRequest(proxy, event, sessionId);
    }
    const privateRequest = url.origin === ASSET_CONSOLE_EMBED_ORIGIN
      && url.pathname.startsWith(proxy.embedPrefix);

    if (!sessionId) {
      if (!privateRequest || !event.frameId) return this.failRequest(proxy, event, sessionId);
      if (proxy.allowedFrameId && proxy.allowedFrameId !== event.frameId) return this.failRequest(proxy, event, sessionId);
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
          return this.failRequest(proxy, event, sessionId);
        }
      } else if (!frameMatches || !proxy.assetSessions.has(sessionId)) {
        return this.failRequest(proxy, event, sessionId);
      }
    }

    const assetSession = Boolean(sessionId && proxy.assetSessions.has(sessionId));
    const route = assetConsoleRoute(event.request.url, { token: proxy.token, assetSession });
    if (!route) return this.failRequest(proxy, event, sessionId);
    try {
      const response = await this.staticResponse(route, event.request.method)
        || await this.requestLocal({
          method: event.request.method,
          route,
          headers: event.request.headers,
          body: event.request.postData || null,
        });
      const body = transformAssetConsoleBody(event.request.url, response.body, { token: proxy.token });
      await proxy.client.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: response.status,
        responseHeaders: responseHeadersForCdp(response.headers, body.length),
        body: body.toString("base64"),
      }, sessionId);
    } catch {
      await this.failRequest(proxy, event, sessionId);
    }
  }

  async disposeProxy(proxy = this.proxy) {
    if (!proxy || proxy.disposed) return;
    proxy.cancelled = true;
    proxy.disposed = true;
    if (this.proxy === proxy) this.proxy = null;
    proxy.removeAttachedListener?.();
    proxy.removePausedListener?.();
    try { await proxy.client.send("Fetch.disable"); } catch {}
    for (const sessionId of proxy.sessions) {
      try { await proxy.client.send("Fetch.disable", {}, sessionId); } catch {}
    }
    proxy.sessions.clear();
    proxy.assetSessions.clear();
    proxy.sessionInfo.clear();
    try {
      await proxy.client.send("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
    } catch {}
  }

  async setupProxy(generation) {
    return this.queue(async () => {
      if (generation !== this.generation || !this.client) return null;
      if (this.proxy) await this.disposeProxy(this.proxy);
      if (generation !== this.generation || !this.client) return null;
      const token = randomBytes(24).toString("hex");
      const proxy = {
        client: this.client,
        token,
        embedPrefix: assetConsoleEmbedPrefix(token),
        embedUrl: assetConsoleEmbedUrl(token),
        allowedFrameId: null,
        sessions: new Set(),
        assetSessions: new Set(),
        sessionInfo: new Map(),
        cancelled: false,
        disposed: false,
      };
      this.proxy = proxy;
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
        try {
          await proxy.client.send("Fetch.enable", {
            patterns: [{ urlPattern: `${proxy.embedUrl}*`, requestStage: "Request" }],
          }, sessionId);
        } catch {}
        try { await proxy.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch {}
      });
      proxy.removePausedListener = proxy.client.on("Fetch.requestPaused", (event, meta) => {
        this.proxyRequest(event, meta.sessionId, proxy).catch(() => {});
      });
      await proxy.client.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      await proxy.client.send("Fetch.enable", {
        patterns: [{ urlPattern: `${proxy.embedUrl}*`, requestStage: "Request" }],
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
      const url = new URL(proxy.embedUrl);
      url.searchParams.set("embed", "codex");
      if (typeof message.threadId === "string" && message.threadId.length <= 160) url.searchParams.set("threadId", message.threadId);
      if (typeof message.threadTitle === "string" && message.threadTitle.length <= 300) url.searchParams.set("threadTitle", message.threadTitle);
      await this.publish({ state: "ready", url: url.href });
      this.logger(`ready ${url.origin}${url.pathname}`);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.queue(() => this.disposeProxy());
      await this.publish({ state: "error", message: error?.message || "资产控制台加载失败" }).catch(() => {});
      this.logger(`error ${error?.message || "资产控制台加载失败"}`);
    }
  }

  async install(client) {
    await this.dispose();
    this.client = client;
    const available = this.available;
    if (available) {
      await client.send("Runtime.enable");
      try { await client.send("Runtime.removeBinding", { name: ASSET_CONSOLE_BINDING }); } catch {}
      await client.send("Runtime.addBinding", { name: ASSET_CONSOLE_BINDING });
      this.removeBindingListener = client.on("Runtime.bindingCalled", ({ name, payload }) => {
        if (name === ASSET_CONSOLE_BINDING) this.handleBinding(payload).catch((error) => this.logger(`binding error ${error.message}`));
      });
    }
    await this.publish({ available, label: "资产控制台", mode: "embedded" }, "setAssetConsole");
  }

  async dispose() {
    this.generation += 1;
    this.removeBindingListener?.();
    this.removeBindingListener = null;
    await this.queue(() => this.disposeProxy());
    this.client = null;
  }
}
