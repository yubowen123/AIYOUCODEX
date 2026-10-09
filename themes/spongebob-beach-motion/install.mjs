#!/usr/bin/env node
import {access,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('用法：node install.mjs [--root AIYOUcodex目录] [--dry-run]\n先检查主题包；--dry-run 只检查，通过后正常运行才注册。不会自动选择主题。');
  process.exit(0);
}
try{
  let root;
  let dryRun=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--root'){
      if(!args[i+1]||args[i+1].startsWith('--'))throw Error('--root 需要一个目录');
      root=path.resolve(args[++i]);
    }else if(args[i]==='--dry-run')dryRun=true;
    else throw Error('未知参数：'+args[i]);
  }
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<5))throw Error('需要 Node.js 22.5 或更新版本');
  root??=process.platform==='win32'
    ? path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Codex Sidebar Enhancer')
    : path.join(os.homedir(),'Library','Application Support','Codex Sidebar Enhancer');
  const installer=path.join(root,'scripts','install-theme.mjs');
  try{await access(installer);}catch{
    throw Error('指定目录缺少 scripts/install-theme.mjs。请使用支持主题包的完整 AIYOUcodex 安装目录，或加 --root 指向其仓库目录。当前目录：'+root);
  }
  const packageDir=path.dirname(fileURLToPath(import.meta.url));
  const manifest=JSON.parse(await readFile(path.join(packageDir,'manifest.json'),'utf8'));
  const run=arguments_=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[installer,'--package',packageDir,...arguments_],{cwd:root,stdio:'inherit',shell:false});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(Error(signal?'检查 / 安装被终止：'+signal:'检查 / 安装失败，退出码 '+code)));
  });
  await run(['--dry-run']);
  if(dryRun){console.log('检查通过，未安装：'+manifest.name+' v'+manifest.version);process.exit(0);}
  await run([]);
  console.log('已注册「'+manifest.name+'」v'+manifest.version+'。在主题选择器中选择此主题。');
}catch(error){console.error(error.message);process.exitCode=1;}
