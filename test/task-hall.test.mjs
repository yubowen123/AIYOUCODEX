import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskHall, taskHallFile } from '../vendor/codex-taskboard/server/task-hall.mjs';
import { createTaskboardServer } from '../vendor/codex-taskboard/server/app.mjs';

const cli = fileURLToPath(new URL('../vendor/codex-taskboard/cli/hallctl.mjs', import.meta.url));
const execute = promisify(execFile);
const task = (requestId, extra = {}) => ({ action: 'create', title: '完成交付', description: '核对三份材料', requestId, ...extra });
const command = (action, record, extra = {}) => ({ action, taskId: record.id, revision: record.revision, ...extra });
async function fixture(t) {
  const root = await mkdtemp(join(process.env.AIYOU_TEST_OUTPUT || tmpdir(), 'aiyou-hall-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('shared hall uses genuine worker claim and handoff, independent review, continuation and audit', async t => {
  const root = await fixture(t), file = join(root, 'hall.sqlite');
  let now = Date.parse('2026-11-13T10:00:00Z');
  const options = { file, clock: () => now };
  const codex = createTaskHall(options), dsh = createTaskHall(options);
  t.after(() => { codex.close(); dsh.close(); });
  const first = codex.register({ id: 'writer', name: 'Codex', host: 'codex' });
  const second = dsh.register({ id: 'editor', name: 'DSH', host: 'dsh' });
  const reviewer = dsh.register({ id: 'checker', name: 'Claude 检测', host: 'claude', role: 'reviewer' });
  const initial = codex.asOperator('codex', task('run-1')).task;
  assert.equal(codex.asOperator('codex', task('run-1')).task.id, initial.id);
  assert.throws(() => dsh.asOperator('dsh', task('run-1', { title: '替换标题' })), { status: 409 });
  const assigned = dsh.asOperator('dsh', command('claim', initial, { agentId: first.id })).task;
  assert.equal(assigned.status, 'queued');
  assert.equal(codex.listOperator().agents.find(a => a.id === first.id).online, false);
  assert.throws(() => codex.asAgent(second, command('claim', assigned)), { status: 403 });
  assert.throws(() => codex.asAgent(reviewer, command('claim', assigned)), { status: 403 });
  assert.throws(() => codex.asAgent({ ...first, key: 'a'.repeat(64) }, command('claim', assigned)), { status: 401 });
  const working = codex.asAgent(first, command('claim', assigned)).task;
  assert.equal(working.status, 'running');
  assert.equal(dsh.listOperator().agents.find(a => a.id === first.id).activeCount, 1);
  assert.throws(() => dsh.asAgent(first, command('submit', assigned, { evidence: '已过时' })), { status: 409 });
  assert.throws(() => dsh.asOperator('dsh', { ...command('submit', working, { evidence: '伪造 Agent' }), actorId: first.id }), { status: 400 });
  now += 1000;
  const handed = codex.asAgent(first, command('handoff', working, { agentId: second.id, evidence: '初稿已写，请校对附件。' })).task;
  assert.equal(handed.status, 'queued');
  assert.equal(dsh.listOperator().agents.find(a => a.id === first.id).activeCount, 0);
  assert.equal(dsh.listAgent(first).tasks.length, 0);
  const editing = dsh.asAgent(second, command('claim', handed)).task;
  const submitted = dsh.asAgent(second, command('submit', editing, { evidence: '三份材料已核对。' })).task;
  assert.equal(submitted.status, 'verification');
  assert.throws(() => dsh.asAgent(second, command('review', submitted, { verdict: 'pass', evidence: '不得自验' })), { status: 403 });
  assert.deepEqual(codex.listAgent(reviewer).tasks.map(t => t.id), [submitted.id]);
  const rejected = codex.asAgent(reviewer, command('review', submitted, { verdict: 'changes', evidence: '缺第三份附件。' })).task;
  assert.equal(rejected.status, 'attention');
  const requeued = dsh.asOperator('dsh', command('requeue', rejected, { evidence: '补附件', agentId: second.id })).task;
  const resumed = dsh.asAgent(second, command('claim', requeued)).task;
  const repaired = dsh.asAgent(second, command('submit', resumed, { evidence: '附件已齐。' })).task;
  const ready = codex.asAgent(reviewer, command('review', repaired, { verdict: 'pass', evidence: '已按三份附件核对。' })).task;
  assert.equal(ready.status, 'continuation');
  const done = dsh.asOperator('dsh', command('progress', ready, { evidence: '验收完毕，收尾。' })).task;
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.timeline.map(e => [e.action, e.actorId]), [
    ['create', 'operator:codex'], ['assign', 'operator:dsh'], ['claim', first.id], ['handoff', first.id], ['claim', second.id],
    ['submit', second.id], ['review', reviewer.id], ['requeue', 'operator:dsh'], ['claim', second.id], ['submit', second.id],
    ['review', reviewer.id], ['progress', 'operator:dsh'],
  ]);
  assert.equal(done.timeline[3].previousAgentId, first.id);
  assert.equal(done.timeline[3].agentId, second.id);
  assert.equal(done.timeline[6].verdict, 'changes');
  assert.equal(done.timeline[10].verdict, 'pass');
  assert.ok(!JSON.stringify(dsh.listOperator()).includes(first.key));
  assert.equal(codex.listOperator('other').tasks.length, 0);
  assert.equal((await stat(file)).mode & 0o777, process.platform === 'win32' ? (await stat(file)).mode & 0o777 : 0o600);
});

test('heartbeat renews a lease without changing task revision; expired worker cannot publish a late result', t => {
  let now = 1_800_000_000_000;
  const hall = createTaskHall({ file: ':memory:', clock: () => now });
  t.after(() => hall.close());
  const first = hall.register({ id: 'worker', name: 'Worker', host: 'local' });
  const row = hall.asOperator('codex', task('lease')).task;
  const active = hall.asAgent(first, command('claim', row)).task;
  now += 110_000;
  hall.heartbeat(first);
  assert.equal(hall.listOperator().tasks[0].revision, active.revision);
  now += 110_000;
  assert.equal(hall.listOperator().tasks[0].status, 'running');
  now += 10_001;
  assert.throws(() => hall.asAgent(first, command('submit', active, { evidence: '已过期回执' })), { status: 409 });
  const saved = hall.listOperator();
  assert.equal(saved.tasks[0].status, 'attention');
  assert.equal(saved.tasks[0].timeline.at(-1).action, 'lease-expired');
  assert.equal(saved.agents[0].online, false);
  assert.equal(saved.agents[0].activeCount, 0);
});

test('local CLI keeps identity key in private file and its operations are visible to both hosts', async t => {
  const root = await fixture(t), file = join(root, 'hall.sqlite'), credential = join(root, 'worker.json');
  const hall = createTaskHall({ file });
  t.after(() => hall.close());
  const run = async (...args) => JSON.parse((await execute(process.execPath, [cli, ...args], {
    env: { ...process.env, AIYOU_TASK_HALL_FILE: file },
  })).stdout);
  assert.equal(taskHallFile({ XDG_DATA_HOME: root }), join(root, 'aiyou', 'task-hall.sqlite'));
  const { agent } = await run('enroll', '--id', 'worker', '--name', 'CLI worker', '--host', 'codex', '--credential', credential);
  assert.equal(agent.online, false);
  assert.ok(!Object.hasOwn(agent, 'key'));
  const initial = hall.asOperator('dsh', task('cli')).task;
  assert.deepEqual((await run('inbox', '--credential', credential)).tasks.map(t => t.id), [initial.id]);
  const active = (await run('claim', '--credential', credential, '--task', initial.id, '--revision', String(initial.revision))).task;
  assert.equal(active.status, 'running');
  assert.equal((await run('list')).agents[0].online, true);
  const proof = join(root, 'proof.txt');
  await writeFile(proof, '源文件核对无误。');
  await run('submit', '--credential', credential, '--task', active.id, '--revision', String(active.revision), '--evidence-file', proof);
  assert.equal(hall.listOperator().tasks[0].evidence, '源文件核对无误。');
  const secret = JSON.parse(await readFile(credential, 'utf8')).key;
  assert.ok(!JSON.stringify(await run('list')).includes(secret));
  await assert.rejects(run('enroll', '--id', 'other', '--name', 'other', '--host', 'codex', '--credential', credential));
  assert.equal(JSON.parse(await readFile(credential, 'utf8')).key, secret);
});

test('Codex route uses signed frame admission, rejects third-party origins and preserves old issues', async t => {
  const root = await fixture(t);
  const app = createTaskboardServer({ dataDirectory: root });
  t.after(() => app.close());
  const origin = 'http://127.0.0.1:' + (await app.listen({ port: 0 })).port;
  const url = origin + '/api/local/task-hall';
  const token = 'a'.repeat(64);
  await writeFile(join(root, 'pipeline-host.token'), token, { mode: 0o600 });
  const post = (target, body, headers = {}) => fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post(url, task('denied'), { origin: 'null', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post(url, task('denied'), { origin: 'http://192.168.1.1', 'x-aiyou-pipeline-host': token })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
  const old = await post(origin + '/api/tasks', { projectId: 'local', title: '旧议题保留', status: 'todo' });
  assert.equal(old.status, 201);
  assert.deepEqual((await (await fetch(url)).json()).tasks, []);
  const embedded = await post(url, task('allowed'), { origin: 'app://-', 'sec-fetch-site': 'cross-site', 'x-aiyou-pipeline-host': token });
  assert.equal(embedded.status, 200, await embedded.clone().text());
  const added = (await embedded.json()).task;
  assert.equal((await (await fetch(url + '?projectId=local')).json()).tasks[0].id, added.id);
  assert.equal((await (await fetch(origin + '/api/tasks')).json()).tasks[0].title, '旧议题保留');
});
