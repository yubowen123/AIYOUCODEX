import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateThemeManifest,validateThemePalette,buildThemePaletteCss,buildThemeDesignCss,createThemeCustomization} from './theme-package.mjs';

export async function buildThemePackage(root) {
  const json = async file => JSON.parse(await readFile(path.join(root,file),'utf8'));
  const manifest=validateThemeManifest(await json('manifest.json'));
  const palette=await json('colors.json'),design=await json('design.json');
  const contrast=validateThemePalette(palette),preset=(await json('controls.json')).defaults;
  let total=0;
  const asset=async(file,mime)=>{
    const bytes=await readFile(path.join(root,file));
    if(bytes.length>manifest.limits.maxAssetBytes)throw Error(`Asset budget exceeded: ${file}`);
    total+=bytes.length;return `data:${mime};base64,${bytes.toString('base64')}`;
  };
  const poster=await asset(manifest.poster,'image/png'),media={},videos={};
  const staticOnly=manifest.defaults?.motion===false&&!manifest.background;
  if(!staticOnly)for(const [event,motion]of Object.entries(manifest.motion))media[event]=await asset(motion.file,motion.file.endsWith('.gif')?'image/gif':'image/png');
  let staticImage=null;
  if(manifest.background){
    staticImage=await asset(manifest.background.image,'image/png');
    for(const [event,file]of Object.entries(manifest.background.videos))videos[event]=await asset(file,'video/mp4');
  }
  if(total>manifest.limits.maxBundleBytes)throw Error('Theme media exceeds bundle budget');
  const decals={};
  for(const [id,file]of Object.entries(manifest.decorations||{})){
    if(!/^assets\/[a-z0-9-]+\.svg$/.test(file))throw Error('Invalid decoration path');
    const value=await readFile(path.join(root,file),'utf8');
    if(Buffer.byteLength(value)>100000||/<script|<foreignObject|\son[a-z]+=|(?:href|src)=/i.test(value))throw Error('Unsafe decoration');
    decals[id]=`data:image/svg+xml;base64,${Buffer.from(value).toString('base64')}`;
  }
  const styles=await Promise.all(['tokens.css','theme.css','customization.css'].map(file=>readFile(path.join(root,file),'utf8')));
  try{styles.push(await readFile(path.join(root,'soft-candy.css'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  styles.splice(1,0,buildThemePaletteCss(palette,manifest.id),buildThemeDesignCss(design,palette,manifest.id));
  const role=k=>palette.primitives[palette.semantic[k]];
  const options={id:manifest.id,mode:palette.mode,primary:role('text'),secondary:role('muted'),base:role('bg'),surface:role('elevated'),backgroundType:preset.background.type,alphaDefaults:preset.alpha,colorDefaults:preset.colors,motionDefault:preset.motion};
  const controls=`window.__AIYOU_THEME_CONTROLS__=(${createThemeCustomization.toString()})(${JSON.stringify(options)});\n`;
  const runtime=(await readFile(path.join(root,'custom-media.js'),'utf8'))+'\n'+await readFile(path.join(root,'theme-runtime.js'),'utf8');
  const compiled=controls+'window.__AIYOUCODEX_THEME_BUNDLE__='+JSON.stringify({manifest,poster,staticImage,videos:manifest.background?videos:null,media,css:styles.join('\n'),decals})+';\n'+runtime;
  const frameSource=controls+'window.__AIYOUCODEX_FRAME_STYLE__='+JSON.stringify(buildThemePaletteCss(palette,manifest.id)+'\n'+await readFile(path.join(root,'theme-frames.css'),'utf8'))+';\n'+await readFile(path.join(root,'theme-frames.js'),'utf8');
  new Function(compiled);new Function(frameSource);
  const prefKey=runtime.match(/prefKey='(aiyoucodex\.theme\.[a-z0-9.-]+)'/)?.[1];
  if(!prefKey)throw Error('Missing isolated preference key');
  return {manifest,compiled,frameSource,prefKey,contrast,assetBytes:total};
}
