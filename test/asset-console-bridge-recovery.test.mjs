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

test("only app-owned sandbox embed URLs qualify for transport adoption", () => {
  assert.deepEqual(existingAssetConsoleEmbed(existingUrl), { token, embedUrl: assetConsoleEmbedUrl(token) });
  for (const invalid of [null, "", "javascript:void(0)", "https://example.com/", existingUrl.replace("a1".repeat(24), "bad"), existingUrl.replace("?embed=codex", "other"), existingUrl.replace("https://", "https://user@")]) {
    assert.equal(existingAssetConsoleEmbed(invalid), null);
  }
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
