import {buildThemePackage} from '../lib/theme-build.mjs';
import {createThemeCustomization} from '../lib/theme-package.mjs';
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
test("card appearance maps native states, preserves alpha, previews and persists settings", {
  timeout: 45_000, skip: !executable && "Requires Chrome/Chromium",
}, async t => {
  const profile = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||tmpdir(), "aiyou-card-appearance-"));
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
  const built=await buildThemePackage('themes/mecha-control');
  // Use the real compiled CSS and runtime, with inert media for this host-free fixture.
  const bundle=JSON.parse(built.compiled.match(/window\.__AIYOUCODEX_THEME_BUNDLE__=(.*);\n/)[1]);
  const start=built.compiled.indexOf('window.__AIYOUCODEX_THEME_BUNDLE__=');
  const runtimeStart=built.compiled.indexOf(';\n',start)+2;
  bundle.poster='';bundle.staticImage='';bundle.media={};bundle.videos=null;
  await client.evaluate(built.compiled.slice(0,start)+'window.__AIYOUCODEX_THEME_BUNDLE__='+JSON.stringify(bundle)+';\n'+built.compiled.slice(runtimeStart));
  const theme='window.__AIYOUCODEX_THEME__';
  await client.evaluate(`${theme}.configure({cards:{styles:{running:{border:'#ff0000',background:'#223344',borderWidth:4,flow:'#00ff00',flowEnabled:true},completed:{border:'#00ff00'},interrupted:{border:'#ff00ff'},pending:{border:'#aaaaaa'}}},alpha:{card:.5,overall:.8,border:.4}})`);
  await state('active',false);await expect('running');
  const style=()=>client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(row)}),s=getComputedStyle(e),p=getComputedStyle(e,'::before');return {border:s.borderColor,width:s.borderWidth,bg:s.backgroundColor,flow:p.backgroundImage,animation:p.animationName,display:p.display,appearance:e.dataset.codexCardAppearanceState}})()`);
  let value=await style();assert.equal(value.width,'4px');assert.match(value.border,/1 0 0 \/ 0.4/);assert.match(value.bg,/\/ 0.4/);assert.match(value.flow,/0 1 0 \/ 0.4/);assert.equal(value.animation,'codex-running-border-flow');
  await state('idle',true);await expect('completed-unread');value=await style();assert.equal(value.appearance,'completed');assert.match(value.border,/0 1 0 \/ 0.4/);
  await state('idle',false);await expect('read');assert.equal((await style()).appearance,'completed');
  await client.evaluate(`${api}.setThreadExecutionStates([{threadId:${JSON.stringify(id)},runtimeStatus:'idle',turnStatus:'interrupted',revision:'stop-1'}])`);
  await expect('idle');value=await style();assert.equal(value.appearance,'interrupted');assert.match(value.border,/1 0 1 \/ 0.4/);
  await client.evaluate(`${api}.setActiveProjectThreads([]);${api}.setThreadExecutionStates([])`);await expect('idle');await waitForBrowserState(client,`document.querySelector(${JSON.stringify(row)}).dataset.codexCardAppearanceState==='pending'`,'Appearance refreshes to pending');
  await client.evaluate(`${theme}.configure({cards:{mode:'static',styles:{static:{border:'#123456',background:'#456789',borderWidth:2,flow:'#fedcba',flowEnabled:true}}}})`);
  const neutral=await style();await state('active',false);await expect('running');const running=await style();assert.equal(running.border,neutral.border);assert.equal(running.bg,neutral.bg);assert.equal(running.animation,'none');assert.equal(running.width,'2px');
  await client.evaluate(`${theme}.configure({cards:{mode:'dynamic'},motion:false})`);assert.equal((await style()).animation,'none');
  await client.evaluate(`${theme}.configure({motion:true})`);await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal((await style()).animation,'none');await client.send('Emulation.setEmulatedMedia',{features:[]});
  const original=await client.evaluate(`${theme}.getState().prefs.cards`);
  await client.evaluate(`${theme}.openSettings()`);
  assert.equal(await client.evaluate(`document.querySelectorAll('[data-card-style]').length`),5);
  await client.evaluate(`(()=>{const e=document.querySelector('[data-card-mode]');e.value='static';e.dispatchEvent(new Event('input',{bubbles:true}));const c=document.querySelector('[data-card-style="static"] [data-card-color="border"]');c.value='#abcdef';c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await client.evaluate(`${theme}.getState().prefs.cards.styles.static.border`),'#abcdef');
  await client.evaluate(`document.querySelector('[data-cancel]').click()`);
  await waitForBrowserState(client,`!document.querySelector('#aiyou-theme-settings')?.open`,'Cancel closes settings');assert.deepEqual(await client.evaluate(`${theme}.getState().prefs.cards`),original);
  await client.evaluate(`${theme}.openSettings();(()=>{const e=document.querySelector('[data-card-mode]');e.value='static';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-theme-close]').click();})()`);
  await waitForBrowserState(client,`!document.querySelector('#aiyou-theme-settings')?.open`,'Save closes settings');
  const key=await client.evaluate(`Object.keys(localStorage).find(k=>k.startsWith('aiyoucodex.theme.')&&!k.includes('catalog'))`);assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).cards.mode`),'static');
  await client.evaluate(`${theme}.configure({enabled:false})`);assert.notEqual((await style()).width,'4px');
});

test('old card preferences migrate and invalid colors, width and state keys cannot enter CSS',()=>{
 const c=createThemeCustomization({surface:'#112233'});const p=c.normalize({alpha:{card:.2},cards:{mode:'bad',styles:{running:{border:'url(secret)',borderWidth:999},publish:{border:'#ffffff'}}}});
 assert.equal(p.alpha.card,.2);assert.equal(p.cards.mode,'dynamic');assert.equal(p.cards.styles.running.borderWidth,8);assert.notEqual(p.cards.styles.running.border,'url(secret)');assert.equal(p.cards.styles.publish,undefined);assert.equal(c.normalize({cards:{styles:{static:{borderWidth:NaN}}}}).cards.styles.static.borderWidth,1);
 assert.equal(createThemeCustomization({cardDefaults:{mode:'static'}}).normalize().cards.mode,'static');
});
