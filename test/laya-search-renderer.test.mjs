import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { EfficiencyBridge } from "../lib/efficiency-bridge.mjs";
import { LAYA_SEARCH_BINDING } from "../lib/laya-search.mjs";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";
const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
let executable;
for (const file of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]) try { await access(file); executable = file; break; } catch {}

test("existing folder input, gated switch, actual bridge clicks, evidence, stale query isolation and fallback", { timeout: 30_000, skip: !executable && "Chrome required" }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "laya-ui-test-")), profile = path.join(root, "browser");
  const fixture = '<style>body{margin:0}aside{width:430px}button{min-height:24px}nav[data-app-navigation-rail]{position:absolute;width:48px;height:800px}aside{margin-left:48px}</style><nav data-app-navigation-rail><button aria-label="首页">首页</button></nav><aside id="app-shell-sidebar"><nav><div><div>Codex<button aria-label="搜索">搜索</button></div><div><button title="新聊天">新聊天</button></div></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="Projects"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">Projects</button></header><div role="list"></div></section><section data-app-action-sidebar-section-heading="Recents"><header>Recents</header><div role="list"></div></section></div></nav></aside><main><div contenteditable="true" id="composer">保留原草稿</div><iframe src="/frame" id="frame"></iframe></main>';
  const server = createServer((req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(req.url === "/frame" ? "<p>frame</p>" : fixture); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--disable-extensions", "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client, bridge, release, calls = 0;
  let enabled = false;
  const status = () => ({ ready: true, enabled, indexReady: true, projects: 2, threads: 2, message: "本地就绪" });
  const hit = { threadId: "11111111-1111-4111-8111-111111111111", title: "普通任务", snippet: "电影对白改成 AI 用量版短视频。", line: 12 };
  const controller = { request: async p => {
    if (p.action === "toggle") { enabled = p.enabled; return { status: status() }; }
    if (p.action === "refresh") return { status: status() };
    calls++;
    if (p.query === "旧查询") await new Promise(r => { release = r; });
    return { query: p.query, results: [{ projectId: "p1", hits: [hit] }], status: status() };
  } };
  t.after(async () => { release?.(); bridge?.dispose(); client?.close(); browser.kill("SIGTERM"); await Promise.race([new Promise(r => browser.once("exit", r)), delay(1500)]); if (browser.exitCode == null) browser.kill("SIGKILL"); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  bridge = new EfficiencyBridge(controller, { binding: LAYA_SEARCH_BINDING, resolver: "resolveLayaSearchRequest" }); await bridge.install(client); await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(`${api}.setSearchCatalog(${JSON.stringify([{ threadId: hit.threadId, title: hit.title, projectId: "p1", projectName: "项目甲" }, { threadId: "22222222-2222-4222-8222-222222222222", title: "另一任务", projectId: "p2", projectName: "项目乙" }])})`);
  const toggle = "[data-laya-search-toggle]", input = "[data-codex-sidebar-folder-search]";
  await waitForBrowserState(client, `!!document.querySelector('${toggle}')`, "Switch in existing folder search");
  assert.equal(await client.evaluate(`document.querySelector('${toggle}').disabled`), true);
  assert.equal(await client.evaluate(`typeof document.querySelector('#frame').contentWindow.${LAYA_SEARCH_BINDING}`), "undefined", "Only trusted top frame gets local search binding");
  async function click(selector) {
    const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===e}})()`);
    assert.equal(point.hit, true); for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  const query = value => client.evaluate(`(()=>{const e=document.querySelector('${input}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await client.evaluate(`${api}.setLayaSearchData(${JSON.stringify(status())})`); await click(toggle);
  await waitForBrowserState(client, `document.querySelector('${toggle}').getAttribute('aria-checked')==='true'`, "Enable confirmed by local bridge");
  await query("那个电影对白改成用量吐槽的工作");
  await waitForBrowserState(client, "document.querySelector('[data-laya-search-evidence]').textContent.includes('电影对白')", "Content outside title matched and evidenced");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-codex-sidebar-folder-tag]').length"), 1);
  await client.evaluate(`window.__searchRoutes=[];window.addEventListener('message',e=>{if(e.data?.type==='navigate-to-route')window.__searchRoutes.push(e.data.path)});${api}.setPinnedThreads([${JSON.stringify(hit.threadId)}])`);
  await waitForBrowserState(client, "document.querySelector('[data-laya-search-evidence] button')?.textContent==='普通任务'", "Pinned matches retain evidence and original title");
  await click('[data-laya-search-evidence] button');
  await waitForBrowserState(client, `window.__searchRoutes[0]==='/local/${hit.threadId}'`, "Evidence link opens the exact validated UUID");
  await query("旧查询"); for (let n = 0; !release && n < 50; n++) await delay(20); assert.ok(release);
  await query("项目乙"); release();
  await client.evaluate(`${api}.setLayaSearchData({ready:false,enabled:false,message:'本地不可用'})`);
  await delay(500);
  assert.equal(await client.evaluate("document.querySelector('[data-codex-sidebar-folder-tag]').textContent"), "项目乙", "Late responses cannot overwrite disabled ordinary search");
  assert.equal(await client.evaluate("document.querySelector('[data-laya-search-evidence]').hidden"), true);
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "保留原草稿");
  assert.ok(calls >= 2); await client.evaluate(`${api}.destroy()`);
});
