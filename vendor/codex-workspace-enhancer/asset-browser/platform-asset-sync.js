import { createHash, randomUUID } from "node:crypto";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import httpSecure from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { listDramaProjects, listDramaAssets } from "./platform-dramatv-assets.js";
import { listDreaminaProjects, listDreaminaAssets, downloadDreaminaTask } from "./dreamina-asset-source.js";
import { listNeoWowProjects, listNeoWowAssets, neowowCliPresent } from "./neowow-asset-source.js";

const MB = 1024 * 1024, MAX_FILE = 600 * MB, MAX_JOB = 10 * 1024 * MB;
const deny = new BlockList();
const has = (object,key) => Object.hasOwn(object,key);
for (const [addr,bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.168.0.0",16],["198.18.0.0",15],["224.0.0.0",3]]) deny.addSubnet(addr,bits);
const sourceInfo = {
  dramatv: { name:"DramaTV", mode:"MCP", note:"个人和团队项目，加上主画布与分集。", projects:listDramaProjects, assets:listDramaAssets },
  dreamina: { name:"即梦", mode:"Dreamina CLI", note:"创作会话和本机已记录的成功任务；无归属的任务单列。", projects:listDreaminaProjects, assets:listDreaminaAssets },
  neowow: { name:"NeoWOW", mode:"官方 CLI", note:"读取项目与节点结果，需要已安装且登录官方 CLI。", projects:listNeoWowProjects, assets:listNeoWowAssets, present:neowowCliPresent, setup:"https://neowow.cn/workflows" },
  libtv: { name:"LibTV", mode:"官方 MCP", note:"需在 Codex 连接官方 LibTV 插件；当前尚未验证账号下项目清单和原件下载。", localExport:true, setup:"https://github.com/liblib-ai/marketplace" },
  tapnow: { name:"TapNow", mode:"官方 MCP", note:"官方提供画布查询和网页批量导出，暂未核实可自动下载整项目的接口。", localExport:true, setup:"https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector" },
};
const media = {
  image:{ "image/png":".png","image/jpeg":".jpg","image/webp":".webp","image/gif":".gif","image/avif":".avif","image/heic":".heic","image/heif":".heif","image/bmp":".bmp","image/tiff":".tiff" },
  video:{ "video/mp4":".mp4","video/quicktime":".mov","video/webm":".webm","video/x-m4v":".m4v" },
  audio:{ "audio/mpeg":".mp3","audio/wav":".wav","audio/x-wav":".wav","audio/wave":".wav","audio/mp4":".m4a","audio/aac":".aac","audio/flac":".flac","audio/ogg":".ogg","audio/opus":".opus" },
};
const digest = value => createHash("sha256").update(String(value)).digest("hex").slice(0,14);
const safe = (value, fallback) => Array.from(String(value ?? "").normalize("NFC").replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g," ").replace(/\s+/g," ").trim().replace(/^[. ]+|[. ]+$/g,"")).slice(0,44).join("") || fallback;
const short = value => typeof value === "string" ? value.slice(0,2000) : "";
function cleanReference(value) {
  if (typeof value !== "string" || value.startsWith("data:")) return "";
  try { const u=new URL(value); return u.protocol==="https:" ? u.origin+u.pathname : ""; } catch {}
  return short(value);
}
const refs = values => Array.isArray(values) ? values.slice(0,100).map(cleanReference).filter(Boolean) : [];
const configFields = new Set(["aspectRatio","resolution","duration","seed","inputMode","episodeId","ratio","video_resolution","model_version","fps","width","height","batchSize","size","createdAt","taskId","mode","guidanceScale","quality"]);
function cleanSettings(settings) {
  return Object.fromEntries(Object.entries(settings || {}).filter(([key,v]) => configFields.has(key) && (typeof v==="boolean"||typeof v==="number"||typeof v==="string"&&!/^(https?:|data:)/i.test(v))).map(([key,v])=>[key,typeof v==="string"?short(v):v]));
}
async function realDirectory(parent,name) {
  const folder=path.join(parent,name);
  await fs.mkdir(folder,{mode:0o700}).catch(e=>{if(e.code!=="EEXIST")throw e;});
  const stat=await fs.lstat(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(folder)!==folder) throw new Error("下载目录不可安全使用。");
  return folder;
}
async function ordinaryFile(target) {
  return fs.lstat(target).then(stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0,()=>false);
}
async function publicUrlResponse(urlValue, signal, redirectCount=0) {
  const url=new URL(urlValue);
  if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||isIP(url.hostname)||!url.hostname.includes(".")
    || /(?:^|\.)(?:local|localhost|internal|invalid|test)$/.test(url.hostname)) throw new Error("平台未返回可用的 HTTPS 素材地址。");
  signal.throwIfAborted();
  const addresses=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("解析素材地址超时。")),5000);
    timer.unref?.();
    lookup(url.hostname,{all:true,family:4}).then(resolve,reject).finally(()=>clearTimeout(timer));
  });
  if(!addresses.length||addresses.some(({address})=>deny.check(address,"ipv4"))) throw new Error("平台未返回可用的公网素材地址。");
  const address=addresses[0].address;
  const response=await new Promise((resolve,reject)=>{
    const request=httpSecure.get(url,{signal,agent:false,headers:{"Accept-Encoding":"identity"},lookup:(_hostname,options,done)=>options.all?done(null,[{address,family:4}]):done(null,address,4)},resolve);
    request.setTimeout(30000,()=>request.destroy(new Error("下载超时。"))); request.on("error",reject);
  });
  if([301,302,303,307,308].includes(response.statusCode) && response.headers.location && redirectCount<3){
    response.destroy(); return publicUrlResponse(new URL(response.headers.location,url).href,signal,redirectCount+1);
  }
  if(response.statusCode!==200){response.destroy(); throw new Error("远程素材不可用或下载地址已失效。");}
  return response;
}
async function receive(url,kind,temp,job) {
  const response=await publicUrlResponse(url,AbortSignal.timeout(180000));
  const headers=response.headers;
  const known=media[kind] || {};
  const mime=String(headers["content-type"]||"").split(";")[0].toLowerCase();
  const urlExtension=path.extname(new URL(url).pathname).toLowerCase().replace(/^\.jpeg$/,".jpg");
  const extension=known[mime] || (["","application/octet-stream"].includes(mime) && Object.values(known).includes(urlExtension) ? urlExtension : "");
  const amount=Number(headers["content-length"]);
  if(!extension||amount>MAX_FILE||amount>MAX_JOB-job.bytes){response.destroy();throw new Error("素材格式不匹配，或文件超过下载上限。");}
  let bytes=0;
  await pipeline(response,new Transform({transform(chunk,_encoding,then){
    bytes+=chunk.length;
    if(bytes>MAX_FILE || bytes+job.bytes>MAX_JOB) then(new Error("素材超过下载上限。")); else then(null,chunk);
  }}),createWriteStream(temp,{flags:"wx",mode:0o600}));
  if(!bytes || (Number.isFinite(amount) && amount!==bytes)) throw new Error("素材下载不完整。");
  job.bytes+=bytes;
  return extension;
}
function writeMetadata(target,record,row){
  const ticket={ kind:row.kind, prompt:typeof row.prompt==="string"?row.prompt.slice(0,24000):"",
    negativePrompt:typeof row.negativePrompt==="string"?row.negativePrompt.slice(0,12000):"",
    references:refs(row.references),pinnedSource:record.platform,model:short(row.model),generator:record.platform,settings:{...cleanSettings(row.settings),...(Array.isArray(row.settings?.referenceSlots)?{referenceSlots:row.settings.referenceSlots.slice(0,50).map(slot=>({kind:short(slot.kind),name:short(slot.name)}))}:{})},createdAt:short(row.createdAt) };
  const metadata={schemaVersion:1,platform:record.platform,project:{id:record.project.id,name:record.project.name},
    item:{id:record.id,name:short(row.name),nodeId:short(row.sourceNodeId),canvasId:short(row.canvasId),status:short(row.status),folder:short(row.folder),downstream:refs(row.downstream)},ticket};
  return fs.writeFile(target,JSON.stringify(metadata,null,2)+"\n",{flag:"wx",mode:0o600});
}
export async function readPlatformAssetDetails(file) {
  const extension=path.extname(file);
  if (!extension) return null;
  const sidecar=file.slice(0,-extension.length)+".meta.json";
  try {
    const stat=await fs.lstat(sidecar);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)return null;
    const data=JSON.parse(await fs.readFile(sidecar,"utf8"));
    if(data?.schemaVersion!==1||!has(sourceInfo,data.platform)||!data.item?.id)return null;
    return { platform:sourceInfo[data.platform].name, project:short(data.project?.name), assetId:short(data.item.id), nodeId:short(data.item.nodeId),
      canvasId:short(data.item.canvasId), folder:short(data.item.folder), model:short(data.ticket?.model), status:short(data.item.status),
      references:refs(data.ticket?.references), downstream:refs(data.item.downstream), settings:cleanSettings(data.ticket?.settings),
      createdAt:short(data.ticket?.createdAt) };
  } catch { return null; }
}

export class PlatformAssetSync {
  constructor({root,register,adapters=sourceInfo,receiveFile=receive,downloadTask=downloadDreaminaTask}){
    this.root=path.resolve(root);this.register=register;this.adapters=adapters;this.receiveFile=receiveFile;this.downloadTask=downloadTask;this.discovery=new Map();this.jobs=new Map();this.projectReads=new Map();this.active=null;
  }
  sources(){
    return Object.entries(this.adapters).map(([id,a])=>({id,name:a.name,mode:a.mode,note:a.note,canRead:!!a.projects && (!a.present||a.present()),localExport:a.localExport===true,setup:a.setup}));
  }
  async projects(source) {
    const a=has(this.adapters,source)&&this.adapters[source]; if(!a?.projects) throw new Error("此平台的项目下载接口尚未接通。");
    const data=await a.projects();
    const list=Array.isArray(data)?data:data.projects;
    if(!Array.isArray(list))throw new Error("平台未返回项目列表。");
    const projects=list.map(row=>({id:String(row.id??""),name:short(row.name),...(row.note?{note:short(row.note)}:{})})).filter(x=>x.id&&x.name).slice(0,10000);
    this.discovery.set(source,new Map(projects.map(p=>[p.id,p])));
    const notice=data.notice || data.warnings?.join("；");
    return {projects,...(notice?{notice:short(notice)}:{})};
  }
  beginProjects(source){
    if(!has(this.adapters,source)||!this.adapters[source].projects)throw new Error("此平台的项目下载接口尚未接通。");
    const active=[...this.projectReads.values()].find(job=>job.source===source&&job.state==="running");
    if(active)return {...active};
    const job={id:randomUUID(),source,state:"running"};
    this.projectReads.set(job.id,job);
    if(this.projectReads.size>16) for(const [id,previous] of this.projectReads){
      if(previous.state!=="running"){this.projectReads.delete(id);break;}
    }
    void this.projects(source).then(result=>Object.assign(job,result,{state:"done"}),error=>Object.assign(job,{state:"error",error:short(error.message)||"无法读取平台项目。"}));
    return {...job};
  }
  getProjects(id){const job=this.projectReads.get(id);return job?{...job}:null;}
  startLocal(source,folder,name){
    if(!has(this.adapters,source)||!this.adapters[source].localExport||typeof folder!=="string"||!path.isAbsolute(folder)) throw new Error("请填写解压后的官方导出目录（绝对路径）。");
    const root=path.resolve(folder);
    if(root===path.parse(root).root)throw new Error("请指定一个项目导出目录。");
    const project={id:"export:"+root,name:safe(name||path.basename(root),"导出项目")};
    return this.startJob(source,project,()=>this.exportRows(root));
  }
  async exportRows(folder){
    const actual=await fs.realpath(folder);
    if(actual===path.parse(actual).root||actual===this.root||actual.startsWith(this.root+path.sep)||this.root.startsWith(actual+path.sep))throw new Error("请选择独立的导出目录。");
    const rows=[];
    let visited=0;
    const traverse=async (base,depth)=>{
      if(depth>12||++visited>10000)throw new Error("导出目录过大，请按单个项目导入。");
      for(const entry of await fs.readdir(base,{withFileTypes:true})){
        if(entry.name.startsWith(".")||entry.isSymbolicLink())continue;
        const file=path.join(base,entry.name);
        if(entry.isDirectory()){await traverse(file,depth+1);continue;}
        if(!entry.isFile())continue;
        const extension=path.extname(file).toLowerCase().replace(/^\.jpeg$/,".jpg");
        const kind=Object.keys(media).find(k=>Object.values(media[k]).includes(extension));
        if(!kind)continue;
        const relative=path.relative(actual,file);
        const subfolder=path.dirname(relative);
        rows.push({id:relative,name:path.basename(file,path.extname(file)),kind,extension,local:file,folder:subfolder==="."?"":subfolder,
          ...await this.readExportMetadata(file)});
        if(rows.length>3000)throw new Error("导出目录超过单次同步上限，未导入任何素材。");
      }
    };
    await traverse(actual,0);
    return rows;
  }
  async readExportMetadata(file){
    const data={};
    // Match the exact filename first. A plain stem is accepted only when it names one media file.
    const ext=path.extname(file), stem=file.slice(0,-ext.length);
    const neighbors=await fs.readdir(path.dirname(file));
    const unique=neighbors.filter(name=>name.slice(0,-path.extname(name).length)===path.basename(stem) && Object.values(media).some(types=>Object.values(types).includes(path.extname(name).toLowerCase().replace(/^\.jpeg$/,".jpg")))).length===1;
    for(const candidate of [file+".meta.json",...(unique?[stem+".meta.json"]:[])]){
      try{
        const stat=await fs.lstat(candidate);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)continue;
        const raw=JSON.parse(await fs.readFile(candidate,"utf8")), item=raw?.ticket||raw?.association||raw;
        Object.assign(data,{prompt:item?.prompt,negativePrompt:item?.negativePrompt,model:item?.model,settings:item?.settings,references:item?.references,createdAt:item?.createdAt});
        break;
      }catch{}
    }
    for(const candidate of [file+".prompt.md",...(unique?[stem+".prompt.md"]:[])]){
      const stat=await fs.lstat(candidate).catch(()=>null);
      if(stat?.isFile()&&!stat.isSymbolicLink()&&stat.size<=256*1024){data.promptFile=candidate;break;}
    }
    return data;
  }
  start(source,id){
    if(this.active)throw new Error("已有平台项目正在同步，请等待完成。");
    const project=this.discovery.get(source)?.get(id);
    if(!project || !this.adapters[source]?.assets)throw new Error("请先读取并选择一个真实平台项目。");
    return this.startJob(source,project,()=>this.adapters[source].assets(project.id));
  }
  startJob(source,project,load){
    if(this.active)throw new Error("已有平台项目正在同步，请等待完成。");
    const job={id:randomUUID(),state:"running",project:project.name,total:0,processed:0,downloaded:0,skipped:0,failed:0,bytes:0};
    this.active=job.id; this.jobs.set(job.id,job); if(this.jobs.size>15)this.jobs.delete(this.jobs.keys().next().value);
    void this.run(job,source,project,load).catch(error=>{job.state="error";job.error=job.total ? "同步未完成，已保存的文件保留，可重新同步。" : short(error.message)||"无法读取平台素材。";}).finally(()=>{this.active=null;});
    return {...job};
  }
  get(id){const data=this.jobs.get(id);return data?{...data}:null;}
  async run(job,source,project,load){
    const result=await load();
    const raw=Array.isArray(result)?result:result?.assets;
    if(!Array.isArray(raw))throw new Error("平台未返回可识别的素材列表。");
    if(result.notice||result.warnings?.length)job.notice=short(result.notice || result.warnings.join("；"));
    const rows=[...new Map(raw.filter(row=>row.id&&(row.url||row.local||(source==="dreamina"&&row.submitId))&&has(media,row.kind)).map(row=>[String(row.id),row])).values()];
    if(!rows.length){job.state="done";return;}
    if(rows.length>3000)throw new Error("该项目超过单次同步上限，未下载任何素材。");
    job.total=rows.length;
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    const root=await fs.realpath(this.root);
    const sourceFolder=await realDirectory(root,source);
    const key=digest(project.id);
    const existing=(await fs.readdir(sourceFolder,{withFileTypes:true})).find(x=>x.isDirectory()&&x.name.endsWith(" · "+key));
    const projectFolder=await realDirectory(sourceFolder,existing?.name || safe(project.name,"未命名项目")+" · "+key);
    const pending=await fs.mkdtemp(path.join(projectFolder,".download-"));
    try{
      for(const row of rows){
        try {
          const collection= row.folder ? await realDirectory(projectFolder,safe(row.folder,"画布")+(row.canvasId?" · "+digest(row.canvasId):"")) : projectFolder;
          const stemKey=" · "+digest(row.id);
          const current=(await fs.readdir(collection)).find(n=>n.endsWith(stemKey+".meta.json"));
          const stem=current?.slice(0,-".meta.json".length) || safe(row.name,"素材")+stemKey;
          const extensions=Object.values(media[row.kind]);
          const complete=await Promise.all(extensions.map(async extension=>await ordinaryFile(path.join(collection,stem+extension)) && await ordinaryFile(path.join(collection,stem+".meta.json"))));
          const missingPromptFile=row.promptFile && row.extension && !await ordinaryFile(path.join(collection,stem+row.extension+".prompt.md"));
          if(complete.some(Boolean)&&!missingPromptFile){ job.skipped++;continue; }
          const record={platform:source,project,id:String(row.id)};
          if(row.local){
            const input=await fs.lstat(row.local);
            if(!input.isFile()||input.isSymbolicLink()||input.size<=0||input.size>MAX_FILE||job.bytes+input.size>MAX_JOB)throw new Error("导出文件不可用。");
            const temp=path.join(pending,randomUUID());
            try {
              await fs.copyFile(row.local,temp);
              await this.publish(collection,stem,row.extension,temp,record,row);
              if(row.promptFile) {
                const destination=path.join(collection,stem+row.extension+".prompt.md");
                const original=path.basename(row.local);
                const text=await fs.readFile(row.promptFile,"utf8");
                const updated=text.replace(/^(\s*[-*]\s*结果文件[：:]\s*)[^\n]+$/m,(line,prefix)=>line.trimEnd().endsWith(original)?prefix+path.basename(path.join(collection,stem+row.extension)):line);
                await fs.writeFile(destination,updated,{flag:"wx",mode:0o600}).catch(e=>{if(e.code!=="EEXIST")throw e;});
              }
              job.bytes+=input.size;job.downloaded++;
            } finally{await fs.unlink(temp).catch(()=>{});}
          } else if(row.url){
            const temp=path.join(pending,randomUUID());
            try {
              const ext=await this.receiveFile(row.url,row.kind,temp,job);
              await this.publish(collection,stem,ext,temp,record,row);
              job.downloaded++;
            } finally {await fs.unlink(temp).catch(()=>{});}
          } else {
            const taskDir=await fs.mkdtemp(path.join(pending,"task-"));
            try{
              const out=await this.downloadTask(row.submitId,taskDir);
              if(!Array.isArray(out)||!out.length)throw new Error("客户端未返回素材。");
              const items=await Promise.all(out.map(async file=>{
                const real=await fs.realpath(file), ext=path.extname(real).toLowerCase().replace(/^\.jpeg$/,".jpg");
                if(!real.startsWith(taskDir+path.sep)||!extensions.includes(ext)||!await ordinaryFile(file))throw new Error("客户端未返回受管媒体文件。");
                return {real,ext,size:(await fs.stat(real)).size};
              }));
              const bytes=items.reduce((sum,x)=>sum+x.size,0);
              if(items.some(x=>x.size>MAX_FILE)||job.bytes+bytes>MAX_JOB)throw new Error("下载内容超过同步上限。");
              for(const [index,item] of items.entries()) await this.publish(collection,index?stem+" · "+(index+1):stem,item.ext,item.real,record,row);
              job.bytes+=bytes; job.downloaded++;
            }finally{await fs.rm(taskDir,{recursive:true,force:true});}
          }
        }catch{job.failed++;}
        finally {job.processed++;}
      }
      if(job.downloaded||job.skipped)job.localProjectId=await this.register(project.name+" · "+this.adapters[source].name,projectFolder);
    }finally{await fs.rm(pending,{recursive:true,force:true});}
    if(job.failed)job.error="部分素材无法下载，可能是链接失效、未登录或格式不支持；可在平台恢复后重试。";
    job.state=job.failed?(job.downloaded||job.skipped?"partial":"error"):"done";
  }
  async publish(collection,stem,ext,temp,record,row){
    const destination=path.join(collection,stem+ext), sidecar=path.join(collection,stem+".meta.json");
    const metadata=path.join(path.dirname(temp),randomUUID());
    await writeMetadata(metadata,record,row);
    try{
      await fs.link(temp,destination).catch(e=>{if(e.code!=="EEXIST")throw e;});
      await fs.link(metadata,sidecar).catch(e=>{if(e.code!=="EEXIST")throw e;});
      if(!await ordinaryFile(destination)||!await ordinaryFile(sidecar)) throw new Error("素材名与本地文件发生冲突。");
    }finally{await fs.unlink(metadata).catch(()=>{});}
  }
}
