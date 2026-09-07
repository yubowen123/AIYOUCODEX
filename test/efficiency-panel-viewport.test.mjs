import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CdpClient } from "../scripts/cdp-client.mjs";
import { waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .map((root) => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

test("efficiency close stays reachable in nested clipped/min-width hosts and after viewport resize", {
  timeout: 35_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Set AIYOUCODEX_TEST_BROWSER for real panel viewport coverage",
}, async (t) => {
  assert.ok(executable, "Required Chrome/Chromium browser is present");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "aiyoucodex-panel-bounds-"));
  const fixture = `<style>body{margin:0;overflow:hidden}main{height:100vh}#clipper{position:absolute;left:250px;top:70px;width:calc(100vw - 290px);height:calc(100vh - 100px);overflow:hidden;transform:translateX(12px)}#host{display:flex;position:relative;width:900px;height:100%;overflow:hidden}#native-chat{flex:0 0 300px;min-width:300px;height:100%;background:#fafafa}button{min-height:28px}</style>
    <main><div id="clipper"><div id="host"><div id="native-chat" data-app-shell-main-content-layout><div class="app-shell-main-content-frame" style="width:100%;height:100%"><div id="composer" contenteditable="true">Do not modify the conversation</div></div></div></div></div></main>`;
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html;charset=utf-8"); response.end(fixture); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1506,1100", "--remote-debugging-port=0", `--user-data-dir=${path.join(temporaryRoot, "browser")}`, origin], { stdio: "ignore" });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port;
  for (let index = 0; index < 70; index += 1) {
    try { port = Number((await readFile(path.join(temporaryRoot, "browser", "DevToolsActivePort"), "utf8")).split("\n")[0]); if (Number.isInteger(port) && port > 0) break; } catch {}
    await delay(100);
  }
  assert.ok(port);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  client = new CdpClient(targets.find((entry) => entry.type === "page").webSocketDebuggerUrl);
  await client.connect();
  await waitForBrowserState(client, `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`, "Nested fixture is loaded");
  await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  await client.evaluate(`${api}.openEfficiencyPanel()`);
  const reachable = `(()=>{const p=document.getElementById('aiyoucodex-efficiency-panel'),c=p?.querySelector('[data-efficiency-close]');if(!p||p.hidden||!c)return false;const r=p.getBoundingClientRect(),b=c.getBoundingClientRect(),clip=document.getElementById('clipper').getBoundingClientRect();return r.right<=Math.min(innerWidth,clip.right)+.5&&r.left>=Math.max(0,clip.left)-.5&&r.top>=Math.max(0,clip.top)-.5&&b.right<=innerWidth&&b.bottom<=innerHeight&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===c})()`;
  await waitForBrowserState(client, reachable, "Initial panel has a reachable close button");
  assert.notEqual(await client.evaluate("document.getElementById('aiyoucodex-efficiency-panel').dataset.efficiencyViewportOverlay"), "true", "Normal flexible layouts retain the original side-by-side placement");
  await client.evaluate(`document.querySelector('[data-efficiency-close]').focus();document.getElementById('native-chat').style.cssText='flex:0 0 850px;min-width:850px;height:100%';document.getElementById('host').style.cssText='width:1000px;height:900px';document.getElementById('clipper').style.maxWidth='700px';window.__originalChat={parent:document.getElementById('native-chat').parentElement,style:document.getElementById('native-chat').getAttribute('style')}`);
  await waitForBrowserState(client, reachable, "An unshrinkable native conversation inside a nested transformed clip cannot push close off-screen");
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-efficiency-panel').dataset.efficiencyViewportOverlay"), "true", "Only the affected efficiency panel uses its viewport fallback");
  assert.equal(await client.evaluate("document.activeElement===document.querySelector('[data-efficiency-close]')"), true, "A native layout change preserves focus while relocating the same panel node");
  assert.equal(await client.evaluate("document.getElementById('native-chat').parentElement===window.__originalChat.parent&&document.getElementById('native-chat').getAttribute('style')===window.__originalChat.style"), true,
    "Native conversation children and styling are not rewritten");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 620, deviceScaleFactor: 1, mobile: false });
  await waitForBrowserState(client, reachable, "A narrower viewport recomputes the close hit target and clips width safely");
  await client.evaluate("document.getElementById('clipper').scrollTop=120");
  await waitForBrowserState(client, reachable, "Ancestor scrolling keeps the panel header within the visible clip");
  const rect = await client.evaluate("(()=>{const r=document.querySelector('[data-efficiency-close]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  assert.equal(await client.evaluate(`${api}.getEfficiencyState().open`), false, "A single physical click closes the fallback panel");
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "Do not modify the conversation");
  await client.evaluate(`${api}.openEfficiencyPanel();${api}.destroy()`);
  await client.send("Emulation.clearDeviceMetricsOverride");
  await client.evaluate("document.getElementById('clipper').scrollTop=0");
  await delay(100);
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-efficiency-panel')===null"), true,
    "Destroy cancels observers/listeners and cannot remount a viewport portal");
});
