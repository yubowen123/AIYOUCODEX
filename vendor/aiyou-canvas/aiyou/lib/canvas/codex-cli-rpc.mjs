import {spawn} from 'node:child_process';
import {access,stat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {StringDecoder} from 'node:string_decoder';

// DSH detaches this public, data-backed snapshot when normalizing a foreign
// adapter error. Without it a useful local code would become UNKNOWN.
export const cliError=(code,message)=>Object.assign(new Error(message),{code,failure:Object.freeze({code,message})});
const stopped=()=>cliError('ABORTED','本地 Codex CLI 请求已取消');
export function cliEnvironment(env=process.env){
 // CLI reads its own existing login store. Never inject an API key or copied
 // token, and never let an inherited API-base override select another gateway.
 return Object.fromEntries(Object.entries(env).filter(([key])=>!/^OPENAI_|^CODEX_(API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$/.test(key)));
}
export async function findCodexExecutable(value,env=process.env){
 if(value!==undefined&&value!==''&&(typeof value!=='string'||!isAbsolute(value)||/[\0\r\n]/.test(value)))throw cliError('INVALID_CLI_PATH','请选择本机 Codex CLI 的绝对可执行路径');
 const candidates=value?[value]:[...String(env.PATH||'').split(delimiter).filter(Boolean).map(p=>join(p,process.platform==='win32'?'codex.exe':'codex')),...(process.platform==='win32'?[]:['/opt/homebrew/bin/codex','/usr/local/bin/codex',join(homedir(),'.local/bin/codex')])];
 for(const path of [...new Set(candidates)])try{await access(path,constants.X_OK);if(!(await stat(path)).isFile())continue;await realpath(path);return path;}catch{}
 throw cliError('CLI_NOT_INSTALLED','未找到本地 Codex CLI，请安装后选择其可执行文件；插件不会自动安装或登录');
}
export async function runCliMetadata(executable,args,{spawnImpl=spawn,signal,timeoutMs=10000}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:cliEnvironment()});let output='',size=0,done=false,killTimer,failure;
  const timer=setTimeout(()=>stop(cliError('CLI_TIMEOUT','本地 Codex CLI 状态检测超时')),timeoutMs);timer.unref?.();
  const abort=()=>stop(stopped());
  const clean=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
  function stop(error){if(done)return;done=true;failure=error;clean();child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref?.();}
  function collect(chunk){size+=chunk.length;if(size>65536){stop(cliError('CLI_OUTPUT_LIMIT','CLI 状态输出超出限制'));return;}output+=chunk.toString();}
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',()=>stop(cliError('CLI_START_FAILED','无法启动所选 Codex CLI')));
  child.once('close',code=>{clearTimeout(killTimer);clean();if(failure){reject(failure);return;}done=true;resolve({code,output});});signal?.addEventListener('abort',abort,{once:true});
 });
}
export async function inspectCodexCli(executablePath,options={}){
 const executable=await findCodexExecutable(executablePath),version=await runCliMetadata(executable,['--version'],options);
 const match=/codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)/.exec(version.output);
 if(version.code!==0||!match)throw cliError('INVALID_CLI','所选文件未返回可识别的 Codex CLI 版本');
 const login=await runCliMetadata(executable,['login','status'],options);
 const loggedIn=login.code===0&&/logged in|authenticated/i.test(login.output);
 return {executablePath:executable,version:match[1],installed:true,loggedIn,loginMethod:loggedIn?(/chatgpt/i.test(login.output)?'chatgpt':/api.?key/i.test(login.output)?'cli-api-key':'cli-managed'):'none'};
}

export function createCodexRpc({executablePath,cwd,spawnImpl=spawn,timeoutMs=30000}={}){
 // Per-child overrides leave the user's CLI configuration and login untouched.
 // DSH remains the tool executor. No MCP/apps/hooks or CLI command environment
 // is imported into this LLM-only child.
 const overrides=['model_provider="openai"','features.shell_tool=false','features.unified_exec=false','features.apps=false','features.plugins=false','features.remote_plugin=false','features.hooks=false','features.memories=false','features.browser_use=false','features.computer_use=false','features.multi_agent=false','features.image_generation=false','features.skip_host_skill_discovery=true','web_search="disabled"','mcp_servers={}','analytics.enabled=false'];
 const child=spawnImpl(executablePath,['app-server','--stdio',...overrides.flatMap(v=>['-c',v])],{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:cliEnvironment()});
 const pending=new Map(),queue=[],waiters=[],decoder=new StringDecoder('utf8');let serial=0,buffer='',closed=false,closePromise,killTimer;
 const ended=new Promise(resolve=>child.once('close',resolve));
 function end(error=cliError('CLI_EXITED','本地 Codex CLI 连接已退出')){
  if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();for(const w of waiters.splice(0))w.reject(error);queue.length=0;
 }
 function send(value){if(closed)throw cliError('CLI_EXITED','本地 Codex CLI 连接已退出');const line=JSON.stringify(value);if(Buffer.byteLength(line)>32*1024*1024)throw cliError('CLI_INPUT_LIMIT','CLI 输入内容超出限制');child.stdin.write(line+'\n');}
 function publish(frame){if(queue.length>=2048){end(cliError('CLI_EVENT_LIMIT','CLI 事件缓冲超出限制'));void dispose();return;}const w=waiters.shift();if(w)w.resolve(frame);else queue.push(frame);}
 child.stdout.on('data',chunk=>{
  buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>32*1024*1024){end(cliError('CLI_OUTPUT_LIMIT','CLI 协议输出超出限制'));void dispose();return;}
  for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;let frame;try{frame=JSON.parse(line);}catch{end(cliError('CLI_PROTOCOL_ERROR','CLI 返回了无效的本地协议数据'));void dispose();return;}
   if(frame.id!==undefined&&!frame.method){const p=pending.get(frame.id);if(!p)continue;pending.delete(frame.id);clearTimeout(p.timer);frame.error?p.reject(cliError('CLI_RPC_ERROR','本地 Codex CLI 拒绝了 '+p.method+' 请求')):p.resolve(frame.result);}
   else if(typeof frame.method==='string')publish(frame);
  }
 });
 // Drain diagnostics without retaining or printing account details / tokens.
 child.stderr.on('data',()=>{});child.stdin.on('error',()=>end());child.once('error',()=>end(cliError('CLI_START_FAILED','无法启动所选 Codex CLI')));child.once('close',()=>{clearTimeout(killTimer);end();});
 function request(method,params={},ms=timeoutMs){if(closed)return Promise.reject(cliError('CLI_EXITED','本地 Codex CLI 连接已退出'));return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(cliError('CLI_TIMEOUT','本地 Codex CLI '+method+' 超时'));},ms);timer.unref?.();pending.set(id,{resolve,reject,timer,method});try{send({id,method,params});}catch(e){pending.delete(id);clearTimeout(timer);reject(e);}});}
 function next(signal){if(signal?.aborted)return Promise.reject(stopped());if(queue.length)return Promise.resolve(queue.shift());if(closed)return Promise.reject(cliError('CLI_EXITED','本地 Codex CLI 连接已退出'));return new Promise((resolve,reject)=>{const w={resolve:x=>{cleanup();resolve(x);},reject:e=>{cleanup();reject(e);}},abort=()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);cleanup();reject(stopped());},cleanup=()=>signal?.removeEventListener('abort',abort);waiters.push(w);signal?.addEventListener('abort',abort,{once:true});});}
 async function initialize(){const result=await request('initialize',{clientInfo:{name:'aiyoudsh_codex_cli',title:'AIYOUDSH Local Codex CLI',version:'1'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});return result;}
 async function dispose(){
  if(closePromise)return closePromise;
  closePromise=(async()=>{end();child.stdin.end();child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref?.();await ended;clearTimeout(killTimer);})();return closePromise;
 }
 return {request,next,initialize,notify:(method,params={})=>send({method,params}),reply:(id,result)=>send({id,result}),reject:(id,message='Unsupported host request')=>send({id,error:{code:-32601,message}}),dispose,pid:child.pid};
}

export async function probeCodexCatalog(executablePath,{spawnImpl=spawn,signal,cwd=homedir()}={}){
 const local=await inspectCodexCli(executablePath,{spawnImpl,signal});
 if(!local.loggedIn)return {...local,connected:false,models:[],diagnostic:'CLI_NOT_LOGGED_IN'};
 const rpc=createCodexRpc({executablePath:local.executablePath,cwd,spawnImpl});const abort=()=>void rpc.dispose();signal?.addEventListener('abort',abort,{once:true});
 try{
  signal?.throwIfAborted();await rpc.initialize();const account=await rpc.request('account/read',{refreshToken:false});
  const loggedIn=Boolean(account.account&&['chatgpt','apiKey'].includes(account.account.type));
  if(!loggedIn)return {...local,loggedIn:false,connected:false,models:[],diagnostic:'CLI_NOT_LOGGED_IN'};
  const models=[];let cursor;
  for(let i=0;i<5;i++){const page=await rpc.request('model/list',{limit:100,...(cursor?{cursor}:{})});for(const row of page.data||[]){if(row.hidden||typeof row.model!=='string'||!row.model)continue;models.push({id:row.model,name:row.displayName||row.model,description:typeof row.description==='string'?row.description:'',inputModalities:(row.inputModalities||['text']).filter(x=>['text','image'].includes(x)),isDefault:Boolean(row.isDefault),reasoningEfforts:(row.supportedReasoningEfforts||[]).map(r=>({id:r.reasoningEffort,name:r.reasoningEffort,description:r.description||''})),defaultReasoningEffort:row.defaultReasoningEffort});}cursor=page.nextCursor;if(!cursor)break;}
  return {...local,loggedIn:true,connected:true,models};
 }finally{signal?.removeEventListener('abort',abort);await rpc.dispose();}
}
