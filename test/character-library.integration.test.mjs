import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { connectFixtureBrowser, waitForBrowserState } from "./helpers/browser-state.mjs";

test("character API persists revisions and browser editing keeps preview/reference actions", {timeout:60000}, async t => {
  const root=await mkdtemp(path.join(tmpdir(),"aiyou-character-library-")), folder=path.join(root,"角色"), profile=path.join(root,"browser");
  await mkdir(folder); await mkdir(profile);
  // Valid image fixture: a tiny decoded PNG, never user assets.
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
  await Promise.all(["韩立_日常.png","南宫婉_写实.png","韩立_战斗.png","unknown.png"].map(name=>writeFile(path.join(folder,name),bytes)));
  const probe=createServer(); await new Promise(r=>probe.listen(0,"127.0.0.1",r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const token="character-integration-only-token-00000001";
  const env={...process.env,PORT:String(port),ASSET_BROWSER_API_TOKEN:token};
  for(const [key,file] of Object.entries({ASSET_BROWSER_CONFIG:"config.json",ASSET_BROWSER_LEDGER:"ledger.json",GENERATION_TICKETS:"generation.json",GENERATION_THREAD_BINDINGS:"bindings.json",CODEX_PROMPT_ASSOCIATIONS:"associations.json",ASSET_LIBRARY_INDEX:"index.json",CODEX_SESSIONS_ROOT:"sessions",CODEX_GENERATED_IMAGES_ROOT:"images",CODEX_GLOBAL_STATE:"global.json",CODEX_SESSION_INDEX:"sessions.jsonl",DUPLICATE_CLEANUP_LEDGER:"duplicates.json",DUPLICATE_QUARANTINE:"quarantine",RHYTHM_CONTROL_REGISTRY:"rhythm.json",PROMPT_LIBRARY_ROOT:"prompts",THREE_D_TASKS:"three-d.json",ASSET_ACTION_TRASH:"trash"}))env[key]=path.join(root,file);
  await writeFile(env.CODEX_GLOBAL_STATE,"{}"); await writeFile(env.CODEX_SESSION_INDEX,""); await mkdir(env.CODEX_SESSIONS_ROOT); await mkdir(env.CODEX_GENERATED_IMAGES_ROOT);
  let service, browser, client, logs="";
  const start=()=>{service=spawn(process.execPath,[fileURLToPath(new URL("../vendor/codex-workspace-enhancer/asset-browser/server.js",import.meta.url))],{env,stdio:["ignore","pipe","pipe"]});service.stderr.on("data",d=>logs+=d);};
  const stop=async()=>{if(service?.exitCode===null){const exit=new Promise(r=>service.once("exit",r));service.kill("SIGTERM");await Promise.race([exit,delay(2000)]);if(service.exitCode===null)service.kill("SIGKILL");}};
  const raw=(route,opts={})=>fetch(`http://127.0.0.1:${port}${route}`,{...opts,headers:{"content-type":"application/json","x-asset-console-token":token}});
  const api=async(route,opts={})=>{const r=await raw(route,opts),json=await r.json();assert.ok(r.ok,json.error||r.status);return json;};
  const ready=async()=>{for(let i=0;i<100;i++){try{await api("/api/config");return;}catch{}await delay(40);}assert.fail(logs);};
  t.after(async()=>{client?.close();if(browser?.exitCode===null){const exit=new Promise(r=>browser.once("exit",r));browser.kill("SIGTERM");await Promise.race([exit,delay(2000)]);if(browser.exitCode===null)browser.kill("SIGKILL");}await stop();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  start(); await ready();
  const project=(await api("/api/projects",{method:"POST",body:JSON.stringify({name:"角色关联验证",folders:[folder]})})).project;
  const listing=await api(`/api/library?project=${project.id}&limit=120`);
  const base=listing.assets.find(a=>a.name==="韩立_日常.png"), child=listing.assets.find(a=>a.name==="韩立_战斗.png"), unknown=listing.assets.find(a=>a.name==="unknown.png");
  assert.ok(base&&child&&unknown); assert.equal(base.character.count,2);
  const context=()=>api(`/api/assets/character?project=${project.id}&id=${encodeURIComponent(unknown.id)}`);
  const initial=await context();
  const patch={projectId:project.id,assetId:unknown.id,revision:initial.revision,character:{name:"韩立",state:"受伤",style:"水墨",parentAssetId:base.id}};
  await api("/api/assets/character",{method:"PATCH",body:JSON.stringify(patch)});
  assert.equal((await context()).asset.character.style,"水墨");
  assert.equal((await raw("/api/assets/character",{method:"PATCH",body:JSON.stringify(patch)})).status,409);
  const baseContext=await api(`/api/assets/character?project=${project.id}&id=${encodeURIComponent(base.id)}`);
  const cyclic=await raw("/api/assets/character",{method:"PATCH",body:JSON.stringify({projectId:project.id,assetId:base.id,revision:baseContext.revision,character:{name:"韩立",parentAssetId:unknown.id}})});
  assert.equal(cyclic.ok,false);
  const wrong=await raw(`/api/assets/character?project=not-this-project&id=${encodeURIComponent(base.id)}`); assert.equal(wrong.ok,false);
  await stop(); start(); await ready();
  assert.equal((await context()).asset.character.state,"受伤","manual relationship survives service restart");
  const renamed=await api("/api/assets/rename",{method:"POST",body:JSON.stringify({assetId:base.id,name:"韩立_基准.png"})});
  assert.equal((await context()).asset.character.parentAssetId,renamed.result.assetId,"renaming a base preserves children");
  assert.equal((await context()).relativeTotal,3,"renaming retains the inferred base identity, not only its file pointer");
  assert.deepEqual(await readFile(path.join(folder,"unknown.png")),bytes,"association never changes source bytes");

  let executable;
  for(const candidate of [process.env.AIYOUCODEX_TEST_BROWSER,"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/usr/bin/google-chrome","/usr/bin/chromium"].filter(Boolean)){try{await access(candidate);executable=candidate;break;}catch{}}
  assert.ok(executable,"Browser verification requires Chrome");
  browser=spawn(executable,["--headless=new","--no-sandbox","--no-first-run","--no-default-browser-check","--disable-extensions","--window-size=1280,900","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  ({client}=await connectFixtureBrowser({browser,profile,url:"about:blank"}));
  await client.send("Network.enable"); await client.send("Network.setExtraHTTPHeaders",{headers:{"x-asset-console-token":token}});
  await client.send("Page.navigate",{url:`http://127.0.0.1:${port}`});
  await waitForBrowserState(client,"document.querySelectorAll('.image-card').length===4","Real asset UI loads images");
  assert.equal(await client.evaluate("document.body.dataset.libraryView"),"thumbnail");
  assert.ok(await client.evaluate("document.querySelector('.library-sidebar #categoryChips')!==null"));
  await client.evaluate(`document.querySelector('[data-asset-id=${JSON.stringify(unknown.id)}] .character-badge').click()`);
  await waitForBrowserState(client,"document.getElementById('characterDialog').open&&!document.getElementById('saveCharacterButton').disabled","Character editor is interactive");
  assert.equal(await client.evaluate("document.getElementById('characterState').value"),"受伤");
  await client.evaluate("document.getElementById('characterState').value='觉醒';document.getElementById('saveCharacterButton').click()");
  await waitForBrowserState(client,"!document.getElementById('characterDialog').open","Confirmation saves and closes");
  assert.equal((await context()).asset.character.state,"觉醒");
  await client.evaluate("window.__assetMessages=[];Object.defineProperty(window,'parent',{value:{postMessage:m=>window.__assetMessages.push(m)},configurable:true});true");
  const point=await client.evaluate("(()=>{const r=document.querySelector('.image-card img').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  for (const clickCount of [1,2]) {
    await client.send("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount});
    await client.send("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount});
    if (clickCount===1) assert.equal(await client.evaluate("document.getElementById('mediaPreviewDialog').open"),false,"Single click must not interrupt double-click preview");
  }
  await waitForBrowserState(client,"document.getElementById('mediaPreviewDialog').open","Double click opens image preview and details");
  assert.equal(await client.evaluate("window.__assetMessages.some(m=>m.action==='use-in-codex')"),false,"Preview must never reference the asset automatically");
  await client.evaluate("document.getElementById('mediaPreviewDialog').close();document.querySelector('.image-card [data-action=use-in-codex]').click()");
  await waitForBrowserState(client,"window.__assetMessages.some(m=>m.action==='use-in-codex')","Explicit menu action retains Codex asset reference");
  await client.evaluate("document.getElementById('detailViewButton').click()");
  assert.equal(await client.evaluate("document.body.dataset.libraryView"),"detail");
  await client.evaluate("document.getElementById('thumbnailViewButton').click()");
  const layout=await client.evaluate("(()=>{const r=document.querySelector('.image-card').getBoundingClientRect();return {width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};})()");
  assert.ok(layout.width<190&&layout.height<280,JSON.stringify(layout)); assert.equal(layout.overflow,false);
  if(process.env.AIYOUCODEX_ASSET_SCREENSHOT){const screenshot=await client.send("Page.captureScreenshot",{format:"png"});await writeFile(process.env.AIYOUCODEX_ASSET_SCREENSHOT,Buffer.from(screenshot.data,"base64"));}
  await client.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert.ok(await client.evaluate("document.documentElement.scrollWidth<=innerWidth"),"Compact view fits narrow screens");
});
