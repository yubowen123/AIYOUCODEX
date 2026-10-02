import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const sidebar = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const board = await readFile(new URL("../vendor/codex-taskboard/inject/codex-taskboard.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("project icons do not depend on the native icon format or label nesting", {
  timeout: 35_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Requires isolated Chrome/Chromium",
}, async t => {
  assert.ok(executable);
  const root = await mkdtemp(path.join(tmpdir(), "aiyoucodex-project-icon-"));
  const variants = [
    '<span class="text-fade-truncate">Plugins</span>',
    '<span aria-hidden="true" class="native-mask-icon"></span><span class="text-fade-truncate">Plugins</span>',
    '<svg class="native-hidden-icon" viewBox="0 0 16 16" style="opacity:0"><use href="#missing-symbol"/></svg><div>Plugins</div>',
  ];
  const server = createServer((request, response) => {
    const index = Number(new URL(request.url, "http://fixture").pathname.slice(1)) || 0;
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end(`<style>body{margin:0;display:flex;height:100vh}aside{width:480px}main{flex:1}button{min-height:30px}.native-mask-icon{display:inline-block;width:18px;height:18px;background:red}.native-hidden-icon{visibility:hidden}</style>
      <aside id="app-shell-sidebar"><nav><div data-app-action-sidebar-scroll><div><div><button aria-label="New chat"><span class="text-fade-truncate">New chat</span></button><button>+</button></div><div><button>Pull requests</button><button>Scheduled</button><button id="fixture-plugin">${variants[index]}</button></div></div><section data-app-action-sidebar-section="projects"><button data-app-action-sidebar-section-toggle>Projects</button></section></div></nav></aside><main><div><div data-app-shell-main-content-layout><div class="app-shell-main-content-frame"><div contenteditable="true">Keep my draft</div></div></div></div></main>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = path.join(root, "browser");
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1506,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close();
    browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `${origin}/0` }));
  for (let index = 0; index < variants.length; index++) {
    if (index) {
      await client.send("Page.navigate", { url: `${origin}/${index}` });
      await waitForBrowserState(client, `location.pathname==='/${index}'&&document.readyState==='complete'`, "New host variant loaded");
    }
    const referenceHtml = await client.evaluate("document.getElementById('fixture-plugin').innerHTML");
    await client.evaluate(`window.__CODEX_TASKBOARD_SOURCE_HASH__='icon-fixture';window.__CODEX_TASKBOARD_DOCUMENT__='<html><body>Fixture board</body></html>'`);
    await client.evaluate(board);
    await waitForBrowserState(client, "!!document.getElementById('codex-taskboard-entry')", "Project entry exists");
    const native = await client.evaluate(`(()=>{const b=document.getElementById('codex-taskboard-entry'),s=b.querySelector('svg'),c=s&&getComputedStyle(s);return {label:b.textContent.trim(),icon:!!s?.querySelector('rect,path'),namespace:s?.namespaceURI,visible:!!s&&c.display!=='none'&&c.visibility==='visible'&&c.opacity!=='0',staleIcons:b.querySelectorAll('.native-mask-icon,.native-hidden-icon').length,source:document.getElementById('fixture-plugin').innerHTML}})()`);
    assert.equal(native.icon, true, `Native entry must own its icon (host variant ${index})`);
    assert.equal(native.namespace, "http://www.w3.org/2000/svg");
    assert.equal(native.label, "项目管理");
    assert.equal(native.visible, true);
    assert.equal(native.staleIcons, 0);
    assert.equal(native.source, referenceHtml, "Do not mutate the native reference");
    // A mixed-version entry may already be missing its icon. The shortcut must
    // supply its own artwork rather than clone an empty native source.
    await client.evaluate("document.querySelector('#codex-taskboard-entry svg').remove()");
    await client.evaluate(sidebar);
    const selector = '[data-codex-sidebar-shortcut-name="项目管理"]';
    await waitForBrowserState(client, `!!document.querySelector(${JSON.stringify(selector)})`, "Project shortcut exists");
    const icon = await client.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),s=b.querySelector('svg'),r=s?.getBoundingClientRect();return {label:b.textContent,paths:s?.querySelectorAll('rect,path').length,width:r?.width,height:r?.height,count:document.querySelectorAll(${JSON.stringify(selector)}).length}})()`);
    assert.ok(icon.paths > 0, "Shortcut artwork must not depend on native source SVG");
    assert.equal(icon.width, 18);
    assert.equal(icon.height, 18);
    assert.equal(icon.count, 1);
    assert.equal(icon.label, "项目管理");
    assert.equal(await client.evaluate("document.querySelector('[contenteditable]').textContent"), "Keep my draft");
    if (index === 0 && process.env.AIYOUCODEX_ICON_SCREENSHOT) {
      const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.AIYOUCODEX_ICON_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }
  }

  await client.evaluate(`document.body.insertAdjacentHTML('afterbegin', '<nav data-app-navigation-rail style="display:block;width:64px;height:100vh"><button>Home</button></nav>')`);
  await waitForBrowserState(client,
    `document.querySelector('#codex-sidebar-shortcut-grid[data-codex-shortcut-layout="rail"] [data-codex-sidebar-shortcut-name="项目管理"]') && !document.getElementById('codex-taskboard-entry')`,
    "The new icon rail replaces the legacy project card");
  const runtimeSource = await readFile(new URL("../vendor/codex-taskboard/scripts/codex-injector.mjs", import.meta.url), "utf8");
  assert.match(runtimeSource, /entryMounted: Boolean\(document\.getElementById\("codex-taskboard-entry"\)[\s\S]*?data-codex-shortcut-layout/,
    "The resident injector must accept the rail shortcut as a healthy entry");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-codex-sidebar-shortcut-name=\"项目管理\"]').length"), 1);
  await client.evaluate("document.querySelector('[data-codex-sidebar-shortcut-name=\"项目管理\"]').click()");
  assert.equal(await client.evaluate("document.documentElement.getAttribute('data-codex-taskboard-open')"), "true",
    "The remaining rail shortcut still opens Taskboard");
  await client.evaluate("window.__codexTaskboardInjection__.close()");
  await client.evaluate("document.querySelector('nav[data-app-navigation-rail]').remove()");
  await waitForBrowserState(client, "!!document.getElementById('codex-taskboard-entry')",
    "The legacy entry returns when the icon rail is removed");
});
