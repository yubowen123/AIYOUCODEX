import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlatformAssetSync, isPlatformPromptCompanion, readPlatformAssetDetails } from "../vendor/codex-workspace-enhancer/asset-browser/platform-asset-sync.js";
import { CodexPromptAssociationStore } from "../vendor/codex-workspace-enhancer/asset-browser/codex-prompt-associations.js";

async function finish(sync,id) {
  for(let i=0;i<200;i++){
    const job=sync.get(id);
    if(job.state!=="running")return job;
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error("sync did not finish");
}
test("platform assets are retrieved only after manual start, grouped, reused and tied to real prompt metadata",async t=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),"platform-sync-"));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  let reads=0, downloads=0, projectFolder="";
  const row={id:"asset-1",name:"镜头一",kind:"image",url:"https://example.com/img.jpg?temporary_secret=fixture",prompt:"对应原提示词",negativePrompt:"不要文字",model:"fixture-model",references:["https://example.com/ref.jpg?secret=fixture"],settings:{seed:1,apiKey:"SECRET",aspectRatio:"16:9"},sourceNodeId:"node-id",folder:"第一集",canvasId:"canvas1"};
  const sync=new PlatformAssetSync({
    root:path.join(tmp,"downloads"),
    adapters:{dramatv:{name:"DramaTV",projects:async()=>[{id:"42",name:"测试 / 项目"}],assets:async()=>{reads++;return [row]}}},
    register:async(_name,folder)=>{projectFolder=folder;return "local";},
    receiveFile:async(_url,_kind,temp)=>{downloads++;await writeFile(temp,"synthetic fixture", {flag:"wx"});return ".jpg";}
  });
  assert.equal(sync.sources()[0].canRead,true);
  assert.throws(()=>sync.start("dramatv","42"),/先读取/);
  await sync.projects("dramatv");
  assert.equal(reads,0); assert.equal(downloads,0);
  let job=await finish(sync,sync.start("dramatv","42").id);
  assert.equal(job.state,"done");assert.equal(job.downloaded,1);assert.equal(job.localProjectId,"local");
  assert.match(path.basename(projectFolder),/^测试 项目 ·/);
  const [folder] = await readdir(projectFolder);
  assert.match(folder, /^第一集 ·/);
  const episode=path.join(projectFolder,folder);
  const names=await readdir(episode), file=path.join(episode,names.find(x=>x.endsWith(".jpg")));
  const details=await readPlatformAssetDetails(file);
  assert.equal(details.nodeId,"node-id"); assert.deepEqual(details.settings,{seed:1,aspectRatio:"16:9"});
  const sidecar=await readFile(file.replace(/\.jpg$/,".meta.json"),"utf8");
  assert.doesNotMatch(sidecar,/temporary_secret|SECRET|secret=/);
  const store=new CodexPromptAssociationStore({registryPath:path.join(tmp,"registry.json")});
  assert.equal((await store.get(file)).prompt,"对应原提示词");
  row.name="远端改名以后";
  job=await finish(sync,sync.start("dramatv","42").id);
  assert.equal(job.skipped,1);assert.equal(downloads,1);
});
test("manual LibTV export import keeps only declared sibling metadata",async t=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),"platform-export-"));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const exported=path.join(tmp,"official-export");await mkdir(exported);
  await writeFile(path.join(exported,"clip.jpg"),"fixture");
  await writeFile(path.join(exported,"clip.prompt.md"),"本地导出的原始提示词");
  let projectFolder;
  const sync=new PlatformAssetSync({root:path.join(tmp,"downloads"),register:async(_,folder)=>{projectFolder=folder;return "local";}});
  const job=await finish(sync,sync.startLocal("libtv",exported,"已有项目").id);
  assert.equal(job.downloaded,1);
  const names=await readdir(projectFolder), target=path.join(projectFolder,names.find(name=>name.endsWith(".jpg")));
  const store=new CodexPromptAssociationStore({registryPath:path.join(tmp,"registry.json")});
  assert.equal((await store.get(target)).prompt,"本地导出的原始提示词");
  const companion=target.replace(/\.jpg$/,".prompt.md");
  assert.equal(await isPlatformPromptCompanion(companion,path.join(tmp,"downloads")),true);
  assert.equal(await isPlatformPromptCompanion(path.join(exported,"clip.prompt.md"),path.join(tmp,"downloads")),false);
  const legacy=target+".prompt.md";
  await writeFile(legacy,"旧版资料");
  assert.equal(await isPlatformPromptCompanion(legacy,path.join(tmp,"downloads")),true);
  const unrelated=path.join(projectFolder,"普通笔记.prompt.md");
  await writeFile(unrelated,"普通文档");
  assert.equal(await isPlatformPromptCompanion(unrelated,path.join(tmp,"downloads")),false);
});
