import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes,realpath} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createAgentWorkspace} from '../lib/agent-workspace.mjs';
test('跨 Agent 最近会话按时间分页，项目和标题过滤，元数据不泄露正文/定位器',async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'agent-recent-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=path.join(root,'home');
 for(const agent of ['.claude','.workbuddy'])await mkdir(path.join(home,agent,'projects/demo'),{recursive:true});
 for(let n=0;n<20;n++){const agent=n%2?'.claude':'.workbuddy';const f=path.join(home,agent,'projects/demo',n+'.jsonl');await writeFile(f,JSON.stringify({type:'user',cwd:n<10?'/fixture/A':'/fixture/B',customTitle:'Session '+n,message:{role:'user',content:'private body '+n}})+'\n');await utimes(f,100+n,100+n);}
 const service=createAgentWorkspace({home,stateRoot:path.join(root,'state')});
 const first=await service.request({action:'recent'});assert.equal(first.total,20);assert.equal(first.sessions.length,16);assert.equal(first.nextOffset,16);assert.equal(first.sessions[0].title,'Session 19');assert.deepEqual(first.projects,['/fixture/A','/fixture/B']);assert(!JSON.stringify(first).includes('private body'));assert(!JSON.stringify(first).includes('locator'));
 const second=await service.request({action:'recent',offset:16});assert.equal(second.sessions.length,4);assert.equal(second.nextOffset,null);assert(!second.sessions.some(s=>first.sessions.some(x=>x.id===s.id)));
 const filtered=await service.request({action:'recent',agentId:'claude-code',projectPath:'/fixture/A',query:'Session'});assert.equal(filtered.total,5);assert(filtered.sessions.every(s=>s.agentId==='claude-code'&&s.cwd==='/fixture/A'));
 const chosen=filtered.sessions[0];const draft=await service.request({action:'draft',agentId:chosen.agentId,sessionIds:[chosen.id]});assert(draft.session.messages[0].text.startsWith('private body'));
 await assert.rejects(service.request({action:'draft',agentId:'workbuddy',sessionIds:[chosen.id]}),/不属于/);
});
