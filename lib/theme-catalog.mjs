import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

export function adaptThemeForCatalog(source,entries){
 const escapeName=value=>String(value).replace(/[&<>"'`\\$\r\n]/g,c=>`&#${c.charCodeAt(0)};`);
 const options=entries.map(e=>`<option value="${e.id}">${escapeName(e.name)}</option>`).join('')+'<option value="default">系统默认</option>';
 const replace=(pattern,value,label)=>{const next=source.replace(pattern,value);if(next===source)throw Error('Theme adapter contract missing: '+label);source=next;};
 replace(/<select data-theme-select>[\s\S]*?<\/select>/,`<select data-theme-select>${options}</select>`,'selector');
 replace(/dialog\.querySelector\('\[data-theme-select\]'\)\.value=prefs\.enabled\?'(?:mecha|pink)'\:'default'/,"dialog.querySelector('[data-theme-select]').value=prefs.enabled?config.manifest.id:'default'",'selection refresh');
 replace(/dialog\.querySelector\('\[data-theme-select\]'\)\.addEventListener\('change',e=>\{prefs\.enabled=e\.target\.value==='(?:mecha|pink)';apply\(false\);refresh\(\);\}\)/,"dialog.querySelector('[data-theme-select]').addEventListener('change',e=>{window.__AIYOUCODEX_THEME_CATALOG__.select(e.target.value,{preview:true,openSettings:true});})",'switch action');
 if(!source.includes('if(retained?.themeId===config.manifest.id&&retained?.prefs)'))replace(/if\(retained\?\.(?:themeId===config\.manifest\.id&&retained\?\.)?prefs\)prefs=controls\.normalize\(retained\.prefs\)/,'if(retained?.themeId===config.manifest.id&&retained?.prefs)prefs=controls.normalize(retained.prefs)','preference isolation');
 if(!source.includes('getState:()=>({themeId:config.manifest.id,'))replace('getState:()=>({prefs:', 'getState:()=>({themeId:config.manifest.id,prefs:', 'theme identity');
 replace('configure:p=>{externalRevision++;','configure:(p,options={})=>{externalRevision++;','transient configuration');
 replace('background:{...prefs.background,...p.background}});apply();},openSettings,play,','background:{...prefs.background,...p.background}});apply(options.persist!==false);},openSettings,play,','transient persistence');
 replace('function openSettings(){if(dialog?.open)return;', 'function openSettings(){if(dialog?.open)return;window.__AIYOUCODEX_THEME_CATALOG__?.beginPreview();','settings transaction');
 replace("dialog.querySelector('[data-cancel]').addEventListener('click',()=>cancelSettings())", "dialog.querySelector('[data-cancel]').addEventListener('click',()=>{if(!window.__AIYOUCODEX_THEME_CATALOG__?.cancelPreview())cancelSettings();})",'cancel transaction');
 replace('committed=true;void finishSettings()', 'committed=true;window.__AIYOUCODEX_THEME_CATALOG__?.commitPreview();void finishSettings()','commit transaction');
 replace("e.stopPropagation();cancelSettings();", "e.stopPropagation();if(!window.__AIYOUCODEX_THEME_CATALOG__?.cancelPreview())cancelSettings();",'escape rollback');
 replace("type:'aiyoucodex:theme-state',enabled:prefs.enabled", "type:'aiyoucodex:theme-state',themeId:config.manifest.id,enabled:prefs.enabled",'frame theme identity');
 new Function(source);return source;
}

function catalogRuntime(initial){
 const key='aiyoucodex.theme.catalog.v1',entries=window.__AIYOUCODEX_THEME_ENTRIES__;
 window.__AIYOUCODEX_THEME_CATALOG__?.destroy?.();
 let selected=initial,activeId=initial,preview=null,applying=false;
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&(entries[saved.selected]||saved.selected==='default')){selected=saved.selected;activeId=entries[saved.activeId]?saved.activeId:initial;}}catch{}
 const writeSelection=()=>localStorage.setItem(key,JSON.stringify({selected,activeId}));
 const snapshot=()=>Object.fromEntries(Object.values(entries).map(e=>[e.prefKey,localStorage.getItem(e.prefKey)]));
 const restore=(values,except)=>{for(const [k,v]of Object.entries(values))if(k!==except){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}};
 function activate(value,{persist=false,openSettings=false,force=false}={}){
  if(value!=='default'&&!entries[value])throw Error('Unknown installed theme: '+value);
  const next=value==='default'?activeId:value;
  if(next!==activeId||force||window.__AIYOUCODEX_THEME__?.getState()?.themeId!==next){
   window.__AIYOUCODEX_THEME__?.destroy?.();delete window.__AIYOUCODEX_THEME__;
   activeId=next;entries[next].mount();
  }
  selected=value;window.__AIYOUCODEX_THEME__.configure({enabled:value!=='default'},{persist:false});
  if(persist){if(value!=='default')window.__AIYOUCODEX_THEME__.configure({}, {persist:true});writeSelection();}
  if(openSettings)window.__AIYOUCODEX_THEME__.openSettings();
 }
 const api={version:1,getState:()=>({selected,activeId,preview:!!preview,themes:Object.values(entries).map(({id,name,prefKey})=>({id,name,prefKey}))}),
  beginPreview(){if(!preview)preview={selected,activeId,values:snapshot(),prefs:window.__AIYOUCODEX_THEME__?.getState()?.prefs};},
  select(value,options={}){if(applying)return;applying=true;try{if(options.preview)api.beginPreview();else if(preview)api.cancelPreview();activate(value,{persist:!options.preview&&options.persist!==false,openSettings:options.openSettings});}finally{applying=false;}},
  commitPreview(){if(preview){restore(preview.values,selected==='default'?undefined:entries[activeId].prefKey);preview=null;}writeSelection();},
  cancelPreview(){if(!preview)return false;const before=preview;preview=null;restore(before.values);activeId=before.activeId;activate(before.selected,{force:true});if(before.prefs)window.__AIYOUCODEX_THEME__.configure(before.prefs,{persist:false});restore(before.values);return true;},
  destroy(){window.removeEventListener('storage',onStorage);}
 };
 function onStorage(e){if(e.key!==key||!e.newValue||preview)return;try{const value=JSON.parse(e.newValue);if(value.activeId&&entries[value.activeId])activeId=value.activeId;api.select(value.selected,{persist:false});}catch{}}
 window.__AIYOUCODEX_THEME_CATALOG__=api;window.addEventListener('storage',onStorage);activate(selected,{force:true});
}

function frameCatalogRuntime(){
 if(window.top===window)return;
 const entries=window.__AIYOUCODEX_FRAME_ENTRIES__;let current='';
 window.__AIYOUCODEX_FRAME_CATALOG__?.destroy?.();
 function receive(e){if(e.source!==parent||!['app://-','null'].includes(e.origin)||e.data?.type!=='aiyoucodex:theme-state'||!entries[e.data.themeId])return;if(current!==e.data.themeId){window.__AIYOUCODEX_FRAME_THEME__?.destroy?.();current=e.data.themeId;entries[current]();}}
 window.addEventListener('message',receive);
 window.__AIYOUCODEX_FRAME_CATALOG__={getState:()=>({themeId:current}),destroy(){window.removeEventListener('message',receive);window.__AIYOUCODEX_FRAME_THEME__?.destroy?.();}};
 parent.postMessage({type:'aiyoucodex:theme-subscribe'},'*');
}
export function buildThemeCatalog(entries,{initial=entries[0]?.id}={}){
 if(!entries.length||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Unique themes required');
 for(const e of entries){if(!/^[a-z0-9-]+$/.test(e.id)||/[<>&"']/.test(e.name)||!/^aiyoucodex\.theme\.[a-z0-9.-]+$/.test(e.prefKey))throw Error('Invalid theme metadata');new Function(e.source);new Function(e.frameSource);}
 if(!entries.some(e=>e.id===initial))throw Error('Initial theme must be installed');
 const mounts=entries.map(e=>`${JSON.stringify(e.id)}:{id:${JSON.stringify(e.id)},name:${JSON.stringify(e.name)},prefKey:${JSON.stringify(e.prefKey)},mount:function(){${adaptThemeForCatalog(e.source,entries)}\n}}`).join(',');
 const frames=entries.map(e=>`${JSON.stringify(e.id)}:function(){${e.frameSource}\n}`).join(',');
 const source=`window.__AIYOUCODEX_THEME_ENTRIES__={${mounts}};(${catalogRuntime.toString()})(${JSON.stringify(initial)});`;
 const frameSource=`window.__AIYOUCODEX_FRAME_ENTRIES__={${frames}};(${frameCatalogRuntime.toString()})();`;
 new Function(source);new Function(frameSource);return{source,frameSource};
}
export async function registerThemePackage(themeDir,entry,options={}){
 const initial=options.initial||entry.id;
 if(!/^[a-z0-9-]+$/.test(entry.id)||/[<>&\"']/.test(entry.name)||!/^aiyoucodex\.theme\.[a-z0-9.-]+$/.test(entry.prefKey))throw Error('Invalid theme metadata');
 const file=path.join(themeDir,'catalog.json');let catalog;try{catalog=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;catalog={schemaVersion:1,initial,entries:[]};}
 if(!catalog.entries.length){
  let oldSource;try{oldSource=await readFile(path.join(themeDir,'active-theme.js'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(oldSource?.includes('window.__AIYOUCODEX_THEME_BUNDLE__=')){
   const marker='window.__AIYOUCODEX_THEME_BUNDLE__=',start=oldSource.indexOf(marker)+marker.length,end=oldSource.indexOf(';\n',start);
   const legacy=JSON.parse(oldSource.slice(start,end)),prefKey=oldSource.slice(end).match(/prefKey='(aiyoucodex\.theme\.[a-z0-9.-]+)'/)?.[1];
   if(!prefKey||!/^[a-z0-9-]+$/.test(legacy.manifest.id))throw Error('Cannot preserve existing theme metadata');
   const oldDir=path.join(themeDir,'packages',legacy.manifest.id);await mkdir(oldDir,{recursive:true});
   await writeFile(path.join(oldDir,'theme.js'),oldSource);await writeFile(path.join(oldDir,'frame.js'),await readFile(path.join(themeDir,'frame-theme.js'),'utf8'));
   catalog.entries.push({id:legacy.manifest.id,name:legacy.manifest.name,prefKey});if(!options.initial)catalog.initial=legacy.manifest.id;
  }
 }
 const dirname=path.join(themeDir,'packages',entry.id);await mkdir(dirname,{recursive:true});
 for(const [name,data]of [['theme.js',entry.source],['frame.js',entry.frameSource]]){await writeFile(path.join(dirname,name+'.tmp'),data);await rename(path.join(dirname,name+'.tmp'),path.join(dirname,name));}
 const metadata={id:entry.id,name:entry.name,prefKey:entry.prefKey};catalog.entries=[...catalog.entries.filter(e=>e.id!==entry.id),metadata];catalog.entries.sort((a,b)=>a.id===catalog.initial?-1:b.id===catalog.initial?1:0);
 const entries=await Promise.all(catalog.entries.map(async e=>({...e,source:await readFile(path.join(themeDir,'packages',e.id,'theme.js'),'utf8'),frameSource:await readFile(path.join(themeDir,'packages',e.id,'frame.js'),'utf8')})));
 const built=buildThemeCatalog(entries,{initial:catalog.initial});
 for(const [name,data]of [['frame-theme.js',built.frameSource],['catalog.json',JSON.stringify(catalog,null,2)+'\n'],['active-theme.js',built.source]]){await writeFile(path.join(themeDir,name+'.tmp'),data);await rename(path.join(themeDir,name+'.tmp'),path.join(themeDir,name));}
 return{catalog,...built};
}
