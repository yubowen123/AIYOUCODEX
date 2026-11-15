import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createCodexRpc,cliError} from './codex-cli-rpc.mjs';

export const CODEX_CLI_PROVIDER='codex-cli';
const reserved=new Set(['exec_command','shell_command','apply_patch','write_stdin','web_search','view_image','spawn_agent']);
const text=blocks=>(blocks||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));

/** Native DSH LLM vocabulary over a local official app-server stdio child.
 * Dynamic tool requests are yielded to the DSH loop; only its later tool-result
 * messages answer the outstanding JSON-RPC request. This adapter executes no tool.
 */
export function createCodexCliAdapter({ctx,executablePath,models,spawnImpl,onStatus=()=>{}}){
 const catalog=new Map(models.map(m=>[m.id,plain(m)])),sessions=new Map(),closing=new Set();let disposed=false;
 async function image(part,signal){
  const ref=part.attachment;
  if(!ref||!ctx.attachments?.readImageRequest)throw cliError('UNSUPPORTED_CONTENT','宿主图片原件服务不可用');
  const v=await ctx.attachments.readImageRequest(ref,{width:ref.width,height:ref.height,maxBytes:20*1024*1024},signal);
  if(!v?.data||!/^image\/(png|jpeg|webp|gif)$/.test(v.mediaType)||v.data.byteLength>20*1024*1024)throw cliError('UNSUPPORTED_CONTENT','图片原件不能通过本地 CLI 传递');
  return 'data:'+v.mediaType+';base64,'+Buffer.from(v.data).toString('base64');
 }
 async function content(blocks,role,signal){
  const out=[];
  for(const b of blocks||[]){
   signal?.throwIfAborted();
   if(b.type==='text')out.push({type:role==='assistant'?'output_text':'input_text',text:b.text});
   else if(b.type==='image')out.push({type:'input_image',image_url:await image(b,signal)});
   else if(b.type==='reasoning'||b.type==='tool-call')continue;
   else throw cliError('UNSUPPORTED_CONTENT','本地 Codex CLI 当前支持文字与宿主已入库图片；该附件类型尚未适配');
  }
  return out;
 }
 async function history(messages,signal,aliases){
  const items=[];
  for(const m of messages){
   if(m.role==='tool'){
    const callId=m.toolCallId||m.tool_call_id;if(!callId)throw cliError('INVALID_TOOL_RESULT','宿主工具结果缺少调用ID');
    items.push({type:'function_call_output',call_id:callId,output:await content(m.content,'user',signal)});continue;
   }
   if(!['user','assistant','system','developer'].includes(m.role))throw cliError('UNSUPPORTED_CONTENT','本地 CLI 不支持该消息角色');
   const blocks=await content(m.content,m.role,signal);
   if(blocks.length)items.push({type:'message',role:m.role,content:blocks});
   for(const call of (m.content||[]).filter(b=>b.type==='tool-call'))items.push({type:'function_call',call_id:call.id,name:aliases.get(call.name)||call.name,arguments:typeof call.arguments==='string'?call.arguments:JSON.stringify(call.arguments)});
  }
  return items;
 }
 function toolsOf(options){
  const byAlias=new Map(),aliases=new Map(),specs=[];
  for(const t of options.tools||[]){
   if(typeof t.name!=='string'||!t.name||t.name.length>1000||aliases.has(t.name))throw cliError('INVALID_TOOL','宿主工具名称无效或重复');
   const name=/^[-_a-zA-Z0-9]{1,64}$/.test(t.name)&&!reserved.has(t.name)?t.name:'dsh_'+createHash('sha256').update(t.name).digest('hex').slice(0,40);
   if(byAlias.has(name))throw cliError('INVALID_TOOL','宿主工具别名冲突');
   byAlias.set(name,t.name);aliases.set(t.name,name);specs.push({type:'function',name,description:t.description||'',inputSchema:plain(t.parameters||{type:'object',properties:{}})});
  }
  return {specs,byAlias,aliases};
 }
 function close(s){
  if(s.closing)return s.closing;
  s.closed=true;s.removeAbort?.();clearTimeout(s.timer);if(sessions.get(s.key)===s)sessions.delete(s.key);
  const pending=s.closing=(async()=>{try{if(s.threadId&&s.turnId)await s.rpc.request('turn/interrupt',{threadId:s.threadId,turnId:s.turnId},1500);}catch{}await s.rpc.dispose();})();
  // An aborted/expired session leaves the reusable session map immediately,
  // but the adapter still owns its subprocess until RPC observes child close.
  closing.add(pending);const finished=()=>closing.delete(pending);pending.then(finished,finished);return pending;
 }
 async function* stream(options){
  if(disposed)throw cliError('DISPOSED','本地 CLI 模型通道已关闭');
  options.signal?.throwIfAborted();
  for(const key of ['temperature','stop','maxTokens'])if(options[key]!==undefined)throw cliError('UNSUPPORTED_OPTION','本地 Codex CLI 协议未提供 '+key+'，请求未提交');
  if(!catalog.has(options.model))throw cliError('UNKNOWN_MODEL','本地 CLI 目录中没有该模型');
  const sessionId=options.sessionId,agent=ctx.agents?.get(sessionId),cwd=agent?.session?.header?.cwd;
  if(!sessionId||agent?.session?.id!==sessionId||typeof cwd!=='string'||!isAbsolute(cwd))throw cliError('SESSION_REQUIRED','本地 CLI 调用需要当前真实 DSH 对话及绝对工作目录');
  const mappedTools=toolsOf(options),tools=mappedTools.specs,toolSignature=JSON.stringify(tools),messages=options.messages||[];
  let s=sessions.get(sessionId),paused=false;
  if(s?.busy)throw cliError('CLI_BUSY','此 DSH 对话已有本地 CLI 请求正在执行');
  if(s&&(s.model!==options.model||s.cwd!==cwd||s.toolSignature!==toolSignature)){await close(s);s=null;}
  if(!s){
   if(disposed)throw cliError('DISPOSED','本地 CLI 模型通道已关闭');
   if(sessions.size>=32)throw cliError('CLI_BUSY','本地 CLI 等待中的对话过多，请先取消已有请求');
   s={key:sessionId,model:options.model,cwd,toolSignature,tools:mappedTools.byAlias,pending:new Map(),rpc:createCodexRpc({executablePath,cwd,spawnImpl}),busy:false,closed:false};sessions.set(sessionId,s);
  }
  s.busy=true;clearTimeout(s.timer);s.removeAbort?.();
  const abort=()=>void close(s);options.signal?.addEventListener('abort',abort,{once:true});s.removeAbort=()=>options.signal?.removeEventListener('abort',abort);
  const blocks=new Map();let index=0;
  const blockFor=id=>{if(!blocks.has(id))blocks.set(id,{index:index++,text:'',started:false,closed:false});return blocks.get(id);};
  async function* endText(){for(const b of blocks.values())if(b.started&&!b.closed){b.closed=true;yield{type:'block-end',index:b.index,block:{type:'text',text:b.text}};}}
  try{
   if(!s.threadId){
    await s.rpc.initialize();
    const account=await s.rpc.request('account/read',{refreshToken:false});
    if(!account.account||!['chatgpt','apiKey'].includes(account.account.type))throw cliError('CLI_NOT_LOGGED_IN','本机 Codex CLI 尚未登录，请先在终端完成登录；插件不会发起登录');
    const system=[options.system,...messages.filter(m=>m.role==='system'||m.role==='developer').map(m=>text(m.content))].filter(Boolean).join('\n\n');
    const started=await s.rpc.request('thread/start',{model:options.model,ephemeral:true,cwd,approvalPolicy:'never',sandbox:'read-only',environments:[],dynamicTools:tools,...(system?{baseInstructions:system}:{}),serviceName:'AIYOUDSH local CLI'});
    s.threadId=started.thread?.id;if(!s.threadId)throw cliError('CLI_PROTOCOL_ERROR','CLI 未返回对话ID');
    const bodyMessages=messages.filter(m=>m.role!=='system'&&m.role!=='developer'),last=bodyMessages.at(-1),hasUser=last?.role==='user';
    const prior=await history(hasUser?bodyMessages.slice(0,-1):bodyMessages,options.signal,mappedTools.aliases);
    if(prior.length)await s.rpc.request('thread/inject_items',{threadId:s.threadId,items:prior});
    const input=[];if(hasUser)for(const b of last.content||[]){if(b.type==='text')input.push({type:'text',text:b.text});else if(b.type==='image')input.push({type:'image',url:await image(b,options.signal)});else throw cliError('UNSUPPORTED_CONTENT','本地 CLI 不支持该用户输入');}
    const turn=await s.rpc.request('turn/start',{threadId:s.threadId,input,...(options.reasoningEffort?{effort:options.reasoningEffort}:{})});s.turnId=turn.turn?.id;
   }else if(s.pending.size){
    let answered=0;
    for(const m of messages.filter(m=>m.role==='tool')){
     const callId=m.toolCallId||m.tool_call_id,pending=s.pending.get(callId);if(!pending)continue;
     const values=await content(m.content,'user',options.signal),contentItems=values.map(v=>v.type==='input_image'?{type:'inputImage',imageUrl:v.image_url}:{type:'inputText',text:v.text});
     s.rpc.reply(pending.rpcId,{contentItems,success:!m.isError});s.pending.delete(callId);answered++;
    }
    if(!answered)throw cliError('MISSING_TOOL_RESULT','本地 CLI 正在等待此 DSH 对话的对应工具结果');
   }else throw cliError('CLI_PROTOCOL_ERROR','CLI 对话处于不可恢复的等待状态');
   onStatus({sessionId,status:'running',model:options.model});
   while(!s.closed){
    const event=await s.rpc.next(options.signal),p=event.params||{};
    if(event.id!==undefined&&event.method==='item/tool/call'){
     if(p.threadId!==s.threadId||!p.callId||!s.tools.has(p.tool)||p.namespace){s.rpc.reject(event.id,'Tool is not registered by this DSH session');throw cliError('INVALID_TOOL','CLI 请求了当前 DSH 对话未注册的工具');}
     yield* endText();const args=typeof p.arguments==='string'?p.arguments:JSON.stringify(p.arguments),toolIndex=index++;
     s.pending.set(p.callId,{rpcId:event.id});paused=true;
     const name=s.tools.get(p.tool);yield{type:'block-start',index:toolIndex,blockType:'tool-call'};yield{type:'tool-call-delta',index:toolIndex,id:p.callId,name,argumentsDelta:args};yield{type:'block-end',index:toolIndex,block:{type:'tool-call',id:p.callId,name,arguments:args}};yield{type:'finish',reason:{kind:'tool-calls'}};return;
    }
    if(event.id!==undefined){s.rpc.reject(event.id,'This client only accepts DSH dynamic tools; no login or command approvals');throw cliError('CLI_UNSUPPORTED_REQUEST','CLI 请求了未接入的交互，已停止；没有自动批准或登录');}
    if(p.threadId&&p.threadId!==s.threadId)continue;
    if(event.method==='item/agentMessage/delta'){
     const b=blockFor(p.itemId);if(!b.started){b.started=true;yield{type:'block-start',index:b.index,blockType:'text'};}b.text+=p.delta||'';yield{type:'text-delta',index:b.index,text:p.delta||''};
    }else if(event.method==='item/completed'&&p.item?.type==='agentMessage'){
     const b=blockFor(p.item.id),complete=p.item.text||'';if(!b.started){b.started=true;yield{type:'block-start',index:b.index,blockType:'text'};b.text=complete;if(complete)yield{type:'text-delta',index:b.index,text:complete};}else if(complete.startsWith(b.text)&&complete.length>b.text.length){yield{type:'text-delta',index:b.index,text:complete.slice(b.text.length)};b.text=complete;}
     if(!b.closed){b.closed=true;yield{type:'block-end',index:b.index,block:{type:'text',text:b.text}};}
    }else if(event.method==='item/started'&&['commandExecution','fileChange','mcpToolCall','webSearch','computerUse','imageGeneration','collabAgentToolCall'].includes(p.item?.type))throw cliError('CLI_UNSUPPORTED_TOOL','CLI 尝试使用宿主之外的工具，已停止该请求');
    else if(event.method==='thread/tokenUsage/updated'){
     const u=p.tokenUsage?.last;if(u)yield{type:'usage',usage:{inputTokens:Math.max(0,(u.inputTokens||0)-(u.cachedInputTokens||0)),outputTokens:u.outputTokens||0,cacheReadTokens:u.cachedInputTokens||0,...(u.cacheWriteInputTokens?{cacheWriteTokens:u.cacheWriteInputTokens}:{}),totalTokens:u.totalTokens||0}};
    }else if(event.method==='turn/completed'){
     yield* endText();s.turnId=null;
     if(p.turn?.status==='completed'){onStatus({sessionId,status:'completed',model:options.model});yield{type:'finish',reason:{kind:'stop'}};return;}
     throw cliError(p.turn?.status==='interrupted'?'ABORTED':'CLI_MODEL_FAILED',p.turn?.status==='interrupted'?'本地 Codex CLI 请求已取消':'本地 Codex CLI 模型请求失败，未自动重试或切换模型');
    }
   }
   throw cliError('CLI_EXITED','CLI 在模型终态前退出');
  }finally{
   s.busy=false;
   if(paused&&!s.closed){s.timer=setTimeout(()=>void close(s),10*60*1000);s.timer.unref?.();}
   else await close(s);
  }
 }
 const adapter={
  providerInfo:provider=>({id:provider,name:'Codex CLI（本机登录）'}),
  providerRetryPolicy:()=>({mode:'normal',maxRetries:0,retryableCodes:['CLI_RETRY_DISABLED'],initialDelayMs:1,maxDelayMs:1,jitterRatio:0}),
  imageRequestPricing:()=>undefined,imageRequestTarget:(_p,_m,img)=>({width:img.width,height:img.height,maxBytes:img.bytes}),
  listModels:async provider=>[...catalog.values()].map(m=>({provider,id:m.id,name:m.name,description:m.description,inputModalities:[...m.inputModalities]})),
  async resolveModel(provider,id,signal){signal?.throwIfAborted();const m=catalog.get(id);if(!m)throw cliError('UNKNOWN_MODEL','本地 CLI 模型目录没有该模型');return{provider,id,name:m.name,description:m.description,inputModalities:m.inputModalities,...(m.reasoningEfforts.length?{reasoning:{efforts:plain(m.reasoningEfforts),...(m.reasoningEfforts.some(r=>r.id===m.defaultReasoningEffort)?{defaultEffort:m.defaultReasoningEffort}:{})}}:{})};},
  async prepareCall(provider,model,signal){const info=await this.resolveModel(provider,model,signal);return{model:info,stream:options=>stream(options)};},stream,
  async dispose(){disposed=true;const current=[...sessions.values()].map(close);await Promise.allSettled([...current,...closing]);}
 };
 return adapter;
}
