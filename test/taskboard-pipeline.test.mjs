import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPipeline } from '../vendor/codex-taskboard/server/pipeline.mjs';
import { createTaskboardServer } from '../vendor/codex-taskboard/server/app.mjs';

const stages = [{ kind:'model', name:'分析', instruction:'整理输入' },
  { kind:'approval', name:'确认', instruction:'采用哪种方式？', options:['A','B'] },
  { kind:'model', name:'交付', instruction:'根据决定给结论' }];
const rule = (changes={}) => ({ name:'演示', enabled:true, trigger:'manual', stages, ...changes });
const runner = invoke => ({select:async()=>({model:'fixture'}),invoke});
async function state(t, extras={}) {
  const root = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(),'aiyou-pipeline-'));
  const opts = {file:path.join(root,'pipeline.sqlite'),engine:'fixture',tickMs:0,
    runner:runner(async({stage})=>({text:stage.name})),project:id=>['local','other'].includes(id)?{id}:null,task:()=>null,...extras};
  let p=createPipeline(opts);
  t.after(async()=>{await p.close();await rm(root,{recursive:true,force:true});});
  const api = (command, project='local')=>p.request(project,command);
  return {api,pump:()=>p.pump(),restart:async()=>{await p.close();p=createPipeline(opts);}};
}
const save=async (api,changes)=>(await api({action:'save-rule',rule:rule(changes)})).rule;
const start=async (api,r,extra={})=>(await api({action:'start',ruleId:r.id,requestId:'request-1',...extra})).run;
const current=async (api,id)=>(await api()).runs.find(r=>r.id===id);

test('one event creates one persistent execution; decision resumes at the next stage after reopen',async t=>{
  const calls=[];
  const {api,pump,restart}=await state(t,{runner:runner(async ({run,stage})=>{
    calls.push([stage.name,run.results.map(r=>r.text)]);
    return {text:stage.name,usage:{input_tokens:3,output_tokens:2}};
  })});
  const r=await save(api);const run=await start(api,r,{input:'example'});
  assert.equal((await start(api,r,{input:'example'})).id,run.id);
  await assert.rejects(start(api,r,{input:'different'}),{status:409});
  await pump();await pump();
  assert.equal((await current(api,run.id)).status,'waiting');
  assert.equal(calls.length,1);
  await restart();
  const waiting=await current(api,run.id);
  await assert.rejects(api({action:'answer',runId:run.id,revision:waiting.revision,option:'B'},'other'),{status:404});
  await api({action:'answer',runId:run.id,revision:waiting.revision,option:'B'});
  await assert.rejects(api({action:'answer',runId:run.id,revision:waiting.revision,option:'A'}),{status:409});
  await pump();
  assert.deepEqual(calls,[['分析',[]],['交付',['分析','B']]]);
  const done=await current(api,run.id);
  assert.equal(done.status,'completed');
  assert.equal(done.input,undefined);
  assert.equal(done.results[2].usage.output_tokens,2);
});

test('model decision and delayed revisit use persisted checkpoint and keep the same execution',async t=>{
  let now=Date.parse('2026-11-13T00:00:00Z'),count=0;
  const {api,pump,restart}=await state(t,{clock:()=>now,runner:runner(async({run})=>{
    count++;
    if(count===1)return {text:'需要选择\n```aiyou-pipeline\n{"ask":{"text":"处理范围？","options":["单集","全量"]}}\n```'};
    if(count===2){assert.equal(run.results.at(-1).text,'全量');return {text:'稍后复查\n```aiyou-pipeline\n{"laterMinutes":5}\n```'};}
    assert.equal(run.results.at(-1).text,'稍后复查');return {text:'已完成核对'};
  })});
  const run=await start(api,await save(api,{stages:[stages[0]]}));
  await pump();const waiting=await current(api,run.id);assert.equal(waiting.status,'waiting');
  await api({action:'answer',runId:run.id,revision:waiting.revision,option:'全量'});
  await pump();
  assert.equal((await current(api,run.id)).status,'scheduled');
  await restart();await pump();assert.equal(count,2);
  now+=5*60_000;await pump();
  assert.equal((await current(api,run.id)).status,'completed');
  assert.equal(count,3);
});

test('enabled issue rule ingests only later issues once; interval avoids backlog and disables future dispatch',async t=>{
  let now=1_800_000_000_000;
  const row=(id,delta)=>({id,projectId:'local',title:id,createdAt:new Date(now+delta).toISOString()});
  const items=[row('old',-1)];
  const {api,pump,restart}=await state(t,{clock:()=>now,issues:()=>items,task:(_p,id)=>items.find(i=>i.id===id)});
  const issueRule=await save(api,{trigger:'issue-created',stages:[stages[1]]});
  const recurring=await save(api,{trigger:'interval',intervalMinutes:5,stages:[stages[1]]});
  items.push(row('new',1));
  now+=5*60_000;await pump();await pump();
  assert.deepEqual((await api()).runs.filter(r=>r.ruleId===issueRule.id).map(r=>r.taskId),['new']);
  assert.equal((await api()).runs.filter(r=>r.ruleId===recurring.id).length,1);
  await restart();now+=600*60_000;await pump();
  assert.equal((await api()).runs.length,2);
  await api({action:'save-rule',rule:{...issueRule,enabled:false}});
  await api({action:'save-rule',rule:{...recurring,enabled:false}});
  items.push(row('newer',1));now+=5*60_000;await pump();
  assert.equal((await api()).runs.length,2);
});

test('stopping host marks in-flight run interrupted; no silent duplicate request; user can retry',async t=>{
  let release, entered, calls=0;
  const started=new Promise(r=>{entered=r;});
  const {api,pump,restart}=await state(t,{runner:runner(async({signal})=>{
    if(++calls===1){
      entered();
      await new Promise(r=>{release=r;signal.addEventListener('abort',r,{once:true});});
      signal.throwIfAborted();
    }
    return {text:'result'};
  })});
  const run=await start(api,await save(api,{stages:[stages[0]]}));
  const pending=pump();await started;
  await restart();await pending;
  await pump();assert.equal(calls,1);assert.ok(release);
  const interrupted=await current(api,run.id);assert.equal(interrupted.status,'interrupted');
  await api({action:'retry',runId:run.id,revision:interrupted.revision});
  await pump();assert.equal(calls,2);
  assert.equal((await current(api,run.id)).status,'completed');
});

test('Codex taskboard API rejects foreign origins, uses unchanged issue store and persists pipeline independently',async t=>{
  const dataDirectory=await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(),'aiyou-pipeline-api-'));
  const app=createTaskboardServer({dataDirectory,pipelineRunner:runner(async()=>({text:'receipt'}))});
  t.after(async()=>{await app.close();await rm(dataDirectory,{recursive:true,force:true});});
  const address=await app.listen({port:0});const base='http://127.0.0.1:'+address.port;
  const api=base+'/api/local/pipeline';
  assert.equal((await fetch(api+'?projectId=local',{headers:{origin:'null'}})).status,403);
  assert.equal((await fetch(api,{method:'POST',body:'{}'})).status,415);
  const token = 'a'.repeat(64);
  await writeFile(path.join(dataDirectory,'pipeline-host.token'),token,{mode:0o600});
  for(const origin of ['null','app://-']){
    const headers={origin,'sec-fetch-site':'cross-site'};
    assert.equal((await fetch(api+'?projectId=local',{headers})).status,403);
    const embedded=await fetch(api+'?projectId=local',{headers:{...headers,'x-aiyou-pipeline-host':token}});
    assert.equal(embedded.status,200);
    assert.equal(embedded.headers.get('access-control-allow-origin'),origin);
  }
  assert.equal((await fetch(api+'?projectId=local',{headers:{origin:'http://192.168.1.1','x-aiyou-pipeline-host':token}})).status,403);
  const post=async(url,value)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(value)});
  const created=await post(base+'/api/tasks',{projectId:'local',title:'保留原议题',description:'测试资料',status:'todo'});
  assert.equal(created.status,201,await created.clone().text());
  const task=(await created.json()).task;
  const saved=await post(api,{projectId:'local',action:'save-rule',rule:rule({trigger:'issue',stages:[stages[1]]})});
  assert.equal(saved.status,200);
  const r=(await saved.json()).rule;
  const started=await post(api,{projectId:'local',action:'start',ruleId:r.id,requestId:'local-1',taskId:task.id});
  assert.equal(started.status,200);
  const view=await (await fetch(api+'?projectId=local')).json();
  assert.equal(view.runs[0].taskId,task.id);
  assert.equal((await (await fetch(base+'/api/tasks/'+task.id)).json()).task.version,task.version);
});
