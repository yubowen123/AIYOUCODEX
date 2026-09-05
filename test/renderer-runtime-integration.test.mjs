import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import test from "node:test";
import { CdpClient, connectCodexTarget } from "../scripts/cdp-client.mjs";
import { RENDERER_HEALTH_EXPRESSION, acceptDocumentHealth, canReuseRenderer } from "../lib/renderer-health.mjs";

const injectorSource = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
const userSourcePath = new URL("../inject/conversation-preview.user.js", import.meta.url);
function productionFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(injectorSource);
  assert.ok(match, `Production function ${name} exists`);
  const rest = injectorSource.slice(match.index);
  const next = /\n(?:async )?function /g;
  next.lastIndex = rest.indexOf("{") + 1;
  const end = next.exec(rest)?.index ?? rest.indexOf('\nfor (const signal');
  assert.ok(end > 0, `Bounded production function ${name}`);
  return rest.slice(0, end);
}

const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
const requireBrowser = process.env.AIYOUCODEX_REQUIRE_BROWSER === "1";

test("production attach and delivery survive CDP reconnect; real document reload replays snapshot, history and keepalive", {
  timeout: 35_000,
  skip: !executable && !requireBrowser && "Set AIYOUCODEX_TEST_BROWSER for renderer integration coverage",
}, async (t) => {
  assert.ok(executable, "Required isolated browser is unavailable");
  const profile = await mkdtemp(path.join(tmpdir(), "aiyoucodex-runtime-regression-"));
  const fixture = `<title>Fixture</title><aside id="app-shell-sidebar"><nav><div><div><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button><button>+</button></div></div><div data-app-action-sidebar-scroll><div><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header><div data-app-action-sidebar-thread-row data-app-action-sidebar-thread-active="true" data-app-action-sidebar-thread-id="11111111-1111-4111-8111-111111111111" data-app-action-sidebar-thread-title="Fixture thread">Fixture thread</div></section></div></div></nav></aside><main></main>`;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end(request.url === "/panel" ? "<title>Local panel fixture</title><p>Persistent fixture</p>" : fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, origin], { stdio: "ignore" });
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) client.close();
    browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port;
  for (let index = 0; index < 70; index += 1) {
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch {}
    await delay(100);
  }
  assert.ok(port);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.type === "page");
  const inspect = new CdpClient(target.webSocketDebuggerUrl);
  await inspect.connect();
  clients.add(inspect);
  const shortcuts = [{ id: "local-fixture", name: "Local fixture", url: `${origin}/panel`, icon: "link", openMode: "internal", keepAlive: true }];
  const catalog = [{ projectId: "fixture-project", projectName: "Fixture project", threadId: "11111111-1111-4111-8111-111111111111", title: "Fixture thread", updatedAt: "2026-09-05T10:00:00Z" }];
  const history = { ...catalog[0], totalCount: 1, sourceSize: 100,
    messages: [{ id: "fixture-message", role: "user", text: "Synthetic history fixture", timestamp: "2026-09-05T10:00:00Z" }] };
  const context = vm.createContext({
    connectCodexTarget: async (entry) => { const client = await connectCodexTarget(entry); clients.add(client); return client; },
    // Only external asset-service I/O is excluded from this renderer lifecycle test.
    createAssetConsoleBridge: () => ({ install: async () => {}, dispose: async () => {} }),
    SCRIPT_ID_GLOBAL: "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__", readFile, sourcePath: userSourcePath,
    readManagedShortcuts: async () => shortcuts, createHash,
    process: { stdout: { write() {} }, stderr: { write() {} } },
    RENDERER_HEALTH_EXPRESSION, acceptDocumentHealth, canReuseRenderer,
    repository: { readRecentCatalog: async () => catalog, readPinnedThreadIds: async () => [],
      readInterruptedCatalog: async () => [], readMany: async () => [], readUsage: async () => ({}), readConversationHistory: async () => history },
    readInstalledSkillCatalog: async () => [], readActiveTaskThreads: async () => ({ activeThreadIds: [] }),
    presentCardPreview: (value) => value, presentRateLimit: () => ({ available: true, text: "本周剩余 42%", remainingPercent: 42 }),
    skillCatalog: [], nextSkillCatalogRefreshAt: 0,
  });
  for (const name of ["attachTarget", "disposeRendererSession", "ensurePersistentManagedShortcuts",
    "readActiveConversationContext", "pushConversationHistory", "pushPreviews"]) {
    vm.runInContext(productionFunction(name), context);
  }
  const installDeliveryCounters = async () => inspect.evaluate(`(()=>{const api=window.__codexConversationPreviewInjection__;window.__fixtureDeliveries={snapshot:0,history:0,destroy:0};for(const [method,key]of [['setSnapshot','snapshot'],['setConversationHistory','history'],['destroy','destroy']]){const original=api[method];api[method]=(...args)=>{window.__fixtureDeliveries[key]+=1;return original(...args)}}})()`);
  let session = await context.attachTarget(target);
  await installDeliveryCounters();
  await context.ensurePersistentManagedShortcuts(session);
  await context.pushPreviews(session);
  await delay(250);
  assert.deepEqual(await inspect.evaluate("window.__fixtureDeliveries"), { snapshot: 1, history: 1, destroy: 0 });
  const first = await inspect.evaluate(`(()=>{const f=document.querySelector('iframe[data-codex-custom-shortcut-frame]');window.__fixtureOriginalFrame=f;return {epoch:window.__codexConversationPreviewInjection__.getHealth().documentEpoch,origin:f.contentWindow.performance.timeOrigin}})()`);
  await context.pushPreviews(session);
  assert.deepEqual(await inspect.evaluate("window.__fixtureDeliveries"), { snapshot: 1, history: 1, destroy: 0 }, "Same document hashes suppress duplicate delivery");
  await context.disposeRendererSession(session);
  session = await context.attachTarget(target);
  const afterReconnect = await inspect.evaluate(`(()=>{const f=document.querySelector('iframe[data-codex-custom-shortcut-frame]');return {epoch:window.__codexConversationPreviewInjection__.getHealth().documentEpoch,sameFrame:f===window.__fixtureOriginalFrame,origin:f.contentWindow.performance.timeOrigin,counts:window.__fixtureDeliveries}})()`);
  assert.equal(afterReconnect.epoch, first.epoch);
  assert.equal(afterReconnect.sameFrame, true);
  assert.equal(afterReconnect.origin, first.origin);
  assert.equal(afterReconnect.counts.destroy, 0, "Actual production attach must reuse a matching source hash without destroy");
  await context.ensurePersistentManagedShortcuts(session);
  await context.pushPreviews(session);
  const beforeReload = { epoch: session.documentEpoch, snapshot: session.deliveredSnapshotHash, history: session.deliveredHistoryKey };
  assert.ok(beforeReload.snapshot && beforeReload.history);
  assert.equal(session.persistentShortcutReady.size, 1);
  await inspect.send("Page.enable");
  await inspect.send("Page.reload", { ignoreCache: true });
  let reloaded;
  for (let index = 0; index < 60; index += 1) {
    try { reloaded = await inspect.evaluate(RENDERER_HEALTH_EXPRESSION); } catch {}
    if (reloaded?.alive && reloaded.documentEpoch !== beforeReload.epoch
      && await inspect.evaluate("document.readyState==='complete'")) break;
    await delay(50);
  }
  assert.equal(reloaded?.alive, true, "Registered production source starts in the new document");
  assert.notEqual(reloaded.documentEpoch, beforeReload.epoch);
  assert.equal(acceptDocumentHealth(session, reloaded), true);
  assert.equal(session.deliveredSnapshotHash, "");
  assert.equal(session.deliveredHistoryKey, "");
  assert.equal(session.persistentShortcutReady.size, 0);
  await installDeliveryCounters();
  await context.ensurePersistentManagedShortcuts(session);
  await context.pushPreviews(session);
  assert.deepEqual(await inspect.evaluate("window.__fixtureDeliveries"), { snapshot: 1, history: 1, destroy: 0 }, "Unchanged repository data must be replayed into the new document");
  assert.equal(session.deliveredSnapshotHash, beforeReload.snapshot);
  assert.equal(session.deliveredHistoryKey, beforeReload.history);
  assert.equal(session.persistentShortcutReady.size, 1);
  assert.equal(await inspect.evaluate("!!document.querySelector('iframe[data-codex-custom-shortcut-frame]')"), true);
  await inspect.evaluate(`(()=>{const ownMount=document.createElement('main');ownMount.id='fixture-asset-mount';document.querySelector('main').before(ownMount);window.codexSidebarOpenAssetConsole=()=>{};const api=window.__codexConversationPreviewInjection__;api.setAssetConsole({available:true,mode:'embedded'});api.openAssetConsolePanel();api.setAssetConsolePanel({state:'ready',url:${JSON.stringify(`${origin}/panel`)}});window.__fixtureAssetFrame=document.getElementById('codex-asset-console-frame');api.refresh();})()`);
  await delay(100);
  assert.equal(await inspect.evaluate("window.__fixtureAssetFrame===document.getElementById('codex-asset-console-frame')&&!document.getElementById('codex-asset-console-page').hidden"), true,
    "Ordinary sidebar refresh must not close or replace the asset panel");
  await inspect.evaluate(`(()=>{const notice=document.createElement('button');notice.setAttribute('aria-label','关闭活动视图');document.querySelector('nav').appendChild(notice);window.__codexConversationPreviewInjection__.refresh();})()`);
  assert.equal(await inspect.evaluate("window.__fixtureAssetFrame===document.getElementById('codex-asset-console-frame')&&!document.getElementById('codex-asset-console-page').hidden"), true,
    "Native activity layout replaces sidebar sections without disposing the asset panel");
  await inspect.evaluate(`(()=>{window.__fixtureRecoveryActions=[];window.__privateFrameBefore=document.querySelector('iframe[data-codex-custom-shortcut-frame]');window.__assetContextBefore=window.__fixtureAssetFrame.contentWindow.performance.timeOrigin;window.codexSidebarOpenAssetConsole=(raw)=>{const action=JSON.parse(raw).action;window.__fixtureRecoveryActions.push(action);if(action==='open')queueMicrotask(()=>window.__codexConversationPreviewInjection__.setAssetConsolePanel({state:'ready',url:${JSON.stringify(`${origin}/panel`)}}));};const fresh=document.createElement('main');fresh.id='fixture-asset-mount';document.getElementById('fixture-asset-mount').replaceWith(fresh);})()`);
  await delay(220);
  const recovered = await inspect.evaluate(`(()=>{const page=document.getElementById('codex-asset-console-page');const frame=document.getElementById('codex-asset-console-frame');return {visible:!!page&&!page.hidden,parent:page?.parentElement?.id,newFrame:!!frame&&frame!==window.__fixtureAssetFrame,newContext:!!frame&&frame.contentWindow.performance.timeOrigin!==window.__assetContextBefore,actions:window.__fixtureRecoveryActions,privateUntouched:window.__privateFrameBefore===document.querySelector('iframe[data-codex-custom-shortcut-frame]')}})()`);
  assert.deepEqual(recovered, { visible: true, parent: "fixture-asset-mount", newFrame: true, newContext: true, actions: ["open"], privateUntouched: true },
    "A replaced native mount locally rebuilds the lost asset context without disturbing another panel");
  await inspect.evaluate(`(()=>{document.querySelector('#codex-asset-console-page .codex-asset-console-close').click();const fresh=document.createElement('main');fresh.id='fixture-asset-mount';document.getElementById('fixture-asset-mount').replaceWith(fresh);})()`);
  await delay(180);
  assert.deepEqual(await inspect.evaluate("window.__fixtureRecoveryActions"), ["open", "close"], "Closed assets must not be reopened by a host layout update");
  assert.equal(await inspect.evaluate("!!document.getElementById('codex-asset-console-frame')"), false);
  await inspect.evaluate("window.__codexConversationPreviewInjection__.openAssetConsolePanel()");
  await delay(100);
  assert.equal(await inspect.evaluate("!!document.getElementById('codex-asset-console-frame')&&!document.getElementById('codex-asset-console-page').hidden"), true,
    "An explicit reopen repairs a detached closed panel instead of returning a dead reference");

  const intentKey = "aiyoucodex:asset-console-open:v1";
  const assetVisible = "!!document.getElementById('codex-asset-console-frame')&&!document.getElementById('codex-asset-console-page').hidden";
  const reloadIsolatedDocument = async () => {
    const oldEpoch = await inspect.evaluate("window.__codexConversationPreviewInjection__.getHealth().documentEpoch");
    await inspect.send("Page.reload", { ignoreCache: true });
    let health;
    for (let index = 0; index < 80; index += 1) {
      try { health = await inspect.evaluate(RENDERER_HEALTH_EXPRESSION); } catch {}
      if (health?.alive && health.documentEpoch !== oldEpoch
        && await inspect.evaluate("document.readyState==='complete'")) break;
      await delay(50);
    }
    assert.equal(health?.alive, true, "Actual registered source recovers in the isolated reloaded document");
    assert.notEqual(health.documentEpoch, oldEpoch);
  };
  const connectFixtureAssetBridge = async () => inspect.evaluate(`(()=>{
    window.__restoredAssetActions=[];
    window.codexSidebarOpenAssetConsole=(raw)=>{
      const action=JSON.parse(raw).action;window.__restoredAssetActions.push(action);
      if(action==='open')queueMicrotask(()=>window.__codexConversationPreviewInjection__.setAssetConsolePanel({state:'ready',url:${JSON.stringify(`${origin}/panel`)}}));
    };
    window.__codexConversationPreviewInjection__.setAssetConsole({available:true,mode:'embedded'});
  })()`);
  assert.equal(await inspect.evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(intentKey)})).open`), true);
  await reloadIsolatedDocument();
  await delay(120);
  assert.equal(await inspect.evaluate(assetVisible), false, "Reload must wait for a usable asset bridge before restoring");
  await connectFixtureAssetBridge();
  await delay(180);
  assert.equal(await inspect.evaluate(assetVisible), true, "An asset panel left open is restored after true document reload");
  assert.deepEqual(await inspect.evaluate("window.__restoredAssetActions"), ["open"]);
  await inspect.evaluate("window.__codexConversationPreviewInjection__.refresh();window.__codexConversationPreviewInjection__.setAssetConsole({available:true,mode:'embedded'});");
  await delay(150);
  assert.deepEqual(await inspect.evaluate("window.__restoredAssetActions"), ["open"], "Restore is one-shot, never a reopen loop");

  await inspect.evaluate("document.querySelector('#codex-asset-console-page .codex-asset-console-close').click()");
  assert.equal(await inspect.evaluate(`sessionStorage.getItem(${JSON.stringify(intentKey)})`), null, "A user close clears persistent visibility intent");
  await reloadIsolatedDocument();
  await connectFixtureAssetBridge();
  await delay(150);
  assert.equal(await inspect.evaluate(assetVisible), false);
  assert.deepEqual(await inspect.evaluate("window.__restoredAssetActions"), [], "An explicitly closed panel stays closed after reload");

  await inspect.evaluate("window.__codexConversationPreviewInjection__.openAssetConsolePanel()");
  await delay(60);
  await reloadIsolatedDocument();
  await inspect.evaluate(`(()=>{const taskboard=document.createElement('section');taskboard.id='codex-taskboard-page';taskboard.textContent='Newer user panel';document.querySelector('main').append(taskboard);const input=document.createElement('textarea');input.id='fixture-composer';document.body.append(input);input.focus()})()`);
  await connectFixtureAssetBridge();
  await delay(160);
  assert.equal(await inspect.evaluate(assetVisible), false);
  assert.deepEqual(await inspect.evaluate("window.__restoredAssetActions"), [], "A newly opened other panel wins over deferred restoration");
  assert.equal(await inspect.evaluate("!document.getElementById('codex-taskboard-page').hidden&&document.activeElement.id==='fixture-composer'"), true, "Restoration must neither close the user's newer panel nor steal chat focus");
  assert.equal(await inspect.evaluate(`sessionStorage.getItem(${JSON.stringify(intentKey)})`), null);
  await inspect.evaluate("document.getElementById('codex-taskboard-page').remove();window.__codexConversationPreviewInjection__.refresh()");
  await delay(120);
  assert.equal(await inspect.evaluate(assetVisible), false, "Cancelled restoration stays cancelled when the other panel closes");

  await inspect.evaluate("window.__codexConversationPreviewInjection__.openAssetConsolePanel()");
  await delay(60);
  await inspect.evaluate("window.__codexConversationPreviewInjection__.destroy()");
  assert.equal(await inspect.evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(intentKey)})).open`), true,
    "Source replacement cleanup is not a user close and must preserve the reload intent");
  await inspect.send("Page.reload", { ignoreCache: true });
  for (let index = 0; index < 80; index += 1) {
    try { if ((await inspect.evaluate(RENDERER_HEALTH_EXPRESSION))?.alive && await inspect.evaluate("document.readyState==='complete'")) break; } catch {}
    await delay(50);
  }
  await connectFixtureAssetBridge();
  await delay(160);
  assert.equal(await inspect.evaluate(assetVisible), true, "A renderer upgrade cleanup preserves the user's previously open panel");
});
