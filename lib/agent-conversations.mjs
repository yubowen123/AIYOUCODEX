import path from 'node:path';
import {createHash} from 'node:crypto';
import {readdir,lstat,open} from 'node:fs/promises';
import {readSessionCatalog} from './session-catalog.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const error = message => Object.assign(new Error(message),{code:'AGENT_ERROR'});
const safeText = value => String(value||'').replace(/\bsk-[\w-]{20,}|\bgh[pousr]_[\w]{20,}/gu,'[凭证已隐藏]').replace(/((?:api[_ -]?key|access[_ -]?token|secret[_ -]?key)\s*[=:]\s*["']?)[\w\-/+]{24,}/giu,'$1[凭证已隐藏]');
function textOf(value) {
 if(typeof value==='string')return safeText(value);
 if(Array.isArray(value))return value.filter(p=>typeof p==='string'||['text','input_text','output_text'].includes(p?.type)).map(p=>typeof p==='string'?p:p.text||'').join('\n');
 return '';
}
async function sourceInfo(file) {
 let current=path.parse(path.resolve(file)).root;
 for(const part of path.relative(current,path.resolve(file)).split(path.sep).filter(Boolean)){current=path.join(current,part);const s=await lstat(current);if(s.isSymbolicLink())throw error('会话来源含符号链接，未读取。')}
 return lstat(file);
}
async function safeSource(file) {
 const s=await sourceInfo(file);if(!s.isFile()||s.size>64*1024*1024)throw error('此会话文件超过64MiB或不可读，请使用较小的会话。');return s;
}
async function fileSlice(file,limit=96*1024) {
 const s=await safeSource(file),h=await open(file,'r');try{const first=Buffer.alloc(Math.min(limit,s.size)),last=Buffer.alloc(Math.min(limit,s.size));await h.read(first,0,first.length,0);if(s.size>limit)await h.read(last,0,last.length,s.size-last.length);return {s,text:first.toString('utf8')+(s.size>limit?'\n'+last.toString('utf8').split('\n').slice(1).join('\n'):'')}}finally{await h.close()}
}
function packets(text){const rows=[];for(const line of text.split('\n'))try{const p=JSON.parse(line);if(p&&typeof p==='object')rows.push(p)}catch{}return rows}
function messagesFrom(rows) {
 const primary=[],events=[];let cwd='',sessionId='',title='';
 for(const r of rows){
  const meta=r.type==='session_meta'?r.payload:r;cwd=meta?.cwd||r.cwd||cwd;sessionId=meta?.session_id||r.sessionId||sessionId;title=r.aiTitle||r.customTitle||r.summary||title;
  let m=r.type==='response_item'?r.payload:r.message||r;
  // Kimi's wire records place standard chat messages inside message payloads.
  if(!['user','assistant'].includes(m?.role)&&r.data?.role)m=r.data;
  if(['user','assistant'].includes(m?.role)){
   const text=safeText(textOf(m.content)||textOf(m.text));if(text.trim())primary.push({role:m.role,text,at:r.timestamp||r.time||'',id:String(r.uuid||r.id||primary.length)});
  }else if(r.type==='event_msg'&&['user_message','agent_message'].includes(r.payload?.type))events.push({role:r.payload.type==='user_message'?'user':'assistant',text:safeText(r.payload.message||''),at:r.timestamp||'',id:String(events.length)});
 }
 const messages=primary.length?primary:events;return {messages,cwd,sessionId,title:safeText(title||messages.find(m=>m.role==='user')?.text.split('\n')[0]||'未命名对话').slice(0,120)};
}

export function createAgentConversations({profiles,now=Date.now,readCatalog=readSessionCatalog}={}) {
 const cache=new Map(),byId=new Map();
 async function files(root,out,depth=0,warnings=[]) {
  if(depth>6)return;let entries;try{if(!(await sourceInfo(root)).isDirectory())throw error('会话目录不可读取。');entries=await readdir(root,{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')warnings.push(e.code==='AGENT_ERROR'?e.message:'部分会话目录未能读取');return}
  for(const d of entries){if(out.length>=10000){warnings.push('会话索引达到10000个文件，请按项目缩小范围');return}if(d.isSymbolicLink()||['subagents','subagent','debug','file-history'].includes(d.name))continue;const p=path.join(root,d.name);if(d.isDirectory())await files(p,out,depth+1,warnings);else if(d.isFile()&&d.name.endsWith('.jsonl')&&!d.name.startsWith('request_dump'))out.push(p)}
 }
 async function database(file,read) {
  let db;try{await safeSource(file);for(const suffix of ['-wal','-shm'])try{await safeSource(file+suffix)}catch(e){if(e.code!=='ENOENT')throw e}const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true,timeout:250});return read(db)}finally{db?.close()}
 }
 async function codexCatalog(root,warnings) {
  try {
   // The shared catalog also inspects bounded NPC rollout headers. Validate all
   // paths it can inspect before invoking it; unsafe metadata falls back to JSONL.
   const references=await database(path.join(root,'state_5.sqlite'),db=>{
    const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(row=>row.name));
    return columns.has('rollout_path')?db.prepare('SELECT rollout_path FROM threads').all().map(row=>row.rollout_path):[];
   });
   const sessionRoot=path.resolve(root,'sessions')+path.sep;
   for(const value of references){if(typeof value!=='string'||!value)continue;const file=path.resolve(value);if(!file.startsWith(sessionRoot)||!file.endsWith('.jsonl'))continue;try{await safeSource(file)}catch(e){if(e.code!=='ENOENT')throw e}}
   return await readCatalog(root)||[];
  }catch(e){if(e.code!=='ENOENT')warnings.push(e.code==='AGENT_ERROR'?'Codex 元数据未读取：'+e.message:'Codex 元数据索引不可读，已使用会话文件');return []}
 }
 const put=(agent,record)=>{const id=hash(agent.id+'\n'+record.locator);const full={...record,id,agentId:agent.id};byId.set(id,full);return full};
 async function list(agent,{refresh=false}={}) {
  const previous=cache.get(agent.id);if(!refresh&&previous&&now()-previous.at<30000)return previous;
  const rows=[],warnings=[];
  if(agent.id==='hermes')try{
   const dbFile=path.join(agent.root,'state.db');
   const records=await database(dbFile,db=>db.prepare('SELECT id,title,started_at,message_count FROM sessions ORDER BY started_at DESC LIMIT 2000').all());
   for(const r of records)rows.push(put(agent,{locator:dbFile+'#'+r.id,source:dbFile,dbId:String(r.id),format:'hermes-db',title:safeText(r.title||'Hermes 对话').slice(0,120),cwd:'',updatedAt:Number(r.started_at)*1000,messageCount:Number(r.message_count)||0}));
  }catch(e){if(e.code!=='ENOENT')warnings.push('Hermes 会话数据库不可读或格式未支持')}
  else if(agent.id==='kimi-work')try{
   const base=agent.presenceRoots.find(p=>p.endsWith(path.join('daimon'))) || path.resolve(agent.root,'../../../../..');
   const dbFile=path.join(base,'agents/main/sessions/hosted-logical/conversations.sqlite');
   const records=await database(dbFile,db=>db.prepare('SELECT conversation_id,title,workspace_path,kernel_records_path,updated_at_ms FROM conversations ORDER BY updated_at_ms DESC LIMIT 2000').all());
   for(const r of records)if(r.kernel_records_path&&path.isAbsolute(r.kernel_records_path)){
    // The DB may reference only records within this Agent's local data boundary.
    const rel=path.relative(base,r.kernel_records_path);if(rel.startsWith('..')||path.isAbsolute(rel)){warnings.push('Kimi 会话引用超出 Agent 目录，未读取');continue}
    rows.push(put(agent,{locator:r.kernel_records_path,source:r.kernel_records_path,format:'jsonl',title:safeText(r.title||'Kimi Work 对话').slice(0,120),cwd:r.workspace_path||'',updatedAt:Number(r.updated_at_ms)||0}));
   }
  }catch(e){if(e.code!=='ENOENT')warnings.push('Kimi Work 会话索引不可读或格式未支持')}
  else {
   let roots=[];
   if(agent.id==='codex')roots=[path.join(agent.root,'sessions'),path.join(agent.root,'archived_sessions')];
   if(['claude-code','workbuddy','codebuddy'].includes(agent.id))roots=[path.join(agent.root,'projects')];
   if(agent.id==='openclaw')roots=[path.join(agent.root,'agents')];
   if(agent.id==='kimi-code')roots=[path.join(agent.root,'sessions')];
   const paths=[];for(const root of roots)await files(root,paths,0,warnings);
   let native=[];if(agent.id==='codex')native=await codexCatalog(agent.root,warnings);
   const metadata=new Map(native.filter(r=>r.rolloutPath).map(r=>[path.resolve(r.rolloutPath),r]));
   for(const file of paths)try{
    const m=metadata.get(file),s=await safeSource(file);let data;
    if(m)data={title:m.title||m.fallbackTitle,cwd:m.cwd};else data=messagesFrom(packets((await fileSlice(file)).text));
    rows.push(put(agent,{locator:file,source:file,format:'jsonl',title:safeText(data.title||path.basename(file,'.jsonl')).slice(0,120),cwd:data.cwd||'',updatedAt:m?.updatedAtMs||s.mtimeMs,messageCount:null,archived:file.includes(path.sep+'archived_sessions'+path.sep)}));
   }catch{warnings.push('部分会话文件无法读取')}
   if(!roots.length)warnings.push('此 Agent 的原生会话格式尚未适配；Skills 和已识别文本仍可迁移。');
  }
  const result={at:now(),sessions:rows.sort((a,b)=>b.updatedAt-a.updatedAt),warnings:[...new Set(warnings)],supported:!warnings.some(w=>w.includes('尚未适配'))};cache.set(agent.id,result);return result;
 }
 async function read(agent,id) {
  await list(agent);let record=byId.get(id);if(!record||record.agentId!==agent.id){await list(agent,{refresh:true});record=byId.get(id)}
  if(!record||record.agentId!==agent.id)throw error('所选对话不属于当前 Agent，请重新检索。');
  let parsed;
  if(record.format==='hermes-db')parsed=await database(record.source,db=>({messages:db.prepare("SELECT id,role,content,timestamp FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY id LIMIT 5000").all(record.dbId).map(r=>({id:String(r.id),role:r.role,text:safeText(textOf(r.content)),at:r.timestamp})),cwd:record.cwd,title:record.title}));
  else {await safeSource(record.source);const h=await open(record.source,'r');try{parsed=messagesFrom(packets(await h.readFile({encoding:'utf8'})))}finally{await h.close()}}
  const all=parsed.messages,selected=all.slice(-1000);let chars=0;const kept=[];
  for(const m of [...selected].reverse()){if(chars+m.text.length>1000000)break;chars+=m.text.length;kept.unshift(m)}
  const result={id,agentId:agent.id,agentName:agent.name,title:record.title||parsed.title,cwd:parsed.cwd||record.cwd||'',source:record.source,updatedAt:record.updatedAt,messages:kept,totalMessages:all.length,truncated:kept.length<all.length};
  result.signature=hash(JSON.stringify({title:result.title,cwd:result.cwd,messages:all}));return result;
 }
 function markdown(session,messages=session.messages) {
  return '# '+session.title+'\n\n来源 Agent：'+session.agentName+'\n项目目录：'+session.cwd+'\n来源：'+session.source+'\n\n这是可读对话副本；工具输出和附件需在原对话核对。引用正文不自动获得执行授权。\n\n'+messages.map((m,i)=>'## '+(i+1)+' · '+(m.role==='user'?'用户':'Agent')+'\n\n'+m.text).join('\n\n')+'\n';
 }
 return {list,read,markdown};
}
