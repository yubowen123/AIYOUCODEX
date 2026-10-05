/* Dedicated decoration owner: hot installs without stopping existing Claude/Codex tasks. */
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.argv.includes('--runtime-root')?process.argv[process.argv.indexOf('--runtime-root')+1]:path.dirname(here);
const {readTargets,selectMainCodexTargets,connectCodexTarget}=await import(path.join(root,'scripts/cdp-client.mjs'));
const sources=path.join(root,'themes/active-theme.js'),sessions=new Map();let cached='',frames='',mtime=0,hash='',stopped=false;
function managedOrigin(origin){return ['app://-','https://web-sandbox.oaiusercontent.com','http://127.0.0.1:47823','http://localhost:47823'].includes(origin);}
function managedIframe(t){try{const u=new URL(t.url);return t.type==='iframe'&&((u.origin==='https://web-sandbox.oaiusercontent.com'&&/^\/__codex_asset_console__\/[a-f0-9]{32,128}\/(?:model-arena\/)?(?:index\.html)?$/i.test(u.pathname))||(['http://127.0.0.1:47823','http://localhost:47823'].includes(u.origin)&&['/','/index.html'].includes(u.pathname)));}catch{return false;}}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;for(const c of sessions.values())c.client.close();});
while(!stopped){try{
 const meta=await stat(sources);if(meta.mtimeMs!==mtime){cached=await readFile(sources,'utf8');frames=await readFile(path.join(root,'themes/frame-theme.js'),'utf8').catch(()=> '');new Function(cached);hash=createHash('sha256').update(cached+frames).digest('hex');mtime=meta.mtimeMs;}
 const inventory=await readTargets();const targets=[...selectMainCodexTargets(inventory),...inventory.filter(managedIframe)];const ids=new Set(targets.map(t=>t.id));
 for(const [id,c]of sessions)if(!ids.has(id)){c.client.close();sessions.delete(id);}
 for(const target of targets){try{let c=sessions.get(target.id);if(!c){const client=await connectCodexTarget(target);await client.send('Page.enable');await client.send('Runtime.enable');c={client,hash:'',identifier:null,frames:new Map()};sessions.set(target.id,c);}
 const frameTarget=managedIframe(target),sentinel=frameTarget?'__AIYOUCODEX_FRAME_WORKER_HASH__':'__AIYOUCODEX_THEME_WORKER_HASH__';
 const installed=await c.client.evaluate(`window[${JSON.stringify(sentinel)}]||null`);
 if(installed!==hash){
 if(c.identifier)try{await c.client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:c.identifier});}catch{}
 const source=frameTarget?`${frames}\nwindow.__AIYOUCODEX_FRAME_WORKER_HASH__=${JSON.stringify(hash)};`:`if(window.top===window){${cached}\nwindow.__AIYOUCODEX_THEME_WORKER_HASH__=${JSON.stringify(hash)};}else{${frames}}`;
 c.identifier=(await c.client.send('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;
 await c.client.evaluate(source);c.hash=hash;console.log(frameTarget?'Frame palette applied':'Theme decoration applied',target.id);}
 for(const ctx of c.client.executionContexts.values())if(ctx.auxData?.isDefault&&managedOrigin(ctx.origin)&&c.frames.get(ctx.id)!==hash){const r=await c.client.send('Runtime.evaluate',{expression:frames,contextId:ctx.id});if(!r.exceptionDetails)c.frames.set(ctx.id,hash);}
 }catch(e){sessions.get(target.id)?.client.close();sessions.delete(target.id);console.error('Theme attach deferred:',e.message);}}
}catch(e){console.error('Theme service waiting:',e.message);}
 await new Promise(r=>setTimeout(r,1500));
}
