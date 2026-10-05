import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
test("card halos follow execution, actual pointer/keyboard activation and persisted per-completion acknowledgements", {
  timeout: 35_000, skip: !executable && "Requires Chrome/Chromium",
}, async t => {
  const profile = await mkdtemp(path.join(tmpdir(), "aiyou-card-execution-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const fixture = `<style>body{margin:0}aside{width:650px}button{min-height:28px}</style><aside id="app-shell-sidebar"><nav><div>Codex<button title="新聊天">新聊天</button></div><div data-app-action-sidebar-scroll><section data-app-action-sidebar-section-heading="Recents"><header><button data-app-action-sidebar-section-toggle aria-expanded="true">Recents</button></header><div role="list"><div role="listitem"><div role="button" tabindex="0" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:${id}" data-app-action-sidebar-thread-title="Halo task"><div data-thread-title-trigger="true"><span data-thread-title="true">Halo task</span></div></div></div></div></section></div></nav></aside>`;
  const server = createServer((req, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(fixture); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--disable-extensions", "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}` }));
  const api = "window.__codexConversationPreviewInjection__";
  const row = '[data-app-action-sidebar-thread-row]';
  const previews = [{ key: `local:${id}\nHalo task`, threadId: id, title: "Halo task", summary: "网络问题已修复", updatedAt: "2026-10-04T01:00:00Z" }];
  async function install() {
    await client.evaluate('localStorage.setItem("codex-conversation-preview:view-mode","card")');
    await client.evaluate(source);
    await client.evaluate(`${api}.setPreviews(${JSON.stringify(previews)});${api}.setActiveProjectThreads([${JSON.stringify(id)}])`);
  }
  async function state(runtimeStatus, unread = true, revision = "completion-1") {
    await client.evaluate(`${api}.setThreadExecutionStates([{threadId:${JSON.stringify(id)},runtimeStatus:${JSON.stringify(runtimeStatus)},unread:${unread},revision:${JSON.stringify(revision)}}])`);
  }
  async function expect(value) {
    await waitForBrowserState(client, `document.querySelector(${JSON.stringify(row)})?.getAttribute('data-codex-execution-state')===${JSON.stringify(value)}`, `Card is ${value}`);
  }
  async function click(selector) {
    const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:(e.closest('[data-app-action-sidebar-thread-row]')||e).contains(document.elementFromPoint(x,y)),width:r.width,height:r.height}})()`);
    assert.ok(point.hit && point.width && point.height, `Real pointer target visible and unobstructed: ${selector} ${JSON.stringify(point)} ${await client.evaluate(`document.elementFromPoint(${point.x},${point.y})?.outerHTML.slice(0,500)`)}`);
    delete point.hit; delete point.width; delete point.height;
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  }
  await install();
  await state("active", false); await expect("running");
  await state("idle"); await expect("completed-unread");
  await click(`${row} .codex-conversation-status-button`); await expect("completed-unread");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 1000, y: 700, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1000, y: 700, button: "left", clickCount: 1 });
  await click(`${row} .codex-conversation-card-content`); await expect("read");
  await client.send("Page.reload");
  await waitForBrowserState(client, "document.readyState==='complete'&&!window.__codexConversationPreviewInjection__", "Reload clears runtime");
  await install(); await state("idle"); await expect("read");
  await state("active", false, "run-2"); await expect("running");
  await state("idle", true, "completion-2"); await expect("completed-unread");
  await client.evaluate(`document.querySelector(${JSON.stringify(row)}).focus()`);
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await expect("read");
  await state("systemError", false); await expect("error");
  await click(`${row} .codex-conversation-card-content`); await expect("error");
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(row)}).hasAttribute('data-codex-project-running')`), false);
  await state("active", false, "run-3"); await expect("running");
  await state("idle", false, "completion-3"); await expect("read");
});
