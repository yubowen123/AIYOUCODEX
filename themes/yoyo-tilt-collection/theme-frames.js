/* No page access beyond the known AIYOUcodex local asset/arena surfaces. */
(() => {
 const u=new URL(location.href),allowed=(u.origin==='https://web-sandbox.oaiusercontent.com'&&/^\/__codex_asset_console__\/[a-f0-9]{32,128}\/(?:model-arena\/)?(?:index\.html)?$/i.test(u.pathname))||(['http://127.0.0.1:47823','http://localhost:47823'].includes(u.origin)&&['/','/index.html'].includes(u.pathname));
 const nativeBoard=u.protocol==='blob:'&&u.origin==='app://-'&&window.frameElement?.id==='codex-taskboard-frame';
 if((!allowed&&!nativeBoard)||window.top===window||!window.__AIYOUCODEX_FRAME_STYLE__)return;
 window.__AIYOUCODEX_FRAME_THEME__?.destroy?.();
 const style=document.createElement('style');style.id='aiyou-frame-theme-style';style.textContent=window.__AIYOUCODEX_FRAME_STYLE__;document.head.append(style);
 const controls=window.__AIYOU_THEME_CONTROLS__,custom=document.createElement('style');custom.id='aiyou-frame-theme-customization';document.head.append(custom);
 const apply=(enabled,preferences)=>{custom.textContent=enabled?controls.css(preferences):'';if(enabled)document.documentElement.dataset.aiyouTheme='yoyo-tilt-collection';else document.documentElement.removeAttribute('data-aiyou-theme');};
 const receive=e=>{if(e.source!==parent||!['app://-','null'].includes(e.origin)||e.data?.type!=='aiyoucodex:theme-state')return;apply(e.data.enabled===true,controls.normalize(e.data.preferences));};
 window.addEventListener('message',receive);
 const subscribe=()=>parent.postMessage({type:'aiyoucodex:theme-subscribe'},'*');subscribe();
 const timer=setInterval(subscribe,2000);
 window.__AIYOUCODEX_FRAME_THEME__={destroy(){clearInterval(timer);window.removeEventListener('message',receive);style.remove();apply(false);custom.remove();}};
})();
