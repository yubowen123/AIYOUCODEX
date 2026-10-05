import test from 'node:test';
import assert from 'node:assert/strict';
import {validateThemeManifest,chooseThemeEvent,readOptionalThemeSource,THEME_EVENTS,themeContrastRatio,validateThemePalette,buildThemePaletteCss,buildThemeDesignCss,THEME_COLOR_CONTEXTS,createThemeCustomization} from '../lib/theme-package.mjs';
const manifest = () => ({schemaVersion:1,id:'mecha-control',name:'机甲控制舱',version:'1.0.0',renderer:'aiyoucodex-theme-v1',poster:'assets/poster.png',motion:Object.fromEntries(THEME_EVENTS.map(id=>[id,{file:`assets/${id}.gif`,durationMs:4000}]))});
test('light themes keep independent surface defaults and soft shadows without changing dark theme defaults',()=>{
 const dark=createThemeCustomization();
 assert.equal(dark.defaults.alpha.sidebar,.72);
 const light=createThemeCustomization({id:'pink-candy',mode:'light',motionDefault:false,primary:'#493b45',secondary:'#595959',base:'#fff3f7',surface:'#fffdfe',backgroundType:'image',alphaDefaults:{chrome:.9,sidebar:.86,message:.82,image:.46},colorDefaults:{warning:'#a74370'}});
 assert.equal(light.defaults.alpha.sidebar,.86);
 assert.equal(light.normalize({alpha:{text:1}}).alpha.chrome,.9);
 assert.equal(light.defaults.background.type,'image');
 assert.equal(light.defaults.motion,false);
 assert.match(light.css({}),/--aiyou-custom-shadow:inset 0 1px 1px color-mix\(in srgb,#ffffff/);
 assert.doesNotMatch(light.css({}),/#000000 50/);
 assert.equal(light.contrast({}).passes,true);
 assert.match(dark.css({}),/#000000 50/);
});
test('manifest validates all independent event clips and confines asset paths',()=>{
  assert.equal(validateThemeManifest(manifest()).id,'mecha-control');
  for(const path of ['../keys.md','assets/../poster.png','https://example.com/a.gif','assets/poster.svg']){const m=manifest();m.poster=path;assert.throws(()=>validateThemeManifest(m));}
  const m=manifest();delete m.motion.send;assert.throws(()=>validateThemeManifest(m));
});
test('event priority keeps errors, transient actions, state semantics and still mode separate',()=>{
  assert.equal(chooseThemeEvent({state:'running'}),'running');
  assert.equal(chooseThemeEvent({state:'completed-unread'}),'complete');
  assert.equal(chooseThemeEvent({state:'read'}),'idle');
  assert.equal(chooseThemeEvent({state:'running',transient:'send'}),'send');
  assert.equal(chooseThemeEvent({state:'error',transient:'click'}),'error');
  assert.equal(chooseThemeEvent({state:'running',hidden:true}),'poster');
  assert.equal(chooseThemeEvent({state:'running',reduced:true}),'poster');
});
test('three background formats have confined paths and a complete video state set',()=>{
 const m=manifest();m.background={defaultType:'video',image:'assets/background.png',videos:Object.fromEntries(THEME_EVENTS.map(id=>[id,'assets/'+id+'.mp4']))};
 assert.equal(validateThemeManifest(m).background.defaultType,'video');
 for(const file of ['../private.mp4','https://example.com/a.mp4','assets/not.js']){const bad=structuredClone(m);bad.background.videos.click=file;assert.throws(()=>validateThemeManifest(bad),/video/);}
 const bad=structuredClone(m);delete bad.background.videos.error;assert.throws(()=>validateThemeManifest(bad),/video/);
 const c=createThemeCustomization({backgroundType:'video'});assert.equal(c.defaults.background.type,'video');assert.equal(c.normalize({background:{fit:'contain'}}).background.type,'video');
 assert.equal(c.normalize({background:{type:'image'}}).background.type,'image');assert.equal(c.normalize({background:{type:'gif'}}).background.type,'gif');
 assert.equal(c.normalize({background:{type:'script'}}).background.type,'video');assert.equal(c.defaults.alpha['composer-area'],0);
 assert.match(c.css({alpha:{overall:.5,'composer-area':.4}}),/--aiyou-alpha-composer-area:0.2/);
});
test('existing installations without theme retain unchanged renderer source',async()=>{
  assert.equal(await readOptionalThemeSource('/nonexistent-aiyoucodex-theme-test'),'');
});
test('custom background prefs migrate without binaries, URLs or arbitrary asset references',()=>{
 const c=createThemeCustomization({backgroundType:'video'});
 assert.equal(c.defaults.background.source,'builtin');assert.equal(c.defaults.background.custom,null);
 const meta={id:'12345678-1234-1234-1234-123456789abc',type:'gif',name:'角色.gif',bytes:4000,url:'https://private.example',data:'binary'};
 const p=c.normalize({background:{source:'custom',custom:meta}});
 assert.equal(p.background.source,'custom');assert.deepEqual(p.background.custom,{id:meta.id,type:'gif',name:'角色.gif',bytes:4000,durationMs:4000});
 assert.deepEqual(p.background.customStates.poster,p.background.custom);
 for(const bad of [{...meta,id:'https://example.com'},{...meta,type:'script'},{...meta,bytes:Infinity},{...meta,bytes:101*1048576}])assert.equal(c.normalize({background:{custom:bad}}).background.custom,null);
 assert.match(c.css({alpha:{composer:.25,text:1}}),/--aiyou-alpha-composer:0.25/);
});
test('custom states preserve seven independent slots and reject unknown state, URL and oversized files',()=>{
 const c=createThemeCustomization();const meta={id:'12345678-1234-1234-1234-123456789abc',type:'gif',name:'机甲.gif',bytes:4000,durationMs:2000,url:'https://example.com'};
 const states=Object.fromEntries(['poster','enter','click','send','running','complete','error'].map(k=>[k,meta]));states.publish=meta;
 const p=c.normalize({background:{source:'custom',customStates:states}});
 assert.equal(Object.keys(p.background.customStates).length,7);assert.equal(p.background.customStates.send.durationMs,2000);assert.equal(p.background.customStates.publish,undefined);assert.equal(p.background.customStates.error.url,undefined);
 assert.deepEqual(c.normalize({background:{custom:meta,customStates:{}}}).background.customStates,{});
 assert.equal(c.normalize({background:{customStates:{running:{...meta,bytes:21*1048576}}}}).background.customStates.running,undefined);
 assert.equal(c.normalize({background:{customStates:{running:{...meta,type:'video',bytes:21*1048576}}}}).background.customStates.running.bytes,21*1048576);
});
test('shared-anchor motion contract rejects hard cuts and unbounded event queues',()=>{
 const m=manifest();m.transitions={mode:'shared-anchor',pendingPolicy:'latest-wins',switchAt:'clip-boundary',anchor:m.poster,neutralHoldFrames:3};assert.equal(validateThemeManifest(m).transitions.mode,'shared-anchor');
 for(const [key,value]of [['mode','hard-cut'],['switchAt','immediate'],['pendingPolicy','all'],['anchor','assets/different.png'],['neutralHoldFrames',0]]){const n=structuredClone(m);n.transitions[key]=value;assert.throws(()=>validateThemeManifest(n),/transition/);}
});
const palette=()=>({schemaVersion:1,mode:'dark',contexts:[...THEME_COLOR_CONTEXTS],primitives:{black:'#0c151e',white:'#edf4fa'},semantic:{fg:'white',bg:'black'},dynamicBackground:{textSurfaceMustBeOpaque:true},pairs:['body','panel-body','secondary','placeholder','timestamp','link','success','error','warning','user-message','accent-button','error-button'].map(role=>({role,foreground:'fg',background:'bg',minimum:role==='body'||role==='panel-body'?7:4.5}))});
test('palette checks every text/background pair and rejects dark-on-dark or translucent text',()=>{
  assert.equal(themeContrastRatio('#000000','#ffffff'),21);
  assert.equal(validateThemePalette(palette()).length,12);
  const p=palette();p.primitives.white='#131f2b';assert.throws(()=>validateThemePalette(p),/contrast/);
  p.primitives.white='#ffffff80';assert.throws(()=>validateThemePalette(p),/opaque/);
});
test('missing semantic roles, weakened thresholds and unprotected video text fail validation',()=>{
  const a=palette();a.pairs.pop();assert.throws(()=>validateThemePalette(a),/Missing/);
  const b=palette();b.pairs[0].minimum=1;assert.throws(()=>validateThemePalette(b),/weak/);
  const d=palette();d.dynamicBackground.textSurfaceMustBeOpaque=false;assert.throws(()=>validateThemePalette(d),/protect/);
  const e=palette();e.contexts=e.contexts.filter(c=>c!=='settings');assert.throws(()=>validateThemePalette(e),/context: settings/);
});
test('validated palette produces theme-scoped primitive and semantic tokens',()=>{
  const css=buildThemePaletteCss(palette(),'mecha-control');
  assert.match(css,/html\[data-aiyou-theme="mecha-control"\]/);assert.match(css,/--aiyou-fg:var\(--aiyou-white\)/);
  assert.throws(()=>buildThemePaletteCss(palette(),'x"]body'),/identity/);
});
test('translucent surfaces keep opaque text and validate brightest video composition',()=>{
  const p=palette();p.dynamicBackground={textSurfaceMustBeOpaque:false,textSurfaceAlpha:.82,textOpacity:1,imageOpacityMaximum:.46};
  p.pairs.forEach(pair=>pair.translucent=true);
  assert.ok(validateThemePalette(p).every(pair=>pair.ratio>=pair.minimum));
  assert.match(buildThemePaletteCss(p,'mecha-control'),/--aiyou-message-alpha:0.82/);
  p.dynamicBackground.textOpacity=.82;assert.throws(()=>validateThemePalette(p),/protect/);
  p.dynamicBackground.textOpacity=1;p.dynamicBackground.textSurfaceAlpha=.3;assert.throws(()=>validateThemePalette(p),/protect/);
});
test('vivid light artwork must still pass protected-surface contrast against black and white pixels',()=>{
 const p=palette();p.mode='light';p.primitives.white='#493b45';p.primitives.black='#fffdfe';
 p.dynamicBackground={textSurfaceMustBeOpaque:false,textSurfaceAlpha:.82,textOpacity:1,imageOpacityMaximum:.78};
 p.pairs.forEach(pair=>pair.translucent=true);
 assert.ok(validateThemePalette(p).every(pair=>pair.ratio>=pair.minimum));
 p.primitives.white='#a7869b';assert.throws(()=>validateThemePalette(p),/contrast/);
 p.primitives.white='#493b45';p.mode='dark';assert.throws(()=>validateThemePalette(p),/protect/);
});
test('theme design contract includes rounded geometry and rejects language/color disagreement',()=>{
 const p=palette();p.dynamicBackground={textSurfaceMustBeOpaque:false,textSurfaceAlpha:.82,textOpacity:1,imageOpacityMaximum:.46};
 const d={schemaVersion:1,id:'mecha-control',language:'control cabin',radius:Object.fromEntries(['control','card','message','dialog','composer','shell'].map(k=>[k,16])),spacing:Object.fromEntries(['unit','stack','message-x','message-y'].map(k=>[k,12])),typography:{bodySizePolicy:'inherit-host'},content:{messageTextOpacity:1,messageBackgroundAlpha:.82,mediaOpacityMaximum:.46},motion:{decorateOnly:true,confirmedSendOnly:true},elevation:{message:'0 3px 10px #0003',card:'0 3px 10px #0003',dialog:'0 3px 10px #0003'}};
 assert.match(buildThemeDesignCss(d,p,'mecha-control'),/--aiyou-radius-message:16px/);
 d.content.messageTextOpacity=.5;assert.throws(()=>buildThemeDesignCss(d,p,'mecha-control'),/disagree/);
 d.content.messageTextOpacity=1;delete d.radius.message;assert.throws(()=>buildThemeDesignCss(d,p,'mecha-control'),/geometry/);
});
test('customization migrates legacy prefs and confines numbers, colors and CSS values',()=>{
 const c=createThemeCustomization();
 assert.equal(c.normalize({enabled:false,motion:false}).alpha.text,1);
 assert.equal(c.normalize({alpha:{card:.5}}).alpha.chat,0);
 assert.equal(c.normalize(null).enabled,true);
 const p=c.normalize({alpha:{card:-5,text:.4,image:10,panel:'0'},colors:{primary:'#123abc',secondary:'red;display:none'},background:{fit:'x;}',x:Infinity,y:400}});
 assert.equal(p.alpha.card,0);assert.equal(p.alpha.text,.4);assert.equal(p.alpha.image,1);assert.equal(p.alpha.panel,.8);assert.equal(p.colors.primary,'#123abc');assert.equal(p.colors.secondary,c.defaults.colors.secondary);assert.equal(p.background.fit,'cover');assert.equal(p.background.y,100);
 assert.doesNotMatch(c.css(p),/display:none|Infinity|NaN/);
 assert.throws(()=>createThemeCustomization({id:'x"]body'}),/identity/);
});
test('background alpha, text alpha, state accents and readable default are independent',()=>{
 const c=createThemeCustomization(),p=c.normalize({alpha:{overall:.5,card:.4,chat:.6,text:.7},colors:{primary:'#ffffff'}}),css=c.css(p);
 assert.match(css,/--aiyou-alpha-chat:0.3/);assert.match(css,/--aiyou-fill-chat:color-mix\(in srgb,var\(--aiyou-bg\) 30.000%,transparent\)/);
 assert.match(css,/--aiyou-alpha-card:0.2/);assert.match(css,/--aiyou-text:color-mix\(in srgb,#ffffff 70.000%,transparent\)/);assert.doesNotMatch(css,/--aiyou-running:|opacity:/);
 assert.equal(c.contrast(c.defaults).passes,true);assert.equal(c.contrast({...c.defaults,alpha:{...c.defaults.alpha,text:0}}).passes,false);
 const copy=c.normalize();copy.alpha.card=0;assert.equal(c.defaults.alpha.card,.82);
});
