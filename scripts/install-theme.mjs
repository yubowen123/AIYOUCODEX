#!/usr/bin/env node
import {access,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildThemePackage} from '../lib/theme-build.mjs';
import {registerThemePackage} from '../lib/theme-catalog.mjs';
import {activateLaunchAgent} from '../lib/launch-agent.mjs';
const args=process.argv.slice(2),option=key=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageDir=option('--package')||path.join(root,'themes',option('--theme')||'pink-candy');
const dest=option('--install-dir')||root;
const built=await buildThemePackage(packageDir);
if(args.includes('--dry-run')){console.log(JSON.stringify({id:built.manifest.id,version:built.manifest.version,assetBytes:built.assetBytes,contrast:built.contrast}));process.exit(0);}
await access(path.join(dest,'scripts/injector.mjs'));
const themeDir=path.join(dest,'themes');await mkdir(themeDir,{recursive:true});
const registered=await registerThemePackage(themeDir,{id:built.manifest.id,name:built.manifest.name,prefKey:built.prefKey,source:built.compiled,frameSource:built.frameSource});
await copyFile(path.join(root,'themes/runtime/theme-worker.mjs'),path.join(themeDir,'theme-worker.mjs'));
if(process.platform==='darwin'){
  const label='com.aiyoucodex.theme-runtime',launchDir=path.join(os.homedir(),'Library/LaunchAgents');await mkdir(launchDir,{recursive:true});
  const plistPath=path.join(launchDir,label+'.plist'),xml=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const plist=`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(themeDir,'theme-worker.mjs'))}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>${xml(path.join(themeDir,'worker.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(themeDir,'worker-error.log'))}</string></dict></plist>`;
  await writeFile(plistPath,plist);
  await activateLaunchAgent({domain:`gui/${process.getuid()}`,label,plistPath});
}
console.log(JSON.stringify({installed:built.manifest.id,version:built.manifest.version,themes:registered.catalog.entries.map(e=>e.id)}));
