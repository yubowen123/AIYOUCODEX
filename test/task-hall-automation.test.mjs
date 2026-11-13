import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTaskHall } from '../vendor/codex-taskboard/server/task-hall.mjs';
import { createTaskHallAgents } from '../vendor/codex-taskboard/server/task-hall-agents.mjs';

async function until(check, timeout = 1500) {
  for (let end = Date.now() + timeout; Date.now() < end;) {
    const value = check();
    if (value) return value;
    await sleep(5);
  }
  assert.fail('State did not arrive');
}

test('managed Agents register automatically, pick only explicit routes, and retain cross-agent receipts', async t => {
  const hall = createTaskHall({file:':memory:'});
  const calls = [];
  const adapter = host => ({
    async select() { return {model:host+'-model'}; },
    async invoke({prompt}) {
      calls.push([host,prompt]);
      if (prompt.startsWith('独立')) return {text:'{"verdict":"pass","evidence":"Checked second receipt"}'};
      return {text: host+' receipt'};
    },
  });
  const service = createTaskHallAgents({hall, adapters:{codex:adapter('codex'),claude:adapter('claude'),dsh:adapter('dsh')}, intervalMs:5});
  t.after(async () => { await service.close(); hall.close(); });
  service.start();service.start();
  await until(() => hall.listOperator().agents.filter(a=>a.online).length===3);
  assert.throws(() => hall.register({id:'builtin:codex',name:'Collision',host:'codex'}), {status:400});
  assert.throws(() => hall.heartbeat({id:'builtin:codex',key:'a'.repeat(64)}), {status:401});
  const manual = hall.asOperator('codex',{action:'create',requestId:'manual',title:'do not auto-run'}).task;
  const request = { action:'create', requestId:'autowork', title:'Cross-host automation',
    agentId:'builtin:codex', automation:{handoffAgentId:'builtin:claude',reviewAgentId:'builtin:dsh',continueAgentId:'builtin:codex'} };
  assert.throws(() => hall.asOperator('dsh',{...request,automation:{...request.automation,reviewAgentId:'builtin:claude'}}),{status:400});
  const {task} = hall.asOperator('codex',request);
  assert.equal(hall.asOperator('dsh',request).task.id,task.id);
  const completed = await until(() => hall.listOperator().tasks.find(x => x.id===task.id && x.status==='completed'));
  assert.deepEqual(calls.map(x=>x[0]),['codex','claude','dsh','codex']);
  assert.match(calls[1][1],/codex receipt/);
  assert.match(calls[2][1],/claude receipt/);
  assert.match(calls[3][1],/Checked second receipt/);
  assert.deepEqual(completed.timeline.map(e=>e.action),['create','claim','handoff','claim','submit','review-start','review','progress-start','progress']);
  assert.equal(completed.timeline.find(e=>e.action==='review').actorKind,'reviewer');
  assert.equal(hall.listOperator().tasks.find(x=>x.id===manual.id).status,'queued');
});

test('duplicate supervisors do not dispatch twice and interruption requires explicit recovery', async t => {
  const hall = createTaskHall({file:':memory:'});
  let tries=0;
  const adapter={async select(){return {model:'current'};},async invoke(){tries++;throw Error('model refused');}};
  const supervisors=Array.from({length:2},()=>createTaskHallAgents({hall,adapters:{codex:adapter,dsh:adapter},intervalMs:5}));
  t.after(async()=>{await Promise.all(supervisors.map(x=>x.close()));hall.close();});
  supervisors.forEach(x=>x.start());
  const initial=hall.asOperator('codex',{action:'create',title:'Error path',requestId:'err',agentId:'builtin:codex',
    automation:{reviewAgentId:'builtin:dsh'}}).task;
  const failed=await until(()=>hall.listOperator().tasks.find(x=>x.id===initial.id&&x.status==='attention'));
  await sleep(35);
  assert.equal(tries,1);
  assert.equal(failed.timeline.at(-1).action,'agent-error');
  hall.asOperator('dsh',{action:'requeue',taskId:failed.id,revision:failed.revision,evidence:'手动恢复'});
  await until(()=>tries===2);
});
