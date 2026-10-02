import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectMainCodex, readTargets, CdpClient } from "./cdp-client.mjs";

const output=process.argv[2];
assert.ok(output && path.isAbsolute(output),"Pass the conversation output directory");
const main=await connectMainCodex(); let frame;
async function wait(read,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{const result=await read();if(result)return result;}catch{}await delay(100);}throw new Error(message);}
try {
  const opened=await main.evaluate("(()=>{const button=[...document.querySelectorAll('[data-codex-sidebar-shortcut-card]')].find(b=>b.dataset.codexSidebarShortcutName==='资产控制台');if(document.getElementById('codex-asset-console-page')?.hidden!==false)button?.click();return Boolean(button);})()");
  assert.ok(opened,"Asset Console entry exists");
  const target=await wait(async()=> (await readTargets()).find(t=>t.type==="iframe"&&t.url.includes("/__codex_asset_console__/")),"Embedded frame did not open");
  frame=new CdpClient(target.webSocketDebuggerUrl,{requestTimeoutMs:15000}); await frame.connect();
  await wait(()=>frame.evaluate("document.readyState==='complete'&&!!document.getElementById('characterDialog')"),"Installed character UI did not load");
  await wait(()=>frame.evaluate("document.querySelectorAll('.project-item').length>0&&!document.getElementById('scanState').classList.contains('busy')"),"Project index did not load",35000);
  assert.equal(await frame.evaluate("document.querySelectorAll('dialog[open]').length"),0,"Do not replace a user draft dialog");
  await frame.evaluate("document.querySelector('[data-asset-kind=image]').click();document.getElementById('thumbnailViewButton').click()");
  await wait(()=>frame.evaluate("document.querySelectorAll('.image-card').length>0&&!document.getElementById('scanState').classList.contains('busy')"),"Selected project has no visible formal images",35000);
  const layout=await frame.evaluate("(()=>{const r=document.querySelector('.image-card').getBoundingClientRect();return {view:document.body.dataset.libraryView,projects:document.querySelectorAll('.project-item').length,cards:document.querySelectorAll('.image-card').length,cardWidth:Math.round(r.width),cardHeight:Math.round(r.height),sidebarCategories:!!document.querySelector('.library-sidebar #categoryChips'),overflow:document.documentElement.scrollWidth>innerWidth};})()");
  assert.equal(layout.view,"thumbnail"); assert.equal(layout.sidebarCategories,true); assert.equal(layout.overflow,false);
  await wait(()=>frame.evaluate("(()=>{const images=[...document.querySelectorAll('.image-card img')].filter(i=>{const r=i.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});return images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0);})()"),"Visible thumbnails did not decode",35000);
  const clip=await main.evaluate("(()=>{const r=document.getElementById('codex-asset-console-frame').getBoundingClientRect(),x=Math.max(0,r.x),y=Math.max(0,r.y);return {x,y,width:Math.min(r.right,innerWidth)-x,height:Math.min(r.bottom,innerHeight)-y,scale:1};})()");
  const screenshot=await main.send("Page.captureScreenshot",{format:"png",clip}); await writeFile(path.join(output,"资产库-本机新布局.png"),Buffer.from(screenshot.data,"base64"));
  await frame.evaluate("(()=>{const cards=[...document.querySelectorAll('.image-card')];const card=cards.find(c=>/ · [2-9]\\d*/.test(c.querySelector('.character-badge').textContent))||cards.find(c=>c.dataset.characterGroup)||cards[0];card.dataset.verifyingCharacter='true';card.scrollIntoView({block:'center'});card.focus();})()");
  const hit=await frame.evaluate("(()=>{const b=document.querySelector('[data-verifying-character] .character-badge'),r=b.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return b===h||b.contains(h);})()");
  assert.equal(hit,true,"Character action must not be covered");
  await frame.evaluate("document.querySelector('[data-verifying-character] .character-badge').click()");
  await wait(()=>frame.evaluate("document.getElementById('characterDialog').open&&!document.getElementById('saveCharacterButton').disabled"),"Character editor could not load current asset");
  await frame.evaluate("document.getElementById('findSimilarCharacters').click()");
  const evidence=await frame.evaluate("document.getElementById('characterEvidence').textContent");
  assert.match(evidence,/本地比较|尚未加载|无法在本地/);
  const saveHit=await frame.evaluate("(()=>{const b=document.getElementById('saveCharacterButton'),r=b.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return b===h||b.contains(h);})()");
  assert.equal(saveHit,true,"Confirm action remains visible and clickable");
  await frame.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const relationScreenshot=await main.send("Page.captureScreenshot",{format:"png",clip});await writeFile(path.join(output,"资产库-角色关联.png"),Buffer.from(relationScreenshot.data,"base64"));
  await frame.evaluate("document.getElementById('characterDialog').close();document.querySelector('.image-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await wait(()=>frame.evaluate("document.getElementById('mediaPreviewDialog').open"),"Double image click did not preview");
  await frame.evaluate("document.getElementById('mediaPreviewDialog').close()");
  console.log(JSON.stringify({installed:true,layout,evidence,checks:["embedded module loads","thumbnail toolbar and sidebar","character button unobstructed","character context API","local candidate check","image preview"],output},null,2));
} finally {frame?.close();main.close();}
