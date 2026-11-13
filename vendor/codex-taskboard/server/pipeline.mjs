import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MINUTE = 60_000;
const ACTIVE = new Set(['queued', 'running', 'waiting', 'scheduled']);
const MAX_STAGES = 12;
const LEASE = 120_000;
export const pipelineError = (status, message) => Object.assign(new Error(message), { status });
const invalid = message => { throw pipelineError(400, message); };
const conflict = message => { throw pipelineError(409, message); };
const clean = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const identifier = (v, label) => {
  if (typeof v !== 'string' || !/^[\w.:-]{1,128}$/u.test(v)) invalid(label + '无效');
  return v;
};
const parse = row => row ? JSON.parse(row.value) : null;
const date = timestamp => new Date(timestamp).toISOString();
const limitedText = (v, n) => {
  if (typeof v !== 'string' || !v.trim() || v.length > n) invalid('请输入有效内容（最多 ' + n + ' 字符）');
  return v.trim();
};

function definition(value) {
  if (!value || !['manual', 'issue', 'issue-created', 'interval'].includes(value.trigger)) invalid('请选择触发方式');
  if (!Array.isArray(value.stages) || !value.stages.length || value.stages.length > MAX_STAGES) invalid('请配置 1 至 12 个步骤');
  const stages = value.stages.map(s => {
    if (!s || !['model', 'approval'].includes(s.kind)) invalid('不支持的步骤类型');
    const stage = { kind: s.kind, name: limitedText(s.name, 80), instruction: limitedText(s.instruction, 4000) };
    if (s.kind === 'approval') {
      if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 6) invalid('决定步骤需要 2 至 6 个选项');
      stage.options = s.options.map(v => limitedText(v, 120));
      if (new Set(stage.options).size !== stage.options.length) invalid('决定选项不能重复');
    }
    return stage;
  });
  const interval = value.intervalMinutes;
  if (value.trigger === 'interval' && (!Number.isInteger(interval) || interval < 5 || interval > 43200)) invalid('间隔须为 5 至 43200 分钟');
  return { name: limitedText(value.name, 100), trigger: value.trigger, enabled: value.enabled === true, stages,
    ...(value.trigger === 'interval' ? { intervalMinutes: interval } : {}) };
}

function receipt(text) {
  const match = /(?:^|\n)```aiyou-pipeline\s*\n([\s\S]*?)\n```\s*$/u.exec(text);
  if (!match) return { text };
  let control;
  try { control = JSON.parse(match[1]); } catch { throw pipelineError(502, '流水线回执格式错误；未自动重试。'); }
  if (!control || Array.isArray(control) || Object.keys(control).length !== 1) throw pipelineError(502, '流水线回执只能包含一项决定或复查。');
  const summary = text.slice(0, match.index).trim();
  if (control.ask) {
    const { text, options } = control.ask;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000 || !Array.isArray(options) || options.length < 2 || options.length > 6 ||
      options.some(v => typeof v !== 'string' || !v.trim() || v.length > 120) || new Set(options).size !== options.length) {
      throw pipelineError(502, '模型请求的决定格式无效。');
    }
    return { text: summary || text, question: { text, options, mode: 'model' } };
  }
  if (Number.isInteger(control.laterMinutes) && control.laterMinutes >= 5 && control.laterMinutes <= 10080 && summary) {
    return { text: summary, laterMinutes: control.laterMinutes };
  }
  throw pipelineError(502, '流水线回执没有可执行的决定或复查。');
}

export function createPipeline({ file, engine, runner, project, task, issues, canDispatch = () => true, available = () => Boolean(runner), clock = Date.now, tickMs = 2000 }) {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    closeSync(openSync(file, 'a', 0o600));
  }
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS pipeline_rules(id TEXT PRIMARY KEY, project TEXT NOT NULL, next INTEGER, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pipeline_rules_due ON pipeline_rules(next);
    CREATE TABLE IF NOT EXISTS pipeline_runs(id TEXT PRIMARY KEY, project TEXT NOT NULL, rule TEXT NOT NULL,
      event TEXT NOT NULL, status TEXT NOT NULL, lease INTEGER, value TEXT NOT NULL, UNIQUE(project,event));
    CREATE INDEX IF NOT EXISTS pipeline_runs_status ON pipeline_runs(status,lease);`);
  const getRule = db.prepare('SELECT value FROM pipeline_rules WHERE id=? AND project=?');
  const getRun = db.prepare('SELECT value FROM pipeline_runs WHERE id=? AND project=?');
  const getEvent = db.prepare('SELECT value FROM pipeline_runs WHERE project=? AND event=?');
  const putRule = db.prepare('INSERT INTO pipeline_rules VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET next=excluded.next,value=excluded.value');
  const putRun = db.prepare('INSERT INTO pipeline_runs VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,lease=excluded.lease,value=excluded.value');
  const saveRule = rule => putRule.run(rule.id, rule.projectId, rule.nextAt ? Date.parse(rule.nextAt) : null, JSON.stringify(rule));
  const saveRun = (run, lease = null) => putRun.run(run.id, run.projectId, run.ruleId, run.event, run.status, lease, JSON.stringify(run));
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const v = fn(); db.exec('COMMIT'); return v; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const change = (run, status, extra = {}) => ({ ...run, ...extra, status, revision: run.revision + 1, updatedAt: date(clock()) });
  let closed = false, busy = null, controller = null, activeId = null, activeRevision = null;
  const nextOf = (rule, now) => rule.enabled && rule.trigger === 'interval' ? date(now + rule.intervalMinutes * MINUTE) : null;
  function enqueue(rule, event, input = '', issue = null) {
    const previous = parse(getEvent.get(rule.projectId, event));
    if (previous) return previous;
    const now = date(clock());
    const run = { id: randomUUID(), projectId: rule.projectId, ruleId: rule.id, ruleRevision: rule.revision,
      title: issue ? rule.name + ' · ' + issue.title : rule.name, taskId: issue?.id ?? null,
      event, input, issue, status: 'queued', revision: 1, cursor: 0, stages: rule.stages, results: [],
      engine, createdAt: now, updatedAt: now };
    saveRun(run);
    return run;
  }
  const publicRun = ({ input, issue, event, selection, ...run }) => run;
  const list = projectId => ({
    engine, available: Boolean(available()),
    rules: db.prepare('SELECT value FROM pipeline_rules WHERE project=? ORDER BY rowid DESC LIMIT 100').all(projectId).map(parse),
    runs: db.prepare('SELECT value FROM pipeline_runs WHERE project=? ORDER BY rowid DESC LIMIT 100').all(projectId).map(row => publicRun(parse(row))),
  });
  function advance(run, result) {
    const cursor = run.cursor + 1;
    return change(run, cursor === run.stages.length ? 'completed' : 'queued', {
      cursor, results: [...run.results, { ...result, at: date(clock()) }], question: null, error: null,
    });
  }
  function recover() {
    for (const row of db.prepare("SELECT value FROM pipeline_runs WHERE status='running' AND lease<=?").all(clock())) {
      const run = parse(row);
      saveRun(change(run, 'interrupted', { error: '上一轮未记录完成回执；请查看结果后手动重试。' }));
    }
  }
  function schedule() {
    for (const row of db.prepare("SELECT value FROM pipeline_runs WHERE status='scheduled' AND lease<=? ORDER BY lease LIMIT 24").all(clock())) {
      saveRun(change(parse(row), 'queued', { nextAt: null }));
    }
    for (const row of db.prepare('SELECT value FROM pipeline_rules WHERE next<=? ORDER BY next LIMIT 24').all(clock())) {
      const rule = parse(row);
      const open = db.prepare("SELECT 1 FROM pipeline_runs WHERE rule=? AND status IN ('queued','running','waiting','scheduled','failed','interrupted') LIMIT 1").get(rule.id);
      if (!open && db.prepare("SELECT count(*) AS n FROM pipeline_runs WHERE project=? AND status IN ('queued','running','waiting','scheduled')").get(rule.projectId).n < 100) enqueue(rule, 'interval:' + rule.id + ':' + rule.nextAt);
      saveRule({ ...rule, nextAt: nextOf(rule, clock()) });
    }
  }
  const pendingWork = db.prepare("SELECT 1 FROM pipeline_runs WHERE status IN ('queued','running','scheduled') UNION ALL SELECT 1 FROM pipeline_rules WHERE next IS NOT NULL OR (json_extract(value,'$.trigger')='issue-created' AND json_extract(value,'$.enabled')=1) LIMIT 1");
  const hasWork = () => Boolean(pendingWork.get());
  let lastIssueScan = -Infinity;
  async function ingestIssues() {
    if (!issues || clock() - lastIssueScan < 15_000) return;
    lastIssueScan = clock();
    const rules = db.prepare("SELECT value FROM pipeline_rules WHERE json_extract(value,'$.trigger')='issue-created' AND json_extract(value,'$.enabled')=1").all().map(parse);
    const projects = new Map();
    for (const rule of rules) {
      if (!projects.has(rule.projectId)) {
        try { projects.set(rule.projectId, await issues(rule.projectId)); }
        catch { projects.set(rule.projectId, []); }
      }
      const candidates = projects.get(rule.projectId);
      tx(() => {
        const latest = parse(getRule.get(rule.id, rule.projectId));
        if (!latest?.enabled || latest.revision !== rule.revision) return;
        for (const issue of candidates) {
          if (issue.projectId !== rule.projectId || issue.archivedAt || !(Date.parse(issue.createdAt) > Date.parse(rule.sinceAt))) continue;
          const event = 'issue-created:' + rule.id + ':' + issue.id;
          if (getEvent.get(rule.projectId, event)) continue;
          if (db.prepare("SELECT count(*) AS n FROM pipeline_runs WHERE project=? AND status IN ('queued','running','waiting','scheduled')").get(rule.projectId).n >= 100) break;
          enqueue(rule, event, '', { id: issue.id, title: clean(issue.title, 240), description: clean(issue.description, 8000), version: issue.version });
        }
      });
    }
  }
  async function work() {
    if (closed || !runner || !available() || !hasWork() || !(await canDispatch()) || closed) return;
    await ingestIssues();
    if (closed) return;
    const run = tx(() => {
      recover();
      if (!runner) return null;
      schedule();
      if (db.prepare("SELECT 1 FROM pipeline_runs WHERE status='running' LIMIT 1").get()) return null;
      const ready = parse(db.prepare("SELECT value FROM pipeline_runs WHERE status='queued' ORDER BY rowid LIMIT 1").get());
      if (!ready) return null;
      const stage = ready.stages[ready.cursor];
      if (stage.kind === 'approval') {
        saveRun(change(ready, 'waiting', { question: { name: stage.name, text: stage.instruction, options: stage.options } }));
        return null;
      }
      const next = change(ready, 'running');
      saveRun(next, clock() + LEASE);
      return next;
    });
    if (!run) return;
    controller = new AbortController();
    activeId = run.id;
    activeRevision = run.revision;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const heartbeat = setInterval(() => {
      try {
        db.prepare("UPDATE pipeline_runs SET lease=? WHERE id=? AND status='running' AND json_extract(value,'$.revision')=?").run(clock() + LEASE, run.id, run.revision);
      } catch { controller?.abort(); }
    }, LEASE / 4);
    heartbeat.unref();
    try {
      const workspace = await project(run.projectId);
      if (!workspace) throw pipelineError(404, '项目已不可用');
      signal.throwIfAborted();
      if (!run.selection) {
        run.selection = await runner.select({ workspace, run, signal });
        if (!run.selection) throw pipelineError(503, '当前宿主没有可用模型');
        const stillOwned = tx(() => {
          const current = parse(getRun.get(run.id, run.projectId));
          if (current?.status !== 'running' || current.revision !== run.revision) return false;
          saveRun(run, clock() + LEASE);
          return true;
        });
        if (!stillOwned) return;
      }
      signal.throwIfAborted();
      const stage = run.stages[run.cursor];
      const result = await runner.invoke({ workspace, run, stage, selection: run.selection, signal });
      signal.throwIfAborted();
      const output = clean(result?.text, 24000);
      if (!output) throw pipelineError(502, '模型没有返回有效结果');
      const returned = receipt(output);
      const usage = Object.fromEntries(Object.entries(result.usage ?? {}).filter(([k,v]) => /^[a-z_]{1,40}$/iu.test(k) && Number.isFinite(v) && v >= 0));
      tx(() => {
        const current = parse(getRun.get(run.id, run.projectId));
        if (current?.status !== 'running' || current.revision !== run.revision) return;
        const result = { name: stage.name, text: returned.text, usage };
        if (returned.question || returned.laterMinutes) {
          const loops = (run.loops || 0) + 1;
          if (loops > 5) { saveRun(change(run, 'failed', { error: '达到本次执行的决定与复查次数上限。' })); return; }
          const results = [...run.results, { ...result, at: date(clock()) }];
          if (returned.question) {
            saveRun(change(run, 'waiting', { loops, results, question: { name: stage.name, ...returned.question } }));
          } else {
            const due = clock() + returned.laterMinutes * MINUTE;
            saveRun(change(run, 'scheduled', { loops, results, nextAt: date(due) }), due);
          }
        } else saveRun(advance(run, result));
      });
    } catch (error) {
      tx(() => {
        const current = parse(getRun.get(run.id, run.projectId));
        if (current?.status !== 'running' || current.revision !== run.revision) return;
        saveRun(change(current, 'failed', { error: error.status || error.code === 'CLI_NOT_LOGGED_IN'
          ? clean(error.message, 400) : signal.aborted ? '执行超时或已停止；未自动重试。' : '本轮执行失败；未收到有效回执。' }));
      });
    } finally {
      clearInterval(heartbeat);
      controller = null;
      activeId = null;
      activeRevision = null;
    }
  }
  const pump = () => {
    if (closed) return Promise.resolve();
    if (!busy) busy = work().finally(() => { busy = null; });
    return busy;
  };
  const wake = () => { void pump().catch(error => console.error('Pipeline worker:', error.code || error.name)); };
  const timer = tickMs ? setInterval(wake, tickMs) : null;
  timer?.unref();

  async function request(projectId, command) {
    identifier(projectId, '项目');
    if (closed) throw pipelineError(503, '执行服务正在关闭。');
    if (!(await project(projectId))) throw pipelineError(404, '项目不存在');
    if (closed) throw pipelineError(503, '执行服务正在关闭。');
    if (!command) return list(projectId);
    const { action, rule: input, ruleId, runId, revision } = command;
    if (action === 'save-rule') return tx(() => {
      const existing = input?.id ? parse(getRule.get(identifier(input.id, '规则'), projectId)) : null;
      if (input?.id && !existing) throw pipelineError(404, '规则不存在');
      if (existing && existing.revision !== input.revision) conflict('规则已更新，请刷新后再编辑');
      if (!existing && db.prepare('SELECT count(*) AS n FROM pipeline_rules WHERE project=?').get(projectId).n >= 100) conflict('该项目的流水线规则已达上限');
      const rule = { ...definition(input), id: existing?.id || randomUUID(), projectId, revision: (existing?.revision || 0) + 1 };
      rule.nextAt = nextOf(rule, clock());
      if (rule.trigger === 'issue-created') {
        rule.sinceAt = existing?.enabled && existing.trigger === rule.trigger ? existing.sinceAt : date(clock());
        lastIssueScan = -Infinity;
      }
      saveRule(rule);
      return { rule };
    });
    if (action === 'start') {
      if (!available()) throw pipelineError(503, '宿主执行服务未连接');
      identifier(ruleId, '规则');
      const key = 'manual:' + identifier(command.requestId, '请求');
      const old = parse(getEvent.get(projectId, key));
      if (old) {
        if (old.ruleId !== ruleId || old.taskId !== (command.taskId || null) || old.input !== clean(command.input, 8000)) conflict('此请求编号已用于其他事项');
        return { run: publicRun(old) };
      }
      const rule = parse(getRule.get(ruleId, projectId));
      if (!rule || !rule.enabled) conflict('请先启用流水线规则');
      const taskId = command.taskId ? identifier(command.taskId, '议题') : null;
      if (['issue','issue-created'].includes(rule.trigger) && !taskId) invalid('此规则需要选择项目议题');
      const issue = taskId && await task(projectId, taskId);
      if (closed) throw pipelineError(503, '执行服务正在关闭。');
      if (taskId && (!issue || issue.projectId !== projectId || issue.archivedAt)) throw pipelineError(404, '没有可用的项目议题');
      const snapshot = issue ? { id: taskId, title: clean(issue.title, 240), description: clean(issue.description, 8000), version: issue.version } : null;
      const run = tx(() => {
        const latest = parse(getRule.get(rule.id, projectId));
        if (!latest?.enabled || latest.revision !== rule.revision) conflict('规则已更新，请刷新');
        const previous = parse(getEvent.get(projectId, key));
        if (previous && (previous.ruleId !== rule.id || previous.taskId !== taskId || previous.input !== clean(command.input, 8000))) conflict('此请求编号已用于其他事项');
        if (!previous && db.prepare("SELECT count(*) AS n FROM pipeline_runs WHERE project=? AND status IN ('queued','running','waiting','scheduled')").get(projectId).n >= 100) conflict('此项目已有过多未完成事项');
        return previous || enqueue(rule, key, clean(command.input, 8000), snapshot);
      });
      if (timer) wake();
      return { run: publicRun(run) };
    }
    if (!['answer', 'retry', 'cancel'].includes(action)) invalid('未知流水线操作');
    const run = tx(() => {
      recover();
      const current = parse(getRun.get(identifier(runId, '执行'), projectId));
      if (!current) throw pipelineError(404, '执行不存在');
      if (current.revision !== revision) conflict('执行状态已变化，请刷新');
      let next;
      if (action === 'answer') {
        if (current.status !== 'waiting' || !current.question?.options.includes(command.option)) conflict('此决定已失效或选项无效');
        const decision = { name: current.question.name, text: command.option, decision: true };
        next = current.question.mode === 'model'
          ? change(current, 'queued', { question: null, results: [...current.results, { ...decision, at: date(clock()) }] })
          : advance(current, decision);
      } else if (action === 'retry') {
        if (!available() || !['failed','interrupted'].includes(current.status)) conflict('此执行无法重试');
        next = change(current, 'queued', { error: null });
      } else {
        if (!ACTIVE.has(current.status) && !['failed','interrupted'].includes(current.status)) conflict('此执行已结束');
        next = change(current, 'canceled', { question: null, nextAt: null });
      }
      saveRun(next);
      return next;
    });
    if (action === 'cancel' && activeId === run.id) controller?.abort();
    if (timer) wake();
    return { run: publicRun(run) };
  }
  return { request, pump, async close() {
    closed = true;
    clearInterval(timer);
    if (activeId) {
      tx(() => {
        const active = parse(db.prepare('SELECT value FROM pipeline_runs WHERE id=?').get(activeId));
        if (active?.status === 'running' && active.revision === activeRevision) saveRun(change(active, 'interrupted', { error: '宿主已退出；请确认后手动继续。' }));
      });
      controller?.abort();
    }
    await busy;
    db.close();
  } };
}
