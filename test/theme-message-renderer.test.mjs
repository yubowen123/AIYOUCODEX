import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {buildThemePackage} from '../lib/theme-build.mjs';
import {connectFixtureBrowser} from './helpers/browser-state.mjs';
const candidates=[process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium',...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;for(const p of candidates){try{await access(p);executable=p;break;}catch{}}

test('compiled pink bubbles keep matched insets and material through streaming, narrow columns and theme fallback', {timeout:30000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome required'},async t=>{
 assert.ok(executable);
 const profile=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'aiyou-message-ui-'));
 const server=createServer((_,r)=>r.end('<title>Isolated message geometry</title>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=spawn(executable,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let client;t.after(async()=>{client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1000)]);if(browser.exitCode==null)browser.kill('SIGKILL');await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 const built=await buildThemePackage('themes/pink-candy');
 const bundle=JSON.parse(built.compiled.match(/window\.__AIYOUCODEX_THEME_BUNDLE__=(.*);\n/)[1]);
 const {frameTree}=await client.send('Page.getFrameTree');
 await client.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:`<style>body{margin:0}main{width:900px;max-width:100vw;box-sizing:border-box;padding:20px;--thread-content-margin:16px}.turn{margin:24px 0;min-width:0}.user-row{display:flex;justify-content:flex-end}[data-user-message-bubble]{padding:10px 16px;border-radius:16px;background:#ddd;overflow-wrap:anywhere;max-width:80%;box-sizing:border-box}[data-markdown-text-style]{min-width:0;overflow-wrap:anywhere}p,ul,pre{margin:16px 0}p:first-child{margin-top:0}p:last-child{margin-bottom:0}pre,.table-scroll{max-width:100%;overflow:auto}table{min-width:650px}</style><main data-aiyou-theme-host><div class="turn user-row"><div id="user" data-user-message-bubble>已发送消息</div></div><div class="turn"><div id="assistant" data-markdown-text-style="assistant-message"><p>短回复</p></div></div><div class="turn"><div id="long" data-markdown-text-style="assistant-message"><p>多段回复</p><p>第二段 <a href="#check">${'long-link-'.repeat(50)}</a></p><ul><li>列表第一项</li><li>列表第二项</li></ul><pre><code>${'const longValue = '.repeat(80)}</code></pre><div class="table-scroll"><table><tr><td>宽表格</td></tr></table></div></div></div><div id="tools" style="padding:7px">原生工具卡</div><div data-composer-body><div contenteditable>保留草稿</div><button id="send">发送</button></div></main>`});
 await client.evaluate(built.compiled.slice(0,built.compiled.indexOf('window.__AIYOUCODEX_THEME_BUNDLE__=')));
 await client.evaluate(`(()=>{document.documentElement.dataset.aiyouTheme='pink-candy';const s=document.createElement('style');s.textContent=${JSON.stringify(bundle.css)};document.head.append(s);const c=document.createElement('style');c.textContent=window.__AIYOU_THEME_CONTROLS__.css();document.head.append(c);})()`);
 const geometry=`(()=>{const read=id=>{const e=document.getElementById(id),s=getComputedStyle(e),r=e.getBoundingClientRect();return{padding:s.padding,radius:s.borderRadius,shadow:s.boxShadow,border:s.border,opacity:s.opacity,width:r.width,overflow:e.scrollWidth>e.clientWidth+1}};return{user:read('user'),short:read('assistant'),long:read('long'),tools:read('tools'),draft:document.querySelector('[contenteditable]').textContent,bodyOverflow:document.body.scrollWidth>innerWidth}})()`;
 for(const width of [1200,460]){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  const g=await client.evaluate(geometry);
  for(const reply of [g.short,g.long]){assert.equal(reply.padding,g.user.padding);assert.equal(reply.radius,g.user.radius);assert.equal(reply.shadow,g.user.shadow);assert.equal(reply.border,g.user.border);assert.equal(reply.opacity,'1');assert.equal(reply.overflow,false);}
  assert.equal(g.user.padding,'10px 16px');assert.notEqual(g.short.shadow,'none');assert.equal(g.tools.padding,'7px');assert.equal(g.draft,'保留草稿');assert.equal(g.bodyOverflow,false);
 }
 // Native view changes replace the chat host before its background marker.
 await client.evaluate("document.querySelector('main').removeAttribute('data-aiyou-theme-host')");
 const remounted=await client.evaluate(geometry);assert.equal(remounted.short.padding,remounted.user.padding);assert.equal(remounted.short.shadow,remounted.user.shadow);
 await client.evaluate(`document.getElementById('assistant').append(Object.assign(document.createElement('p'),{textContent:'流式追加的段落'}))`);
 const streaming=await client.evaluate(geometry);assert.equal(streaming.short.padding,streaming.user.padding);assert.equal(streaming.short.shadow,streaming.user.shadow);
 const hit=await client.evaluate(`(()=>{const e=document.getElementById('send');e.scrollIntoView();const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`);assert.equal(hit,true);
 for(const theme of ['mecha-control','']){await client.evaluate(`document.documentElement.dataset.aiyouTheme=${JSON.stringify(theme)}`);const g=await client.evaluate(geometry);assert.equal(g.short.padding,'0px');assert.equal(g.short.shadow,'none');assert.equal(g.user.padding,'10px 16px');}
});
