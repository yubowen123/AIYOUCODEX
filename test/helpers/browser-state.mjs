import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CdpClient } from "../../scripts/cdp-client.mjs";

// A Chrome process and its initial page do not become ready together. In
// particular, Windows CI may expose a startup page before command-line URL
// navigation starts. Own a target explicitly instead of taking the first page.
export async function connectFixtureBrowser({ browser, profile, url, timeout = 15_000 }) {
  const deadline = Date.now() + timeout;
  let browserError;
  let browserOutput = "";
  browser.on("error", (error) => { browserError = error; });
  browser.stderr?.on("data", (chunk) => { browserOutput = (browserOutput + chunk).slice(-4000); });
  let browserClient;
  let client;
  let phase = "waiting for the isolated debugging endpoint";
  let lastError;
  const remaining = () => {
    const milliseconds = deadline - Date.now();
    if (milliseconds <= 0) throw new Error(`Fixture startup exceeded ${timeout}ms`);
    return milliseconds;
  };
  async function sendDuringStartup(connection, method, params) {
    // Each startup request shares the same deadline, including Page.navigate.
    // Do not accidentally restore CdpClient's shorter per-request default here.
    connection.requestTimeoutMs = remaining();
    return connection.send(method, params);
  }
  async function poll(read) {
    do {
      if (browserError) throw browserError;
      if (browser.exitCode !== null || browser.signalCode !== null) {
        throw new Error(`Browser exited (code=${browser.exitCode}, signal=${browser.signalCode})`);
      }
      try {
        const result = await read();
        if (result) return result;
      } catch (error) { lastError = error; }
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error(lastError?.message || "Readiness deadline exceeded");
  }
  try {
    const { port, version } = await poll(async () => {
      const port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(Math.min(1000, remaining())) });
      if (!response.ok) throw new Error(`Debugging endpoint returned HTTP ${response.status}`);
      const version = await response.json();
      return version.webSocketDebuggerUrl ? { port, version } : null;
    });
    phase = "creating the isolated fixture target";
    browserClient = new CdpClient(version.webSocketDebuggerUrl, { connectTimeoutMs: remaining() });
    await browserClient.connect();
    const { targetId } = await sendDuringStartup(browserClient, "Target.createTarget", { url: "about:blank" });
    let targets;
    const target = await poll(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(Math.min(1000, remaining())) });
      if (!response.ok) throw new Error(`Target list returned HTTP ${response.status}`);
      targets = await response.json();
      return targets.find((entry) => entry.id === targetId && entry.type === "page" && entry.webSocketDebuggerUrl);
    });
    // The command-line blank tab is only a bootstrap surface. Do not keep an
    // extra renderer alive for every concurrent isolated browser fixture.
    for (const entry of targets.filter((entry) => entry.id !== targetId && entry.type === "page" && entry.url === "about:blank")) {
      await sendDuringStartup(browserClient, "Target.closeTarget", { targetId: entry.id });
    }
    client = new CdpClient(target.webSocketDebuggerUrl, { connectTimeoutMs: remaining() });
    const defaultRequestTimeout = client.requestTimeoutMs;
    await client.connect();
    phase = `navigating the fixture target to ${url}`;
    await sendDuringStartup(client, "Page.enable");
    const navigation = await sendDuringStartup(client, "Page.navigate", { url });
    assert.ok(!navigation.errorText, navigation.errorText);
    await waitForBrowserState({ evaluate: (expression) => {
      client.requestTimeoutMs = remaining();
      return client.evaluate(expression);
    } }, `location.href===${JSON.stringify(new URL(url).href)}&&document.readyState==='complete'`, "Explicit fixture navigation completes", remaining());
    // Business interaction checks retain the normal bounded request timeout.
    client.requestTimeoutMs = defaultRequestTimeout;
    return { client, target };
  } catch (error) {
    let pageState;
    try { pageState = await client?.evaluate("({url:location.href,readyState:document.readyState})"); } catch {}
    client?.close();
    throw new Error(`${phase}: ${error.message}; page=${JSON.stringify(pageState)}; browser stderr=${browserOutput || "(none)"}`, { cause: error });
  } finally {
    browserClient?.close();
  }
}

// Rendering and navigation are asynchronous, especially with concurrent browser
// tests on CI. Observe the required state instead of assuming a fixed frame time.
// A missing result still fails with the last observed value and a bounded wait.
export async function waitForBrowserState(client, expression, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let observed;
  let lastError;
  do {
    try {
      observed = await client.evaluate(expression);
      lastError = undefined;
      if (observed === true) return;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`${message}; last browser state: ${lastError?.message || JSON.stringify(observed)}`);
}
