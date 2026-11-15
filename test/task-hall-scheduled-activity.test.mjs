import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTaskboardServer } from '../vendor/codex-taskboard/server/app.mjs';
import { readHallScheduledActivity } from '../vendor/codex-taskboard/server/task-hall-automation.mjs';

const update = '2026-11-13T03:00:00.000Z';
const next = '2026-11-13T04:00:00.000Z';
const privateText = 'never put automation prompts into a hall response';

async function workspace(t) {
  const root = await mkdtemp(join(process.env.AIYOU_TEST_OUTPUT || tmpdir(), 'aiyou-scheduled-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('scheduled inventory shows proven native and automatic pipeline activity, without payload or project leakage', async t => {
  const root = await workspace(t);
  const codexHome = join(root, 'codex');
  await mkdir(join(codexHome, 'sqlite'), { recursive: true });
  const codexDb = new DatabaseSync(join(codexHome, 'sqlite', 'codex.db'));
  codexDb.exec(`CREATE TABLE automations(id TEXT, name TEXT, prompt TEXT, status TEXT, next_run_at INTEGER,
    updated_at INTEGER, project_id TEXT, kind TEXT);
    CREATE TABLE automation_runs(thread_id TEXT, automation_id TEXT, status TEXT, updated_at INTEGER)`);
  const automation = codexDb.prepare('INSERT INTO automations VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  automation.run('hourly', '查阅已交付工单', privateText, 'ACTIVE', Date.parse(next), Date.parse(update), 'native-a', 'heartbeat');
  automation.run('paused', '暂停的日检', privateText, 'PAUSED', Date.parse(next), Date.parse(update), 'native-b', 'cron');
  codexDb.prepare('INSERT INTO automation_runs VALUES (?, ?, ?, ?)').run('thread-a', 'hourly', 'IN_PROGRESS', Date.parse(update));
  codexDb.close();

  const pipelineFile = join(root, 'pipeline.sqlite');
  const pipeline = new DatabaseSync(pipelineFile);
  pipeline.exec('CREATE TABLE pipeline_rules(id TEXT, project TEXT, next INTEGER, value TEXT); CREATE TABLE pipeline_runs(id TEXT, project TEXT, event TEXT, status TEXT, value TEXT)');
  const rule = pipeline.prepare('INSERT INTO pipeline_rules VALUES (?, ?, ?, ?)');
  rule.run('cycle', 'project-a', Date.parse(next), JSON.stringify({ name:'每小时核对', trigger:'interval', enabled:true, instruction:privateText }));
  rule.run('intake', 'project-b', Date.parse(next), JSON.stringify({ name:'新工单自动检查', trigger:'issue-created', enabled:false, instruction:privateText }));
  rule.run('manual', 'project-a', null, JSON.stringify({ name:'手动规则', trigger:'manual', enabled:true }));
  const run = pipeline.prepare('INSERT INTO pipeline_runs VALUES (?, ?, ?, ?, ?)');
  const runValue = JSON.stringify({ title:'自动执行记录', updatedAt:update, instruction:privateText });
  run.run('run-auto', 'project-a', 'interval:hourly', 'running', runValue);
  run.run('run-other', 'project-b', 'issue-created:issue-id', 'completed', runValue);
  run.run('run-manual', 'project-a', 'manual:user', 'completed', runValue);
  pipeline.close();

  let catalogReads = 0;
  const dshSchedule = { async catalog() {
    catalogReads++;
    return [{ id:'reminder', title:'原生定时提醒', kind:'every', status:'active', scheduledAt:next,
      content:privateText, lastDelivery:{ messageId:'message-a', deliveredAt:update } }];
  } };
  const options = { codexHome, pipelineFile, dshSchedule, dshNative:true };
  const result = await readHallScheduledActivity(options);
  assert.equal(catalogReads, 1);
  assert.deepEqual(Object.fromEntries(result.sources.map(x => [x.id, x.available])), { 'pipeline':true, 'codex-native':true, 'dsh-native':true });
  const items = Object.fromEntries(result.items.map(x => [x.id, x]));
  assert.equal(items['codex-native:rule:hourly'].nextAt, next);
  assert.equal(items['codex-native:rule:hourly'].status, 'active');
  assert.equal(items['codex-native:rule:paused'].nextAt, null);
  assert.equal(items['codex-native:run:thread-a'].status, 'running');
  assert.equal(items['pipeline:rule:cycle'].nextAt, next);
  assert.equal(items['pipeline:rule:intake'].status, 'disabled');
  assert.equal(items['pipeline:run:run-auto'].status, 'running');
  assert.equal(items['dsh-native:run:reminder:message-a'].status, 'delivered');
  assert.ok(!items['pipeline:run:run-manual']);
  assert.ok(!items['pipeline:rule:manual']);
  assert.ok(!JSON.stringify(result).includes(privateText));

  const project = await readHallScheduledActivity({ ...options, projectId:'project-a', codexProjectId:'native-a' });
  assert.equal(catalogReads, 1);
  assert.deepEqual(project.items.map(x => x.id).sort(), [
    'codex-native:rule:hourly','codex-native:run:thread-a','pipeline:rule:cycle','pipeline:run:run-auto',
  ]);
  assert.ok(project.items.every(x => x.projectId === 'project-a'));
  const unmapped = await readHallScheduledActivity({ ...options, projectId:'project-a' });
  assert.ok(unmapped.items.every(x => x.source === 'pipeline'));
});

test('Codex hall reads bounded definition fallback without inventing execution state or changing definitions', async t => {
  const root = await workspace(t);
  const codexHome = join(root, 'codex');
  const directory = join(codexHome, 'automations', 'reminder');
  await mkdir(directory, { recursive:true });
  await writeFile(join(directory, 'automation.toml'), [
    'id = "reminder"', 'name = "定时复核"', 'status = "ACTIVE"', 'kind = "cron"',
    'prompt = """', privateText, 'name = "诱导内容"', '"""', 'updated_at = ' + Date.parse(update),
  ].join('\n'));
  if (process.platform !== 'win32') await symlink(directory, join(codexHome,'automations','outside'));

  const app = createTaskboardServer({ dataDirectory:join(root,'aiyou'), codexStatePath:join(codexHome,'.codex-global-state.json'), nativeHallActivity:true });
  t.after(() => app.close());
  const url = 'http://127.0.0.1:' + (await app.listen({ port:0 })).port + '/api/local/task-hall';
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const { scheduledActivity } = await response.json();
  assert.ok(scheduledActivity.sources.find(x => x.id === 'codex-native').available);
  assert.deepEqual(scheduledActivity.items, [{ id:'codex-native:rule:reminder', source:'codex-native', kind:'rule',
    title:'定时复核', status:'active', trigger:'cron', nextAt:null, updatedAt:update, projectId:null }]);
  const rejected = await fetch(url, { headers:{ Origin:'https://elsewhere.invalid' } });
  assert.equal(rejected.status, 403);
  assert.ok(!Object.hasOwn(await rejected.json(), 'scheduledActivity'));
});
