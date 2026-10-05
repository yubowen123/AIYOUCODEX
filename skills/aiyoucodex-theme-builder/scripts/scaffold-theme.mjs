#!/usr/bin/env node
import {access,mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
for(const k of ['--repo','--id','--name','--poster','--output'])if(!args.includes(k)||!get(k))throw Error(`Missing ${k}`);
const id=get('--id');if(!/^[a-z][a-z0-9-]{1,60}$/.test(id))throw Error('Invalid theme id');
const source=path.join(get('--repo'),'themes/pink-candy'),dest=path.resolve(get('--output'));
try{await access(dest);throw Error('Output already exists; choose a new theme directory');}catch(e){if(e.code!=='ENOENT')throw e;}
const poster=await readFile(get('--poster'));if(poster.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Poster must be PNG');
await mkdir(dest,{recursive:true});
const files=['manifest.json','colors.json','design.json','controls.json','tokens.css','theme.css','customization.css','soft-candy.css','custom-media.js','theme-runtime.js','theme-frames.css','theme-frames.js'];
for(const file of files){const s=(await readFile(path.join(source,file),'utf8')).replaceAll('pink-candy',id);await writeFile(path.join(dest,file),s);}
await cp(path.join(source,'assets'),path.join(dest,'assets'),{recursive:true});
const m=JSON.parse(await readFile(path.join(dest,'manifest.json'),'utf8'));m.id=id;m.name=get('--name');m.version='1.0.0';await writeFile(path.join(dest,'manifest.json'),JSON.stringify(m,null,2)+'\n');
await writeFile(path.join(dest,m.poster),poster);
console.log(JSON.stringify({created:dest,id,next:'Adjust palette, design and styles to match the reference, then dry-run and verify native interaction.'}));
