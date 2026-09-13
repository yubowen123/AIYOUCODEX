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

test("reset notice fits header, opens once, updates locally, and never rewrites quota", {
  timeout: 40000, skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Chrome not available",
}, async (t) => {
  assert.ok(executable);
  const profile = await mkdtemp(path.join(tmpdir(), "aiyou-reset-ui-"));
  const html = `<style>body{margin:0;font-family:Arial}.contents{display:contents}#header{display:flex;align-items:center;gap:8px;width:510px;box-sizing:border-box;padding:8px}#title{margin-right:auto;min-width:60px}button{width:28px;height:28px;border:0;background:#eee}</style>
    <header id="header"><span id="title">Codex</span><div class="contents"><span class="contents"><button aria-label="搜索">搜</button></span></div><button id="notify" aria-label="通知">铃</button></header><div contenteditable="true" id="composer">用户未发送的草稿</div>`;
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1200,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}/` }));
  await client.evaluate(source);
  const api = "window.__codexConversationPreviewInjection__";
  await waitForBrowserState(client, "!!document.getElementById('aiyoucodex-reset-notice')", "Header notice mounted");
  const initialNow = Date.parse("2026-09-13T10:00:00Z");
  await client.evaluate(`window.__clock=${initialNow};Date.now=()=>window.__clock;window.__notifyClicks=0;document.getElementById('notify').onclick=()=>window.__notifyClicks++;`);
  const usage = { available: true, text: "本周剩余 94%", remainingPercent: 94, tone: "normal", ariaLabel: "本周剩余 94%",
    resetNotice: { checkStatus: "ok", lastSuccessAt: new Date(initialNow).toISOString(), lastCheckAt: new Date(initialNow).toISOString(), active: {
      status: "scheduled", verification: "rss", precision: "exact", targetAt: "2026-09-14T12:00:00Z", scope: "所有付费用户",
      summary: '<img src=x onerror="window.__unsafe=true">', sourceUrl: "https://x.com/thsottiaux/status/2099000000000000001",
    } } };
  await client.evaluate(`${api}.setUsage(${JSON.stringify(usage)});${api}.refresh()`);
  for (const width of [510, 450, 420]) {
    await client.evaluate(`document.getElementById('header').style.width='${width}px'`);
    const boxes = await client.evaluate(`['title','aiyoucodex-reset-notice','codex-conversation-usage-status','codex-conversation-view-toggle','codex-sidebar-shortcut-settings-button','notify'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,right:r.right,width:r.width}})`);
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x >= boxes[i - 1].right - 1, `No overlaps at ${width}px: ${JSON.stringify(boxes)}`);
    assert.ok(boxes.at(-1).right <= width, `Header stays within sidebar at ${width}: ${JSON.stringify(boxes)}`);
  }
  async function click(selector) {
    const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  }
  await click("#aiyoucodex-reset-notice");
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-reset-dialog').open"), true);
  assert.equal(await client.evaluate("window.__unsafe===true||!!document.querySelector('#aiyoucodex-reset-dialog img')"), false);
  assert.match(await client.evaluate("document.querySelector('[data-reset-details]').textContent"), /RSS 转发原帖/);
  await click("[aria-label='关闭重置公告']");
  assert.equal(await client.evaluate("document.getElementById('aiyoucodex-reset-dialog').open"), false);
  const colors = [];
  for (const remainingHours of [26, 12, 3, 0.25, 0]) {
    await client.evaluate(`window.__clock=${Date.parse(usage.resetNotice.active.targetAt)}-${remainingHours}*3600000;document.dispatchEvent(new Event('visibilitychange'))`);
    colors.push(await client.evaluate("document.getElementById('aiyoucodex-reset-notice').style.color"));
  }
  assert.equal(new Set(colors).size, 5);
  assert.match(await client.evaluate("document.getElementById('aiyoucodex-reset-notice').textContent"), /已到时 · 待核验/);
  assert.equal(await client.evaluate("document.querySelector('.codex-conversation-usage-value').textContent"), "94%");
  await click("#notify");
  assert.equal(await client.evaluate("window.__notifyClicks"), 1);
  assert.equal(await client.evaluate("document.getElementById('composer').textContent"), "用户未发送的草稿");
  usage.resetNotice.active = { status: "tentative", verification: "rss", targetAt: null };
  await client.evaluate(`${api}.setUsage(${JSON.stringify(usage)});${api}.refresh()`);
  assert.match(await client.evaluate("document.getElementById('aiyoucodex-reset-notice').textContent"), /时间待确认/);
  await client.evaluate(`${api}.destroy()`);
  assert.equal(await client.evaluate("document.querySelectorAll('#aiyoucodex-reset-notice,#aiyoucodex-reset-dialog').length"), 0);
  await client.evaluate(source);
  await waitForBrowserState(client, "document.querySelectorAll('#aiyoucodex-reset-notice').length===1", "Reinstall is idempotent");
  // Exercise the real settings form; only native scheduler I/O is substituted.
  await client.evaluate(`window.__monitorCalls=[];window.__monitor={available:true,configured:true,id:'fixture',revision:'v1',enabled:true,intervalHours:3,nextRunAt:Date.now()+10800000};
    window.__aiyoucodexResetMonitorRequest__=raw=>{const p=JSON.parse(raw);window.__monitorCalls.push(p);
      setTimeout(()=>{if(window.__monitorFail){${api}.resolveResetMonitorRequest({requestId:p.requestId,ok:false,error:'计划未确认，请刷新'});return;}
        if(p.action==='save')window.__monitor={...window.__monitor,intervalHours:p.intervalHours,enabled:p.enabled,revision:'v2'};
        ${api}.resolveResetMonitorRequest({requestId:p.requestId,ok:true,data:window.__monitor});},30);};`);
  await click("#codex-sidebar-shortcut-settings-button");
  await waitForBrowserState(client, "!document.querySelector('[data-reset-monitor-form] button[type=submit]').disabled", "Native monitor loaded");
  assert.equal(await client.evaluate("document.querySelector('[name=intervalHours]').value"), "3");
  await client.evaluate("document.querySelector('[name=intervalHours]').value='6';document.querySelector('[name=intervalHours]').dispatchEvent(new Event('input',{bubbles:true}))");
  await click("[data-reset-monitor-form] button[type=submit]");
  await waitForBrowserState(client, "document.querySelector('[data-reset-monitor-message]').textContent.includes('已核对生效')", "Saved schedule is acknowledged");
  assert.match(await client.evaluate("document.querySelector('[data-reset-monitor-summary]').textContent"), /每 6 小时/);
  await client.evaluate("document.querySelector('[name=intervalHours]').value='9';document.querySelector('[name=intervalHours]').dispatchEvent(new Event('input',{bubbles:true}));window.__monitorFail=true");
  await click("[data-reset-monitor-form] button[type=submit]");
  await waitForBrowserState(client, "document.querySelector('[data-reset-monitor-message]').dataset.error==='true'", "Failure is not success");
  assert.equal(await client.evaluate("document.querySelector('[name=intervalHours]').value"), "9");
  await client.evaluate("window.__monitorFail=false");
  await click("[data-reset-monitor-refresh]");
  await waitForBrowserState(client, "!document.querySelector('[data-reset-monitor-refresh]').disabled", "Refresh completed");
  assert.equal(await client.evaluate("document.querySelector('[name=intervalHours]').value"), "9", "Refresh preserves unsaved draft");
  await click("[data-codex-shortcut-settings-close]");
  await click("#codex-sidebar-shortcut-settings-button");
  await waitForBrowserState(client, "document.querySelector('[name=intervalHours]').value==='6'", "Reopen uses saved schedule");
  await client.evaluate("document.querySelector('[name=intervalHours]').value='0'");
  const saves = await client.evaluate("window.__monitorCalls.filter(p=>p.action==='save').length");
  await click("[data-reset-monitor-form] button[type=submit]");
  assert.equal(await client.evaluate("window.__monitorCalls.filter(p=>p.action==='save').length"), saves, "Invalid interval is not sent");
  await client.evaluate(`${api}.destroy()`);
});
