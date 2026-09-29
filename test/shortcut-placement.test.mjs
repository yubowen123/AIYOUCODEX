import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const candidates = [process.env.AIYOUCODEX_TEST_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, "Google/Chrome/Application/chrome.exe"))].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }

// The installed host conditionally removes quick chat. Its new-chat button is
// also wrapped for drag/drop; the next ancestor with two buttons is then the
// ENTIRE header (product picker + search), not a new-chat action row.
function header(quick = false, wrapped = true) {
  const chat = '<button aria-label="New chat"><span class="text-fade-truncate">New chat</span></button>';
  return `<div id="native-header" class="header">
    <div id="native-toolbar" class="toolbar"><button>Codex</button><div class="controls"><span><button aria-label="Search">Search</button></span><span><button aria-label="Notifications">Bell</button></span></div></div>
    <div class="action-group"><div class="chat-row">${wrapped ? `<div class="drag-wrapper">${chat}</div>` : chat}${quick ? '<div><button aria-label="Start an instant chat">Quick</button></div>' : ''}</div></div>
  </div>`;
}

test("shortcut grid stays above conversations with optional quick chat, rerenders and sidebar resizing", {
  timeout: 40_000,
  skip: !executable && process.env.AIYOUCODEX_REQUIRE_BROWSER !== "1" && "Requires isolated Chrome/Chromium",
}, async t => {
  assert.ok(executable);
  const root = await mkdtemp(path.join(tmpdir(), "aiyoucodex-shortcut-placement-"));
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end(`<style>
      *{box-sizing:border-box}body{margin:0;display:flex;height:100vh;font:13px sans-serif;background:#f8fafc}button{min-height:28px}aside{width:520px;height:100%;padding-top:36px;display:flex;flex-direction:column;border-right:1px solid #ddd}nav{display:flex;flex-direction:column;flex:1;min-height:0}.header{flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding:8px}.toolbar,.controls,.chat-row{display:flex;align-items:center}.controls{margin-left:auto}.drag-wrapper{flex:1}[data-app-action-sidebar-scroll]{flex:1;min-height:0;overflow:auto;padding:8px}footer{height:40px;flex-shrink:0;border-top:1px solid #ddd}main{flex:1}.thread-content{height:1200px}
    </style><aside id="app-shell-sidebar"><nav aria-label="Scheduled task folders">${header()}
      <div data-app-action-sidebar-scroll><div id="destinations"><button aria-label="Pull requests">Pull requests</button><button aria-label="Scheduled">Scheduled</button><button aria-label="Plugins">Plugins</button></div><div id="project-content" class="thread-content">Projects and conversations</div></div>
    </nav><footer><button id="profile">Profile</button><button id="footer-new-chat" aria-label="New chat">Footer new chat</button></footer></aside><main><div contenteditable="true">Keep my draft</div></main>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(root, "browser");
  const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1200,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let client;
  t.after(async () => {
    client?.close(); browser.kill("SIGTERM");
    await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(2000)]);
    if (browser.exitCode == null) browser.kill("SIGKILL");
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ({ client } = await connectFixtureBrowser({ browser, profile, url: `http://127.0.0.1:${server.address().port}/` }));
  await client.evaluate(`window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__=[{id:'private-example',name:'Private tool',url:'https://example.test',icon:'tv',openMode:'in-app'}];window.chatClicks=0;document.addEventListener('click',e=>{if(e.target.closest('#native-header [aria-label="New chat"],#native-header [aria-label="新聊天"]')&&!e.target.closest('#codex-sidebar-shortcut-grid'))window.chatClicks++;});`);
  await client.evaluate(source);
  const grid = "document.getElementById('codex-sidebar-shortcut-grid')";
  await waitForBrowserState(client, `!!${grid}`, "Shortcut grid exists");

  async function verifyPosition(label) {
    const state = await client.evaluate(`(()=>{const grid=${grid},header=document.getElementById('native-header'),toolbar=document.getElementById('native-toolbar'),content=document.querySelector('[data-app-action-sidebar-scroll]'),footer=document.querySelector('footer'),r=grid?.getBoundingClientRect(),h=toolbar.getBoundingClientRect(),c=content.getBoundingClientRect(),f=footer.getBoundingClientRect();return {insideHeader:header.contains(grid),headerVisible:h.height>0,gridTop:r?.top,gridBottom:r?.bottom,toolbarBottom:h.bottom,contentTop:c.top,footerTop:f.top,count:document.querySelectorAll('#codex-sidebar-shortcut-grid').length,quickCount:grid?.querySelectorAll('[data-codex-sidebar-shortcut-quick]').length,quickLabel:grid?.querySelector('[data-codex-sidebar-shortcut-quick]')?.getAttribute('aria-label'),hiddenHeader:!!toolbar.closest('[data-codex-sidebar-shortcut-source-hidden],[data-codex-sidebar-shortcut-source-group-hidden]'),privateCount:grid?.querySelectorAll('[data-codex-sidebar-shortcut-managed="private-example"]').length,draft:document.querySelector('[contenteditable]').textContent};})()`);
    assert.equal(state.insideHeader, true, `${label}: mount in header, never append at nav bottom`);
    assert.equal(state.headerVisible, true, `${label}: product/usage/search header stays visible`);
    assert.equal(state.hiddenHeader, false, `${label}: do not hide a toolbar ancestor`);
    assert.ok(state.gridTop >= state.toolbarBottom, `${label}: below native toolbar`);
    assert.ok(state.gridBottom <= state.contentTop, `${label}: above scrolling conversations`);
    assert.ok(state.gridBottom <= state.footerTop, `${label}: no overlap with profile/voice`);
    assert.equal(state.count, 1);
    assert.equal(state.privateCount, 1);
    assert.equal(state.draft, "Keep my draft");
    return state;
  }
  assert.equal((await verifyPosition("without quick chat")).quickCount, 0, "Do not mistake the product picker for quick chat");
  // Recover from a previous runtime's misplaced grid and hidden titlebar.
  await client.evaluate(`document.querySelector('nav').append(${grid});document.getElementById('native-header').setAttribute('data-codex-sidebar-shortcut-source-hidden','true')`);
  await waitForBrowserState(client, `document.getElementById('native-header').contains(${grid})&&!document.getElementById('native-header').hasAttribute('data-codex-sidebar-shortcut-source-hidden')`, "Recover wrong-parent mount and stale hiding");
  await verifyPosition("recovered old placement");
  await client.evaluate(`document.querySelector('.chat-row').insertAdjacentHTML('beforeend','<button id="optional-quick" aria-label="Start an instant chat">Quick</button>')`);
  await waitForBrowserState(client, `!!${grid}?.querySelector('[data-codex-sidebar-shortcut-quick]')`, "Optional quick chat can appear without replacing the native new-chat button");
  await client.evaluate(`document.getElementById('optional-quick').remove()`);
  await waitForBrowserState(client, `!${grid}?.querySelector('[data-codex-sidebar-shortcut-quick]')`, "Optional quick chat can disappear without replacing the native new-chat button");
  await verifyPosition("conditional quick chat removed");
  for (const variant of [{ quick: true, wrapped: true }, { quick: false, wrapped: false }, { quick: false, wrapped: true }]) {
    await client.evaluate(`document.getElementById('native-header').outerHTML=${JSON.stringify(header(variant.quick, variant.wrapped))}`);
    await waitForBrowserState(client, `document.getElementById('native-header').contains(${grid})`, "Native header replacement remounts one grid");
    const state = await verifyPosition(JSON.stringify(variant));
    assert.equal(state.quickCount, variant.quick ? 1 : 0);
    if (variant.quick) assert.equal(state.quickLabel, "Start an instant chat");
  }
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="新对话"]').click()`);
  assert.equal(await client.evaluate("window.chatClicks"), 1, "Resolve the replacement native action at click time");
  for (const width of [340, 520, 700]) {
    await client.evaluate(`document.getElementById('app-shell-sidebar').style.width='${width}px'; document.querySelector('[data-app-action-sidebar-scroll]').scrollTop=250; window.dispatchEvent(new Event('resize'))`);
    await verifyPosition(`width ${width}`);
  }
  // A host update must not nominate the footer's similarly named action.
  await client.evaluate(`document.getElementById('native-header').remove()`);
  await waitForBrowserState(client, `!${grid}`, "Missing header does not create shortcuts in footer", 5000);
  assert.equal(await client.evaluate("document.getElementById('profile').getBoundingClientRect().height>0"), true);

  // New host fixture: independent icon rail, including a shorter native group.
  const rail = `<div id="native-rail" style="width:72px;flex:0 0 72px;height:calc(100vh - 36px);margin-top:36px"><div id="native-rail-actions">${['Home', 'History', 'Library', 'Images', 'More'].map(name => `<button aria-label="${name}" style="display:block;width:48px;height:44px;margin:0 auto">${name}</button>`).join('')}</div></div>`;
  await client.evaluate(`document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(rail)});document.querySelector('#app-shell-sidebar nav').insertAdjacentHTML('afterbegin',${JSON.stringify(header().replaceAll('New chat', '新聊天'))});window.__codexTaskboardInjection__={open(){document.documentElement.setAttribute('data-codex-taskboard-open','true')},close(){document.documentElement.removeAttribute('data-codex-taskboard-open')}}`);
  await waitForBrowserState(client, `${grid}?.dataset.codexShortcutLayout==='rail'`, "Upgrade mounts in icon rail");
  async function verifyRail() {
    const state = await client.evaluate(`(()=>{const g=${grid},r=document.getElementById('native-rail').getBoundingClientRect(),b=g.getBoundingClientRect();return{parent:g.parentElement.id,top:b.top,bottom:b.bottom,railBottom:r.bottom,native:document.querySelectorAll('#native-rail-actions button').length,names:[...g.querySelectorAll('[data-codex-sidebar-shortcut-name]')].map(b=>b.dataset.codexSidebarShortcutName),health:window.__codexConversationPreviewInjection__.getHealth(),headerControls:document.querySelectorAll('#native-toolbar #codex-conversation-view-toggle,#native-toolbar #codex-sidebar-shortcut-settings-button').length}})()`);
    assert.equal(state.parent, 'native-rail', 'Use full-height rail, not inner native group');
    assert.ok(state.bottom <= state.railBottom + 1, JSON.stringify(state));
    assert.equal(state.native, 5, 'Preserve host rail actions');
    for (const name of ['新对话', 'Private tool', '模型竞技场', 'Skills 分组', '项目管理', '设置']) assert.ok(state.names.includes(name), name);
    assert.equal(state.headerControls, 0);
    assert.equal(state.health.components.header, 'ready', 'Settings-only toggle is not a missing header');
  }
  await verifyRail();
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="项目管理"]').click()`);
  assert.equal(await client.evaluate("document.documentElement.getAttribute('data-codex-taskboard-open')"), 'true');
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="项目管理"]').click()`);
  assert.equal(await client.evaluate("document.documentElement.hasAttribute('data-codex-taskboard-open')"), false);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-settings]').scrollIntoView();document.querySelector('[data-codex-sidebar-shortcut-settings]').click()`);
  assert.equal(await client.evaluate("document.querySelector('#codex-conversation-view-toggle').closest('dialog').open"), true);
  const view = await client.evaluate("document.documentElement.getAttribute('data-codex-conversation-view')");
  await client.evaluate("document.getElementById('codex-conversation-view-toggle').click()");
  assert.notEqual(await client.evaluate("document.documentElement.getAttribute('data-codex-conversation-view')"), view);
  await client.evaluate(`document.querySelector('[aria-label="显示模型竞技场"]').click()`);
  await waitForBrowserState(client, `!${grid}?.querySelector('[data-codex-sidebar-shortcut-name="模型竞技场"]')`, 'Settings hides optional entry');
  await client.evaluate(`document.querySelector('[aria-label="显示模型竞技场"]').click();document.querySelector('[data-codex-shortcut-settings-close]').click()`);
  await waitForBrowserState(client, `!!${grid}?.querySelector('[data-codex-sidebar-shortcut-name="模型竞技场"]')`, 'Settings restores optional entry');
  await client.evaluate(`document.getElementById('native-rail').outerHTML=${JSON.stringify(rail)}`);
  await waitForBrowserState(client, `document.querySelectorAll('#native-rail #codex-sidebar-shortcut-grid').length===1`, 'Host redraw restores rail entries');
  await verifyRail();
  await client.send('Emulation.setDeviceMetricsOverride', {width:1000,height:600,deviceScaleFactor:1,mobile:false});
  await client.evaluate('window.__codexConversationPreviewInjection__.refresh()');
  await verifyRail();

  // Source-backed September host shape: labelled sr-only children (NOT
  // aria-label on destination buttons), an inner flexing scroll area and a
  // fixed profile/help footer. Geometry alone cannot identify this rail.
  const markedRail = `<nav id="native-rail" data-app-navigation-rail="true" aria-label="App navigation" style="display:flex;flex-direction:column;align-items:center;flex:0 0 52px;width:52px;height:calc(100vh - 36px);margin-top:36px;padding:4px 8px;gap:8px">
    <div aria-hidden="true" style="position:absolute;pointer-events:none"></div>
    <div id="rail-scroll" style="display:flex;flex-direction:column;align-items:center;flex:1;min-height:0;overflow-y:auto;width:100%;gap:8px">
      ${['Home','History','Library','Images','More'].map(name => `<div style="flex-shrink:0"><button data-sidebar-destination="${name}" style="position:relative;display:block;width:36px;height:36px"><svg width="20" height="20"></svg><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">${name}</span></button></div>`).join('')}
    </div><div id="rail-footer" style="flex-shrink:0"><button aria-label="Help" style="width:36px;height:36px">?</button><button aria-label="Profile" style="width:36px;height:36px">P</button></div></nav>`;
  await client.evaluate(`document.getElementById('native-rail').outerHTML=${JSON.stringify(markedRail)}`);
  await waitForBrowserState(client, `${grid}?.dataset.codexShortcutLayout==='rail'&&document.getElementById('rail-scroll').contains(${grid})`, 'Real host semantic rail and scrolling slot are recognized without aria-labelled destinations');
  async function verifyMarkedRail(label) {
    const state = await client.evaluate(`(()=>{const g=${grid},rail=document.getElementById('native-rail'),scroll=document.getElementById('rail-scroll'),footer=document.getElementById('rail-footer');const r=rail.getBoundingClientRect(),f=footer.getBoundingClientRect();return{parent:g.parentElement.id,count:document.querySelectorAll('#codex-sidebar-shortcut-grid').length,horizontal:document.querySelectorAll('#app-shell-sidebar #codex-sidebar-shortcut-grid').length,footerVisible:f.bottom<=r.bottom+1&&f.top>=r.top,scrollBottom:scroll.getBoundingClientRect().bottom,footerTop:f.top,railOverflow:rail.scrollHeight>rail.clientHeight+1,buttonFits:[...g.querySelectorAll('[data-codex-sidebar-shortcut-card]')].every(b=>{const q=b.getBoundingClientRect();return q.left>=r.left&&q.right<=r.right}),labelsHidden:[...g.querySelectorAll('.codex-sidebar-shortcut-label')].every(b=>b.clientWidth<=1&&getComputedStyle(b).clipPath==='inset(50%)'),nativeCount:rail.querySelectorAll('[data-sidebar-destination]').length,draft:document.querySelector('[contenteditable]').textContent}})()`);
    assert.equal(state.parent, 'rail-scroll', label);
    assert.equal(state.count, 1, label);
    assert.equal(state.horizontal, 0, 'Never leave a duplicate horizontal row');
    assert.ok(state.footerVisible && !state.railOverflow, `${label}: keep account/help anchored ${JSON.stringify(state)}`);
    assert.ok(state.scrollBottom <= state.footerTop + 1, label);
    assert.ok(state.buttonFits && state.labelsHidden, `${label}: icon-only and no widening`);
    assert.equal(state.nativeCount, 5);
    assert.equal(state.draft, 'Keep my draft');
  }
  await verifyMarkedRail('semantic rail');
  for (const zoom of [0.8, 1.5, 2.2]) {
    await client.evaluate(`document.getElementById('native-rail').style.zoom='${zoom}';document.getElementById('native-rail').style.height='calc((100vh - 36px) / ${zoom})';window.__codexConversationPreviewInjection__.refresh()`);
    await verifyMarkedRail(`host zoom ${zoom}`);
  }
  await client.evaluate(`document.getElementById('native-rail').style.zoom='1';document.getElementById('native-rail').style.height='calc(100vh - 36px)';${grid}.replaceWith(${grid}.cloneNode(true))`);
  await waitForBrowserState(client, `typeof ${grid}?.querySelector('[data-codex-sidebar-shortcut-settings]').onclick==='function'`, 'Cloned rail gets working handlers');
  await client.evaluate(`${grid}.querySelector('[data-codex-sidebar-shortcut-name="新对话"]').click()`);
  assert.equal(await client.evaluate('window.chatClicks'), 2);
  await client.evaluate(`${grid}.querySelector('[data-codex-sidebar-shortcut-settings]').scrollIntoView();${grid}.querySelector('[data-codex-sidebar-shortcut-settings]').click()`);
  assert.equal(await client.evaluate("document.querySelector('#codex-conversation-view-toggle').closest('dialog').open"), true);
  await client.evaluate("document.querySelector('[data-codex-shortcut-settings-close]').click()");
  await client.evaluate(`${grid}.querySelector('[data-codex-sidebar-shortcut-name="模型竞技场"]').remove()`);
  await waitForBrowserState(client, `!!${grid}?.querySelector('[data-codex-sidebar-shortcut-name="模型竞技场"]')`, 'Partial rail removal self-heals');
  await client.evaluate(`document.getElementById('native-rail').outerHTML=${JSON.stringify(markedRail)}`);
  await waitForBrowserState(client, `document.getElementById('rail-scroll').contains(${grid})`, 'Whole semantic rail replacement self-heals');
  await verifyMarkedRail('redrawn semantic rail');
  if (process.env.AIYOUCODEX_TEST_SCREENSHOT) {
    const { data } = await client.send('Page.captureScreenshot', {format:'png'});
    await writeFile(process.env.AIYOUCODEX_TEST_SCREENSHOT, Buffer.from(data, 'base64'));
  }
  await client.evaluate('window.__codexConversationPreviewInjection__.destroy()');
  assert.equal(await client.evaluate("document.querySelectorAll('[data-aiyoucodex-icon-rail]').length"), 0);
});
