import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildThemePackage} from '../lib/theme-build.mjs';
import {buildThemeCatalog} from '../lib/theme-catalog.mjs';

const repo=fileURLToPath(new URL('..',import.meta.url));
const theme=path.join(repo,'themes/yoyo-tilt-collection');
const candidates=[process.env.AIYOUCODEX_TEST_BROWSER,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium',...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google/Chrome/Application/chrome.exe'))].filter(Boolean);
let executable;
for(const candidate of candidates){try{await access(candidate);executable=candidate;break;}catch{}}

test('community yoyo package compiles with consistent defaults and the existing theme catalog',async()=>{
 const manifest=JSON.parse(await readFile(path.join(theme,'manifest.json')));
 const preset=JSON.parse(await readFile(path.join(theme,'controls.json')));
 const built=await buildThemePackage(theme);
 assert.equal(built.manifest.version,'1.3.2');
 assert.equal(manifest.author,'浠浠');
 const sums=(await readFile(path.join(theme,'SHA256SUMS.txt'),'utf8')).trim().split('\n');
 for(const line of sums){
  const [digest,relative]=line.split('  ');
  assert.equal(createHash('sha256').update(await readFile(path.join(theme,relative))).digest('hex'),digest,relative);
 }
 assert.equal(manifest.defaults.motion,preset.defaults.motion);
 assert.equal(built.prefKey,preset.storageKey);
 assert.ok(built.contrast.every(pair=>pair.ratio>=pair.minimum));
 const pink=await buildThemePackage(path.join(repo,'themes/pink-candy'));
 const entries=[pink,built].map(b=>({id:b.manifest.id,name:b.manifest.name,prefKey:b.prefKey,source:b.compiled,frameSource:b.frameSource}));
 const catalog=buildThemeCatalog(entries,{initial:built.manifest.id});
 new Function(catalog.source);new Function(catalog.frameSource);
});

test('community theme runtime protects motion, custom media, messages, draft and theme fallback',{timeout:60000,skip:!executable&&process.env.AIYOUCODEX_REQUIRE_BROWSER!=='1'&&'Chrome required'},async()=>{
 assert.ok(executable,'Chrome required');
 const output=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT||os.tmpdir(),'yoyo-audit-'));
 try{
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.join(repo,'scripts/verify-yoyo-theme.mjs'),'--package',theme],{cwd:repo,env:{...process.env,AIYOUCODEX_REPO:repo,AIYOUCODEX_TEST_BROWSER:executable,AIYOU_THEME_AUDIT_OUTPUT:output},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
   child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
  const report=JSON.parse(await readFile(path.join(output,'fixed-results.json')));
  assert.equal(report.failed,0);
  assert.equal(report.passed,30);
  assert.equal(report.error,undefined);
 }finally{await rm(output,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
