import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { EfficiencyBridge, createEfficiencyController } from "../lib/efficiency-bridge.mjs";
import { describeWorkspaceFolder, openWorkspaceFolder } from "../lib/workspace-folder.mjs";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean).map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("open-file toolbar: real clicks, exact-thread bridge, clipping, redraw, errors, keyboard and no chat changes", {
  timeout: 45_000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Chrome/Chromium required",
}, async (t) => {
  assert.ok(executable);
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-folder-ui-"));
  const profile = path.join(root, "browser");
  const records = new Map(["a", "b"].map((threadId) => [threadId, { threadId, title: "同名任务", projectPath: path.join(root, `项目 ${threadId}`) }]));
  for (const record of records.values()) await mkdir(record.projectPath);
  let active = "a", release;
  let hold = false;
  const launches = [];
  const platform = process.platform === "win32" ? "win32" : "darwin";
  const controller = createEfficiencyController({ rootDir: path.join(root, "efficiency"),
    repository: { resolveEfficiencyThread: async (id) => records.get(id) || null, readTokenUsage: async () => null },
    readActiveContext: async () => ({ threadId: active }),
    openFolder: (request) => openWorkspaceFolder(request, { platform, launch: async (...args) => {
      launches.push(args); if (hold) await new Promise((resolve) => { release = resolve; });
    } }),
  });
  const fixture = `<style>body{margin:0}#native-header{height:44px;overflow:hidden;display:flex;align-items:center;position:relative;z-index:30;-webkit-app-region:drag}
    [data-testid]{display:flex;width:100%;align-items:center;overflow:hidden}#native-title{flex:1;min-width:0;overflow:hidden;white-space:nowrap}#native-actions{display:flex;align-items:center;flex:none;gap:6px}
    main{height:800px;padding:20px}#composer{height:120px}#native-actions button{height:28px}</style>
    <header id="native-header"><div data-testid="app-shell-header-context-menu-surface" aria-hidden="false"><span id="native-title">Conversation title</span><div id="native-actions" data-app-shell-header-obstacle="true"><button id="native-share">分享</button><button>面板</button></div></div></header>
    <main><div id="composer" contenteditable="true">保持已有输入与附件</div><iframe id="untrusted" src="/frame"></iframe></main>`;
  const server = createServer((request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end(request.url === "/frame" ? "<p>frame</p>" : fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client, bridge;
  t.after(async () => {
    release?.(); bridge?.dispose(); client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  bridge = new EfficiencyBridge(controller); await bridge.install(client);
  await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  const button = "#aiyoucodex-workspace-folder-open", menu = "#aiyoucodex-workspace-folder-menu";
  async function snapshot() {
    const value = await controller.snapshot();
    // Linux CI simulates a supported file manager; OS process launching is mocked.
    value.workspaceFolder = describeWorkspaceFolder(records.get(active), { platform });
    await client.evaluate(`${api}.setSnapshot({efficiency:${JSON.stringify(value)}})`);
  }
  async function click(selector) {
    const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===e}})()`);
    assert.equal(point.hit, true, `Pointer really reaches ${selector}`);
    const { x, y } = point;
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  const visible = () => client.evaluate(`!!document.querySelector('${menu}')&&!document.querySelector('${menu}').hidden`);
  const status = (pattern) => waitForBrowserState(client, `(()=>{const text=document.querySelector('${menu} [role=status]')?.textContent;return text?.includes(${JSON.stringify(pattern)})?true:text})()`, pattern);
  await snapshot();
  await waitForBrowserState(client, `document.querySelector('${button}')?.hidden===false`, "Folder entry mounted");
  assert.equal(await client.evaluate(`document.querySelector('${button}').nextElementSibling.id`), "aiyoucodex-task-context-open");
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('${button}')).webkitAppRegion`), "no-drag");
  await click(button); assert.equal(await visible(), true);
  assert.equal(launches.length, 0, "Opening menu alone must not open directories");
  await click(button); assert.equal(await visible(), false);
  await click(button);
  hold = true;
  await click("[data-workspace-folder-mode=parent]");
  await waitForBrowserState(client, `document.querySelector('[data-workspace-folder-mode=parent]').disabled`, "Pending requests disable repeat actions");
  await click("[data-workspace-folder-mode=parent]");
  await status("正在请求");
  for (let attempt = 0; !release && attempt < 50; attempt++) await delay(20);
  assert.equal(launches.length, 1); assert.ok(release); release(); hold = false;
  await status("上级目录");
  assert.deepEqual(launches[0][1], platform === "win32" ? ["/select,", records.get("a").projectPath] : ["-R", records.get("a").projectPath]);
  await click("[data-workspace-folder-mode=folder]"); await status("对话所在文件夹");
  assert.deepEqual(launches[1][1], [records.get("a").projectPath]);
  assert.equal(await client.evaluate("typeof document.querySelector('#untrusted').contentWindow.__AIYOUCODEX_EFFICIENCY_REQUEST__"), "undefined");
  assert.equal(await client.evaluate("document.querySelector('#composer').textContent"), "保持已有输入与附件");

  // A native change before the polling snapshot must reject the old menu guard.
  active = "b";
  await click("[data-workspace-folder-mode=folder]"); await status("切换");
  assert.equal(launches.length, 2);
  await snapshot(); assert.equal(await visible(), false);
  await click(button); await click("[data-workspace-folder-mode=folder]"); await status("对话所在文件夹");
  assert.deepEqual(launches[2][1], [records.get("b").projectPath]);
  await rm(records.get("b").projectPath, { recursive: true });
  // macOS realpath can change /var -> /private/var when a directory disappears;
  // refresh its target guard, then verify the explicit missing-directory error.
  await snapshot(); if (!await visible()) await click(button);
  await click("[data-workspace-folder-mode=folder]"); await status("不存在");
  assert.equal(launches.length, 3);

  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  assert.equal(await visible(), false);
  assert.equal(await client.evaluate("document.activeElement.id"), button.slice(1));
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
  assert.equal(await client.evaluate("document.activeElement.dataset.workspaceFolderMode"), "parent");
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
  assert.equal(await client.evaluate("document.activeElement.dataset.workspaceFolderMode"), "folder");
  await click("#native-share"); assert.equal(await visible(), false);

  // Replacement with a clone must not leave visible-but-dead event handlers.
  await client.evaluate("document.querySelector('#native-actions').replaceWith(document.querySelector('#native-actions').cloneNode(true))");
  await delay(150);
  await snapshot(); await click(button); assert.equal(await visible(), true);
  assert.equal(await client.evaluate(`document.querySelectorAll('${button}').length`), 1);
  const before = await client.evaluate(`${api}.getHealth().syncCount`);
  await delay(350);
  assert.ok((await client.evaluate(`${api}.getHealth().syncCount`)) - before < 4, "Menu does not cause a mutation/render loop");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 480, height: 500, deviceScaleFactor: 1.5, mobile: false });
  await waitForBrowserState(client, `(()=>{const r=document.querySelector('${menu}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`, "Menu remains in a narrow scaled viewport");
  await click("[data-workspace-folder-mode=folder]"); await status("不存在");
  await client.send("Emulation.clearDeviceMetricsOverride");
  records.get("b").projectPath = null;
  await snapshot(); await click(button); await status("尚未关联");
  assert.equal(await client.evaluate("[...document.querySelectorAll('[data-workspace-folder-mode]')].every(b=>b.disabled)"), true);
  active = "unknown"; await snapshot();
  assert.equal(await client.evaluate(`document.querySelector('${button}').hidden`), true);
  await client.evaluate(`${api}.destroy()`);
  assert.equal(await client.evaluate(`!document.querySelector('${button}')&&!document.querySelector('${menu}')`), true);
});
