import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { assetConsoleEmbedUrl, existingAssetConsoleEmbed, transformAssetConsoleBody } from "../lib/asset-console-embed.mjs";

const token = "a1".repeat(24);
const existingUrl = `${assetConsoleEmbedUrl(token)}?embed=codex`;
const staticRoot = fileURLToPath(new URL("../vendor/codex-workspace-enhancer/asset-console/public", import.meta.url));

class Client {
  constructor(url = existingUrl) { this.url = url; this.calls = []; this.expressions = []; this.listeners = new Map(); }
  on(name, callback) {
    this.listeners.set(name, callback);
    return () => this.listeners.delete(name);
  }
  async evaluate(expression) {
    this.expressions.push(expression);
    return expression.includes("frame.getAttribute('src')") ? this.url : undefined;
  }
  async send(method, params = {}, sessionId) {
    this.calls.push({ method, params, sessionId });
    if (method === "Target.setAutoAttach" && params.autoAttach && this.url) {
      await this.listeners.get("Target.attachedToTarget")?.({ sessionId: "child-session", targetInfo: { type: "iframe", targetId: "asset-frame", url: this.url } });
    }
    return {};
  }
}

class EditorClient extends Client {
  constructor({ errorDocument = false, retained = true } = {}) {
    super(null);
    this.editorUrl = retained ? `${assetConsoleEmbedUrl(token)}#/editor/project-a` : null;
    this.errorDocument = errorDocument;
  }
  async evaluate(expression) {
    this.expressions.push(expression);
    if (expression.includes('#aiyoucodex-openchatcut iframe')) return this.editorUrl;
    if (expression.includes('state?.threadId')) return 'owned-thread';
    return undefined;
  }
  async send(method, params = {}, sessionId) {
    this.calls.push({ method, params, sessionId });
    if (method === 'Target.setAutoAttach' && params.autoAttach && this.editorUrl) {
      await this.listeners.get('Target.attachedToTarget')?.({ sessionId: 'editor-session', targetInfo: { type: 'iframe', targetId: 'editor-frame', url: this.editorUrl } });
    }
    if (method === 'Runtime.evaluate' && params.expression.includes("root?.localName === 'Error'")) return { result: { value: this.errorDocument } };
    return {};
  }
}

test('install restores a retained OpenChatCut transport from its host session without another open request', async () => {
  const requests = [];
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: '/unused-in-unit-test', openChatCutStatus: async context => {
    requests.push(context);
    return { installed: true, session: { projectId: 'project-a', editorUrl: 'http://127.0.0.1:5199/#/editor/project-a' } };
  } });
  const client = new EditorClient();
  await bridge.install(client);
  assert.deepEqual(requests, [{ threadId: 'owned-thread' }]);
  assert.equal(bridge.openChatCutProxy.token, token);
  assert.equal(bridge.openChatCutProxy.origin, 'http://127.0.0.1:5199');
  assert.equal(bridge.openChatCutProxy.assetSessions.has('editor-session'), true);
  assert.equal(client.calls.some(call => call.params?.expression === 'location.reload();true'), false, 'A healthy mounted document never reloads');
  assert.equal(client.expressions.some(expression => /\.src\s*=/.test(expression)), false);
  await bridge.dispose();
});

test('only a known BlobNotFound editor document reloads after its owned transport is ready', async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: '/unused-in-unit-test', openChatCutStatus: async () => ({ installed: true, baseUrl: 'http://127.0.0.1:5199' }) });
  const client = new EditorClient({ errorDocument: true });
  await bridge.install(client);
  const reloadIndex = client.calls.findIndex(call => call.params?.expression === 'location.reload();true');
  assert.ok(reloadIndex > 0);
  assert.equal(client.calls[reloadIndex].sessionId, 'editor-session');
  assert.ok(client.calls.slice(0, reloadIndex).some(call => call.method === 'Fetch.enable' && call.sessionId === 'editor-session'));
  await bridge.dispose();
});

test('a confirmed restarted service gets a fresh owned route and repeated recovery events share it', async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: '/unused-in-unit-test' });
  const client = new EditorClient();
  await bridge.install(client);
  const original = await bridge.embedOpenChatCut('http://127.0.0.1:5199/#/editor/project-a');
  const oldProxy = bridge.openChatCutProxy; oldProxy.allowedFrameId = 'obsolete-frame';
  const recovery = { reconnectEditor: true, serviceRestarted: true, reconnectId: 'ab'.repeat(12) };
  const restarted = await bridge.embedOpenChatCut('http://127.0.0.1:5199/#/editor/project-a', recovery);
  assert.notEqual(restarted, original); assert.equal(new URL(restarted).hash, '#/editor/project-a');
  assert.equal(oldProxy.cancelled, true); assert.equal(bridge.openChatCutProxy.allowedFrameId, null);
  assert.equal(await bridge.embedOpenChatCut('http://127.0.0.1:5199/#/editor/project-a', recovery), restarted);
  assert.equal(await bridge.embedOpenChatCut('http://127.0.0.1:5199/#/editor/project-a'), restarted, 'Ordinary reads preserve the healthy route');
  await bridge.dispose();
});

test('transport adoption rejects an uninstalled app, unrelated project or non-loopback upstream', async () => {
  for (const status of [
    { installed: false, baseUrl: 'http://127.0.0.1:5199' },
    { installed: true, session: { projectId: 'project-b', editorUrl: 'http://127.0.0.1:5199/#/editor/project-b' } },
    { installed: true, baseUrl: 'https://remote.test' },
  ]) {
    const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: '/unused-in-unit-test', openChatCutStatus: async () => status });
    await bridge.install(new EditorClient());
    assert.equal(bridge.openChatCutProxy, null);
    await bridge.dispose();
  }
});

test('pinned runtime CDN assets are released only in the owned OpenChatCut frame', async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: '/unused-in-unit-test' });
  const client = new Client();
  const proxy = { client, token, kind: 'openchatcut', embedPrefix: `/__codex_asset_console__/${token}/`,
    allowedFrameId: 'editor-frame', assetSessions: new Set(['editor-session']),
    sessionInfo: new Map([['editor-session', { targetId: 'editor-frame', active: true }]]) };
  const event = { requestId: 'runtime', frameId: 'editor-frame', request: {
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort-wasm-simd-threaded.asyncify.wasm', method: 'GET',
    headers: { Origin: 'null', Accept: '*/*', Cookie: 'fixture', Authorization: 'fixture', 'Proxy-Authorization': 'fixture', Referer: existingUrl, 'X-Asset-Console-Token': 'fixture' },
  } };
  await bridge.proxyRequest(event, 'editor-session', proxy);
  assert.deepEqual(client.calls.at(-1), { method: 'Fetch.continueRequest', sessionId: 'editor-session', params: {
    requestId: 'runtime', headers: [{ name: 'Origin', value: 'null' }, { name: 'Accept', value: '*/*' }],
  } });
  client.calls.length = 0;
  await bridge.proxyRequest(event, 'unowned-session', proxy);
  await bridge.proxyRequest({ ...event, frameId: 'unowned-frame' }, 'editor-session', proxy);
  assert.equal(client.calls.length, 0, 'Other frames are not handled by this proxy');
  await bridge.proxyRequest(event, 'editor-session', { ...proxy, kind: 'asset' });
  assert.equal(client.calls.at(-1).method, 'Fetch.failRequest');
  await bridge.proxyRequest({ ...event, request: { ...event.request, method: 'POST' } }, 'editor-session', proxy);
  assert.equal(client.calls.at(-1).method, 'Fetch.failRequest');
  await bridge.proxyRequest({ ...event, request: { ...event.request, url: event.request.url + '?extra=1' } }, 'editor-session', proxy);
  assert.equal(client.calls.at(-1).method, 'Fetch.failRequest');
});

test("only app-owned sandbox embed URLs qualify for transport adoption", () => {
  assert.deepEqual(existingAssetConsoleEmbed(existingUrl), { token, embedUrl: assetConsoleEmbedUrl(token) });
  for (const suffix of ["model-arena/?embed=codex", "model-arena/index.html?threadId=fixture"]) {
    assert.deepEqual(existingAssetConsoleEmbed(`${assetConsoleEmbedUrl(token)}${suffix}`), { token, embedUrl: assetConsoleEmbedUrl(token) });
  }
  for (const invalid of [null, "", "javascript:void(0)", "https://example.com/", existingUrl.replace("a1".repeat(24), "bad"), existingUrl.replace("?embed=codex", "other"), existingUrl.replace("https://", "https://user@")]) {
    assert.equal(existingAssetConsoleEmbed(invalid), null);
  }
});

test("Arena reconnect adopts the existing module document and preserves its API transport", async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: "/unused-in-unit-test" });
  const client = new Client(`${assetConsoleEmbedUrl(token)}model-arena/?embed=codex`);
  await bridge.install(client);
  assert.equal(bridge.proxy.token, token);
  assert.equal(bridge.proxy.assetSessions.has("child-session"), true);
  assert.equal(client.expressions.some((text) => text.includes('"setAssetConsolePanel"')), false, "Adopting Arena must not navigate it or reopen it as Asset Console");
  let requestedRoute;
  bridge.requestLocal = async ({ route }) => { requestedRoute = route; return { status: 200, headers: {}, body: Buffer.from('{"runs":[]}') }; };
  await bridge.proxyRequest({ requestId: "arena-state", frameId: "asset-frame", request: { url: "https://web-sandbox.oaiusercontent.com/api/arena/state", method: "GET", headers: {} } }, "child-session", bridge.proxy);
  assert.equal(requestedRoute, "/api/arena/state");
  assert.ok(client.calls.some((call) => call.method === "Fetch.fulfillRequest" && call.params.requestId === "arena-state"));
  await bridge.dispose();
});

test("module binding selects Arena URL and ignores an earlier pending open after switching", async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: "/unused-in-unit-test" });
  const pending = [];
  const published = [];
  bridge.waitForService = () => new Promise((resolve) => pending.push(resolve));
  bridge.setupProxy = async () => ({ embedUrl: assetConsoleEmbedUrl(token) });
  bridge.publish = async (value) => published.push(value);
  const stale = bridge.handleBinding(JSON.stringify({ action: "open", kind: "asset" }));
  const current = bridge.handleBinding(JSON.stringify({ action: "open", kind: "arena", threadId: "fixture-thread" }));
  pending[1]();
  await current;
  pending[0]();
  await stale;
  assert.equal(published.length, 1, "Late completion of the previous module open cannot publish over the new module");
  assert.equal(published[0].kind, "arena");
  assert.equal(published[0].state, "ready");
  const url = new URL(published[0].url);
  assert.equal(url.pathname, `/__codex_asset_console__/${token}/model-arena/`);
  assert.equal(url.searchParams.get("threadId"), "fixture-thread");
});

test("reconnecting a hidden or visible iframe restores API transport without navigating it", async () => {
  const logs = [];
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: "/unused-in-unit-test", logger: (message) => logs.push(message) });
  const oldClient = new Client();
  await bridge.install(oldClient);
  const previousProxy = bridge.proxy;
  assert.equal(previousProxy.token, token);
  const client = new Client();
  await bridge.install(client);
  assert.equal(previousProxy.disposed, true);
  assert.equal(bridge.proxy.token, token);
  assert.equal(bridge.proxy.allowedFrameId, "asset-frame");
  assert.equal(bridge.proxy.assetSessions.has("child-session"), true);
  assert.equal(client.expressions.some((text) => text.includes('"setAssetConsolePanel"')), false, "install must not publish ready and recreate the iframe");
  assert.equal(client.expressions.some((text) => /\.src\s*=/.test(text)), false);
  let requestedRoute = "";
  bridge.requestLocal = async ({ route }) => { requestedRoute = route; return { status: 200, headers: {}, body: Buffer.from('{"revision":"r1"}') }; };
  await bridge.proxyRequest({ requestId: "probe", frameId: "asset-frame", request: { url: "https://web-sandbox.oaiusercontent.com/api/library/revision?project=A", method: "GET", headers: {} } }, "child-session", bridge.proxy);
  assert.equal(requestedRoute, "/api/library/revision?project=A");
  assert.ok(client.calls.some((call) => call.method === "Fetch.fulfillRequest" && call.params.requestId === "probe"));
  assert.equal(logs.some((message) => message.includes(token)), false);
  await bridge.dispose();
});

test("new document installation discards old iframe transport and republishes capabilities", async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: "/unused-in-unit-test" });
  await bridge.install(new Client());
  const previousProxy = bridge.proxy;
  const newDocument = new Client(null);
  await bridge.install(newDocument);
  assert.equal(previousProxy.disposed, true);
  assert.equal(bridge.proxy, null);
  assert.ok(newDocument.calls.some((call) => call.method === "Runtime.addBinding"));
  assert.ok(newDocument.expressions.some((expression) => expression.includes('"setAssetConsole"')));
  await bridge.dispose();
});

test("both ES module dependencies are served without requiring a running asset service", async () => {
  const bridge = new AssetConsoleBridge({ staticRoot, tokenPath: "/unused-in-unit-test" });
  for (const route of ["/asset-library-state.js", "/asset-metadata-ui.js", "/asset-media-lifecycle.js"]) {
    const response = await bridge.staticResponse(route, "GET");
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /javascript/);
    assert.ok(response.body.length > 0);
  }
  assert.equal(await bridge.staticResponse("/../../private.txt", "GET"), null);
  const transformed = transformAssetConsoleBody(`${assetConsoleEmbedUrl(token)}app.js`, Buffer.from('import "./asset-library-state.js";'), { token }).toString();
  assert.match(transformed, /^window\.__CODEX_ASSET_CONSOLE_EMBEDDED__ = true;/);
});

function proxyFailureFixture() {
  const logs = [];
  const bridge = new AssetConsoleBridge({ logger: message => logs.push(message) });
  const client = new Client(null);
  const proxy = {
    client, kind: 'asset', token, embedPrefix: `/__codex_asset_console__/${token}/`,
    allowedFrameId: 'owned-frame', cancelled: false,
    assetSessions: new Set(['owned-session']),
    sessionInfo: new Map([['owned-session', { targetId: 'owned-frame', active: true }]]),
    transfers: new Map(),
  };
  const event = {
    requestId: 'failure-fixture', frameId: 'owned-frame',
    request: { url: `${assetConsoleEmbedUrl(token)}api/library/failure`, method: 'GET', headers: {} },
  };
  return { bridge, client, proxy, event, logs };
}

test('proxy diagnostic: local upstream failures report transport errors instead of policy blocking', async t => {
  for (const [code, errorReason] of [['ECONNREFUSED', 'ConnectionRefused'], ['ETIMEDOUT', 'TimedOut'], ['ECONNRESET', 'Failed']]) {
    await t.test(code, async () => {
      const { bridge, client, proxy, event } = proxyFailureFixture();
      bridge.requestLocal = async () => { throw Object.assign(new Error('Fixture upstream unavailable'), { code }); };
      await bridge.proxyRequest(event, 'owned-session', proxy);
      assert.deepEqual(client.calls.at(-1), { method: 'Fetch.failRequest', sessionId: 'owned-session',
        params: { requestId: event.requestId, errorReason } });
      assert.equal(proxy.transfers.size, 0, 'Failed transfers do not retain request controllers');
    });
  }
});

test('proxy diagnostic: a failed CDP fulfillment reports Failed instead of policy blocking', async () => {
  const { bridge, client, proxy, event } = proxyFailureFixture();
  bridge.requestLocal = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') });
  const send = client.send.bind(client);
  client.send = async (method, params, sessionId) => {
    await send(method, params, sessionId);
    if (method === 'Fetch.fulfillRequest') throw new Error('Fixture CDP fulfillment unavailable');
    return {};
  };
  await bridge.proxyRequest(event, 'owned-session', proxy);
  assert.equal(client.calls.some(call => call.method === 'Fetch.fulfillRequest'), true);
  assert.deepEqual(client.calls.at(-1), { method: 'Fetch.failRequest', sessionId: 'owned-session',
    params: { requestId: event.requestId, errorReason: 'Failed' } });
  assert.equal(proxy.transfers.size, 0);
});

test('proxy diagnostic: frame ownership mismatches remain strictly blocked before upstream access', async () => {
  const { bridge, client, proxy, event } = proxyFailureFixture();
  let upstreamRequests = 0;
  bridge.requestLocal = async () => { upstreamRequests += 1; throw new Error('An unowned frame must not reach the upstream'); };
  for (const sessionId of [undefined, 'owned-session']) {
    await bridge.proxyRequest({ ...event, frameId: 'unowned-frame' }, sessionId, proxy);
    assert.deepEqual(client.calls.at(-1), { method: 'Fetch.failRequest', sessionId,
      params: { requestId: event.requestId, errorReason: 'BlockedByClient' } });
  }
  assert.equal(upstreamRequests, 0);
  assert.equal(proxy.allowedFrameId, 'owned-frame');
  assert.equal(proxy.transfers.size, 0);
});

test('proxy diagnostic: failure logs exclude routing tokens, URLs, queries, headers, bodies and error messages', async () => {
  const { bridge, proxy, event, logs } = proxyFailureFixture();
  const querySecret = 'fixture-query-secret';
  const headerSecret = 'fixture-header-secret';
  const bodySecret = 'fixture-body-secret';
  const errorSecret = 'fixture-error-message-secret';
  event.request.url += `?credential=${querySecret}`;
  event.request.method = 'POST';
  event.request.headers.Authorization = `Bearer ${headerSecret}`;
  event.request.postData = JSON.stringify({ secret: bodySecret });
  const errorMessage = `${errorSecret} ${event.request.url} ${headerSecret} ${bodySecret}`;
  bridge.requestLocal = async () => { throw Object.assign(new Error(errorMessage), { code: 'ECONNREFUSED' }); };
  await bridge.proxyRequest(event, 'owned-session', proxy);
  assert.ok(logs.length > 0, 'Transport failures produce a bounded diagnostic instead of silently swallowing their cause');
  const recorded = logs.map(String).join('\n');
  assert.match(recorded, /asset/, 'Diagnostics identify the static proxy kind');
  for (const secret of [token, event.request.url, querySecret, headerSecret, bodySecret, errorSecret, errorMessage]) {
    assert.equal(recorded.includes(secret), false, 'Diagnostics contain no request or exception secrets');
  }
  assert.equal(recorded.includes(event.request.postData), false);
});
