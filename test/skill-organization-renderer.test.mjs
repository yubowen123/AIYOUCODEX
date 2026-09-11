import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { SkillOrganizationBridge, createSkillOrganizationController, createSkillOrganizationStore } from "../lib/skill-organization.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { createSkillDetailsReader } from "../lib/skill-details.mjs";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("Skills UI: all by default, real single clicks, persistent custom groups, exact-file context menu and two-line summaries", {
  timeout: 55_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Chrome/Chromium required",
}, async (t) => {
  assert.ok(executable);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "aiyou-skill-ui-")));
  const profile = path.join(root, "browser");
  const skillsRoot = path.join(root, "skills");
  for (const name of ["imagegen", "video-gen", "voice", "dingtalk-chat", "skill-creator", "unknown-utility"]) {
    await mkdir(path.join(skillsRoot, name), { recursive: true });
    await writeFile(path.join(skillsRoot, name, "SKILL.md"), `---\nname: ${name}\ndescription: 测试介绍需保留两行，不论刷新还是切换分类均不能缩成一行。这里还有额外的细节用于验证文本截断与可读性。\n---\n`);
  }
  const catalog = await readInstalledSkillCatalog({ roots: [skillsRoot] });
  const imageSkill = catalog.find((skill) => skill.name === "imagegen");
  const store = createSkillOrganizationStore({ filePath: path.join(root, "state", "organization.json") });
  const revealed = [], additions = [], actions = [];
  let delayDetail = false, releaseDetail, traceMode = "found", traceCalls = 0;
  const describe = createSkillDetailsReader();
  const controller = createSkillOrganizationController({ store, readCatalog: async () => catalog,
    describe: async (entry) => { if (delayDetail) { delayDetail = false; await new Promise((resolve) => { releaseDetail = resolve; }); } return describe(entry); },
    trace: async () => {
      traceCalls++;
      if (traceMode === "unassociated") return { status: "unassociated", message: "未找到可验证的创建或优化对话。" };
      if (traceCalls === 1) return { status: "indexing", message: "正在建立本地追溯索引（1/2）" };
      return { status: "found", threadId: "22222222-2222-4222-8222-222222222222", title: "最近优化对话", message: "最近可验证的优化对话：最近优化对话" };
    },
    reveal: async (entry) => { revealed.push(entry.skillFile); return { status: "requested", message: "已请求在所在文件夹中选中 SKILL.md。" }; } });
  const request = controller.request; controller.request = (payload) => { actions.push(payload); return request(payload); };
  const fixture = `<style>body{margin:0;display:flex;height:100vh}aside{width:220px;flex:none}main{display:flex;flex:1;min-width:0;height:100vh}#chat{flex:1;min-width:200px;padding:20px}button{min-height:28px}</style>
    <aside id="app-shell-sidebar"><nav><div><div><button class="sidebar-item"><span class="text-fade-truncate">新对话</span></button></div></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="项目"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">项目</button></header></section></div></nav></aside>
    <main><div id="chat"><div id="composer" contenteditable="true">保留已有聊天草稿</div><button id="outside">对话操作</button><iframe src="/frame"></iframe></div></main>`;
  const server = createServer((req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(req.url === "/frame" ? "<p>Untrusted frame</p>" : fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1400,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client, bridge;
  t.after(async () => {
    bridge?.dispose(); client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  bridge = new SkillOrganizationBridge(controller); await bridge.install(client);
  const api = "window.__codexConversationPreviewInjection__";
  const panel = "#codex-skill-organizer", menu = ".codex-skill-context-menu";
  const row = `${panel} [data-skill-id='${imageSkill.id}']`;
  async function install() {
    await client.evaluate("window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.__added=[];window.__codexTaskboardInjection__={addSkillToComposer:async value=>{window.__added.push(value);return true}};");
    await client.evaluate(source);
    await client.evaluate(`${api}.setSnapshot({skillOrganization:${JSON.stringify(await controller.snapshot())}});${api}.openSkillsGrouping()`);
  }
  async function point(selector) {
    await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(selector)})`, `Render target ${selector}`);
    return client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})===e}})()`);
  }
  async function click(selector, button = "left") {
    const p = await point(selector); assert.equal(p?.hit, true, `Mouse reaches ${selector}`);
    const { x, y } = p;
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
  }
  async function type(selector, value) {
    await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  }
  const saved = () => waitForBrowserState(client, `document.querySelector('${panel} [data-skill-organization-status]').textContent.includes('已保存')`, "Category saved");
  await install();
  assert.equal(await client.evaluate(`document.querySelector('${panel} [aria-pressed=true]').dataset.codexSkillFilter`), "all");
  assert.equal(await client.evaluate(`document.querySelectorAll('${panel} .codex-skill-row').length`), 6);
  assert.equal(await client.evaluate(`document.querySelectorAll('${panel} [data-codex-skill-filter]').length`), 8);
  const selectVisual = `${panel} [data-codex-skill-filter=visual]`;
  await client.evaluate(`window.__filter=document.querySelector('${selectVisual}')`);
  const p = await point(selectVisual);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  assert.equal(await client.evaluate("window.__filter.getAttribute('aria-pressed')"), "true", "Pointerdown selects immediately");
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await waitForBrowserState(client, `document.querySelectorAll('${panel} .codex-skill-row').length===1`, "One click filters cards");
  for (const id of ["office", "video", "audio", "tools", "all", "visual"]) {
    await click(`${panel} [data-codex-skill-filter=${id}]`);
    assert.equal(await client.evaluate(`document.querySelector('${panel} [data-codex-skill-filter=${id}]').getAttribute('aria-pressed')`), "true");
  }
  await client.evaluate(`${api}.setSnapshot({skillOrganization:${JSON.stringify(await controller.snapshot())}})`);
  assert.equal(await client.evaluate(`window.__filter===document.querySelector('${selectVisual}')&&window.__filter.isConnected`), true, "Polling preserves filter DOM identity");
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('${panel} .codex-skill-description')).webkitLineClamp`), "2");
  // A card opens one native modal immediately, with exact, inert local content.
  await writeFile(imageSkill.skillFile, "---\nname: imagegen\ndescription: 图片创作工具\n---\n## 适用场景\n角色设计与场景生成\n## 使用方法\n1. 提供参考图片\n2. 说明风格与尺寸\n<img src=x onerror='window.__unsafe=true'>\n## 输入要求\n参考图片\n## 输出结果\n图片文件\n");
  const dialog = "#aiyoucodex-skill-details";
  assert.equal(actions.some((action) => action.action === "describeSkill"), false, "No full descriptions preloaded");
  const cardPoint = await point(row);
  await client.evaluate(`window.__pressedSkill=document.querySelector(${JSON.stringify(row)})`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cardPoint.x, y: cardPoint.y, button: "left", clickCount: 1 });
  // A queued category render / host refresh may finish while the mouse is down.
  // It must not replace the card and swallow the eventual click.
  await client.evaluate(`${api}.setSkillOrganization(${JSON.stringify(await controller.snapshot())})`);
  await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.equal(await client.evaluate(`window.__pressedSkill===document.querySelector(${JSON.stringify(row)})&&window.__pressedSkill.isConnected`), true, "Refresh preserves the pressed card");
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cardPoint.x, y: cardPoint.y, button: "left", clickCount: 1 });
  await waitForBrowserState(client, `document.querySelector('${dialog}[open] [data-skill-detail-body]').textContent.includes('角色设计与场景生成')`, "Single click opens scenario and usage preview");
  assert.equal(await client.evaluate("window.__added.length"), 0, "Reading does not insert or send");
  assert.equal(await client.evaluate(`!!document.querySelector('${dialog} img')||!!window.__unsafe`), false, "Source HTML is inert text");
  assert.equal(await client.evaluate(`(()=>{const d=document.querySelector('${dialog}').getBoundingClientRect(),f=document.querySelector('${dialog} footer').getBoundingClientRect();return d.top>=0&&d.bottom<=innerHeight&&f.bottom<=d.bottom})()`), true, "Close/action bar stays inside viewport");
  if (process.env.AIYOUCODEX_TEST_SKILL_SCREENSHOT) {
    const capture = await client.send("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.AIYOUCODEX_TEST_SKILL_SCREENSHOT, Buffer.from(capture.data, "base64"));
  }
  await click("[data-skill-detail-close]");
  assert.equal(await client.evaluate(`!document.querySelector('${dialog}').open&&document.activeElement.dataset.skillId===${JSON.stringify(imageSkill.id)}`), true, "Close is clickable and restores focus");
  // Late replies must not reopen or overwrite a newer modal.
  delayDetail = true; await click(row);
  for (let n = 0; !releaseDetail && n < 30; n++) await delay(20);
  assert.ok(releaseDetail);
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.equal(await client.evaluate(`!document.querySelector('${dialog}').open&&!document.querySelector('${panel}').hidden`), true, "Escape closes only preview");
  await click(`${panel} [data-codex-skill-filter=all]`);
  const other = catalog.find((entry) => entry.name === "voice");
  await waitForBrowserState(client, `!!document.querySelector('[data-skill-id="${other.id}"]')`, "All cards rendered");
  await click(`[data-skill-id='${other.id}']`);
  await waitForBrowserState(client, `document.querySelector('${dialog} [data-skill-detail-body]').textContent.includes('原文件未单列适用场景')`, "Missing sections are not fabricated");
  releaseDetail(); await delay(100);
  assert.equal(await client.evaluate(`document.querySelector('${dialog} h2').textContent`), other.title);
  // Backdrop closes without touching the composer.
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: 1, y: 1, button: "left", clickCount: 1 });
  assert.equal(await client.evaluate(`!document.querySelector('${dialog}').open`), true);
  await click(selectVisual);
  await client.evaluate("window.__routes=[];window.addEventListener('message',event=>{if(event.data?.type==='navigate-to-route')window.__routes.push(event.data.path)})");
  await click(row, "right"); await click("[data-skill-menu-trace]");
  await waitForBrowserState(client, "window.__routes.length===1", "Trace follows latest optimization after index completes");
  assert.deepEqual(await client.evaluate("window.__routes"), ["/local/22222222-2222-4222-8222-222222222222"]);
  assert.equal(traceCalls, 2);
  assert.equal(await client.evaluate("window.__added.length"), 0);
  traceMode = "unassociated"; await click(row, "right"); await click("[data-skill-menu-trace]");
  await waitForBrowserState(client, `document.querySelector('${panel} [data-skill-organization-status]').textContent.includes('未找到可验证')`, "Missing associations are explained");
  assert.equal(await client.evaluate("window.__routes.length"), 1, "No guessed navigation");
  await click("[data-skill-manage]"); await type("[data-skill-create-group] input", "常用制作流程");
  await click("[data-skill-create-group] button"); await saved();
  await waitForBrowserState(client, "!!document.querySelector('[data-skill-custom-group]')", "Custom category appears");
  const groupId = (await store.read()).groups[0].id;
  await click("[data-skill-manager-close]");
  await click(row, "right");
  assert.equal(await client.evaluate(`document.querySelector('${menu}').matches(':popover-open')`), true);
  assert.match(await client.evaluate(`document.querySelector('${menu}').textContent`), /添加到对话.*移动分类.*打开所在文件/);
  await click("[data-skill-menu-move]"); await click(`[data-skill-move-group='${groupId}']`); await saved();
  await waitForBrowserState(client, `document.querySelectorAll('${panel} .codex-skill-row').length===0`, "Moved card leaves old group");
  await click(`${panel} [data-codex-skill-filter='${groupId}']`);
  await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(row)})`, "Custom group contains moved card");
  await click(row, "right"); await click("[data-skill-menu-reveal]");
  await waitForBrowserState(client, `document.querySelector('${panel} [data-skill-organization-status]').textContent.includes('选中 SKILL.md')`, "Reveal acknowledged");
  assert.deepEqual(revealed, [imageSkill.skillFile]);
  assert.deepEqual(Object.keys(actions.at(-1)).sort(), ["action", "requestId", "skillId"], "UI sends only exact ID, not a filesystem path");
  assert.equal(await client.evaluate("typeof document.querySelector('iframe').contentWindow.__AIYOUCODEX_SKILLS_REQUEST__"), "undefined");
  await click(row, "right"); await click(`${menu} button`);
  additions.push(...await client.evaluate("window.__added"));
  assert.equal(additions.length, 1); assert.equal(additions[0].skillPath, imageSkill.path);
  await click(row, "right"); await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.equal(await client.evaluate(`!document.querySelector('${menu}')&&!document.querySelector('${panel}').hidden`), true, "Escape closes only the menu");
  await click(row, "right"); await click("#outside"); assert.equal(await client.evaluate(`!document.querySelector('${menu}')`), true);
  await click("[data-skill-manage]");
  await type("[data-skill-custom-group] input", "我的生产工具");
  await click("[data-skill-custom-group] button[type=submit]"); await saved();
  assert.equal((await store.read()).groups[0].label, "我的生产工具");
  await click("[data-skill-manager-close]");
  await click(`${panel} .codex-skill-close`);
  await client.evaluate(`${api}.openSkillsGrouping()`);
  assert.equal(await client.evaluate(`document.querySelector('${panel} [aria-pressed=true]').dataset.codexSkillFilter`), "all", "Reopening defaults to all");
  // Recreate renderer from the persisted store, as after an app restart.
  await client.evaluate(`${api}.destroy()`); await install();
  await click(`${panel} [data-codex-skill-filter='${groupId}']`);
  await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(row)})`, "Manual category survives reinjection");
  await click("[data-skill-manage]");
  await click("[data-skill-custom-group] button[type=button]"); await saved();
  assert.equal((await store.read()).groups.length, 0);
  assert.equal((await store.read()).assignments[imageSkill.id], undefined);
  await click("[data-skill-manager-close]");
  assert.equal(await client.evaluate(`document.querySelector('${panel} [aria-pressed=true]').dataset.codexSkillFilter`), "all", "Deleting selected custom group falls back to all");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "保留已有聊天草稿");
  assert.deepEqual(await client.evaluate("window.__errors"), []);
  const count = await client.evaluate(`${api}.getHealth().syncCount`); await delay(400);
  assert.ok(await client.evaluate(`${api}.getHealth().syncCount`) - count < 4, "No self-triggered mutation loop");
  await client.evaluate(`${api}.destroy()`);
  assert.equal(await client.evaluate(`!document.querySelector('${panel}')&&!document.querySelector('${menu}')`), true);
});
