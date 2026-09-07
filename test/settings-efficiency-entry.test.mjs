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

test("settings output-preferences entry opens by actual mouse and keyboard interaction", {
  timeout: 35_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Set AIYOUCODEX_TEST_BROWSER for actual settings-entry coverage",
}, async (t) => {
  assert.ok(executable, "Required Chrome/Chromium browser is present");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "aiyoucodex-settings-entry-"));
  const fixture = `<style>*{box-sizing:border-box}body{margin:0;display:flex;height:100vh;overflow:hidden}aside{width:240px}main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;position:relative;isolation:isolate;overflow:hidden}#native-layout{position:relative;isolation:isolate;display:flex;flex:1;min-height:0;overflow:hidden}#native-chat{display:flex;flex-direction:column;flex:1;position:relative;min-width:0;min-height:0}#native-frame{display:flex;flex-direction:column;flex:1;min-height:0;min-width:100%;position:relative}button{min-height:28px}</style>
    <aside><div><span><button aria-label="搜索">搜索</button></span></div></aside>
    <main data-app-shell-main-surface="default"><div id="native-layout"><div id="native-chat" data-app-shell-main-content-layout><div id="native-frame"><div id="composer" contenteditable="true">Preserve the conversation draft</div></div></div></div></main>`;
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end(fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = path.join(temporaryRoot, "browser");
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1506,1100", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: origin }));
  await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  const click = async (selector) => {
    const rect = await client.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  };
  await click("#codex-sidebar-shortcut-settings-button");
  await waitForBrowserState(client, "document.getElementById('codex-sidebar-shortcut-settings-dialog').open", "Settings opens through the real header button");
  await click("[data-aiyou-efficiency-open]");
  await waitForBrowserState(client, `${api}.getEfficiencyState().open&&!document.getElementById('codex-sidebar-shortcut-settings-dialog').open`, "Output preferences remains open after the settings-dialog transition");
  const reachable = `(()=>{const p=document.getElementById('aiyoucodex-efficiency-panel'),c=p?.querySelector('[data-efficiency-close]');if(!p||p.hidden||!c)return false;const r=c.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===c})()`;
  await waitForBrowserState(client, reachable, "The output-preferences panel is visible and its close button receives mouse input");
  await click("[data-efficiency-close]");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false);
  await click("#codex-sidebar-shortcut-settings-button");
  await client.evaluate("document.querySelector('[data-aiyou-efficiency-open]').focus()");
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitForBrowserState(client, reachable, "Keyboard activation opens the same reachable output-preferences panel");
  await click("[data-efficiency-close]");
  await client.evaluate(`(()=>{const main=document.querySelector('main'),replacement=document.createElement('div');replacement.id='future-native-surface';replacement.style.cssText='flex:1;height:100%;min-width:0';const composer=document.getElementById('composer');replacement.appendChild(composer);main.replaceWith(replacement);window.__originalSurface={node:replacement,html:replacement.innerHTML,style:replacement.getAttribute('style')}})()`);
  await click("#codex-sidebar-shortcut-settings-button");
  await click("[data-aiyou-efficiency-open]");
  await waitForBrowserState(client, reachable, "Global preferences remains accessible when native main-content selectors are absent");
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-efficiency-panel').parentElement===document.body"), true);
  assert.equal(await client.evaluate("document.getElementById('future-native-surface')===window.__originalSurface.node&&window.__originalSurface.node.innerHTML===window.__originalSurface.html&&window.__originalSurface.node.getAttribute('style')===window.__originalSurface.style"), true,
    "The preferences-only fallback does not rewrite native conversation children or styling");
  assert.equal(await client.evaluate("document.activeElement===document.querySelector('[data-efficiency-close]')"), true,
    "Closing the settings dialog transfers focus to the newly opened panel");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 620, deviceScaleFactor: 1, mobile: false });
  await waitForBrowserState(client, reachable, "The body-mounted fallback stays reachable after resizing");
  await click("[data-efficiency-close]");
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false);
  await client.evaluate(`(()=>{document.getElementById('aiyoucodex-efficiency-panel').remove();window.__nativeAppend=document.body.appendChild;document.body.appendChild=function(node){if(node.id==='aiyoucodex-efficiency-panel')throw new Error('Synthetic unavailable mount');return window.__nativeAppend.call(this,node)}})()`);
  await click("#codex-sidebar-shortcut-settings-button");
  await click("[data-aiyou-efficiency-open]");
  assert.equal(await client.evaluate("document.getElementById('codex-sidebar-shortcut-settings-dialog').open"), true,
    "An unexpected mount failure must not dismiss the existing settings dialog");
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-open-error]').textContent.length>0"), true,
    "The entry explains an unexpected failure instead of silently losing the settings view");
  await client.evaluate("document.body.appendChild=window.__nativeAppend;delete window.__nativeAppend");
  await click("[data-aiyou-efficiency-open]");
  await waitForBrowserState(client, reachable, "Retry recovers after a temporary mount failure");
  assert.equal(await client.evaluate("document.querySelector('[data-efficiency-open-error]').textContent"), "");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "Preserve the conversation draft");
  await client.evaluate(`${api}.destroy()`);
  assert.equal(await client.evaluate("!document.getElementById('aiyoucodex-efficiency-panel')&&!document.getElementById('codex-sidebar-shortcut-settings-dialog')"), true,
    "Destroy removes both the panel portal and settings dialog");
});
