import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {registerThemePackage,buildThemeCatalog} from '../lib/theme-catalog.mjs';
// Small theme-v1 adapter fixture. Browser integration uses both full production themes.
function theme(id,name,prefKey){
 const source=`window.__AIYOUCODEX_THEME_BUNDLE__=${JSON.stringify({manifest:{id,name}})};\n(()=>{
 const config=window.__AIYOUCODEX_THEME_BUNDLE__,KEY='__AIYOUCODEX_THEME__',prefKey='${prefKey}';let prefs={},dialog=null,retained=null,externalRevision=0;const controls={normalize:p=>p};
 function apply(){}function tick(){}function cancelSettings(){}function finishSettings(){return Promise.resolve()}function play(){}
 function refresh(){dialog.querySelector('[data-theme-select]').value=prefs.enabled?'mecha':'default';}
 function openSettings(){if(dialog?.open)return;dialog.innerHTML='<select data-theme-select><option value="mecha">机甲控制舱</option><option value="default">系统默认</option></select>';
 dialog.querySelector('[data-theme-select]').addEventListener('change',e=>{prefs.enabled=e.target.value==='mecha';apply(false);refresh();});
 dialog.querySelector('[data-cancel]').addEventListener('click',()=>cancelSettings());
 const committed=true;void finishSettings();
 dialog.addEventListener('keydown',e=>{e.stopPropagation();cancelSettings();});}
 const message={type:'aiyoucodex:theme-state',enabled:prefs.enabled};
 window[KEY]={getState:()=>({prefs:controls.normalize(prefs)}),configure:p=>{externalRevision++;prefs=controls.normalize({...prefs,...p,alpha:{...prefs.alpha,...p.alpha},colors:{...prefs.colors,...p.colors},background:{...prefs.background,...p.background}});apply();},openSettings,play,destroy(){}};
 if(retained?.prefs)prefs=controls.normalize(retained.prefs);apply();tick();})();`;
 return{id,name,prefKey,source,frameSource:`window.mounts.push('${id}');window.__AIYOUCODEX_FRAME_THEME__={destroy(){window.destroyed.push('${id}')}};`};
}
const mech=theme('mecha-control','机甲控制舱','aiyoucodex.theme.v1'),pink=theme('pink-candy','粉嫩软糖','aiyoucodex.theme.pink-candy.v1');
test('installing and updating a theme preserves prior theme bytes and current catalog default',async()=>{
 const dir=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'aiyou-theme-catalog-'));try{
 await writeFile(path.join(dir,'active-theme.js'),mech.source);await writeFile(path.join(dir,'frame-theme.js'),mech.frameSource);
 await registerThemePackage(dir,pink);
 let registry=JSON.parse(await readFile(path.join(dir,'catalog.json'),'utf8'));assert.equal(registry.initial,'mecha-control');assert.equal(registry.entries.length,2);
 assert.equal(await readFile(path.join(dir,'packages/mecha-control/theme.js'),'utf8'),mech.source);
 await registerThemePackage(dir,{...pink,source:pink.source+'\n// skin update'});
 registry=JSON.parse(await readFile(path.join(dir,'catalog.json'),'utf8'));assert.equal(registry.entries.length,2);assert.equal(registry.initial,'mecha-control');assert.equal(await readFile(path.join(dir,'packages/mecha-control/theme.js'),'utf8'),mech.source);assert.equal(await readFile(path.join(dir,'packages/mecha-control/frame.js'),'utf8'),mech.frameSource);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('catalog rejects duplicate identities and unsupported adapters',()=>{
 assert.throws(()=>buildThemeCatalog([mech,mech]),/Unique/);
 assert.throws(()=>buildThemeCatalog([{...mech,source:'void 0;'}]),/contract missing/);
});
test('managed frame changes palette owner only when parent changes theme',()=>{
 const{frameSource}=buildThemeCatalog([mech,pink]);let listener;const parent={postMessage(){}};
 const window={top:parent,mounts:[],destroyed:[],addEventListener(type,fn){if(type==='message')listener=fn},removeEventListener(){}};
 vm.runInNewContext(frameSource,{window,parent});
 const send=(id,source=parent,origin='app://-')=>listener({source,origin,data:{type:'aiyoucodex:theme-state',themeId:id}});
 send('mecha-control',{},'app://-');assert.deepEqual(window.mounts,[]);
 send('mecha-control');send('mecha-control');assert.deepEqual(window.mounts,['mecha-control']);
 send('pink-candy');assert.deepEqual(window.mounts,['mecha-control','pink-candy']);assert.deepEqual(window.destroyed,['mecha-control']);
 send('unknown');assert.equal(window.__AIYOUCODEX_FRAME_CATALOG__.getState().themeId,'pink-candy');
});
