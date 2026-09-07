import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CdpClient } from "../scripts/cdp-client.mjs";
import { EfficiencyBridge, createEfficiencyController, EFFICIENCY_BINDING } from "../lib/efficiency-bridge.mjs";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("live default-world bridge saves through UI, isolates iframe and survives repeated enable, reload and CDP reconnect", {
  timeout: 40_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Set AIYOUCODEX_TEST_BROWSER for a real renderer/controller round trip",
}, async (t) => {
  assert.ok(executable, "Required Chrome/Chromium browser must be installed");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "aiyoucodex-efficiency-live-"));
  const profile = path.join(temporaryRoot, "browser");
  const rootDir = path.join(temporaryRoot, "efficiency");
  const fixture = `<style>body{margin:0;display:flex;height:100vh}aside{width:240px;flex-shrink:0}main{display:flex;flex:1;min-width:0;height:100vh}#chat{flex:1;padding:18px;min-width:200px}</style>
    <aside id="app-shell-sidebar"><nav><div><div><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button></div></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header></section></div></nav></aside>
    <main><div id="chat"><div id="composer" contenteditable="true" style="height:100px">请保留这条聊天草稿</div><iframe id="untrusted-frame" src="/frame" title="Untrusted embedded content"></iframe></div></main>`;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end(request.url === "/frame" ? "<title>Embedded frame fixture</title><p>Not an authorized settings context</p>" : fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1440,1100", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const clients = new Set();
  let bridge;
  t.after(async () => {
    bridge?.dispose();
    for (const connection of clients) connection.close();
    browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const connection = await connectFixtureBrowser({ browser, profile, url: origin });
  const target = connection.target;
  let client = connection.client;
  clients.add(client);
  await waitForBrowserState(client, `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'&&document.getElementById('untrusted-frame')?.contentDocument?.readyState==='complete'`, "The top frame and embedded fixture are ready");
  const record = { threadId: "fixture-thread", title: "Isolated round-trip fixture", projectPath: path.join(temporaryRoot, "project") };
  const history = [{ id: "fixture-user-1", role: "user", text: "目标：验证隔离环境。下一步：补齐测试。", timestamp: "2026-09-07T00:00:00Z" }];
  const executions = [];
  const controller = createEfficiencyController({ rootDir, repository: {
    resolveEfficiencyThread: async (id) => id === record.threadId ? record : null,
    readTokenUsage: async () => null,
    readContextSourceRevision: async () => `fixture-history-${history.length}`,
    readContextHistory: async () => ({ threadId: record.threadId, messages: history.slice(), sourceRevision: `fixture-history-${history.length}` }),
  }, readActiveContext: async () => ({ threadId: record.threadId }), executeContext: async (request) => {
    // This fixture callback only writes an in-memory history array, never a real app or composer.
    executions.push(request); history.push({ id: `fixture-sent-${executions.length}`, role: "user", text: request.prompt, timestamp: "2026-09-07T00:01:00Z" });
    return { status: "submitted" };
  } });
  bridge = new EfficiencyBridge(controller);
  await bridge.install(client);
  const api = "window.__codexConversationPreviewInjection__";
  const bindingReady = `typeof window[${JSON.stringify(EFFICIENCY_BINDING)}]==='function'`;
  await waitForBrowserState(client, bindingReady, "A native binding is installed in the current top default world");
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await client.evaluate(source);
  async function refreshPanel() {
    const efficiency = await controller.snapshot();
    await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(efficiency)},skillCatalog:[{id:'skill:fixture',name:'fixture-skill',title:'Fixture Skill',source:'user'}]});${api}.openEfficiencyPanel()`);
    return efficiency;
  }
  async function click(selector) {
    const rect = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  async function assertFrameIsolation() {
    assert.equal(await client.evaluate(`typeof document.getElementById('untrusted-frame').contentWindow[${JSON.stringify(EFFICIENCY_BINDING)}]`), "undefined", "The embedded frame does not get a privileged binding");
  }
  async function saveMode(mode, expectedVersion) {
    await client.evaluate(`(()=>{const e=document.querySelector('[data-efficiency-field=mode]');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("[data-efficiency-request=saveScope]");
    await waitForBrowserState(client, `${api}.getEfficiencyState().pending===0&&${api}.getEfficiencyState().snapshot.version===${expectedVersion}`,
      `One actual UI click commits ${mode} and returns the real store revision`, 7000);
    const disk = JSON.parse(await readFile(controller.store.filePath, "utf8"));
    assert.equal(disk.global.mode, mode, "The real atomic store file contains the chosen mode");
    assert.equal(disk.version, expectedVersion, "One click produces exactly one committed revision");
    assert.equal(await client.evaluate(`${api}.getEfficiencyState().error`), "");
    assert.equal(await client.evaluate(`${api}.getEfficiencyState().snapshot.hookStatus.loaded`), false, "Saving policy is not a fabricated native hook receipt");
    assert.doesNotMatch(await client.evaluate("document.querySelector('[data-efficiency-hook]').textContent"), /当前会话已加载/);
    assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "请保留这条聊天草稿", "The bridge never sends or changes the composer");
    await assertFrameIsolation();
  }

  await refreshPanel(); await assertFrameIsolation();
  await saveMode("concise", 1);
  const firstEpoch = await client.evaluate(`${api}.documentEpoch`);
  await bridge.install(client);
  assert.equal(bridge.contexts.size, 1, "Reinstalling on an already Runtime-enabled client must rediscover its current default context");
  await saveMode("smart", 2);
  assert.equal(await client.evaluate(`${api}.documentEpoch`), firstEpoch, "Repeated installation must not reload the renderer");

  await client.send("Page.reload", { ignoreCache: true });
  await waitForBrowserState(client, `!!${api}&&${api}.documentEpoch!==${JSON.stringify(firstEpoch)}&&${api}.getHealth().ready&&${bindingReady}&&document.getElementById('untrusted-frame')?.contentDocument?.readyState==='complete'`,
    "Navigation creates a new top default world, renderer and binding");
  await refreshPanel();
  await saveMode("concise", 3);

  const secondEpoch = await client.evaluate(`${api}.documentEpoch`);
  bridge.dispose(); client.close();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect(); clients.add(client);
  // Another runtime feature may enable events before this bridge attaches.
  await client.send("Runtime.enable");
  await bridge.install(client);
  assert.equal(bridge.contexts.size, 1, "A reconnect after an earlier Runtime.enable must still authorize the actual top context");
  await refreshPanel();
  await saveMode("smart", 4);
  assert.equal(await client.evaluate(`${api}.documentEpoch`), secondEpoch, "CDP reconnect preserves the same document and user state");
  assert.equal(await client.evaluate(`${api}.getHealth().ready`), true);

  // Real renderer -> native default-world binding -> controller/store; no actual user messages are sent.
  await client.evaluate(`${api}.openTaskContextPanel()`);
  await waitForBrowserState(client, `${api}.getEfficiencyState().pending===0&&${api}.getEfficiencyState().contextDraft.summaryAttempted`, "Local history is summarized through the actual bridge");
  assert.equal(executions.length, 0);
  assert.equal((await controller.store.read({ threadId: record.threadId })).context.version, 0, "Summarization does not save a context card");
  await client.evaluate(`(()=>{for(const [field,value] of [['goal','验证隔离浏览器中的任务上下文'],['nextStep','运行回归测试']]){const e=document.querySelector('[data-efficiency-field='+field+']');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await click("[data-efficiency-request=previewContextExecution]");
  await waitForBrowserState(client, `${api}.getEfficiencyState().pending===0&&!!${api}.getEfficiencyState().executionPreview`, "Exact prompt preview is returned through the native binding");
  assert.equal((await controller.store.read({ threadId: record.threadId })).context.version, 0, "Preview remains read-only before explicit second confirmation");
  const reviewedPrompt = await client.evaluate("document.querySelector('[data-efficiency-execution-prompt]').textContent");
  assert.match(reviewedPrompt, /运行回归测试/);
  assert.equal(executions.length, 0);
  await click("[data-efficiency-confirm-execution]");
  await waitForBrowserState(client, `${api}.getEfficiencyState().pending===0&&${api}.getEfficiencyState().message.includes('已读回本次发送的消息')`, "Confirmed context is saved and fixture history confirms exactly one execution", 8000);
  assert.equal(executions.length, 1);
  assert.equal(executions[0].threadId, record.threadId);
  assert.equal(executions[0].prompt, reviewedPrompt, "Backend executes exactly the full prompt reviewed in the UI");
  const savedContext = (await controller.store.read({ threadId: record.threadId })).context;
  assert.equal(savedContext.version, 1);
  assert.equal(savedContext.nextStep, "运行回归测试");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "请保留这条聊天草稿");
});
