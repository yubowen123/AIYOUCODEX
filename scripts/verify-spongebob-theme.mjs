import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Own an isolated Chrome process and profile. Never connect to the Codex app.
const repo=process.env.AIYOUCODEX_REPO||fileURLToPath(new URL('..',import.meta.url));
const here=path.resolve(process.env.AIYOU_THEME_AUDIT_OUTPUT||path.join(repo,'output','spongebob-theme-audit'));
const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1];
const packageDir=path.resolve(args.includes('--package')?option('--package'):path.join(repo,'themes','spongebob-beach-motion'));
const label=args.includes('--baseline')?'original':'fixed';
const {buildThemePackage}=await import(pathToFileURL(path.join(repo,'lib/theme-build.mjs')));
const {buildThemeCatalog}=await import(pathToFileURL(path.join(repo,'lib/theme-catalog.mjs')));
const {themeContrastRatio}=await import(pathToFileURL(path.join(repo,'lib/theme-package.mjs')));
const {connectFixtureBrowser,waitForBrowserState}=await import(pathToFileURL(path.join(repo,'test/helpers/browser-state.mjs')));
await mkdir(here,{recursive:true});
const built=await buildThemePackage(packageDir);
const report={package:packageDir,version:built.manifest.version,scope:'isolated Chrome fixture; not native Codex',contrast:built.contrast,checks:[]};
const check=(name,passes,details)=>report.checks.push({name,passes:Boolean(passes),details});
check('compiler, palette, resource budget and JavaScript syntax',built.assetBytes<=built.manifest.limits.maxBundleBytes,{assetBytes:built.assetBytes});
check('isolated preference key',built.prefKey===`aiyoucodex.theme.${built.manifest.id}.v1`,built.prefKey);
const manifest=JSON.parse(await readFile(path.join(packageDir,'manifest.json'))),controls=JSON.parse(await readFile(path.join(packageDir,'controls.json')));
check('motion defaults agree',manifest.defaults.motion===controls.defaults.motion,{manifest:manifest.defaults.motion,controls:controls.defaults.motion});
const html=`<!doctype html><html><head><meta charset="utf-8"><title>主题隔离验证</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.6 system-ui;background:#eee;color:#222}header{height:48px;padding:10px 20px;position:relative;z-index:1;border-bottom:1px solid #aaa;display:flex;justify-content:space-between}header strong{font-size:14px}main.shell{display:flex;height:calc(100vh - 48px);min-width:0}aside.app-shell-left-panel{width:260px;flex-shrink:0;display:flex}aside nav{width:48px;padding:8px}aside .sidebar-navigation{flex:1;min-width:0;padding:14px}aside button{width:100%;margin:6px 0}main.chat{flex:1;min-width:0;overflow:auto;padding:24px;--thread-content-margin:16px}.turn{margin:18px 0;min-width:0}.user-row{display:flex;justify-content:flex-end}[data-user-message-bubble]{padding:10px 16px;border:0 solid transparent;border-radius:16px;max-width:80%;overflow-wrap:anywhere}[data-markdown-text-style]{min-width:0;border:0 solid transparent;overflow-wrap:anywhere}p,ul,pre{margin:16px 0}p:first-child{margin-top:0}p:last-child{margin-bottom:0}pre,.table-scroll{max-width:100%;overflow:auto}table{min-width:650px}td{padding:8px}button,input,textarea{font:inherit}button{cursor:pointer;padding:7px 12px;border:1px solid #ccc;border-radius:12px}textarea{width:100%;height:50px;background:transparent;border:0;color:inherit}.compose-area{position:relative;margin-top:24px;padding:12px}[data-composer-body]{position:relative;padding:14px;border:1px solid #ccc}.compose-footer{display:flex;justify-content:space-between;align-items:center}.compose-footer button{width:40px;height:40px;padding:0}#aiyoucodex-agent-launchers{display:flex;flex-direction:column}.thread-card{padding:12px;margin-top:16px;border:1px solid #ddd;border-radius:16px}.claim{font-size:12px;color:inherit}a{overflow-wrap:anywhere}#tools{padding:7px}@media(max-width:600px){aside.app-shell-left-panel{width:128px}aside nav{width:38px;padding:3px}aside .sidebar-navigation{padding:8px}main.chat{padding:12px}header{padding:10px}}
</style></head><body><header><strong>海底假日 · 主题隔离预览</strong><span class="claim">测试夹具，非 Codex 实机截图</span></header><main class="shell"><aside class="app-shell-left-panel"><nav><button id="rail-button">◈</button></nav><section class="sidebar-navigation"><strong>项目</strong><div id="aiyoucodex-agent-launchers"><button>Codex</button><button>Dot / Claude</button></div><div class="thread-card" data-codex-conversation-preview-enhanced data-app-action-sidebar-thread-id="fixture" data-codex-execution-state="read"><strong>海底假日</strong><p class="codex-conversation-card-summary">主题兼容验证</p></div></section></aside><main class="chat" id="chat"><div class="turn user-row"><div id="user" data-user-message-bubble="true">检查这个主题是否有问题。</div></div><div class="turn"><div id="assistant" data-markdown-text-style="assistant-message"><p>已检查主题结构、可读性和背景层。</p><p>海底配色与原始图片保留；收发气泡使用相同留白和材质。</p><ul><li>动画支持开关与减少动态效果。</li><li>更换自定义素材时移除内置人物层。</li></ul><p><a id="fixture-link" href="#details">查看检查结果</a></p></div></div><div id="tools">工具结果保持原生留白</div><div class="turn" id="long-turn" hidden><div id="long" data-markdown-text-style="assistant-message"><p>多段回复</p><p>第二段 <a href="#check">${'long-link-'.repeat(50)}</a></p><ul><li>列表第一项</li><li>列表第二项</li></ul><pre><code>${'const longValue = '.repeat(80)}</code></pre><div class="table-scroll"><table><tr><td>宽表格</td></tr></table></div></div></div><div class="compose-area"><div data-codex-composer-root><div aria-hidden="true" class="pointer-events-none absolute bg-gradient-to-t" id="composer-paint"></div><div data-composer-body><textarea>保留草稿</textarea><div class="compose-footer"><span>本地隔离验证</span><button id="send" aria-label="发送消息">↑</button></div></div></div></div></main></main></body></html>`;
const server=createServer((_,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(path.join(here,'.chrome-fixture-'));
const executable=process.env.AIYOUCODEX_TEST_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=spawn(executable,['--headless=new','--no-first-run','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let client;
const evaluatedErrors=[];
try{
 ({client}=await connectFixtureBrowser({browser,profile,url:`http://127.0.0.1:${server.address().port}`}));
 await client.send('Runtime.enable');
 await client.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});
 await client.evaluate("window.__fixtureErrors=[];window.addEventListener('error',e=>window.__fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__fixtureErrors.push(String(e.reason)));window.__codexConversationPreviewInjection__={getActiveTaskContext:()=>({threadId:'fixture'})}");
 await client.evaluate(built.compiled);
 await waitForBrowserState(client,"!!document.querySelector('#aiyou-theme-backdrop img.aiyou-motion-art')?.naturalWidth",'Theme mounted and artwork decodes');
 const state=()=>client.evaluate(`(()=>{const layer=document.getElementById('aiyou-theme-backdrop'),chars=layer?.querySelector('.aiyou-character-layer'),water=layer?.querySelector('.aiyou-water-glimmer');const art=layer?.querySelector('.aiyou-motion-art');return {motion:layer?.dataset.motionEnabled||null,charactersVisible:!!chars&&!chars.hidden&&getComputedStyle(chars).display!=='none',waterVisible:!!water&&!water.hidden&&getComputedStyle(water).display!=='none',animations:[...layer?.querySelectorAll('.aiyou-character')||[]].map(e=>getComputedStyle(e).animationName),artDecodes:!!art?.naturalWidth,isFullPoster:art?.src===window.__AIYOUCODEX_THEME_BUNDLE__.poster}})()`);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({motion:true})");
 await waitForBrowserState(client,"!!document.querySelector('.aiyou-motion-art')?.naturalWidth",'Animated artwork decodes');
 let s=await state();check('motion can be enabled',s.motion==='true'&&s.animations.every(n=>n!=='none'),s);
 await client.evaluate("document.getElementById('aiyou-theme-backdrop').remove()");
 await waitForBrowserState(client,"!!document.querySelector('#aiyou-theme-backdrop img.aiyou-motion-art')?.naturalWidth",'Background remount completes');
 s=await state();check('remount preserves motion',s.motion==='true'&&s.animations.every(n=>n!=='none'),s);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({motion:true})");
 s=await state();assert.ok(s.animations.every(n=>n!=='none'),'visibility test starts with active CSS animation');
 await client.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))");
 s=await state();check('hidden window stops CSS animation',s.animations.every(n=>n==='none'),s);
 await client.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))");
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await waitForBrowserState(client,"matchMedia('(prefers-reduced-motion: reduce)').matches",'Reduced motion enabled');
 await delay(60);s=await state();check('reduced motion disables decoration',s.animations.every(n=>n==='none'),s);
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await client.evaluate(`(async()=>{const blob=await(await fetch(window.__AIYOUCODEX_THEME_BUNDLE__.poster)).blob();const meta=await window.__AIYOU_THEME_MEDIA_STORE__.prepare(new File([blob],'fixture.png',{type:'image/png'}));window.__fixtureCustom=meta;window.__AIYOUCODEX_THEME__.configure({background:{source:'custom',customStates:{poster:meta}}})})()`);
 await waitForBrowserState(client,"document.getElementById('aiyou-theme-backdrop')?.dataset.customSlot==='poster'",'Custom artwork loaded');
 s=await state();check('custom backgrounds hide built-in characters and water',!s.charactersVisible&&!s.waterVisible&&s.animations.every(n=>n==='none'),s);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({motion:false,background:{source:'builtin'}})");
 await waitForBrowserState(client,"!!document.querySelector('.aiyou-motion-art')?.naturalWidth",'Static artwork decodes');
 s=await state();check('disabled motion uses complete static poster',s.isFullPoster&&!s.charactersVisible,s);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({motion:true});document.querySelector('.aiyou-character').dispatchEvent(new Event('error'))");
 await waitForBrowserState(client,"document.querySelector('.aiyou-motion-art')?.src===window.__AIYOUCODEX_THEME_BUNDLE__.poster&&!!document.querySelector('.aiyou-motion-art')?.naturalWidth",'Character failure falls back to a complete poster');
 s=await state();check('a broken character layer restores the complete image',s.isFullPoster&&!s.charactersVisible&&s.animations.every(n=>n==='none'),s);
 await client.evaluate("window.__AIYOUCODEX_THEME__.destroy();delete window.__AIYOUCODEX_THEME__");
 await client.evaluate(built.compiled);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({alpha:{composer:0,'composer-area':0}})");
 const transparency=await client.evaluate(`(()=>{const body=document.querySelector('[data-composer-body]'),area=document.querySelector('[data-aiyou-composer-area]'),editor=document.querySelector('textarea');const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');const alpha=e=>{context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(e).backgroundColor;context.fillRect(0,0,1,1);return context.getImageData(0,0,1,1).data[3]};return {composer:alpha(body),area:alpha(area),textOpacity:getComputedStyle(editor).opacity,ancestorOpacity:[body,area].map(e=>getComputedStyle(e).opacity),draft:editor.value}})()`);
 check('composer and outer alpha do not fade text or draft',transparency.composer===0&&transparency.area===0&&transparency.textOpacity==='1'&&transparency.ancestorOpacity.every(o=>o==='1')&&transparency.draft==='保留草稿',transparency);
 await client.evaluate("window.__AIYOUCODEX_THEME__.configure({motion:false,alpha:{composer:.94,'composer-area':.28}})");
 const geometry=`(()=>{const read=id=>{const e=document.getElementById(id),s=getComputedStyle(e);return{padding:s.padding,radius:s.borderRadius,shadow:s.boxShadow,border:s.border,opacity:s.opacity,overflow:e.scrollWidth>e.clientWidth+1}};return{user:read('user'),short:read('assistant'),long:read('long'),tools:read('tools'),draft:document.querySelector('textarea').value,bodyOverflow:document.body.scrollWidth>innerWidth}})()`;
 await client.evaluate("document.getElementById('long-turn').hidden=false");
 for(const width of [1400,460]){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  const g=await client.evaluate(geometry);
  check(`paired bubble geometry and material at ${width}px`,[g.short,g.long].every(e=>['padding','radius','shadow','border'].every(k=>e[k]===g.user[k])),g);
  check(`native draft, tool spacing and no overflow at ${width}px`,g.draft==='保留草稿'&&g.tools.padding==='7px'&&!g.bodyOverflow&&!g.short.overflow&&!g.long.overflow&&g.short.opacity==='1',g);
 }
 await client.evaluate("document.getElementById('chat').removeAttribute('data-aiyou-theme-host')");
 let g=await client.evaluate(geometry);check('message style survives host-marker replacement',g.short.padding===g.user.padding&&g.short.shadow===g.user.shadow,g);
 await client.evaluate("document.getElementById('assistant').append(Object.assign(document.createElement('p'),{textContent:'流式追加的段落'}))");
 g=await client.evaluate(geometry);check('streaming append keeps paired insets',g.short.padding===g.user.padding&&g.short.shadow===g.user.shadow,g);
 await client.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});
 const hit=await client.evaluate("(()=>{const e=document.getElementById('send');e.scrollIntoView();const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()");
 check('decoration does not intercept send hit target',hit);
 const rgbToHex=value=>'#'+value.match(/\d+(?:\.\d+)?/g).slice(0,3).map(v=>Math.round(Number(v)*(value.startsWith('color(srgb ')?255:1)).toString(16).padStart(2,'0')).join('');
 const sendColors=await client.evaluate("(()=>{const s=getComputedStyle(document.getElementById('send'));return {foreground:s.color,background:s.backgroundColor}})()");
 const ratio=themeContrastRatio(rgbToHex(sendColors.foreground),rgbToHex(sendColors.background));check('send icon contrast >= 4.5',ratio>=4.5,{...sendColors,ratio});
 // Runtime observes send intent but must not emit business actions itself.
 await client.evaluate("window.__fixtureSends=0;document.getElementById('send').addEventListener('click',()=>window.__fixtureSends++);window.__AIYOUCODEX_THEME__.play('click')");
 check('motion does not send messages',await client.evaluate('window.__fixtureSends===0'));
 await client.evaluate("window.__fixturePreferences=JSON.stringify(window.__AIYOUCODEX_THEME__.getState().prefs);window.__AIYOUCODEX_THEME__.openSettings()");
 const optionText=await client.evaluate("document.querySelector('[data-theme-select] option').textContent");check('settings identifies the actual theme',optionText===manifest.name,optionText);
 await client.evaluate("(()=>{const e=document.querySelector('[data-alpha=\"message\"]');e.value='90';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-cancel]').click()})()");
 check('cancel restores all preferences',await client.evaluate('JSON.stringify(window.__AIYOUCODEX_THEME__.getState().prefs)===window.__fixturePreferences'));
 await client.evaluate("window.__AIYOUCODEX_THEME__.openSettings();(()=>{const e=document.querySelector('[data-alpha=\"composer\"]');e.value='33';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-theme-close]').click()})()");
 await waitForBrowserState(client,"!document.querySelector('#aiyou-theme-settings').open",'Settings save closes');
 await client.evaluate("window.__AIYOUCODEX_THEME__.destroy();delete window.__AIYOUCODEX_THEME__");
 await client.evaluate(built.compiled);
 check('saved preferences restore after runtime reload',await client.evaluate("Math.abs(window.__AIYOUCODEX_THEME__.getState().prefs.alpha.composer-.67)<.001"));
 // Test the real catalog adapter, keeping all writes inside the fixture profile.
 const pink=await buildThemePackage(path.join(repo,'themes/pink-candy'));
 const entries=[pink,built].map(b=>({id:b.manifest.id,name:b.manifest.name,prefKey:b.prefKey,source:b.compiled,frameSource:b.frameSource}));
 const catalog=buildThemeCatalog(entries,{initial:built.manifest.id});new Function(catalog.source);new Function(catalog.frameSource);
 await client.evaluate(catalog.source);
 await client.evaluate("window.__AIYOUCODEX_THEME_CATALOG__.select('pink-candy');window.__fixturePink=localStorage.getItem('aiyoucodex.theme.pink-candy.v1');window.__AIYOUCODEX_THEME_CATALOG__.select('spongebob-beach-motion');window.__AIYOUCODEX_THEME_CATALOG__.select('default')");
 const fallback=await client.evaluate("({theme:document.documentElement.dataset.aiyouTheme||null,background:!!document.getElementById('aiyou-theme-backdrop'),draft:document.querySelector('textarea').value,ink:getComputedStyle(document.getElementById('assistant')).padding,pinkPreserved:window.__fixturePink===localStorage.getItem('aiyoucodex.theme.pink-candy.v1')})");
 check('catalog preserves other theme and restores system styles',!fallback.theme&&!fallback.background&&fallback.ink==='0px'&&fallback.draft==='保留草稿'&&fallback.pinkPreserved,fallback);
 await client.evaluate("window.__AIYOUCODEX_THEME_CATALOG__.select('spongebob-beach-motion');window.__AIYOUCODEX_THEME__.configure({motion:true});document.getElementById('long-turn').hidden=true;document.getElementById('chat').scrollTop=0");
 await waitForBrowserState(client,"!!document.querySelector('.aiyou-motion-art')?.naturalWidth",'Preview decodes');
 const capture=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(here,`${label}-wide.png`),Buffer.from(capture.data,'base64'));
 await client.send('Emulation.setDeviceMetricsOverride',{width:460,height:1000,deviceScaleFactor:1,mobile:false});
 const narrow=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(here,`${label}-narrow.png`),Buffer.from(narrow.data,'base64'));
 evaluatedErrors.push(...await client.evaluate('window.__fixtureErrors'));
 check('no runtime errors or unhandled promise rejection',evaluatedErrors.length===0,evaluatedErrors);
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{
 client?.close();browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1000)]);if(browser.exitCode==null)browser.kill('SIGKILL');
 await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 report.passed=report.checks.filter(c=>c.passes).length;report.failed=report.checks.filter(c=>!c.passes).length;
 await writeFile(path.join(here,`${label}-results.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({label,passed:report.passed,failed:report.failed,failures:report.checks.filter(c=>!c.passes).map(c=>c.name),error:report.error}));
 if(report.failed&&!args.includes('--baseline'))process.exitCode=1;
}
