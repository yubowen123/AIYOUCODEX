import {randomUUID} from 'node:crypto';

const error=(message,code)=>Object.assign(new Error(message),{code});
const blocked=/qiniu|qnaigc|七牛/i;
const clone=value=>structuredClone(value);
const textBlock=text=>({type:'text',text});
const aborted=signal=>signal?.throwIfAborted();
const publicSelection=value=>value?Object.fromEntries(['provider','model','reasoningEffort','maxTokens'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]])):null;

/** Native DSH adapter. It never resolves, copies, or stores an LLM credential. */
export function createHostLlm({ctx,select,emit=()=>{},record}={}){
 if(!ctx?.llm)throw new TypeError('宿主LLM服务未注入');
 let disposed=false;
 const calls=new Set();
 const getAgent=context=>ctx.agents?.get(context.sessionId);
 function selection(context){
  if(select)return select(context);
  const agent=getAgent(context),session=agent?.session;
  const pending=session&&ctx.sessionProjections?.stateOf(session,'modelSelection')?.pending;
  if(pending)return clone(pending);
  const header=session?.requestHeader?.();
  if(header?.config?.provider&&header.config.model){
   const {provider,model,reasoningEffort}=header.config;
   return {provider,model,...(reasoningEffort===undefined||header.adapterDefaults?.reasoningEffort?{}:{reasoningEffort})};
  }
  return ctx.agentDefaultModel?.currentSelection();
 }
 async function capabilities(context={}){
  const selected=await selection(context),providers=ctx.llm.listProviders?.()||[];
  const registered=Boolean(selected&&providers.some(p=>p.id===selected.provider));
  let modelInfo,diagnostic;
  if(registered)try{modelInfo=await ctx.llm.resolveModelInfo(selected.provider,selected.model,context.signal);}catch(e){diagnostic=e.code||'MODEL_UNAVAILABLE';}
  return {available:registered&&!diagnostic,selected:publicSelection(selected),credentialManagedByHost:true,authorizationVerified:false,
   codex:{supported:providers.some(p=>p.id==='codex-cli'),selected:selected?.provider==='codex-cli',connectionType:'local-cli',authorization:'existing-cli-login-not-probed'},
   inputModalities:modelInfo?.inputModalities||['text'],tools:true,toolChoice:['auto','none'],
   ...(diagnostic?{diagnostic}:{}),cancellation:'local-signal',source:'DSH configured adapters'};
 }
 async function content(raw,role,signal){
  if(raw===null||raw===undefined)return [];
  if(typeof raw==='string')return [textBlock(raw)];
  if(!Array.isArray(raw))throw error('对话内容须为文字或有序内容数组','INVALID_REQUEST');
  const out=[];
  for(const part of raw){
   aborted(signal);
   if(part?.type==='text'&&typeof part.text==='string'){out.push(clone(part));continue;}
   if(part?.type==='image'&&part.attachment){out.push(clone(part));continue;}
   if(part?.type==='file'&&part.attachment){out.push(clone(part));continue;}
   if(part?.type==='tool-call'&&role==='assistant'){out.push(clone(part));continue;}
   if(part?.type==='reasoning'&&role==='assistant'){out.push(clone(part));continue;}
   const url=part?.type==='image_url'?part.image_url?.url:null;
   const encoded=url&&/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url);
   const input=encoded?{type:'image',mediaType:encoded[1],data:encoded[2]}:part?.type==='image'&&part.data?clone(part):null;
   if(input){
    if(!['user','tool'].includes(role))throw error('该角色不接受图片输入','UNSUPPORTED_CONTENT');
    if(!ctx.attachments?.admitPromptContent)throw error('宿主图片附件服务未就绪','UNSUPPORTED_CONTENT');
    out.push(...await ctx.attachments.admitPromptContent([input]));continue;
   }
   throw error('宿主对话仅接受文字与已入库图片/文件；远程图片请先导入素材库','UNSUPPORTED_CONTENT');
  }
  return out;
 }
 async function messagesOf(request,signal){
  const input=request.messages??[{role:'user',content:request.prompt||''}];
  if(!Array.isArray(input)||!input.length||input.length>512)throw error('对话消息须为1至512条','INVALID_REQUEST');
  const output=[];
  for(const item of input){
   if(!item||!['system','developer','user','assistant','tool'].includes(item.role))throw error('不支持的对话角色','INVALID_REQUEST');
   const blocks=await content(item.content,item.role,signal);
   for(const call of item.tool_calls||[]){
    if(item.role!=='assistant'||call.type!=='function'||!call.id||!call.function?.name||typeof call.function.arguments!=='string')throw error('历史工具调用格式无效','INVALID_REQUEST');
    blocks.push({type:'tool-call',id:call.id,name:call.function.name,arguments:call.function.arguments});
   }
   if(item.role==='tool'&&!item.toolCallId&&!item.tool_call_id)throw error('工具结果缺少关联调用ID','INVALID_REQUEST');
   output.push({id:item.id||randomUUID(),role:item.role,content:blocks,
    source:item.source||(item.role==='assistant'?{kind:'model',provider:'external-history',model:'unknown'}:item.role==='system'?{kind:'system-prompt'}:item.role==='tool'?{kind:'tool',callId:item.toolCallId||item.tool_call_id}:{kind:'canvas-input'}),
    ...(item.role==='tool'?{toolCallId:item.toolCallId||item.tool_call_id,isError:Boolean(item.isError)}:{})});
  }
  return output;
 }
 async function llm(request={},context={}){
  if(disposed)throw error('宿主模型适配器已关闭','DISPOSED');
  const agent=getAgent(context);
  if(!agent?.session||agent.session.id!==context.sessionId)throw error('请先打开当前DSH对话，不能向失效会话提交','SESSION_NOT_FOUND');
  for(const key of ['top_p','response_format','parallel_tool_calls'])if(request[key]!==undefined)throw error('宿主模型尚未支持参数：'+key,'UNSUPPORTED_OPTION');
  const choice=request.tool_choice??request.toolChoice??'auto';
  if(!['auto','none'].includes(choice))throw error('宿主不支持强制工具选择，未提交模型请求','UNSUPPORTED_OPTION');
  const controller=new AbortController();calls.add(controller);
  const signal=context.signal?AbortSignal.any([context.signal,controller.signal]):controller.signal;
  const requestId=request.requestId||randomUUID();
  try{
   aborted(signal);const route=await selection(context);
   if(!route?.provider||!route.model||blocked.test(route.provider+' '+route.model))throw error('当前DSH模型不可用或属于禁用供应商','MODEL_UNAVAILABLE');
   const messages=await messagesOf(request,signal);
   let tools=request.tools===undefined?undefined:request.tools.map(t=>t.type==='function'?{name:t.function?.name,description:t.function?.description||'',parameters:clone(t.function?.parameters||{type:'object'})}:clone(t));
   if(tools?.some(t=>!t.name||!t.parameters))throw error('工具声明格式无效','INVALID_REQUEST');
   if(choice==='none')tools=[];
   const maxTokens=request.max_tokens??request.maxTokens;
   const call=await ctx.llm.prepareCall({...route,...(maxTokens!==undefined?{maxTokens}:{})},signal);
   if(messages.some(m=>m.content.some(p=>p.type==='image'))&&call.inputModalities&&!call.inputModalities.includes('image'))throw error('当前DSH模型不支持图片输入','UNSUPPORTED_CONTENT');
   const options={...call.config,messages,sessionId:context.sessionId,purpose:'canvas',signal,
    ...(tools!==undefined?{tools}:{}),...(request.system!==undefined?{system:request.system}:{}),
    ...(request.temperature!==undefined?{temperature:request.temperature}:{}),...(request.stop!==undefined?{stop:request.stop}:{})};
   // Canvas SQLite owns conversation text. The enhancement audit receives only
   // routing/status metadata; no unsupported Host Session event is appended.
   await record?.(agent.session,'llm-request',{requestId,projectId:context.projectId??null,selection:publicSelection(call.config),messageCount:messages.length,toolCount:tools?.length||0,status:'prepared'});
   aborted(signal);
   const blocks=new Map(),order=[];let finish,usage;
   const ensure=(index,type)=>{if(!blocks.has(index)){order.push(index);blocks.set(index,{type,text:'',arguments:''});}return blocks.get(index);};
   for await(const chunk of call.stream(options)){
    aborted(signal);
    if(chunk.type==='block-start')ensure(chunk.index,chunk.blockType);
    else if(chunk.type==='text-delta'||chunk.type==='reasoning-delta'){const b=ensure(chunk.index,chunk.type==='text-delta'?'text':'reasoning');if(!b.closed)b.text+=chunk.text;}
    else if(chunk.type==='tool-call-delta'){const b=ensure(chunk.index,'tool-call');if(!b.closed){if(chunk.id)b.id=chunk.id;if(chunk.name)b.name=chunk.name;b.arguments+=chunk.argumentsDelta||'';}}
    else if(chunk.type==='block-end'){ensure(chunk.index,chunk.block.type);blocks.set(chunk.index,{...chunk.block,closed:true});}
    else if(chunk.type==='usage')usage=clone(chunk.usage);
    else if(chunk.type==='finish')finish=clone(chunk.reason);
    if(chunk.type==='text-delta')emit('canvas:llm-delta',{requestId,sessionId:context.sessionId,projectId:context.projectId,text:chunk.text},context);
   }
   aborted(signal);
   if(!finish)throw error('宿主模型流缺少终态','INCOMPLETE_STREAM');
   if(['error','aborted'].includes(finish.kind))throw error(finish.failure?.message||'宿主模型未完成',finish.failure?.code||finish.kind.toUpperCase());
   const all=order.map(i=>blocks.get(i)),text=all.filter(b=>b.type==='text').map(b=>b.text).join('');
   const toolCalls=finish.kind==='max-tokens'?[]:all.filter(b=>b.type==='tool-call').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:typeof b.arguments==='string'?b.arguments:JSON.stringify(b.arguments)}}));
   if(!text&&!toolCalls.length)throw error('宿主模型未返回文字或工具调用','EMPTY_RESPONSE');
   const result={requestId,text,toolCalls,usage,finishReason:finish.kind==='max-tokens'?'length':toolCalls.length?'tool_calls':'stop',model:call.config.model,provider:call.config.provider,
    message:{role:'assistant',content:text||null,...(toolCalls.length?{tool_calls:toolCalls}:{})}};
   await record?.(agent.session,'llm-result',{requestId,projectId:context.projectId??null,selection:publicSelection(call.config),usage,status:'completed',finishReason:result.finishReason});return result;
  }catch(e){
   await record?.(agent.session,'llm-failed',{requestId,projectId:context.projectId??null,status:signal.aborted?'aborted':'failed',code:signal.aborted?'ABORTED':e.code||'MODEL_ERROR'});
   throw e;
  }finally{calls.delete(controller);}
 }
 llm.capabilities=capabilities;
 llm.dispose=()=>{disposed=true;for(const c of calls)c.abort(error('画布模块已关闭','DISPOSED'));calls.clear();};
 return llm;
}
