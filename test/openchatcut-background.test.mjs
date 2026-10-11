import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backgroundMainSource, prepareBackgroundRuntime, readAsarFiles } from '../lib/openchatcut-background.mjs';

const main = `async function boot() {
  await app3.whenReady();
  const origin = (await startEmbeddedServer(DIST_DIR)).origin;
  installProjectStoreIpc(origin);
  const initialBounds = resolveInitialDesktopWindowBounds(screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow4({show:true});
  await win.loadURL(\u0060\u0024{origin}/\u0060);
}
app3.on("window-all-closed", () => app3.quit());
boot();`;
function archive(files) {
  const tree = {files:{}}, chunks=[]; let offset=0;
  for (const [name,text] of Object.entries(files)) {
    const data=Buffer.from(text), parts=name.split('/'); let node=tree;
    for(const part of parts.slice(0,-1)) node=(node.files[part] ||= {files:{}});
    node.files[parts.at(-1)]={size:data.length,offset:String(offset)}; offset+=data.length; chunks.push(data);
  }
  const json=Buffer.from(JSON.stringify(tree)), header=Buffer.alloc(8+Math.ceil(json.length/4)*4), prefix=Buffer.alloc(8);
  header.writeUInt32LE(header.length-4,0);header.writeUInt32LE(json.length,4);json.copy(header,8);
  prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(header.length,4);return Buffer.concat([prefix,header,...chunks]);
}

test('background adapter retains upstream storage/server boot and removes desktop window creation and close-to-quit', () => {
  const adapted = backgroundMainSource(main);
  assert.match(adapted, /startEmbeddedServer/); assert.match(adapted, /installProjectStoreIpc/);
  assert.doesNotMatch(adapted, /new BrowserWindow4|win\.loadURL|window-all-closed", \(\) => app3\.quit/);
  assert.match(adapted, /getAllWindows\(\)\.length/);
  assert.throws(() => backgroundMainSource(main.replace('resolveInitialDesktopWindowBounds', 'futureChangedEntry')), {code:'BACKGROUND_RUNTIME_FAILED'});
});

test('companion packaging preserves official bytes and Electron entitlements, with matching ASAR integrity', async t => {
  const root=await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(),'openchatcut-background-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const app=path.join(root,'official.app'), resources=path.join(app,'Contents','Resources');
  await mkdir(resources,{recursive:true});await mkdir(path.join(app,'Contents','MacOS'));
  const installed={appPath:app,executable:path.join(app,'Contents','MacOS','OpenChatCut'),version:'0.2.16'};
  await writeFile(installed.executable,'official binary');
  const bytes=archive({'package.json':'{"name":"openchatcut","version":"0.2.16","license":"AGPL-3.0-or-later"}',
    'desktop-dist/main.mjs':'original bootstrap','desktop-dist/app-main.mjs':main,'desktop-dist/preload.cjs':'original preload'});
  await writeFile(path.join(resources,'app.asar'),bytes);
  await writeFile(path.join(app,'Contents','Info.plist'),`<plist><dict><key>CFBundleIdentifier</key><string>app.official</string><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>${'a'.repeat(64)}</string></dict></dict></dict>\n</plist>`);
  const commands=[];
  const runtime=await prepareBackgroundRuntime(installed,path.join(root,'managed'),{execFileAsync:async(command,args)=>{
    commands.push({command,args});
    if(command==='/bin/cp') {await mkdir(args.at(-1));return {};}
    if(args[0]==='-d')return {stdout:'<?xml version="1.0"?><plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>'};
    assert.ok(args.includes('--entitlements'));assert.ok(args.includes('--timestamp=none'));return {};
  }});
  const adaptedPath=path.join(runtime.appPath,'Contents','Resources','app.asar');
  const adapted=await readAsarFiles(adaptedPath,['desktop-dist/app-main.mjs','desktop-dist/preload.cjs','package.json']);
  assert.doesNotMatch(adapted['desktop-dist/app-main.mjs'],/new BrowserWindow4/);
  assert.equal(adapted['desktop-dist/preload.cjs'],'original preload');
  assert.equal(JSON.parse(adapted['package.json']).license,'AGPL-3.0-or-later');
  assert.deepEqual(await readFile(path.join(resources,'app.asar')),bytes);
  const packed=await readFile(adaptedPath),headerSize=packed.readUInt32LE(4),header=packed.subarray(8,8+headerSize);
  const raw=header.subarray(8,8+header.readUInt32LE(4));
  const hash=createHash('sha256').update(raw).digest('hex');
  const plist=await readFile(path.join(runtime.appPath,'Contents','Info.plist'),'utf8');
  assert.ok(plist.includes(hash));assert.match(plist,/<key>LSUIElement<\/key><true\/>/);
  assert.equal(commands.some(c=>c.args.includes('--deep')),false,'Official shared dependencies are never re-signed');
});
