/* Theme v1 adapter: decoration only; never sends messages or mutates native task state. */
(() => {
 'use strict';
 const KEY='__AIYOUCODEX_THEME__',config=window.__AIYOUCODEX_THEME_BUNDLE__;
 if(!config||window.top!==window)return;
 window[KEY]?.cancelSettings?.();const retained=window[KEY]?.getState?.();window[KEY]?.destroy?.();
 const controls=window.__AIYOU_THEME_CONTROLS__,prefKey='aiyoucodex.theme.pink-candy.v1';let prefs=controls.normalize();
 try{prefs=controls.normalize(JSON.parse(localStorage.getItem(prefKey)||'{}'));}catch{}
 let destroyed=false,host=null,layer=null,img=null,button=null,dialog=null,chassis=null,transient=null,eventTimer=null,timer=null,currentAsset='',nonce=0,threadKey='',lastState='unknown',currentState='idle',lastClick=0,lastSend=0,pendingSend=null;
 const chromeMarks=new Map(),composerMarks=new Set(),composerAreas=new Set();
 const marked=new Set(),html=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const style=document.createElement('style');style.id='aiyou-theme-style';style.textContent=config.css;document.head.append(style);
 const customStyle=document.createElement('style');customStyle.id='aiyou-theme-customization';document.head.append(customStyle);
 let workspace=null,trackedSidebar=null,workspacePaths=new Set(),resizeQueued=false,externalRevision=0;
 let cancelSettings=()=>{},customSignature='';
 const anchored=config.manifest.transitions?.mode==='shared-anchor';
 let boundaryTimer=null,motionBusy=false,decodeRevision=0,transientRevision=0,pendingAsset='',activeFormat='',failedVideo='';
 const customStates=[['poster','待机 / 通用背景'],['enter','进入聊天'],['click','点击操作'],['send','发送消息'],['running','执行中'],['complete','完成未读'],['error','错误 / 网络异常']];
 const customIds=p=>new Set(Object.values(p.background.customStates).map(a=>a.id));
 const mediaStore=window.__AIYOU_THEME_MEDIA_STORE__,customCache=new Map(),customLoading=new Set(),customMissing=new Set();let customLoadRevision=0,customStatus='',failedCustom='';
 function notifyCustom(){const output=dialog?.querySelector('[data-custom-status]');if(output)output.textContent=customStatus;}
 function releaseCustom(id){const cached=customCache.get(id);if(cached){URL.revokeObjectURL(cached.url);URL.revokeObjectURL(cached.poster);customCache.delete(id);}}
 function syncCustom(){
  if(prefs.background.source!=='custom')return;
  for(const meta of Object.values(prefs.background.customStates)){
  const id=meta.id;if(customCache.has(id)||customLoading.has(id)||customMissing.has(id))continue;
  customLoading.add(id);const revision=customLoadRevision;
  Promise.resolve().then(()=>mediaStore.get(id)).then(record=>{
   if(destroyed||revision!==customLoadRevision||!customIds(prefs).has(id))return;
   if(!record?.blob||!record.poster)throw Error('自定义素材已丢失，请重新选择');
   customCache.set(id,{url:URL.createObjectURL(record.blob),poster:URL.createObjectURL(record.poster),type:record.meta.type});
   customStatus='本机素材已加载';failedCustom='';notifyCustom();render();
  }).catch(e=>{if(!destroyed&&revision===customLoadRevision){customMissing.add(id);customStatus=meta.name+'：'+(e.message||'本机素材读取失败');notifyCustom();render();}}).finally(()=>customLoading.delete(id));
  }
 }
 function stopMedia(node){if(node instanceof HTMLVideoElement){node.pause();node.removeAttribute('src');node.load();}}
 function backgroundFormat(){return prefs.background.type==='image'?'image':prefs.background.type==='video'&&config.videos?'video':'gif';}
 const resizeObserver=new ResizeObserver(()=>queueBounds());
 const visible=e=>e&&e.isConnected&&!e.hidden&&e.getBoundingClientRect().width>30&&e.getBoundingClientRect().height>30;
 const save=()=>{try{localStorage.setItem(prefKey,JSON.stringify(prefs));return true;}catch{return false;}};
 function managedFrame(frame){try{const u=new URL(frame.src);return (frame.id==='codex-taskboard-frame'&&u.protocol==='blob:'&&u.origin==='app://-')||(u.origin==='https://web-sandbox.oaiusercontent.com'&&/^\/__codex_asset_console__\/[a-f0-9]{32,128}\/(?:model-arena\/)?(?:index\.html)?$/i.test(u.pathname))||(['http://127.0.0.1:47823','http://localhost:47823'].includes(u.origin)&&['/','/index.html'].includes(u.pathname));}catch{return false;}}
 function broadcastFrames(){for(const f of document.querySelectorAll('iframe'))if(managedFrame(f))f.contentWindow?.postMessage({type:'aiyoucodex:theme-state',enabled:prefs.enabled,preferences:controls.normalize(prefs)},new URL(f.src).origin);}
 function onFrameMessage(e){if(!['app://-','https://web-sandbox.oaiusercontent.com','http://127.0.0.1:47823','http://localhost:47823'].includes(e.origin)||e.data?.type!=='aiyoucodex:theme-subscribe')return;const f=[...document.querySelectorAll('iframe')].find(f=>managedFrame(f)&&f.contentWindow===e.source);if(f)broadcastFrames();}
 function activeHost(){const claude=document.getElementById('aiyoucodex-claude-panel');if(visible(claude))return claude;if(html.hasAttribute('data-codex-asset-console-open')||html.hasAttribute('data-codex-taskboard-open'))return null;
  const mains=[...document.querySelectorAll('main')].filter(e=>visible(e)&&e!==document.querySelector('main')&&!e.closest('[hidden],[inert]'));
  const chats=mains.filter(e=>e.querySelector('[data-composer-body],[data-codex-composer-root],[data-user-message-bubble],[data-markdown-text-style="assistant-message"]'));
  return (chats.length?chats:mains).filter(e=>!(chats.length?chats:mains).some(other=>other!==e&&e.contains(other))).sort((a,b)=>b.getBoundingClientRect().x-a.getBoundingClientRect().x)[0]||null;
 }
 function stateInfo(){if(host?.id==='aiyoucodex-claude-panel'){const c=window.__aiyouClaudeInjection__?.getState?.(),s=c?.data?.session;return {key:'claude:'+c?.sessionId,state:s?.status==='running'?'running':s?.status==='error'||s?.status==='failed'?'error':'read'};}
 const context=window.__codexConversationPreviewInjection__?.getActiveTaskContext?.();const id=context?.threadId||location.pathname;const rows=[...document.querySelectorAll('[data-app-action-sidebar-thread-id]')].filter(e=>e.dataset.appActionSidebarThreadId===id||e.dataset.appActionSidebarThreadId?.endsWith(':'+id));const row=rows.find(e=>e.dataset.codexExecutionState&&visible(e))||rows.find(e=>e.dataset.codexExecutionState);return {key:'codex:'+id,state:row?.dataset.codexExecutionState||'unknown'};}
 function eventFor(){if(document.hidden||reduced.matches||!prefs.motion||(prefs.background.source!=='custom'&&prefs.background.type==='image'))return 'poster';if(currentState==='error')return 'error';if(transient)return transient;return ({running:'running','completed-unread':'complete',error:'error'})[currentState]||'poster';}
 function render(restart=false){if(!prefs.enabled||!host||!img)return;const format=backgroundFormat();if(format!==activeFormat){stopMedia(img);clearTimeout(boundaryTimer);motionBusy=false;pendingAsset='';currentAsset='';decodeRevision++;activeFormat=format;failedVideo='';}
 if(prefs.background.source==='custom'){renderCustom();return;}
 const event=eventFor(),asset=event==='poster'?(format==='gif'?config.poster:config.staticImage||config.poster):config.media[event]||config.poster;
 if(format==='video'){renderVideo(event,restart);return;}
 if(anchored){renderAnchored(event,asset,restart);return;}
 if(asset===currentAsset&&!restart)return;currentAsset=asset;layer.dataset.event=event;const previous=img;img=document.createElement('img');img.alt='';img.setAttribute('aria-hidden','true');img.draggable=false;
 // New element restarts one-shot GIF decode. No URL cache-busting or network request.
 img.className='aiyou-motion-art';img.src=asset;img.addEventListener('error',()=>{if(img.src!==config.poster)img.src=config.poster;},{once:true});previous.replaceWith(img);nonce++;
 }
 function renderCustom(){
  const event=eventFor(),slots=prefs.background.customStates,meta=slots[event]||slots.poster;
  const cached=customCache.get(meta?.id)||customCache.get(slots.poster?.id),still=customCache.get(slots.poster?.id)?.poster||cached?.poster||config.staticImage||config.poster;
  const animated=prefs.motion&&!document.hidden&&!reduced.matches;
  const asset=cached&&(cached.type==='image'||animated)?cached.url:still;
  const isVideo=cached?.type==='video'&&animated&&failedCustom!==asset;
  const target=failedCustom===asset?still:asset;
  const key=event+':'+target;
  if(!animated){clearTimeout(boundaryTimer);motionBusy=false;}
  if(motionBusy||pendingAsset===key||currentAsset===key)return;
  clearTimeout(boundaryTimer);pendingAsset=key;
  const revision=++decodeRevision,request=transientRevision,previous=img,next=document.createElement(isVideo?'video':'img');
  next.className='aiyou-motion-art';next.setAttribute('aria-hidden','true');next.draggable=false;
  if(isVideo){next.muted=true;next.defaultMuted=true;next.playsInline=true;next.loop=event==='poster';next.preload='auto';next.poster=still;next.setAttribute('muted','');next.setAttribute('playsinline','');}else next.alt='';
  function valid(){return !destroyed&&revision===decodeRevision&&(previous.isConnected||img===next);}
  function fail(){if(!valid())return;failedCustom=asset;pendingAsset='';motionBusy=false;stopMedia(next);customStatus='素材播放失败，已使用静态预览';notifyCustom();if(img===next)currentAsset='';renderCustom();}
  function boundary(){if(!valid()||img!==next)return;motionBusy=false;const repeated=transientRevision!==request&&transient===event;if(transientRevision===request&&transient===event)transient=null;
   const wanted=eventFor();if(wanted===event&&!repeated){if(event==='running'){if(isVideo){next.currentTime=0;motionBusy=true;next.play().catch(fail);}else{motionBusy=true;boundaryTimer=setTimeout(boundary,meta?.durationMs||4000);}}return;}
   currentAsset='';render();
  }
  function commit(){if(!valid()||!previous.isConnected){stopMedia(next);return;}pendingAsset='';stopMedia(previous);previous.replaceWith(next);img=next;currentAsset=key;layer.dataset.event=event;layer.dataset.customSlot=slots[event]&&customCache.has(slots[event].id)?event:slots.poster?'poster':'builtin';layer.dataset.mediaType=isVideo?'video':cached?.type==='gif'&&animated?'gif':'image';nonce++;
   if(animated&&event!=='poster'&&cached&&target===cached.url){motionBusy=true;if(isVideo)next.addEventListener('ended',boundary,{once:false});else boundaryTimer=setTimeout(boundary,meta?.durationMs||4000);}if(isVideo)next.play().catch(fail);
  }
  next.addEventListener('error',fail,{once:true});
  next.src=target;if(isVideo){next.addEventListener('loadeddata',commit,{once:true});next.load();}else if(next.complete&&next.naturalWidth)commit();else next.addEventListener('load',commit,{once:true});
 }
 function renderVideo(event,restart){
  const still=config.staticImage||config.poster,asset=event==='poster'?still:config.videos[event]||still;
  if(event==='poster'){clearTimeout(boundaryTimer);motionBusy=false;if(img instanceof HTMLVideoElement){stopMedia(img);pendingAsset='';decodeRevision++;}}
  if(motionBusy||pendingAsset===asset||(asset===currentAsset&&!restart))return;
  if(asset===failedVideo&&event!=='poster')return;
  pendingAsset=asset;const revision=++decodeRevision,request=transientRevision,previous=img,isVideo=event!=='poster'&&asset!==still;
  const next=document.createElement(isVideo?'video':'img');next.className='aiyou-motion-art';next.setAttribute('aria-hidden','true');next.draggable=false;
  if(isVideo){next.muted=true;next.defaultMuted=true;next.playsInline=true;next.preload='auto';next.controls=false;next.setAttribute('muted','');next.setAttribute('playsinline','');next.poster=still;}else next.alt='';
  function valid(){return !destroyed&&revision===decodeRevision&&(previous.isConnected||(img===next&&next.isConnected));}
  function fallback(){if(!valid())return;failedVideo=asset;pendingAsset='';motionBusy=false;const target=img===next?next:previous;stopMedia(next);const p=document.createElement('img');p.alt='';p.className='aiyou-motion-art';p.setAttribute('aria-hidden','true');p.src=still;stopMedia(previous);target.replaceWith(p);img=p;currentAsset=still;layer.dataset.event='poster';layer.dataset.mediaType='image';}
  function commit(){if(!valid()){stopMedia(next);return;}pendingAsset='';stopMedia(previous);previous.replaceWith(next);img=next;currentAsset=asset;layer.dataset.event=event;layer.dataset.mediaType=isVideo?'video':'image';nonce++;
   if(isVideo){motionBusy=true;next.play().catch(fallback);}
  }
  if(isVideo)next.addEventListener('ended',()=>{
   if(destroyed||img!==next||revision!==decodeRevision)return;motionBusy=false;
   const repeated=transientRevision!==request&&transient===event;
   if(transientRevision===request&&transient===event)transient=null;
   const wanted=eventFor();
   if(wanted==='running'&&event==='running'&&!repeated){next.currentTime=0;motionBusy=true;next.play().catch(()=>{motionBusy=false;failedVideo=asset;renderVideo('poster',true);});return;}
   if(wanted===event&&!repeated)return;
   // A shared HD poster bridges decoders. The next action starts only at this
   // real media boundary, never because a wall-clock timer happened to fire.
   stopMedia(next);const p=document.createElement('img');p.alt='';p.className='aiyou-motion-art';p.setAttribute('aria-hidden','true');p.src=still;next.replaceWith(p);img=p;currentAsset=still;layer.dataset.event='poster';layer.dataset.mediaType='image';render(repeated);
  });
  next.addEventListener('error',fallback,{once:true});
  next.src=asset;if(isVideo){next.addEventListener('loadeddata',commit,{once:true});next.load();}else if(next.complete&&next.naturalWidth)commit();else next.addEventListener('load',commit,{once:true});
 }
 // All clips share an encoded neutral boundary. A pending event never tears an
 // active action in half. Status is read again at the boundary (latest wins).
 function renderAnchored(event,asset,restart){
  const staticMode=!prefs.motion||reduced.matches||document.hidden;
  if(staticMode){clearTimeout(boundaryTimer);motionBusy=false;if(pendingAsset&&pendingAsset!==asset){decodeRevision++;pendingAsset='';}}
  if(motionBusy)return;
  if(pendingAsset===asset)return;
  if(asset===currentAsset&&!restart)return;
  pendingAsset=asset;
  const revision=++decodeRevision,request=transientRevision,previous=img;
  const next=document.createElement('img');next.alt='';next.setAttribute('aria-hidden','true');next.draggable=false;next.className='aiyou-motion-art';next.src=asset;
  function commit(){if(destroyed||revision!==decodeRevision||!previous.isConnected)return;
   pendingAsset='';previous.replaceWith(next);img=next;currentAsset=asset;layer.dataset.event=event;nonce++;
   if(event!=='poster'&&!staticMode){motionBusy=true;const duration=config.manifest.motion[event]?.durationMs||4000;
    function boundary(){if(destroyed)return;motionBusy=false;
     const repeated=transientRevision!==request&&transient===event;
     if(transientRevision===request&&transient===event)transient=null;
     const wanted=eventFor();
     if(wanted!==event||repeated){render(repeated);return;}
     if(event==='running'){motionBusy=true;boundaryTimer=setTimeout(boundary,duration);}
    }
    boundaryTimer=setTimeout(boundary,duration);
   }
  }
  next.addEventListener('error',()=>{if(revision===decodeRevision&&!destroyed){pendingAsset='';motionBusy=false;transient=null;if(asset!==config.poster){currentAsset='';renderAnchored('poster',config.poster,false);}}},{once:true});
  if(next.complete&&next.naturalWidth)commit();else next.addEventListener('load',commit,{once:true});
 }
 function play(event){if(!prefs.enabled||!prefs.motion||reduced.matches||document.hidden||(anchored&&currentState==='error'&&event!=='error'))return;transient=event;transientRevision++;clearTimeout(eventTimer);render(true);if(!anchored)eventTimer=setTimeout(()=>{transient=null;render();},config.manifest.motion[event]?.durationMs||1200);}
 function decorateComposer(){
  for(const e of composerMarks){e.removeAttribute('data-aiyou-composer-area');e.removeAttribute('data-aiyou-composer-path');e.removeAttribute('data-aiyou-composer-paint');}composerMarks.clear();composerAreas.clear();
  if(!prefs.enabled||!host)return;
  const hr=host.getBoundingClientRect();
  for(const body of document.querySelectorAll('[data-composer-body],[data-claude-compose],.thread-pane .composer')){
   if(!visible(body)||body.closest('[hidden],[inert]'))continue;
   const br=body.getBoundingClientRect();
   if(!host.contains(body)&&(host.id==='aiyoucodex-claude-panel'||body.closest('#aiyoucodex-claude-panel')||br.left<hr.left-30||br.right>hr.right+30||br.top<hr.top))continue;
   let area=body.closest('[data-codex-composer-root],[data-chatgpt-composer],form')||body.parentElement;
   if(!area||area===host)continue;
   while(area.parentElement&&area.parentElement!==host&&area.parentElement!==document.body){
    const p=area.parentElement,r=p.getBoundingClientRect();
    if(p.contains(host)||r.height>Math.max(320,hr.height*.4)||r.width>hr.width+60||p.querySelector('[data-user-message-bubble],[data-markdown-text-style="assistant-message"],.message-row'))break;
    area=p;
   }
   area.setAttribute('data-aiyou-composer-area','');composerMarks.add(area);composerAreas.add(area);
   // Native ComposerSurface (Ikr): noninteractive gradient siblings can sit
   // beside the root or at the footer shell, not on the body ancestor path.
   for(const e of area.querySelectorAll('[aria-hidden="true"].pointer-events-none.absolute'))if([...e.classList].some(c=>c.startsWith('bg-gradient-to-')||c==='bg-surface'||c==='bg-surface-secondary')){e.setAttribute('data-aiyou-composer-paint','');composerMarks.add(e);}
   for(let e=body.parentElement;e&&e!==area;e=e.parentElement){e.setAttribute('data-aiyou-composer-path','');composerMarks.add(e);}
  }
 }
 function decorateChrome(){
  decorateComposer();
  if(!prefs.enabled){chassis?.remove();chassis=null;return;}
  const mark=(el,attr)=>{if(el&&!el.hasAttribute(attr)){el.setAttribute(attr,'');if(!chromeMarks.has(el))chromeMarks.set(el,new Set());chromeMarks.get(el).add(attr);}};
  mark(document.getElementById('aiyoucodex-agent-launchers')?.parentElement,'data-aiyou-launcher-group');
  mark([...document.querySelectorAll('aside nav')].find(e=>visible(e)&&e.getBoundingClientRect().width<80),'data-aiyou-rail');
  for(const e of document.querySelectorAll('header')){const r=e.getBoundingClientRect();if(r.y<2&&r.height>20&&r.width>innerWidth*.8)mark(e,'data-aiyou-titlebar');}
  if(!chassis?.isConnected){chassis=document.createElement('div');chassis.id='aiyou-theme-chassis';chassis.setAttribute('aria-hidden','true');chassis.innerHTML='<i class="aiyou-armor-rail"></i><i class="aiyou-armor-rail aiyou-armor-right"></i><i class="aiyou-armor-seam"><i></i></i><span class="aiyou-armor-footer">GOOD CODE · HIGHER INTELLIGENCE</span>';for(const corner of ['tl','tr','bl','br'])if(config.decals?.corner){const art=document.createElement('img');art.className='aiyou-corner aiyou-corner-'+corner;art.src=config.decals.corner;art.alt='';chassis.append(art);}document.body.append(chassis);}
  chassis.style.setProperty('--aiyou-host-left',(host?.getBoundingClientRect().x||innerWidth*.36)+'px');
  chassis.style.setProperty('--aiyou-titlebar-height',(host?.getBoundingClientRect().top||[...document.querySelectorAll('[data-aiyou-titlebar]')].find(visible)?.getBoundingClientRect().height||44)+'px');
 }
 function clearWorkspace(){stopMedia(img);clearTimeout(boundaryTimer);motionBusy=false;pendingAsset='';decodeRevision++;activeFormat='';resizeObserver.disconnect();for(const e of workspacePaths)e.removeAttribute('data-aiyou-workspace-path');workspacePaths.clear();workspace?.removeAttribute('data-aiyou-workspace');workspace=null;trackedSidebar=null;layer?.remove();layer=null;img=null;currentAsset='';}
 function workspaceNodes(){const sidebar=[...document.querySelectorAll('.app-shell-left-panel')].find(visible);return {sidebar,chat:host};}
 function updateBounds(){if(!layer||!host)return;const {sidebar,chat}=workspaceNodes(),rects=[sidebar,chat,...composerAreas].filter(visible).map(e=>e.getBoundingClientRect());if(!rects.length)return;const left=Math.max(0,Math.min(...rects.map(r=>r.left))),top=Math.max(0,Math.min(...rects.map(r=>r.top))),right=Math.min(innerWidth,Math.max(...rects.map(r=>r.right))),bottom=Math.min(innerHeight,Math.max(...rects.map(r=>r.bottom)));
  for(const [k,v] of Object.entries({left,top,width:right-left,height:bottom-top})){const value=v+'px';if(layer.style[k]!==value)layer.style[k]=value;}
  const brand=layer.querySelector('.aiyou-brand');if(brand){const value=Math.max(24,chat.getBoundingClientRect().left-left+24)+'px';if(brand.style.left!==value)brand.style.left=value;}
 }
 function queueBounds(){if(resizeQueued||destroyed)return;resizeQueued=true;requestAnimationFrame(()=>{resizeQueued=false;if(!destroyed)updateBounds();});}
 function mount(){const next=activeHost();const changed=next!==host;host?.removeAttribute('data-aiyou-theme-host');host=next;decorateComposer();if(!host||!prefs.enabled){clearWorkspace();return;}
  host.dataset.aiyouThemeHost='true';marked.add(host);const {sidebar}=workspaceNodes();trackedSidebar=sidebar;const endpoints=[sidebar,host,...composerAreas].filter(Boolean);let common=endpoints[0];while(common&&!endpoints.every(e=>common.contains(e)))common=common.parentElement;common=common||host;
  if(common!==workspace||!layer?.isConnected){clearWorkspace();workspace=common;workspace.setAttribute('data-aiyou-workspace','');layer=document.createElement('div');layer.id='aiyou-theme-backdrop';layer.setAttribute('aria-hidden','true');img=document.createElement('img');img.className='aiyou-motion-art';const brand=document.createElement('div');brand.className='aiyou-brand';brand.innerHTML='<small>与更强的你，一起构建可能</small>';const side=document.createElement('div');side.className='aiyou-brand-side';side.innerHTML='<strong></strong>A BRIGHTER\nTOMORROW\nWITH\nYOU';if(config.decals?.wordmark){for(const container of [brand,side.querySelector('strong')]){const logo=document.createElement('img');logo.className='aiyou-wordmark';logo.src=config.decals.wordmark;logo.alt='';container.prepend(logo);}}else brand.prepend(document.createTextNode('AIYOUCODEX'));layer.append(img,brand,side);workspace.prepend(layer);}
  trackedSidebar=sidebar;for(const e of workspacePaths)e.removeAttribute('data-aiyou-workspace-path');workspacePaths.clear();resizeObserver.disconnect();for(const endpoint of endpoints){resizeObserver.observe(endpoint);let node=endpoint;while(node&&node!==workspace){node.setAttribute('data-aiyou-workspace-path','');workspacePaths.add(node);node=node.parentElement;}}resizeObserver.observe(workspace);updateBounds();render();if(changed&&threadKey)play('enter');}
 function apply(persist=true){const signature=JSON.stringify([prefs.background.source,prefs.background.customStates,prefs.motion]);if(signature!==customSignature){customSignature=signature;stopMedia(img);clearTimeout(boundaryTimer);motionBusy=false;pendingAsset='';currentAsset='';decodeRevision++;failedCustom='';}syncCustom();customStyle.textContent=prefs.enabled?controls.css(prefs):'';if(prefs.enabled)html.dataset.aiyouTheme=config.manifest.id;else{html.removeAttribute('data-aiyou-theme');clearWorkspace();host?.removeAttribute('data-aiyou-theme-host');host=null;}mount();decorateChrome();render();if(persist)save();broadcastFrames();}
 function ensureTrigger(){if(button?.isConnected)return;const rail=document.querySelector('aside nav.group\\/sidebar-rail')||[...document.querySelectorAll('aside nav')].find(e=>e.getBoundingClientRect().width<80);if(!rail)return;button=document.createElement('button');button.id='aiyou-theme-trigger';button.type='button';button.title='主题与动效';button.setAttribute('aria-label','主题与动效');button.setAttribute('aria-haspopup','dialog');button.textContent='◈';button.addEventListener('click',openSettings);rail.append(button);}
 function openSettings(){if(dialog?.open)return;dialog?.remove();const before=controls.normalize(prefs),revision=externalRevision;let committed=false,uploading=false;const staged=new Set();dialog=document.createElement('dialog');dialog.id='aiyou-theme-settings';dialog.setAttribute('aria-labelledby','aiyou-theme-settings-title');const panel=dialog;
 const colorLabels=[['primary','主要文字'],['secondary','次要文字'],['link','链接文字'],['success','成功文字'],['danger','错误文字'],['warning','警告文字'],['inverse','实色按钮文字']];
 const sliders=[['overall','全部底色'],['chrome','顶栏 / 导航栏'],['sidebar','项目侧栏'],['chat','右侧聊天区域底色'],['panel','面板 / 工具结果'],['card','任务卡片 / 资产卡片'],['message','对话气泡'],['composer','输入框背景'],['composer-area','输入区外层背景'],['control','按钮 / 输入控件'],['menu','菜单 / 弹窗'],['text','文字（独立）'],['border','边框'],['shadow','阴影'],['decoration','软糖装饰']];
 dialog.innerHTML='<h2 id="aiyou-theme-settings-title">主题与动效</h2><p class="aiyou-settings-note">实时预览，保存后生效。底色与文字独立；整体仅影响底色。透明度 0% 为实色，100% 为全透明。</p><div class="aiyou-settings-scroll"><label>界面主题<select data-theme-select><option value="pink">粉嫩软糖</option><option value="default">系统默认</option></select></label><label>播放动效<input type="checkbox" data-motion></label><fieldset><legend>连续大背景</legend><label>背景来源<select data-background-source><option value="builtin">主题内置</option><option value="custom">自定义素材</option></select></label><div data-custom-options>'+customStates.map(([key,label])=>'<section class="aiyou-custom-slot" data-custom-slot-editor="'+key+'"><h3>'+label+'</h3><label>选择素材<input type="file" data-custom-file="'+key+'" accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm" aria-label="'+label+'素材"></label><p data-custom-info="'+key+'"></p><label>图片 / GIF 状态时长（秒）<input type="number" data-custom-duration="'+key+'" min="1" max="30" step="0.5"></label><div><button type="button" data-custom-preview="'+key+'">预览此状态</button><button type="button" data-custom-clear="'+key+'">清除此状态</button></div></section>').join('')+'<p data-custom-status role="status" aria-live="polite"></p><button type="button" data-custom-remove>移除全部自定义素材</button><small>图片 / GIF ≤20 MB，视频 ≤100 MB。仅保存本机；七个状态可分别选择图片 / GIF / 视频；未配置状态回退到待机素材，再回退内置静态图。视频静音，待机 / 运行循环，其余按末尾切换；图片 / GIF按设置时长切换。建议所有动画共用首尾姿态；关闭动效使用待机静态预览。</small></div><label>背景类型<select data-background-type><option value="image">静态图片</option><option value="gif">GIF 动图（自定义素材）</option><option value="video">视频（自定义素材）</option></select></label><label>显示方式<select data-fit><option value="cover">铺满区域（可能裁切）</option><option value="contain">完整图片（可能留边）</option></select></label><label>背景显现强度<input type="range" min="0" max="100" step="1" data-image aria-label="背景显现强度"><output data-image-value></output></label><label>水平位置<input type="range" min="0" max="100" step="1" data-position="x" aria-label="背景水平位置"><output data-position-value="x"></output></label><label>垂直位置<input type="range" min="0" max="100" step="1" data-position="y" aria-label="背景垂直位置"><output data-position-value="y"></output></label></fieldset><fieldset><legend>输入框背景透明度</legend><small>只改变底色，不改变文字；输入框与外层区域分别调节。</small>'+sliders.filter(([key])=>key==='composer'||key==='composer-area').map(([key,label])=>'<label>'+label+'<input type="range" min="0" max="100" step="1" data-alpha="'+key+'" aria-label="'+label+'透明度"><output data-alpha-value="'+key+'"></output></label>').join('')+'</fieldset><fieldset><legend>其他分层透明度</legend>'+sliders.filter(([key])=>key!=='composer'&&key!=='composer-area').map(([key,label])=>'<label>'+label+'<input type="range" min="0" max="100" step="1" data-alpha="'+key+'" aria-label="'+label+'透明度"><output data-alpha-value="'+key+'"></output></label>').join('')+'</fieldset>'+(controls.cardEditorHtml?.()||'')+'<fieldset><legend>文字颜色</legend>'+colorLabels.map(([key,label])=>'<label>'+label+'<input type="color" data-color="'+key+'" aria-label="'+label+'颜色"><input type="text" data-hex="'+key+'" aria-label="'+label+' HEX 颜色" maxlength="7" spellcheck="false"></label>').join('')+'</fieldset><div class="aiyou-theme-sample" aria-label="主题配置预览"><strong>对话 / 卡片示例</strong><p>这段主要文字与底色独立配置。</p><small>次要文字 · 时间 · 状态说明</small></div><p data-contrast role="status" aria-live="polite"></p><small>进入聊天、点击、发送分别播放。卡片状态颜色可分别设置；系统减少动态时显示静态背景。对比度提示是最亮背景的保守估算，不会改写你的配置。</small></div><footer><button type="button" data-reset>恢复默认</button><button type="button" data-cancel>取消</button><button type="button" data-theme-close>保存并完成</button></footer>';
 function refresh(){controls.refreshCardEditor?.(dialog,prefs);dialog.querySelector('[data-background-source]').value=prefs.background.source;dialog.querySelector('[data-custom-options]').hidden=prefs.background.source!=='custom';dialog.querySelector('[data-background-type]').disabled=prefs.background.source==='custom';for(const [key] of customStates){const asset=prefs.background.customStates[key],slot=dialog.querySelector('[data-custom-slot-editor="'+key+'"]');slot.querySelector('[data-custom-info]').textContent=asset?asset.name+' · '+asset.type+' · '+(asset.bytes/1048576).toFixed(1)+' MB':key==='poster'?'未配置：使用内置静态背景':'未配置：使用待机 / 通用背景';slot.querySelector('[data-custom-duration]').value=(asset?.durationMs||4000)/1000;slot.querySelector('[data-custom-duration]').disabled=!asset||asset.type==='video'||key==='poster';slot.querySelector('[data-custom-clear]').disabled=!asset;slot.querySelector('[data-custom-preview]').disabled=uploading;slot.querySelector('[data-custom-file]').disabled=uploading;}dialog.querySelector('[data-custom-status]').textContent=customStatus;dialog.querySelector('[data-custom-remove]').disabled=!customIds(prefs).size;dialog.querySelector('[data-theme-close]').disabled=uploading;dialog.querySelector('[data-background-type]').value=prefs.background.type;dialog.querySelector('[data-theme-select]').value=prefs.enabled?'pink':'default';dialog.querySelector('[data-motion]').checked=prefs.motion;dialog.querySelector('[data-fit]').value=prefs.background.fit;dialog.querySelector('[data-image]').value=Math.round(prefs.alpha.image*100);dialog.querySelector('[data-image-value]').textContent=Math.round(prefs.alpha.image*100)+'%';for(const [key] of sliders){const value=Math.round((1-prefs.alpha[key])*100);dialog.querySelector('[data-alpha="'+key+'"]').value=value;dialog.querySelector('[data-alpha-value="'+key+'"]').textContent=value+'%';}for(const key of ['x','y']){dialog.querySelector('[data-position="'+key+'"]').value=prefs.background[key];dialog.querySelector('[data-position-value="'+key+'"]').textContent=prefs.background[key]+'%';}for(const [key] of colorLabels){dialog.querySelector('[data-color="'+key+'"]').value=prefs.colors[key];const e=dialog.querySelector('[data-hex="'+key+'"]');e.value=prefs.colors[key];e.setCustomValidity('');e.removeAttribute('aria-invalid');}const c=controls.contrast(prefs);dialog.querySelector('[data-contrast]').textContent=(c.passes?'可读性估算通过：':'当前设置可能降低可读性：')+c.minimum+':1（主 / 次文字建议 ≥ 4.5:1）';const sample=dialog.querySelector('.aiyou-theme-sample');sample.style.background=`color-mix(in srgb,var(--aiyou-elevated) ${prefs.alpha.card*prefs.alpha.overall*100}%,transparent)`;sample.style.color=`color-mix(in srgb,${prefs.colors.primary} ${prefs.alpha.text*100}%,transparent)`;sample.style.setProperty('--sample-secondary',`color-mix(in srgb,${prefs.colors.secondary} ${prefs.alpha.text*100}%,transparent)`);}
 dialog.addEventListener('input',e=>{const t=e.target;if(t.matches('[data-alpha]'))prefs.alpha[t.dataset.alpha]=1-Number(t.value)/100;else if(t.matches('[data-image]'))prefs.alpha.image=Number(t.value)/100;else if(t.matches('[data-position]'))prefs.background[t.dataset.position]=Number(t.value);else if(t.matches('[data-color]'))prefs.colors[t.dataset.color]=t.value;else if(t.matches('[data-hex]')){if(!/^#[0-9a-f]{6}$/i.test(t.value)){t.setCustomValidity('请填写 #RRGGBB 格式');t.setAttribute('aria-invalid','true');return;}prefs.colors[t.dataset.hex]=t.value;}else return;prefs=controls.normalize(prefs);apply(false);refresh();});
 let finishPromise;
 function finishSettings(){if(finishPromise)return finishPromise;if(!committed&&!destroyed&&revision===externalRevision){prefs=before;transient=null;apply();}const keep=customIds(prefs),remove=new Set([...staged,...(committed?customIds(before):[])]);const tasks=[];for(const id of remove)if(!keep.has(id)){releaseCustom(id);tasks.push(mediaStore?.remove(id).catch(()=>{}));}finishPromise=Promise.all(tasks);return finishPromise;}
 cancelSettings=()=>{if(panel.open){void finishSettings();panel.close();}};
 dialog.querySelector('[data-background-source]').addEventListener('change',e=>{prefs.background.source=e.target.value;customStatus='';failedCustom='';apply(false);refresh();});
 dialog.addEventListener('change',async e=>{
  if(!e.target.matches('[data-custom-file]'))return;const state=e.target.dataset.customFile;
  const file=e.target.files[0];if(!file||uploading)return;uploading=true;customStatus='正在检查并保存本机素材…';refresh();
  try{const meta=await mediaStore.prepare(file);staged.add(meta.id);
   if(destroyed||dialog!==panel||!panel.open||revision!==externalRevision){await mediaStore.remove(meta.id);return;}
   prefs.background.customStates[state]=meta;prefs.background.source='custom';prefs=controls.normalize(prefs);failedCustom='';customStatus='该状态素材已就绪，保存并完成后保留';apply(false);
  }catch(error){if(!destroyed&&dialog===panel&&panel.open)customStatus=error.message||'素材导入失败';}
  finally{uploading=false;e.target.value='';if(!destroyed&&dialog===panel&&panel.open)refresh();}
 });
 dialog.querySelector('[data-custom-remove]').addEventListener('click',()=>{prefs.background.custom=null;prefs.background.customStates={};prefs.background.source='builtin';customStatus='保存后移除；取消可恢复';apply(false);refresh();});
 dialog.addEventListener('change',e=>{if(!e.target.matches('[data-custom-duration]'))return;const asset=prefs.background.customStates[e.target.dataset.customDuration];if(!asset)return;asset.durationMs=Math.max(1000,Math.min(30000,Number(e.target.value)*1000||4000));prefs=controls.normalize(prefs);apply(false);refresh();});
 dialog.addEventListener('click',e=>{const clear=e.target.closest('[data-custom-clear]'),preview=e.target.closest('[data-custom-preview]');if(clear){delete prefs.background.customStates[clear.dataset.customClear];prefs=controls.normalize(prefs);customStatus='保存后清除此状态；取消可恢复';apply(false);refresh();}if(preview){stopMedia(img);clearTimeout(boundaryTimer);motionBusy=false;pendingAsset='';currentAsset='';decodeRevision++;transient=preview.dataset.customPreview;transientRevision++;render();}});
 controls.bindCardEditor?.(dialog,()=>prefs,p=>{prefs=p;apply(false);refresh();});
 dialog.querySelector('[data-theme-select]').addEventListener('change',e=>{prefs.enabled=e.target.value==='pink';apply(false);refresh();});dialog.querySelector('[data-motion]').addEventListener('change',e=>{prefs.motion=e.target.checked;apply(false);});dialog.querySelector('[data-background-type]').addEventListener('change',e=>{prefs.background.type=e.target.value;apply(false);refresh();});dialog.querySelector('[data-fit]').addEventListener('change',e=>{prefs.background.fit=e.target.value;apply(false);});dialog.querySelector('[data-reset]').addEventListener('click',()=>{prefs=controls.normalize();apply(false);refresh();});dialog.querySelector('[data-cancel]').addEventListener('click',()=>cancelSettings());dialog.querySelector('[data-theme-close]').addEventListener('click',()=>{if(![...dialog.querySelectorAll('input')].every(e=>e.reportValidity()))return;if(prefs.background.source==='custom'&&!customIds(prefs).size){customStatus='请先选择本地素材，或改回主题内置';refresh();return;}if(!save()){customStatus='配置保存失败，请检查本机存储空间';refresh();return;}committed=true;void finishSettings().then(()=>panel.close());});dialog.addEventListener('close',()=>{void finishSettings();button?.focus();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelSettings();}});document.body.append(dialog);refresh();dialog.showModal();}
 function userRevision(scope){return [...(scope?.querySelectorAll('[data-user-message-bubble="true"],article[data-role="user"], [data-message-author-role="user"]')||[])].map(e=>e.dataset.messageId||e.textContent).join('\u001f');}
 function tick(){if(destroyed)return;ensureTrigger();if(!prefs.enabled)return;mount();decorateChrome();const info=stateInfo();currentState=info.state;if(info.key!==threadKey){threadKey=info.key;lastState=info.state;pendingSend=null;play('enter');}else if(info.state!==lastState){lastState=info.state;if(anchored&&((transient==='complete'&&info.state!=='completed-unread')||(transient==='error'&&info.state!=='error'))){transient=null;transientRevision++;}if(info.state==='error')play('error');else if(info.state==='completed-unread')play('complete');}
 if(pendingSend){if(Date.now()-pendingSend.at>10000||pendingSend.key!==info.key)pendingSend=null;else if(userRevision(host)!==pendingSend.revision||(info.state==='running'&&pendingSend.state!=='running')){pendingSend=null;play('send');}}render();}
 function inputValue(scope){const e=scope?.querySelector('[data-claude-prompt],textarea,[contenteditable="true"]');return e?.value||e?.textContent||'';}
 function sendIntent(scope){if(!inputValue(scope).trim()||Date.now()-lastSend<700)return;lastSend=Date.now();pendingSend={at:Date.now(),key:threadKey,state:currentState,revision:userRevision(host)};}
 function onClick(e){if(!(e.target instanceof Element)||e.target.closest('#aiyou-theme-settings,#aiyou-theme-trigger'))return;const b=e.target.closest('button,[role="button"],a,[data-app-action-sidebar-thread-row]');if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')return;const composer=b.closest('[data-composer-body],#aiyoucodex-claude-panel');const isSend=b.matches('[data-claude-send]')||/^(发送|Send|Send message|发送消息)$/i.test(b.getAttribute('aria-label')||b.title||b.textContent.trim());if(composer&&isSend){sendIntent(composer);return;}if(Date.now()-lastClick<900)return;lastClick=Date.now();play('click');}
 function onKey(e){if(e.ctrlKey&&e.altKey&&e.code==='KeyT'){e.preventDefault();openSettings();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.target.matches('[data-claude-prompt],textarea,[contenteditable="true"]')){const composer=e.target.closest('[data-composer-body],#aiyoucodex-claude-panel');if(composer)sendIntent(composer);}}
 function onVisibility(){transient=null;clearTimeout(eventTimer);render();}
 let mountQueued=false;
 const mountObserver=new MutationObserver(records=>{const composerChanged=records.some(r=>r.target instanceof Element&&r.target.closest('[data-aiyou-composer-area]')||[...r.addedNodes].some(n=>n instanceof Element&&(n.matches('[data-composer-body],[data-codex-composer-root]')||n.querySelector('[data-composer-body],[data-codex-composer-root]'))));if(!destroyed&&prefs.enabled&&!mountQueued&&(composerChanged||activeHost()!==host||workspaceNodes().sidebar!==trackedSidebar||(host&&!layer?.isConnected))){mountQueued=true;queueMicrotask(()=>{mountQueued=false;if(!destroyed)tick();});}});
 mountObserver.observe(document.body,{childList:true,subtree:true});
 document.addEventListener('click',onClick,true);document.addEventListener('keydown',onKey,true);document.addEventListener('visibilitychange',onVisibility);reduced.addEventListener('change',onVisibility);window.addEventListener('message',onFrameMessage);window.addEventListener('resize',queueBounds);
 window[KEY]={version:config.manifest.version,getState:()=>({themeId:config.manifest.id,prefs:controls.normalize(prefs),threadKey,currentState,event:layer?.dataset.event||null,restarts:nonce,host:host?.tagName||null,mediaType:img?.tagName.toLowerCase()||null}),configure:p=>{externalRevision++;p=p&&typeof p==='object'?p:{};prefs=controls.normalize({...prefs,...p,alpha:{...prefs.alpha,...p.alpha},colors:{...prefs.colors,...p.colors},cards:{...prefs.cards,...p.cards,styles:Object.fromEntries(Object.keys(prefs.cards.styles).map(k=>[k,{...prefs.cards.styles[k],...p.cards?.styles?.[k]}]))},background:{...prefs.background,...p.background}});apply();},openSettings,play,
 destroy(){destroyed=true;customLoadRevision++;for(const e of composerMarks){e.removeAttribute('data-aiyou-composer-area');e.removeAttribute('data-aiyou-composer-path');e.removeAttribute('data-aiyou-composer-paint');}composerMarks.clear();mountObserver.disconnect();clearWorkspace();for(const id of customCache.keys())releaseCustom(id);clearInterval(timer);clearTimeout(eventTimer);document.removeEventListener('click',onClick,true);document.removeEventListener('keydown',onKey,true);document.removeEventListener('visibilitychange',onVisibility);reduced.removeEventListener('change',onVisibility);window.removeEventListener('message',onFrameMessage);window.removeEventListener('resize',queueBounds);const enabled=prefs.enabled;prefs.enabled=false;broadcastFrames();prefs.enabled=enabled;chassis?.remove();button?.remove();dialog?.remove();style.remove();customStyle.remove();html.removeAttribute('data-aiyou-theme');for(const node of marked)node.removeAttribute('data-aiyou-theme-host');for(const [el,attrs] of chromeMarks)for(const attr of attrs)el.removeAttribute(attr);}};
 if(retained?.themeId===config.manifest.id&&retained?.prefs)prefs=controls.normalize(retained.prefs);apply();tick();timer=setInterval(tick,800);
})();
