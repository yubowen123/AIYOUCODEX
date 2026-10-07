import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const THEME_EVENTS = ['enter', 'click', 'send', 'running', 'complete', 'error'];
const PALETTE_ROLES = ['body','panel-body','secondary','placeholder','timestamp','link','success','error','warning','user-message','accent-button','error-button'];
export const THEME_COLOR_CONTEXTS=['Codex','Dot','Claude','menus','inputs','tool-results','assets','arena','taskboard','settings','dialogs','permissions','notifications','search','skills','mcp','terminal','diff','media-controls'];
export function themeContrastRatio(foreground, background) {
  const luminance = hex => {
    if (!/^#[a-f0-9]{6}$/i.test(hex || '')) throw new Error('Theme colors must be opaque six-digit hex');
    const values = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return values[0]*.2126 + values[1]*.7152 + values[2]*.0722;
  };
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
export function validateThemePalette(value) {
  if(value?.schemaVersion!==1 || !['dark','light'].includes(value.mode)) throw new Error('Invalid theme palette');
  for(const context of THEME_COLOR_CONTEXTS) if(!value.contexts?.includes(context)) throw new Error('Missing theme color context: '+context);
  const resolve = name => value.primitives?.[value.semantic?.[name]];
  for(const [name,color] of Object.entries(value.primitives||{})) {
    if(!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid palette token');
    themeContrastRatio(color,color);
  }
  for(const [name,reference] of Object.entries(value.semantic||{})) {
    if(!/^[a-z][a-z0-9-]*$/.test(name)||!value.primitives?.[reference]) throw new Error('Invalid semantic color reference');
  }
  const protection=value.dynamicBackground;
  const translucent=protection?.textSurfaceMustBeOpaque===false;
  // Light artwork can remain vivid when its protected text surfaces pass the
  // same worst-pixel contrast audit. Dark themes retain their original budget.
  const mediaLimit=value.mode==='light'?1:.46;
  if(!protection || (!protection.textSurfaceMustBeOpaque && (!Number.isFinite(protection.textSurfaceAlpha)||protection.textSurfaceAlpha<.75||protection.textSurfaceAlpha>1||protection.textOpacity!==1||!Number.isFinite(protection.imageOpacityMaximum)||protection.imageOpacityMaximum<0||protection.imageOpacityMaximum>mediaLimit))) throw new Error('Dynamic theme must protect text surfaces');
  const blend=(front,back,alpha)=>'#'+[1,3,5].map(i=>Math.round(parseInt(front.slice(i,i+2),16)*alpha+parseInt(back.slice(i,i+2),16)*(1-alpha)).toString(16).padStart(2,'0')).join('');
  for(const role of PALETTE_ROLES) if(!value.pairs?.some(p=>p.role===role)) throw new Error('Missing color pair: '+role);
  const report=value.pairs.map(pair=>{
    const role=pair.role;
    if(!pair || !Number.isFinite(pair.minimum) || pair.minimum<(role==='body'||role==='panel-body'?7:4.5)) throw new Error('Missing or weak color pair: '+role);
    const backgrounds=[resolve(pair.background)];
    if(translucent && pair.translucent) {
      for(const pixel of ['#ffffff','#000000']) {
        const underlay=blend(pixel,resolve('bg'),protection.imageOpacityMaximum);
        backgrounds.push(blend(resolve(pair.background),underlay,protection.textSurfaceAlpha));
      }
    }
    const ratio=Math.min(...backgrounds.map(bg=>themeContrastRatio(resolve(pair.foreground),bg)));
    if(ratio<pair.minimum) throw new Error('Insufficient theme contrast: '+role+' '+ratio.toFixed(2));
    return {role,ratio:Number(ratio.toFixed(2)),minimum:pair.minimum};
  });
  return report;
}
export function buildThemePaletteCss(value,id) {
  validateThemePalette(value);
  if(!/^[a-z][a-z0-9-]{1,60}$/.test(id)) throw new Error('Invalid palette theme identity');
  return `html[data-aiyou-theme="${id}"]{\n`+
    Object.entries(value.primitives).map(([k,v])=>`--aiyou-${k}:${v};`).join('\n')+'\n'+
    Object.entries(value.semantic).map(([k,v])=>`--aiyou-${k}:var(--aiyou-${v});`).join('\n')+`\n--aiyou-message-alpha:${value.dynamicBackground.textSurfaceMustBeOpaque?1:value.dynamicBackground.textSurfaceAlpha};\n}`;
}
export function buildThemeDesignCss(value,palette,id) {
  if(value?.schemaVersion!==1||value.id!==id||!value.language||value.typography?.bodySizePolicy!=='inherit-host') throw new Error('Invalid theme design language');
  const entries=[];
  for(const [group,keys] of Object.entries({radius:['control','card','message','dialog','composer','shell'],spacing:['unit','stack','message-x','message-y']})) {
    for(const key of keys){const n=value[group]?.[key];if(!Number.isFinite(n)||n<0||n>48||(group==='radius'&&key==='message'&&n===0))throw new Error('Invalid theme geometry: '+key);entries.push(`--aiyou-${group==='spacing'?'space':'radius'}-${key}:${n}px;`);}
  }
  if(value.content?.messageTextOpacity!==1||value.content?.messageBackgroundAlpha!==palette.dynamicBackground?.textSurfaceAlpha||value.content?.mediaOpacityMaximum!==palette.dynamicBackground?.imageOpacityMaximum||!value.motion?.decorateOnly||!value.motion?.confirmedSendOnly) throw new Error('Theme design and color contract disagree');
  for(const key of ['message','card','dialog']){const shadow=value.elevation?.[key];if(typeof shadow!=='string'||!/^[-0-9a-z#., %]+$/i.test(shadow))throw new Error('Invalid theme elevation');entries.push(`--aiyou-shadow-${key}:${shadow};`);}
  entries.push('--aiyou-stack-gap:var(--aiyou-space-stack);','--aiyou-card-radius:var(--aiyou-radius-card);','--aiyou-shadow:var(--aiyou-shadow-card);');
  return `html[data-aiyou-theme="${id}"]{\n${entries.join('\n')}\n}`;
}
export function validateThemeManifest(value) {
  if (value?.schemaVersion !== 1 || !/^[a-z][a-z0-9-]{1,60}$/.test(value.id || '')) throw new Error('Invalid theme identity');
  if (!value.name || !value.version || value.renderer !== 'aiyoucodex-theme-v1') throw new Error('Invalid theme contract');
  for (const field of ['poster', ...THEME_EVENTS]) {
    const file = field === 'poster' ? value.poster : value.motion?.[field]?.file;
    if (typeof file !== 'string' || !/^assets\/[a-z0-9-]+\.(png|gif)$/.test(file)) throw new Error(`Invalid asset: ${field}`);
    if (field !== 'poster' && (!Number.isFinite(value.motion[field].durationMs) || value.motion[field].durationMs < 100 || value.motion[field].durationMs > 30000)) throw new Error(`Invalid duration: ${field}`);
  }
  if(value.background!==undefined){
    const b=value.background;
    if(!['image','gif','video'].includes(b.defaultType)||!/^assets\/[a-z0-9-]+\.(png|jpg|webp)$/.test(b.image||''))throw Error('Invalid background media contract');
    for(const event of THEME_EVENTS)if(!/^assets\/[a-z0-9-]+\.mp4$/.test(b.videos?.[event]||''))throw Error('Invalid video asset: '+event);
  }
  if(value.transitions!==undefined){
    const t=value.transitions;
    if(t?.mode!=='shared-anchor'||t.pendingPolicy!=='latest-wins'||t.switchAt!=='clip-boundary'||t.anchor!==value.poster||!Number.isInteger(t.neutralHoldFrames)||t.neutralHoldFrames<2||t.neutralHoldFrames>12) throw new Error('Invalid theme transition contract');
  }
  return value;
}
export function stateThemeEvent(state) {
  return ({running:'running', 'completed-unread':'complete', error:'error', read:'idle', idle:'idle', unknown:'idle'})[state] || 'idle';
}
export function chooseThemeEvent({state='idle', transient=null, hidden=false, reduced=false}={}) {
  if(hidden || reduced) return 'poster';
  if(state === 'error') return 'error';
  if(transient && ['enter','click','send'].includes(transient)) return transient;
  return stateThemeEvent(state);
}
export async function readOptionalThemeSource(root) {
  try { return await readFile(path.join(root, 'themes', 'active-theme.js'), 'utf8'); }
  catch(error) { if(error.code === 'ENOENT') return ''; throw error; }
}

// Self-contained factory: the same validated controls run in Node, native and managed frames.
// Values are alpha (0 transparent, 1 opaque), not container opacity.
export function createThemeCustomization({id='mecha-control',primary='#edf4fa',secondary='#a9becf',colorDefaults={},base='#0c151e',surface='#1b2a38',backgroundType='gif',mode='dark',alphaDefaults={},motionDefault=true,cardDefaults={}}={}) {
  if(!/^[a-z][a-z0-9-]{1,60}$/.test(id))throw Error('Invalid theme controls identity');
  const hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
  const defaults={schemaVersion:1,enabled:true,motion:true,alpha:{overall:1,chrome:1,sidebar:.72,chat:0,panel:.8,card:.82,message:.82,composer:.86,control:.86,menu:.96,text:1,border:.65,shadow:1,decoration:.9,image:.46},colors:{primary:hex(primary)?primary:'#edf4fa',secondary:hex(secondary)?secondary:'#a9becf',link:'#49adff',success:'#52dba0',danger:'#ff716d',warning:'#ffa932',inverse:'#0c151e'},background:{fit:'cover',x:75,y:50}};
  defaults.alpha['composer-area']=0;
  if(typeof motionDefault==='boolean')defaults.motion=motionDefault;
  for(const key of Object.keys(defaults.alpha))if(Number.isFinite(alphaDefaults[key]))defaults.alpha[key]=Math.max(0,Math.min(1,alphaDefaults[key]));
  defaults.background.type=['image','gif','video'].includes(backgroundType)?backgroundType:'gif';
  defaults.background.source='builtin';defaults.background.custom=null;defaults.background.customStates={};
  for(const k of Object.keys(defaults.colors))if(hex(colorDefaults?.[k]))defaults.colors[k]=colorDefaults[k];
  const cardStates=['static','running','completed','interrupted','pending'];
  const cardLabels={static:'统一样式',running:'执行中',completed:'已完成',interrupted:'执行中断',pending:'待执行 / 空闲'};
  const cardColors={static:mode==='light'?'#d7bdba':'#536c80',running:defaults.colors.link,completed:defaults.colors.success,interrupted:defaults.colors.danger,pending:mode==='light'?'#d7bdba':'#536c80'};
  defaults.cards={mode:'dynamic',styles:Object.fromEntries(cardStates.map(k=>[k,{background:hex(surface)?surface:'#1b2a38',border:cardColors[k],borderWidth:1,flow:cardColors[k],flowEnabled:k==='running'}]))};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const bounded=(v,f,max=1)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(max,v)):f;
  function normalize(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))input={};
    const result=clone(defaults);
    for(const k of ['enabled','motion'])if(typeof input[k]==='boolean')result[k]=input[k];
    for(const k of Object.keys(result.alpha))result.alpha[k]=bounded(input.alpha?.[k],result.alpha[k]);
    for(const k of Object.keys(result.colors))if(hex(input.colors?.[k]))result.colors[k]=input.colors[k].toLowerCase();
    result.cards.mode=['static','dynamic'].includes(input.cards?.mode)?input.cards.mode:defaults.cards.mode;
    for(const state of cardStates){
      const entry=input.cards?.styles?.[state],style=result.cards.styles[state];
      for(const key of ['background','border','flow'])if(hex(entry?.[key]))style[key]=entry[key].toLowerCase();
      style.borderWidth=bounded(entry?.borderWidth,style.borderWidth,8);
      if(typeof entry?.flowEnabled==='boolean')style.flowEnabled=entry.flowEnabled;
    }
    result.background.type=['image','gif','video'].includes(input.background?.type)?input.background.type:(['image','gif','video'].includes(backgroundType)?backgroundType:'gif');
    const normalizeAsset=asset=>asset&&/^[a-f0-9-]{36}$/i.test(asset.id)&&['image','gif','video'].includes(asset.type)&&typeof asset.name==='string'&&Number.isFinite(asset.bytes)&&asset.bytes>0&&asset.bytes<=(asset.type==='video'?100:20)*1024*1024?{id:asset.id,name:asset.name.slice(0,160),type:asset.type,bytes:asset.bytes,durationMs:bounded(asset.durationMs,4000,30000)||4000}:null;
    for(const state of ['poster','enter','click','send','running','complete','error']){
      const asset=normalizeAsset(input.background?.customStates?.[state]);if(asset)result.background.customStates[state]=asset;
    }
    // v1.3 single-file configurations become the idle/fallback slot, never lost.
    if(!Object.hasOwn(input.background||{},'customStates')){const old=normalizeAsset(input.background?.custom);if(old)result.background.customStates.poster=old;}
    result.background.custom=result.background.customStates.poster||null;
    result.background.source=input.background?.source==='custom'?'custom':'builtin';
    if(['cover','contain'].includes(input.background?.fit))result.background.fit=input.background.fit;
    for(const k of ['x','y'])result.background[k]=bounded(input.background?.[k],result.background[k],100);
    return result;
  }
  if(cardDefaults&&typeof cardDefaults==='object')defaults.cards=normalize({cards:cardDefaults}).cards;
  function cardCss(p,mix){
    const scope=`html[data-aiyou-theme="${id}"][data-codex-conversation-view="card"]`;
    const card=`${scope} [data-app-action-sidebar-thread-row][data-codex-conversation-preview-enhanced]`;
    const styleRules=(selector,state)=>{const c=p.cards.styles[state];return `${selector}{--aiyou-thread-card-background:${mix(c.background,p.alpha.card*p.alpha.overall)};--aiyou-thread-card-border:${mix(c.border,p.alpha.border)};--aiyou-thread-card-width:${c.borderWidth}px;--aiyou-thread-card-flow:${mix(c.flow,p.alpha.border)};--aiyou-thread-card-flow-render:${c.flowEnabled&&c.borderWidth>0?'block':'none'};}`;};
    let result=styleRules(card,p.cards.mode==='static'?'static':'pending');
    if(p.cards.mode==='dynamic'){
      for(const [state,selectors] of Object.entries({running:['[data-codex-execution-state="running"]'],completed:['[data-codex-execution-state="completed-unread"]','[data-codex-execution-state="read"]'],interrupted:['[data-codex-card-appearance-state="interrupted"]','[data-codex-execution-state="error"]']}))result+=styleRules(selectors.map(s=>card+s).join(','),state);
    }
    return result+`
${card}{background:var(--aiyou-thread-card-background)!important;background-image:none!important;border:var(--aiyou-thread-card-width) solid var(--aiyou-thread-card-border)!important;box-shadow:var(--aiyou-custom-shadow)!important;}
${card}::before{content:""!important;display:var(--aiyou-thread-card-flow-render)!important;position:absolute;z-index:3;inset:0!important;padding:var(--aiyou-thread-card-width)!important;border-radius:inherit;pointer-events:none!important;background:conic-gradient(from var(--codex-running-angle,0deg),transparent 0deg 230deg,var(--aiyou-thread-card-flow) 275deg,transparent 320deg 360deg)!important;filter:none!important;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:${p.cards.mode==='dynamic'&&p.motion?'codex-running-border-flow 2.4s linear infinite':'none'}!important;}
@media(prefers-reduced-motion:reduce){${card}::before{animation:none!important;}}
`;
  }
  function cardEditorHtml(){
    return '<fieldset data-card-settings><legend>对话卡片颜色与流光</legend><label>颜色模式<select data-card-mode><option value="dynamic">动态：按执行状态</option><option value="static">静态：统一样式</option></select></label><small>动态按真实状态切换；已读和未读完成共用完成颜色，中断与错误共用中断颜色。待执行 / 空闲使用中性样式。背景透明度沿用卡片设置，边框与流光沿用边框透明度。</small>'+cardStates.map(state=>'<section data-card-style="'+state+'"><h3>'+cardLabels[state]+'</h3>'+[['background','背景色'],['border','边框色'],['flow','流光颜色']].map(([key,label])=>'<label>'+label+'<input type="color" data-card-color="'+key+'" aria-label="'+cardLabels[state]+label+'"><input type="text" data-card-hex="'+key+'" maxlength="7" spellcheck="false" aria-label="'+cardLabels[state]+label+' HEX"></label>').join('')+'<label>边框粗细（px）<input type="number" min="0" max="8" step="0.5" data-card-width aria-label="'+cardLabels[state]+'边框粗细"></label><label>显示流光<input type="checkbox" data-card-flow-enabled aria-label="'+cardLabels[state]+'显示流光"></label><div data-card-sample style="padding:12px;border-radius:12px;pointer-events:none">'+cardLabels[state]+'卡片预览</div></section>').join('')+'</fieldset>';
  }
  function refreshCardEditor(dialog,input){
    const p=normalize(input);dialog.querySelector('[data-card-mode]').value=p.cards.mode;
    for(const state of cardStates){const section=dialog.querySelector('[data-card-style="'+state+'"]'),c=p.cards.styles[state];section.hidden=p.cards.mode==='static'?state!=='static':state==='static';for(const key of ['background','border','flow']){section.querySelector('[data-card-color="'+key+'"]').value=c[key];const text=section.querySelector('[data-card-hex="'+key+'"]');text.value=c[key];text.setCustomValidity('');text.removeAttribute('aria-invalid');}section.querySelector('[data-card-width]').value=c.borderWidth;section.querySelector('[data-card-flow-enabled]').checked=c.flowEnabled;const sample=section.querySelector('[data-card-sample]');sample.style.background=`color-mix(in srgb,${c.background} ${p.alpha.card*p.alpha.overall*100}%,transparent)`;sample.style.border=`${c.borderWidth}px solid color-mix(in srgb,${c.border} ${p.alpha.border*100}%,transparent)`;sample.style.boxShadow=c.flowEnabled?`0 0 10px color-mix(in srgb,${c.flow} ${p.alpha.border*100}%,transparent)`:'none';sample.style.color=p.colors.primary;}
  }
  function bindCardEditor(dialog,getPreferences,update){
    dialog.addEventListener('input',event=>{const e=event.target;if(!e.closest('[data-card-settings]'))return;const p=normalize(getPreferences());if(e.matches('[data-card-mode]'))p.cards.mode=e.value;else{const state=e.closest('[data-card-style]')?.dataset.cardStyle;if(!state)return;const c=p.cards.styles[state];if(e.matches('[data-card-color],[data-card-hex]')){if(!hex(e.value)){e.setCustomValidity('请输入 #RRGGBB 颜色');e.setAttribute('aria-invalid','true');return;}c[e.dataset.cardColor||e.dataset.cardHex]=e.value.toLowerCase();}else if(e.matches('[data-card-width]')){if(!Number.isFinite(e.valueAsNumber)||e.valueAsNumber<0||e.valueAsNumber>8){e.setCustomValidity('边框粗细须为 0–8px');return;}c.borderWidth=e.valueAsNumber;}else if(e.matches('[data-card-flow-enabled]'))c.flowEnabled=e.checked;else return;}e.setCustomValidity('');update(normalize(p));});
  }
  function css(input){
    const p=normalize(input),a=p.alpha,percent=v=>(v*100).toFixed(3)+'%',mix=(color,v)=>`color-mix(in srgb,${color} ${percent(v)},transparent)`,rules=[];
    rules.push(`--aiyou-text:${mix(p.colors.primary,a.text)}!important`,`--aiyou-muted:${mix(p.colors.secondary,a.text)}!important`);
    for(const k of ['chrome','sidebar','chat','panel','card','message','composer','composer-area','control','menu']){
      const value=a[k]*a.overall;
      rules.push(`--aiyou-alpha-${k}:${value}`,`--aiyou-fill-${k}:${mix(k==='chat'?'var(--aiyou-bg)':'var(--aiyou-elevated)',value)}`);
    }
    rules.push(`--aiyou-card-bg:var(--aiyou-fill-card)!important`,`--aiyou-button-bg:var(--aiyou-fill-control)!important`,`--aiyou-message-alpha:${a.message*a.overall}!important`,`--aiyou-image-alpha:${a.image}`,`--aiyou-decoration-alpha:${a.decoration}`,`--aiyou-card-border:${mix('var(--aiyou-border)',a.border)}!important`);
    for(const k of ['link','success','danger','warning','inverse'])rules.push(`--aiyou-ink-${k}:${mix(p.colors[k],a.text)}`);
    rules.push(mode==='light'
      ? `--aiyou-custom-shadow:inset 0 1px 1px ${mix('#ffffff',.88*a.shadow)},inset 0 -1px 2px ${mix(p.colors.warning,.1*a.shadow)},0 2px 5px ${mix(p.colors.warning,.08*a.shadow)},0 7px 18px ${mix(p.colors.warning,.08*a.shadow)}`
      : `--aiyou-custom-shadow:inset 0 1px 1px ${mix('#d0e6ff',.14*a.shadow)},inset 0 -1px 2px ${mix('#000000',.5*a.shadow)},0 2px 3px ${mix('#000000',.5*a.shadow)},0 7px 18px ${mix('#000000',.33*a.shadow)}`);
    for(const token of ['--color-background-panel','--color-background-callout-surface','--app-color-background-elevated-primary','--app-color-background-elevated-secondary','--app-color-background-elevated-primary-opaque','--app-color-background-elevated-secondary-opaque','--app-color-background-editor-opaque','--color-background-execution-output','--codeblock-background-color','--color-token-diff-surface','--color-token-main-surface-secondary','--color-surface-secondary','--color-surface-tertiary','--color-surface-elevated','--color-surface-elevated-secondary','--color-background-secondary','--color-background-primary-soft','--color-background-primary-soft-alpha'])rules.push(`${token}:var(--aiyou-fill-panel)!important`);
    for(const token of ['--color-background-control-opaque','--app-color-background-control','--color-background-mode-toggle-selected','--segmented-control-thumb-background','--color-token-list-hover-background'])rules.push(`${token}:var(--aiyou-fill-control)!important`);
    for(const token of ['--color-background-composer-surface','--color-background-composer-action-bar'])rules.push(`${token}:var(--aiyou-fill-composer)!important`);
    for(const token of ['--color-background-warning-surface','--color-background-danger-surface','--color-background-danger-soft','--color-background-danger-soft-hover','--color-background-danger-soft-active','--color-background-caution-soft','--app-color-background-accent','--app-color-background-accent-hover','--app-color-background-accent-active'])rules.push(`${token}:var(--aiyou-fill-panel)!important`);
    for(const token of ['--color-token-dropdown-background','--color-background-tooltip-classic'])rules.push(`${token}:var(--aiyou-fill-menu)!important`);
    for(const [token,ink] of [['--color-token-text-link-foreground','link'],['--link-primary-text-color','link'],['--link-primary-text-color-hover','link'],['--color-text-info','link'],['--color-text-info-ghost','link'],['--color-text-danger','danger'],['--color-text-success','success'],['--color-text-warning','warning'],['--app-color-text-warning','warning'],['--app-color-text-danger','danger'],['--app-color-text-success','success'],['--color-codex-git-added','success'],['--color-codex-git-deleted','danger'],['--color-text-execution-output-error','danger']])rules.push(`${token}:var(--aiyou-ink-${ink})!important`);
    for(const type of ['danger','warning','success'])for(const variant of ['ghost','outline','soft','surface','ghost-hover','outline-hover'])rules.push(`--color-text-${type}-${variant}:var(--aiyou-ink-${type})!important`);
    for(const token of ['--color-text-primary-solid','--color-text-danger-solid','--color-text-warning-solid','--color-text-success-solid','--app-color-text-on-accent'])rules.push(`${token}:var(--aiyou-ink-inverse)!important`);
    rules.push(`--aiyou-background-fit:${p.background.fit}`,`--aiyou-background-position:${p.background.x}% ${p.background.y}%`);
    // Shared composer contract, not a per-theme skin. Native ComposerSurface
    // also paints aria-hidden siblings; clearing only ancestors is insufficient.
    const scope=`html[data-aiyou-theme="${id}"]`;
    return cardCss(p,mix)+`${scope}{${rules.join(';')};}
${scope} :is([data-codex-composer-root],[data-chatgpt-composer],[data-aiyou-composer-path],[data-composer-surface-variant]:has([data-composer-body])){background:transparent!important;background-image:none!important;--composer-layout-surface-background:transparent!important;--composer-layout-surface-backdrop-filter:none!important;--composer-layout-surface-shadow:none!important;box-shadow:none!important;backdrop-filter:none!important}
${scope} :is([data-codex-composer-root],[data-aiyou-composer-area]) [aria-hidden="true"].pointer-events-none.absolute:is([class*="bg-gradient-to-"],[class~="bg-surface"],[class~="bg-surface-secondary"]),
${scope} [data-request-input-activity-root]:has([data-composer-body]) .thread-scroll-container [aria-hidden="true"].pointer-events-none.sticky.bottom-0 > [aria-hidden="true"].pointer-events-none.absolute[class~="bg-gradient-to-t"],
${scope} [data-request-input-activity-root]:has([data-composer-body]) [data-thread-scroll-footer="true"] > [aria-hidden="true"].pointer-events-none.absolute:is([class~="bg-surface"],[class~="bg-gradient-to-t"]),
${scope} [data-aiyou-composer-paint]{background:transparent!important;background-image:none!important;backdrop-filter:none!important}
${scope} [data-aiyou-composer-area]{background:var(--aiyou-fill-composer-area)!important;background-image:none!important}
${scope} :is([data-composer-body],#aiyoucodex-claude-panel [data-claude-compose],.thread-pane .composer):is([data-composer-body],[data-claude-compose],.composer){background:var(--aiyou-fill-composer)!important;background-image:none!important;box-shadow:var(--aiyou-custom-shadow)!important}
${scope} :is([data-composer-body],#aiyoucodex-claude-panel [data-claude-compose],.thread-pane .composer) :is([data-composer-input],[data-composer-footer],[contenteditable],textarea){background:transparent!important;background-image:none!important}
`;
  }
  // Advisory only: user overrides do not silently rewrite their explicit color/alpha choice.
  function contrast(input){
    const p=normalize(input),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),mix=(a,b,t)=>a.map((v,i)=>v*t+b[i]*(1-t)),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const baseRgb=rgb(hex(base)?base:'#0c151e'),surfaceRgb=rgb(hex(surface)?surface:'#1b2a38');
    let min=Infinity;
    for(const brightness of [0,255])for(const k of ['sidebar','panel','card','message','composer','control','menu'])for(const color of [p.colors.primary,p.colors.secondary]){
      const image=mix([brightness,brightness,brightness],baseRgb,p.alpha.image),bg=mix(surfaceRgb,image,p.alpha[k]*p.alpha.overall),fg=mix(rgb(color),bg,p.alpha.text),x=lum(fg),y=lum(bg);
      min=Math.min(min,(Math.max(x,y)+.05)/(Math.min(x,y)+.05));
    }
    for(const c of Object.values(p.cards.styles))for(const brightness of [0,255])for(const color of [p.colors.primary,p.colors.secondary]){const image=mix([brightness,brightness,brightness],baseRgb,p.alpha.image),bg=mix(rgb(c.background),image,p.alpha.card*p.alpha.overall),fg=mix(rgb(color),bg,p.alpha.text),x=lum(fg),y=lum(bg);min=Math.min(min,(Math.max(x,y)+.05)/(Math.min(x,y)+.05));}
    return {minimum:Number(min.toFixed(2)),passes:min>=4.5};
  }
  return {defaults:clone(defaults),normalize,css,contrast,cardEditorHtml,refreshCardEditor,bindCardEditor};
}
