import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("task context has a native-header entry, isolated drafts, read-only summaries and explicit exact-prompt execution", {
  timeout: 40_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Set AIYOUCODEX_TEST_BROWSER for task-context interaction coverage",
}, async (t) => {
  assert.ok(executable, "Required Chrome/Chromium browser must be installed");
  const profile = await mkdtemp(path.join(tmpdir(), "aiyoucodex-context-ui-"));
  const fixture = `<style>
    body{margin:0;height:100vh}main{display:flex;min-width:0;height:100vh;padding-top:48px;box-sizing:border-box}#chat{min-width:220px;flex:1;padding:16px}
    #native-header{position:fixed;top:0;left:260px;right:0;height:46px;display:flex;align-items:center;overflow:hidden;background:white;z-index:30}
    [data-testid=app-shell-header-context-menu-surface]{display:flex;flex:1;min-width:0;align-items:center;overflow:hidden}
    #native-title{flex:1;min-width:0;overflow:hidden;white-space:nowrap}[data-app-shell-header-obstacle]{display:flex;flex-shrink:0;gap:6px;align-items:center}
    button{min-height:28px}#share-wrapper{display:flex}#composer{height:120px}</style>
    <main><header id="native-header"><div data-testid="app-shell-header-context-menu-surface" aria-hidden="false"><span id="native-title">Current native conversation</span><div id="native-actions" data-app-shell-header-obstacle="true"><div id="share-wrapper"><span style="display:contents"><button id="native-share" aria-label="分享">分享</button></span></div><button id="native-panel" aria-label="面板">面板</button></div></div></header>
    <div id="chat"><div id="composer" contenteditable="true">绝不能清除或发送的已有输入</div><button id="message-share" aria-label="分享">消息分享</button></div></main>`;
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end(fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1440,1100", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: origin }));
  await waitForBrowserState(client, `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`, "Native header fixture is ready");
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(source);
  await client.evaluate("window.__requests=[];window.__AIYOUCODEX_EFFICIENCY_REQUEST__=raw=>window.__requests.push(JSON.parse(raw));window.__shareClicks=0;document.getElementById('native-share').onclick=()=>window.__shareClicks++");
  const snapshot = { version: 1, targetKey: "opaque-context-A", targetLabel: "对话 A", contextSourceRevision: "history-a-1",
    scopeAvailable: { project: true, thread: true }, scopes: { global: { mode: "smart", defaultSkills: [] }, project: {}, thread: {} },
    effective: { mode: "smart" }, context: { version: 0, goal: "已保存的 A", progress: "", nextStep: "", agreements: [] },
    hookStatus: { loaded: false }, usage: { available: false } };
  async function update(value = snapshot) { await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(value)}})`); }
  async function click(selector) {
    const rect = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  async function lastRequest(action) {
    const value = await client.evaluate("window.__requests.at(-1)");
    assert.equal(value.action, action); assert.equal(Object.hasOwn(value, "threadId"), false);
    return value;
  }
  async function resolve(request, data, ok = true) {
    await client.evaluate(`${api}.resolveEfficiencyRequest(${JSON.stringify({ requestId: request.requestId, ok, ...(ok ? { data } : { error: data }) })})`);
  }
  async function input(field, value) {
    await client.evaluate(`(()=>{const e=document.querySelector('[data-efficiency-field=${field}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  const visible = (selector) => `!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;

  await update();
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-task-context-open').parentElement.id"), "native-actions");
  await click("#native-share");
  assert.equal(await client.evaluate("window.__shareClicks"), 1, "Injected entry does not overlap or steal the Share control");
  await client.evaluate(`${api}.openEfficiencyPanel()`);
  assert.equal(await client.evaluate(visible("[data-efficiency-context-fields]")), false, "Global preference panel contains no visible context fields");
  assert.equal(await client.evaluate(visible("[data-efficiency-target]")), false);
  assert.equal(await client.evaluate("window.__requests.length"), 0, "Opening output preferences does not summarize any conversation");

  await click("#aiyoucodex-task-context-open");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().view`), "context");
  assert.equal(await client.evaluate(visible("[data-efficiency-scope]")), false, "Context panel never displays global/project preference scope");
  assert.equal(await client.evaluate(visible("[data-efficiency-fields]")), false);
  const firstSummary = await lastRequest("summarizeContext");
  assert.equal(firstSummary.expectedTargetKey, snapshot.targetKey);
  await click("#aiyoucodex-task-context-open");
  assert.equal(await client.evaluate("window.__requests.length"), 1, "Repeated open while summarizing does not duplicate work");
  const markup = '<img src=x onerror="window.__unsafe=true">';
  await resolve(firstSummary, { snapshot, contextDraft: { context: { goal: markup, progress: "已分析", nextStep: "补齐回归测试", agreements: ["不要发送外部消息"] },
    sourceRevision: "history-a-1", sources: [{ field: "goal", role: "user", timestamp: "2026-09-07T01:00:00Z", excerpt: "真实历史最后两条" }], method: "local-extraction", warnings: ["请人工确认阶段"], hasContent: true } });
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), markup);
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().contextDraft.dirty`), true);
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-efficiency-panel img')===null&&window.__unsafe!==true"), true);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-summary-sources]').textContent"), /真实历史最后两条/);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-summary-sources]').textContent"), /目标 · 用户消息 · 2026-09-07T01:00:00Z · 原句/);
  assert.equal(await client.evaluate("window.__requests.length"), 1, "Read-only summarization never saves or sends automatically");

  await input("goal", "A 的手动草稿");
  await client.evaluate("(()=>{const e=document.querySelector('[data-efficiency-field=goal]');e.focus();e.setSelectionRange(2,4);window.__goalNode=e})()");
  snapshot.contextSourceRevision = "history-a-2";
  await update();
  assert.deepEqual(await client.evaluate("(()=>{const e=document.querySelector('[data-efficiency-field=goal]');return[e.value,document.activeElement===e,e===window.__goalNode,e.selectionStart,e.selectionEnd]})()"), ["A 的手动草稿", true, true, 2, 4]);
  assert.equal(await client.evaluate("window.__requests.length"), 1, "New history never overwrites a dirty manual draft");
  await click("[data-efficiency-summarize]");
  assert.equal(await client.evaluate("window.__requests.length"), 1, "Replacing a dirty summary first asks for explicit confirmation");
  await click("[data-efficiency-cancel-summary]");
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "A 的手动草稿");

  const second = { ...snapshot, targetKey: "opaque-context-B", targetLabel: "对话 B", contextSourceRevision: "history-b-1", context: { ...snapshot.context, goal: "只属于 B" } };
  await update(second);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "只属于 B", "Switching target immediately removes A's content from the current view");
  const summaryB = await lastRequest("summarizeContext");
  await update(snapshot);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "A 的手动草稿", "Returning restores the correct per-conversation draft");
  await resolve(summaryB, { snapshot: second, contextDraft: { context: { goal: "B 的迟到响应" }, sourceRevision: "history-b-1", hasContent: true } });
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "A 的手动草稿", "A late B response cannot replace the currently active A draft");

  await click("[data-efficiency-request=previewContextExecution]");
  const preview = await lastRequest("previewContextExecution");
  const prompt = `请继续当前任务\n${markup}\n完整执行内容：补齐回归测试`;
  await resolve(preview, { snapshot, executionPreview: { prompt, targetKey: snapshot.targetKey } });
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-execution-prompt]').textContent"), prompt, "Full authoritative prompt is shown literally, not as executable markup");
  assert.equal(await client.evaluate("window.__requests.some(r=>r.action==='prepareContextExecution'||r.action==='executeContext')"), false, "First click only previews; it does not save or execute");
  await input("nextStep", "修改后的下一步");
  assert.equal(await client.evaluate(visible("[data-efficiency-execution-preview]")), false, "Editing invalidates previously displayed execution approval");
  await click("[data-efficiency-request=previewContextExecution]");
  const preview2 = await lastRequest("previewContextExecution");
  await resolve(preview2, { snapshot, executionPreview: { prompt, targetKey: snapshot.targetKey } });
  await click("[data-efficiency-confirm-execution]");
  await click("[data-efficiency-confirm-execution]");
  const prepare = await lastRequest("prepareContextExecution");
  assert.equal(prepare.expectedPrompt, prompt);
  assert.deepEqual(prepare.context, preview2.context, "Second confirmation saves exactly the reviewed draft");
  assert.equal(await client.evaluate("window.__requests.filter(r=>r.action==='prepareContextExecution').length"), 1, "Repeated confirmation while pending cannot duplicate saves");
  snapshot.context = { ...prepare.context, version: 1 };
  await resolve(prepare, { snapshot, execution: { token: "isolated-single-use-token", prompt, targetKey: snapshot.targetKey } });
  const execute = await lastRequest("executeContext");
  assert.equal(execute.token, "isolated-single-use-token");
  await resolve(execute, { snapshot, executionResult: { status: "unknown", message: "结果待核对" } });
  assert.match(await client.evaluate(`${api}.getEfficiencyState().message`), /不会自动重试/);
  await update(); await update();
  assert.equal(await client.evaluate("window.__requests.filter(r=>r.action==='executeContext').length"), 1, "Unknown delivery is never automatically retried");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "绝不能清除或发送的已有输入", "Only the native binding receives requests; renderer never manipulates the composer");

  // Mismatched prepare result must remain saved-only, never submit altered content.
  await click("[data-efficiency-request=previewContextExecution]");
  await resolve(await lastRequest("previewContextExecution"), { snapshot, executionPreview: { prompt, targetKey: snapshot.targetKey } });
  await click("[data-efficiency-confirm-execution]");
  snapshot.context.version = 2;
  await resolve(await lastRequest("prepareContextExecution"), { snapshot, execution: { token: "must-not-use", prompt: `${prompt} altered`, targetKey: snapshot.targetKey } });
  assert.equal(await client.evaluate("window.__requests.filter(r=>r.action==='executeContext').length"), 1);
  assert.match(await client.evaluate(`${api}.getEfficiencyState().message`), /未发送/);

  await click("[data-efficiency-request=previewContextExecution]");
  await resolve(await lastRequest("previewContextExecution"), { snapshot, executionPreview: { prompt, targetKey: snapshot.targetKey } });
  await click("[data-efficiency-confirm-execution]");
  snapshot.context.version = 3;
  await resolve(await lastRequest("prepareContextExecution"), { snapshot, execution: { token: "partial-insertion", prompt, targetKey: snapshot.targetKey } });
  await resolve(await lastRequest("executeContext"), { snapshot, executionResult: { status: "prepared-not-sent", prepared: null } });
  assert.match(await client.evaluate(`${api}.getEfficiencyState().message`), /可能只填入了部分/);
  assert.doesNotMatch(await client.evaluate(`${api}.getEfficiencyState().message`), /消息已预填/);

  // React replaces its toolbar; one stable entry returns without touching native controls.
  await client.evaluate("document.getElementById('native-actions').replaceWith(document.getElementById('native-actions').cloneNode(true));document.getElementById('aiyoucodex-task-context-open').remove()");
  await update();
  assert.equal(await client.evaluate("document.querySelectorAll('#aiyoucodex-task-context-open').length"), 1);
  await click("[data-efficiency-close]");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false);
  await update({ ...snapshot, targetKey: "no-local-target", scopeAvailable: { project: false, thread: false }, context: {} });
  assert.equal(await client.evaluate(visible("#aiyoucodex-task-context-open")), false, "Nonlocal or unavailable targets do not expose an actionable task-context entry");
  await client.evaluate(`${api}.destroy()`);
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-task-context-open')===null"), true);
});
