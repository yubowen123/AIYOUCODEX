import assert from "node:assert/strict";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";
import { presentTokenUsage } from "../lib/usage-data.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("efficiency requests use a native binding and never a composer fallback", () => {
  const start = source.indexOf("  function sendEfficiencyRequest(");
  const end = source.indexOf("  function resolveEfficiencyRequest(", start);
  const request = source.slice(start, end);
  assert.match(request, /expectedTargetKey/);
  assert.match(request, /expectedContextVersion/);
  assert.match(request, /expectedVersion/);
  assert.doesNotMatch(request, /currentComposer|insertPlainText|execCommand|threadId|projectId|projectPath/);
  assert.match(source, /if \(value\.startsWith\("skill:"\)\) return \[value\]/,
    "Favorite IDs from a repository not currently mounted are retained");
});

test("favorite migration retains absent stable IDs and does not select ambiguous same-name skills", () => {
  const context = vm.createContext({ skillOrganizerFavorites: null, SKILL_FAVORITES_KEY: "fixture",
    localStorage: { getItem: () => JSON.stringify(["同名技能", "skill:temporarily-absent", "唯一技能"]), setItem() {} } });
  for (const name of ["skillFavoriteKey", "loadSkillFavorites"]) {
    const start = source.indexOf(`  function ${name}(`);
    const end = source.indexOf("\n  function ", start + 1);
    vm.runInContext(source.slice(start, end), context);
  }
  const result = context.loadSkillFavorites([{ id: "skill:a", name: "same", title: "同名技能" },
    { id: "skill:b", name: "same", title: "同名技能" }, { id: "skill:c", name: "unique", title: "唯一技能" }]);
  assert.deepEqual(Array.from(result), ["skill:temporarily-absent", "skill:c"]);
});

test("isolated browser: efficiency single click, scope safety, independent drafts, truthful status and lifecycle", {
  timeout: 35_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Set AIYOUCODEX_TEST_BROWSER for actual renderer coverage",
}, async (t) => {
  assert.ok(executable, "Required Chrome/Chromium browser must be present");
  const profile = await mkdtemp(path.join(tmpdir(), "aiyoucodex-efficiency-ui-"));
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end("<title>Efficiency fixture</title>"); });
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
  await waitForBrowserState(client, `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`, "Fixture has a real origin");
  const { frameTree } = await client.send("Page.getFrameTree");
  await client.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<style>
    body{margin:0;display:flex;height:100vh}aside{width:280px;flex-shrink:0}main{display:flex;flex:1;min-width:0;height:100vh}button{min-height:28px}#chat{flex:1;min-width:220px;padding:20px}</style>
    <aside id="app-shell-sidebar"><nav><div><div><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button></div></div>
    <div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header></section></div></nav></aside>
    <main><div id="chat"><div id="composer" contenteditable="true" style="width:240px;height:90px">保留的聊天草稿</div></div></main>` });
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate("window.__fixtureErrors=[];window.addEventListener('error',event=>window.__fixtureErrors.push(event.message));");
  await client.evaluate(source.replace("  window[SENTINEL] = {", "  window[SENTINEL] = { __openSettings: openShortcutSettings,"));
  await client.evaluate(`${api}.__openSettings()`);
  async function click(selector) {
    const rect = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  }
  await click("[data-aiyou-efficiency-open]");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), true, `One genuine click opens the panel: ${JSON.stringify(await client.evaluate("({errors:window.__fixtureErrors,dialog:document.querySelector('dialog').open,panels:[...document.querySelectorAll('[data-codex-workspace-side-panel]')].map(e=>[e.id,e.hidden])})"))}`);
  assert.equal(await client.evaluate("document.querySelector('dialog').open"), false);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-effective]').textContent"), /不可用/);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-request=saveScope]').disabled"), true);
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "保留的聊天草稿");

  const snapshot = { version: 1, targetKey: "opaque-fixture-a", scopeAvailable: { project: true, thread: true },
    scopes: { global: { mode: "smart", defaultSkills: ["skill:a"] }, project: {}, thread: {} },
    effective: { mode: "smart", source: "global" }, context: { version: 0, goal: "", progress: "", nextStep: "", agreements: [], references: ["保留的证据引用"] },
    hookStatus: { saved: true, loaded: true }, usage: { available: false } };
  await client.evaluate(`window.__requests=[];window.__AIYOUCODEX_EFFICIENCY_REQUEST__=(raw)=>window.__requests.push(JSON.parse(raw));
    ${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)},skillCatalog:[{id:'skill:a',name:'same-name',title:'同名技能',description:'one'},{id:'skill:b',name:'same-name',title:'同名技能',description:'two'}]})`);
  assert.doesNotMatch(await client.evaluate("document.querySelector('[data-efficiency-hook]').textContent"), /当前会话已加载/,
    "A loaded boolean without a real load timestamp must not invent evidence");
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-usage]').textContent"), /暂不可用/);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-selected-skills]').children.length"), 1);
  await click("[data-efficiency-skill-results] button");
  assert.deepEqual(await client.evaluate(`${api}.getEfficiencyState().drafts.global.defaultSkills`), ["skill:a", "skill:b"], "Same-name Skills are selectable by distinct IDs");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "保留的聊天草稿", "Setting defaults never inserts or sends a chat message");
  await client.evaluate(`(()=>{const e=document.querySelector('[data-efficiency-field=goal]');e.value='未提交的目标';e.dispatchEvent(new Event('input',{bubbles:true}));${api}.openTaskContextPanel();e.focus();e.setSelectionRange(2,4);})()`);
  snapshot.version = 2;
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)}})`);
  assert.deepEqual(await client.evaluate(`(()=>{const e=document.querySelector('[data-efficiency-field=goal]');return[e.value,e.selectionStart,e.selectionEnd,document.activeElement===e]})()`), ["未提交的目标", 2, 4, true],
    "Polling must preserve dirty text, focused node and selection");
  await client.evaluate(`${api}.openEfficiencyPanel()`);
  await click("[data-efficiency-request=saveScope]");
  await click("[data-efficiency-request=saveScope]");
  assert.equal(await client.evaluate("window.__requests.length"), 1, "Double click while pending does not send duplicate actions");
  const save = await client.evaluate("window.__requests[0]");
  assert.equal(save.expectedVersion, 1, "Snapshot refresh cannot silently rebase an edited policy draft");
  assert.equal(save.expectedTargetKey, "opaque-fixture-a");
  assert.equal(save.action, "saveScope");
  assert.deepEqual(save.defaultSkills, ["skill:a", "skill:b"]);
  assert.equal(Object.hasOwn(save, "threadId"), false);
  snapshot.scopes.global.defaultSkills = save.defaultSkills;
  snapshot.version = 3;
  await client.evaluate(`${api}.resolveEfficiencyRequest({requestId:${JSON.stringify(save.requestId)},ok:true,data:${JSON.stringify(snapshot)}})`);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "未提交的目标", "Policy save does not discard independent context edits");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().contextDraft.dirty`), true);
  assert.equal(await client.evaluate(`${api}.resolveEfficiencyRequest({requestId:${JSON.stringify(save.requestId)},ok:true,data:${JSON.stringify(snapshot)}})`), false, "Duplicate responses are ignored");
  await client.evaluate(`${api}.openTaskContextPanel()`);
  await click("[data-efficiency-request=saveContext]");
  const saveContext = await client.evaluate("window.__requests.at(-1)");
  assert.equal(saveContext.scope, "thread");
  assert.equal(saveContext.context.goal, "未提交的目标");
  assert.deepEqual(saveContext.context.references, ["保留的证据引用"], "Editing visible context fields does not erase stored evidence references");
  await client.evaluate(`(()=>{const e=document.querySelector('[data-efficiency-field=goal]');e.value='保存途中继续编辑';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  snapshot.context = { ...snapshot.context, version: 1, goal: saveContext.context.goal };
  await client.evaluate(`${api}.resolveEfficiencyRequest({requestId:${JSON.stringify(saveContext.requestId)},ok:true,data:${JSON.stringify(snapshot)}})`);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "保存途中继续编辑", "Late success keeps newer edits");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().contextDraft.dirty`), true);
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().contextDraft.version`), 1, "New edits rebase only onto their own acknowledged write");
  await click("[data-efficiency-request=saveContext]");
  const failedSave = await client.evaluate("window.__requests.at(-1)");
  assert.equal(failedSave.expectedContextVersion, 1);
  await client.evaluate(`${api}.resolveEfficiencyRequest({requestId:${JSON.stringify(failedSave.requestId)},ok:false,error:'验证失败：保留草稿'})`);
  snapshot.version = 4;
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)}})`);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "保存途中继续编辑");
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-error]').textContent"), /验证失败/,
    "Status polling does not erase actionable errors or failed drafts");

  snapshot.targetKey = "opaque-fixture-b";
  snapshot.context.goal = "其他任务";
  await client.evaluate(`${api}.openEfficiencyPanel()`);
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)}})`);
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().targetChanged`), false);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "其他任务");
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify({ ...snapshot, targetKey: "opaque-fixture-a" })}})`);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), "保存途中继续编辑", "Returning to the original thread restores only that thread's dirty draft");
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)}})`);
  await client.evaluate("(()=>{const e=document.querySelector('[data-efficiency-scope]');e.value='project';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-skill-inherit]').checked"), true);
  await click("[data-efficiency-request=saveScope]");
  const inheritedSave = await client.evaluate("window.__requests.at(-1)");
  assert.equal(inheritedSave.mode, null);
  assert.equal(inheritedSave.defaultSkills, null, "Inherited defaults must remain distinct from an explicit empty selection");
  snapshot.version = 5;
  await client.evaluate(`${api}.resolveEfficiencyRequest({requestId:${JSON.stringify(inheritedSave.requestId)},ok:true,data:${JSON.stringify(snapshot)}})`);
  snapshot.hookStatus = { loaded: true, loadedAt: "2026-09-06T12:00:00Z" };
  snapshot.usage = presentTokenUsage({ cumulative: { inputTokens: 432, outputTokens: 12, reasoningOutputTokens: 8, totalTokens: 444 },
    lastRequest: { inputTokens: 99, outputTokens: 5 } });
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)}})`);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-hook]').textContent"), /当前会话已加载/);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-usage]').textContent"), /本会话累计：输入 432 · 输出 12 · 推理 8 · 总计 444/);
  assert.doesNotMatch(await client.evaluate("document.querySelector('[data-efficiency-usage]').textContent"), /缓存输入 0|推理 0|%/);
  snapshot.usage = presentTokenUsage({ cumulative: null, lastRequest: { inputTokens: 99, outputTokens: 5, cachedInputTokens: 0 } });
  snapshot.hookStatus = { loaded: false, loadedAt: "2026-09-06T12:00:00Z", currentPolicyFingerprint: "updated-policy" };
  const markup = '<img src="fixture-invalid" onerror="window.__draftExecuted=true">';
  snapshot.targetLabel = markup;
  snapshot.context = { ...snapshot.context, goal: markup, progress: '</textarea><script>window.__draftExecuted=true</script>',
    nextStep: '引用 "quotes" 与 \\path', agreements: [markup] };
  await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(snapshot)},skillCatalog:[{id:'skill:x',name:'safe',title:${JSON.stringify(markup)},description:${JSON.stringify(markup)}}]})`);
  assert.match(await client.evaluate("document.querySelector('[data-efficiency-usage]').textContent"), /最近请求：输入 99 · 缓存输入 0 · 输出 5/);
  assert.doesNotMatch(await client.evaluate("document.querySelector('[data-efficiency-hook]').textContent"), /当前会话已加载/,
    "An old timestamp must not override the backend's current-policy mismatch result");
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-target]').textContent"), markup);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=goal]').value"), markup);
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-field=progress]').value"), '</textarea><script>window.__draftExecuted=true</script>');
  assert.equal(await client.evaluate("document.querySelector('#aiyoucodex-efficiency-panel img, #aiyoucodex-efficiency-panel script')===null"), true,
    "Task/skill strings stay text; they must never become markup");
  assert.equal(await client.evaluate("window.__draftExecuted===true"), false);
  await click("[data-efficiency-close]");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false, "Close has a real reachable hit target");
  await client.evaluate(`${api}.openEfficiencyPanel()`);
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false);
  await client.evaluate(`${api}.openEfficiencyPanel();${api}.openSkillsGrouping()`);
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false, "Workspace panels remain mutually exclusive");
  await client.evaluate(`${api}.openEfficiencyPanel();${api}.destroy()`);
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-efficiency-panel')===null"), true);
  await client.evaluate(source);
  await waitForBrowserState(client, `${api}.getHealth().ready===true`, "Renderer re-injection remains compatible");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false);
  assert.equal(await client.evaluate("window.__requests.length"), 4, "Destroy/re-injection never sends background configuration mutations");
});
