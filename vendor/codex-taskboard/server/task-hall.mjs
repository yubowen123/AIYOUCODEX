import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const BUILTIN_HALL_AGENTS = Object.freeze({
  codex: Object.freeze({ id: 'builtin:codex', name: 'Codex', host: 'codex' }),
  claude: Object.freeze({ id: 'builtin:claude', name: 'Claude Code', host: 'claude' }),
  dsh: Object.freeze({ id: 'builtin:dsh', name: 'AIYOUDSH', host: 'dsh' }),
});
const BUILTINS = new Map(Object.values(BUILTIN_HALL_AGENTS).map(agent => [agent.id, agent]));
const HOSTS = new Set(['codex', 'dsh', 'claude', 'local']);
const ROLES = new Set(['worker', 'reviewer']);
const HEARTBEAT_MS = 120_000;
const LEASE_MS = HEARTBEAT_MS;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u;
const SECRET = /^[a-f0-9]{64}$/u;
const digest = text => createHash('sha256').update(text).digest('hex');
const iso = value => value == null ? null : new Date(value).toISOString();
export const hallError = (status, message) => Object.assign(new Error(message), { status });
const fail = (status, message) => { throw hallError(status, message); };
const id = (value, label) => typeof value === 'string' && ID.test(value) ? value : fail(400, label + '无效');
function field(value, label, limit, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || value.includes('\0') || !value.trim() || value.length > limit) fail(400, label + '无效（最多 ' + limit + ' 字）');
  return value.trim();
}
export function taskHallFile(env = process.env) {
  if (env.AIYOU_TASK_HALL_FILE) return env.AIYOU_TASK_HALL_FILE;
  const dataHome = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  return join(dataHome, 'aiyou', 'task-hall.sqlite');
}

const common = ['action', 'taskId', 'revision'];
const INPUT_KEYS = {
  create: ['action', 'projectId', 'title', 'description', 'agentId', 'requestId', 'automation'],
  claim: [...common, 'agentId'],
  handoff: [...common, 'agentId', 'evidence'],
  submit: [...common, 'evidence'],
  review: [...common, 'verdict', 'evidence'],
  progress: [...common, 'agentId', 'evidence'],
  requeue: [...common, 'agentId', 'evidence'],
};
const WORKER_ACTIONS = new Set(['claim', 'handoff', 'submit']);

export function createTaskHall({ file = taskHallFile(), clock = Date.now } = {}) {
  if (file !== ':memory:') {
    if (!isAbsolute(file)) throw new TypeError('Task hall storage must use an absolute path');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    closeSync(openSync(file, 'a', 0o600));
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS hall_agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
      role TEXT NOT NULL, secret_hash TEXT NOT NULL, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS hall_tasks (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
      agent TEXT REFERENCES hall_agents(id), evidence TEXT, lease INTEGER,
      revision INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      UNIQUE(project,request)
    );
    CREATE INDEX IF NOT EXISTS hall_tasks_project ON hall_tasks(project,updated);
    CREATE INDEX IF NOT EXISTS hall_tasks_lease ON hall_tasks(status,lease);
    CREATE TABLE IF NOT EXISTS hall_events (
      seq INTEGER PRIMARY KEY, task TEXT NOT NULL REFERENCES hall_tasks(id), action TEXT NOT NULL,
      actor TEXT NOT NULL, actor_kind TEXT NOT NULL, before_agent TEXT, after_agent TEXT,
      note TEXT, verdict TEXT, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hall_events_task ON hall_events(task,seq);
    CREATE TABLE IF NOT EXISTS hall_managed (
      agent TEXT PRIMARY KEY REFERENCES hall_agents(id), model TEXT
    );
    CREATE TABLE IF NOT EXISTS hall_dispatch (
      task TEXT PRIMARY KEY REFERENCES hall_tasks(id), plan TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0, token TEXT, expires INTEGER
    );
  `);
  const getAgent = db.prepare('SELECT * FROM hall_agents WHERE id=?');
  const getTask = db.prepare('SELECT * FROM hall_tasks WHERE id=?');
  const insertEvent = db.prepare('INSERT INTO hall_events(task,action,actor,actor_kind,before_agent,after_agent,note,verdict,at) VALUES (?,?,?,?,?,?,?,?,?)');
  const dispatchFor = db.prepare('SELECT * FROM hall_dispatch WHERE task=?');
  const getPlan = dispatch => JSON.parse(dispatch.plan);
  const timeline = db.prepare('SELECT * FROM hall_events WHERE task=? ORDER BY seq DESC LIMIT 30');
  const putTask = db.prepare('UPDATE hall_tasks SET status=?,agent=?,evidence=?,lease=?,revision=revision+1,updated=? WHERE id=? AND revision=?');
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const operator = host => {
    if (!HOSTS.has(host)) fail(403, '操作端无效');
    return { id: 'operator:' + host, kind: 'operator' };
  };
  const auth = credential => {
    if (!credential || typeof credential.id !== 'string' || !ID.test(credential.id) ||
        typeof credential.key !== 'string' || !SECRET.test(credential.key)) fail(401, '需要有效的 Agent 凭证');
    const row = getAgent.get(credential.id);
    if (!row || !SECRET.test(row.secret_hash) || !timingSafeEqual(Buffer.from(row.secret_hash), Buffer.from(digest(credential.key)))) fail(401, 'Agent 凭证无效');
    return { id: row.id, kind: row.role };
  };
  function assigned(value, optional = false) {
    if (optional && (value == null || value === '')) return null;
    const target = getAgent.get(id(value, 'Agent'));
    if (!target || target.role !== 'worker') fail(404, '承接 Agent 未注册');
    return target.id;
  }
  const expose = row => {
    const dispatch = dispatchFor.get(row.id);
    const plan = dispatch && getPlan(dispatch);
    return ({
    id: row.id, title: row.title, description: row.description, projectId: row.project,
    status: row.status, agentId: row.agent, revision: row.revision, evidence: row.evidence,
    createdAt: iso(row.created), updatedAt: iso(row.updated), leaseUntil: iso(row.lease),
    ...(plan ? { automation: { steps: plan, step: dispatch.step, active: Boolean(dispatch.token) } } : {}),
    timeline: timeline.all(row.id).reverse().map(e => ({
      id: e.seq, action: e.action, actorId: e.actor, actorKind: e.actor_kind, agentId: e.after_agent,
      previousAgentId: e.before_agent, note: e.note, verdict: e.verdict, at: iso(e.at),
    })),
    });
  };
  function append(row, action, actor, agent, note, at, verdict = null) {
    insertEvent.run(row.id, action, actor.id, actor.kind, row.agent ?? null, agent, note, verdict, at);
  }
  function transition(row, action, actor, { status, agent = row.agent, note = null, lease = null, verdict = null }, at) {
    if (!putTask.run(status, agent, note ?? row.evidence, lease, at, row.id, row.revision).changes) fail(409, '任务已更新，请刷新');
    append(row, action, actor, agent, note, at, verdict);
    return expose(getTask.get(row.id));
  }
  function expire(now) {
    for (const entry of db.prepare('SELECT task FROM hall_dispatch WHERE token IS NOT NULL AND expires<=? LIMIT 100').all(now)) {
      const row = getTask.get(entry.task);
      db.prepare('UPDATE hall_dispatch SET token=NULL,expires=NULL WHERE task=?').run(row.id);
      transition(row, 'lease-expired', { id: 'system', kind: 'system' }, { status: 'attention', note: 'Agent 执行连接中断。核对回执后可手动恢复；未自动重发。' }, now);
    }
    const expired = db.prepare("SELECT * FROM hall_tasks WHERE status='running' AND lease<=? ORDER BY lease LIMIT 100").all(now);
    for (const row of expired) {
      transition(row, 'lease-expired', { id: 'system', kind: 'system' }, { status: 'attention' }, now);
    }
  }
  function noteSeen(actor, now) {
    db.prepare('UPDATE hall_agents SET last_seen=? WHERE id=?').run(now, actor.id);
    db.prepare("UPDATE hall_tasks SET lease=? WHERE status='running' AND agent=? AND lease>?").run(now + LEASE_MS, actor.id, now);
  }
  function list({ projectId, actor } = {}) {
    const project = projectId == null || projectId === '' ? null : id(projectId, '项目');
    const now = clock();
    // An expired task is never returned as an active claim, even after
    // unexpected process exit or if the expired maintenance batch is full.
    return tx(() => {
      expire(now);
      const clauses = ["(status!='running' OR lease>?)"], params = [now];
      if (project) { clauses.push('project=?'); params.push(project); }
      if (actor?.kind === 'worker') {
        clauses.push("(agent=? OR (status='queued' AND agent IS NULL))"); params.push(actor.id);
      } else if (actor?.kind === 'reviewer') clauses.push("status='verification'");
      const where = clauses.join(' AND ');
      const rows = db.prepare(`SELECT * FROM hall_tasks WHERE ${where}
        ORDER BY CASE status WHEN 'attention' THEN 0 WHEN 'verification' THEN 1 WHEN 'continuation' THEN 2
        WHEN 'running' THEN 3 WHEN 'queued' THEN 4 ELSE 5 END, updated DESC, id LIMIT 100`).all(...params);
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const counts = { queued: 0, running: 0, verification: 0, attention: 0, continuation: 0, completed: 0, completedToday: 0 };
      let total = 0;
      for (const row of db.prepare(`SELECT status, count(*) AS count, sum(updated>=?) AS today
        FROM hall_tasks WHERE ${where} GROUP BY status`).all(startOfDay.getTime(), ...params)) {
        counts[row.status] = row.count;
        total += row.count;
        if (row.status === 'completed') counts.completedToday = row.today;
      }
      const agents = db.prepare(`SELECT a.id,a.name,a.host,a.role,a.last_seen,m.agent AS managed,m.model,
        (SELECT count(*) FROM hall_dispatch d WHERE d.token IS NOT NULL AND d.expires>? AND
         json_extract(d.plan,'$['||d.step||'].agentId')=a.id) AS dispatched,
        (SELECT count(*) FROM hall_tasks t WHERE t.agent=a.id AND t.status='running' AND t.lease>?) AS active
        FROM hall_agents a LEFT JOIN hall_managed m ON m.agent=a.id ORDER BY a.host,a.name,a.id LIMIT 105`).all(now,now).map(a => ({
        id: a.id, name: a.name, host: a.host, role: a.role,
        online: a.last_seen != null && a.last_seen > now - HEARTBEAT_MS,
        lastSeenAt: iso(a.last_seen), activeCount: Math.max(a.active, a.dispatched),
        ...(a.managed ? { managed: true, model: a.model } : {}),
      }));
      return { tasks: rows.map(expose), agents, total, truncated: rows.length < total, counts };
    });
  }
  function register({ id: agentId, name, host, role = 'worker' }) {
    id(agentId, 'Agent 标识');
    if (agentId.startsWith('builtin:') || agentId.startsWith('operator:') || agentId === 'system' || !HOSTS.has(host) || !ROLES.has(role)) fail(400, 'Agent 类型或标识无效');
    const label = field(name, 'Agent 名称', 80);
    return tx(() => {
      if (getAgent.get(agentId)) fail(409, 'Agent 标识已存在');
      if (db.prepare('SELECT count(*) AS n FROM hall_agents').get().n >= 100) fail(409, 'Agent 数量已达上限');
      const key = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO hall_agents VALUES (?,?,?,?,?,NULL)').run(agentId, label, host, role, digest(key));
      return { id: agentId, key, host, role };
    });
  }
  function create(command, actor, now) {
    const project = id(command.projectId ?? 'local', '项目');
    const request = id(command.requestId, '请求');
    const title = field(command.title, '任务标题', 120);
    const description = field(command.description, '任务说明', 8000, true);
    const agent = assigned(command.agentId, true);
    const plan = command.automation === undefined ? null : validatePlan(agent, command.automation);
    if (!plan && BUILTINS.has(agent)) fail(400, '请选择自动协作路线后再分配内置 Agent');
    const fingerprint = digest(JSON.stringify({ title, description, agent, ...(plan ? { plan } : {}) }));
    const previous = db.prepare('SELECT * FROM hall_tasks WHERE project=? AND request=?').get(project, request);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail(409, '请求编号已用于其他任务内容');
      return expose(previous);
    }
    const taskId = randomUUID();
    db.prepare(`INSERT INTO hall_tasks(id,project,request,fingerprint,title,description,status,agent,revision,created,updated)
      VALUES (?,?,?,?,?,?,'queued',?,1,?,?)`).run(taskId, project, request, fingerprint, title, description, agent, now, now);
    if (plan) db.prepare('INSERT INTO hall_dispatch(task,plan) VALUES (?,?)').run(taskId, JSON.stringify(plan));
    append({ id: taskId }, 'create', actor, agent, plan ? '已启用自动协作。' : null, now);
    return expose(getTask.get(taskId));
  }
  function write(command, actor, now) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) fail(400, '请求须为 JSON 对象');
    const { action } = command;
    if (typeof action !== 'string' || !Object.hasOwn(INPUT_KEYS, action) || Object.keys(command).some(key => !INPUT_KEYS[action].includes(key))) fail(400, '未知任务操作或字段');
    if (actor.kind !== 'operator' && !(actor.kind === 'worker' && WORKER_ACTIONS.has(action)) &&
        !(actor.kind === 'reviewer' && action === 'review')) fail(403, '当前身份不可执行此操作');
    if (action === 'create') return create(command, actor, now);
    const row = getTask.get(id(command.taskId, '任务'));
    if (!row) fail(404, '任务不存在');
    const dispatch = dispatchFor.get(row.id);
    const routeFinished = dispatch && dispatch.step >= getPlan(dispatch).length;
    if (dispatch && !(actor.kind === 'operator' && ((action === 'requeue' && row.status === 'attention') ||
        (routeFinished && action === 'progress' && row.status === 'continuation')))) fail(409, '该任务由自动协作路线管理');
    if (row.status === 'running' && row.lease <= now) fail(409, '领取租约已过期，请刷新');
    if (actor.kind === 'worker' && row.agent !== actor.id && (action !== 'claim' || row.agent !== null)) fail(403, '任务由其他 Agent 承接或预约');
    if (!Number.isSafeInteger(command.revision) || row.revision !== command.revision) fail(409, '任务已更新，请刷新后操作');
    const expect = status => { if (row.status !== status) fail(409, '当前任务阶段不支持该操作'); };
    if (action === 'claim') {
      expect('queued');
      if (actor.kind === 'operator') {
        const agent = assigned(command.agentId);
        if (BUILTINS.has(agent)) fail(400, '内置 Agent 需要自动协作路线');
        if (row.agent === agent) return expose(row);
        return transition(row, 'assign', actor, { status: 'queued', agent }, now);
      }
      if (command.agentId != null && command.agentId !== actor.id) fail(403, '不能代其他 Agent 领取');
      return transition(row, 'claim', actor, { status: 'running', agent: actor.id, lease: now + LEASE_MS }, now);
    }
    const note = field(command.evidence, '交接依据或回执', 4000);
    switch (action) {
      case 'handoff': {
        expect('running');
        const agent = assigned(command.agentId);
        if (BUILTINS.has(agent)) fail(400, '内置 Agent 需要自动协作路线');
        if (agent === row.agent) fail(400, '请选择另一位 Agent');
        return transition(row, action, actor, { status: 'queued', agent, note }, now);
      }
      case 'submit':
        expect('running');
        return transition(row, action, actor, { status: 'verification', note }, now);
      case 'review': {
        expect('verification');
        const { verdict } = command;
        if (!['pass', 'changes'].includes(verdict)) fail(400, '请选择检测结论');
        if (actor.id === row.agent) fail(403, '承接 Agent 不能验收自己的任务');
        return transition(row, action, actor, { status: verdict === 'pass' ? 'continuation' : 'attention', note, verdict }, now);
      }
      case 'progress': {
        expect('continuation');
        const agent = assigned(command.agentId, true);
        if (BUILTINS.has(agent)) fail(400, '内置 Agent 需要自动协作路线');
        if (agent && routeFinished) db.prepare('DELETE FROM hall_dispatch WHERE task=?').run(row.id);
        return transition(row, action, actor, { status: agent ? 'queued' : 'completed', agent: agent ?? row.agent, note }, now);
      }
      case 'requeue': {
        expect('attention');
        if (dispatch) {
          if (command.agentId) fail(400, '恢复自动任务时沿用原来的协作路线');
          const step = getPlan(dispatch)[dispatch.step];
          return transition(row, action, actor, { status: dispatchStatus(step.kind), agent: step.kind === 'work' ? step.agentId : row.agent, note }, now);
        }
        const agent = assigned(command.agentId, true);
        if (BUILTINS.has(agent)) fail(400, '内置 Agent 需要自动协作路线');
        return transition(row, action, actor, { status: 'queued', agent, note }, now);
      }
      default:
        fail(400, '未知任务操作');
    }
  }
  function validatePlan(agent, automation) {
    if (!automation || typeof automation !== 'object' || Array.isArray(automation) ||
        Object.keys(automation).some(key => !['handoffAgentId', 'reviewAgentId', 'continueAgentId'].includes(key))) fail(400, '自动协作路线无效');
    const { handoffAgentId, reviewAgentId, continueAgentId } = automation;
    for (const target of [agent, handoffAgentId, reviewAgentId, continueAgentId].filter(v => v != null)) {
      if (!BUILTINS.has(target) || !db.prepare('SELECT 1 FROM hall_managed WHERE agent=?').get(target)) fail(400, '协作路线包含未接入的内置 Agent');
    }
    if (!BUILTINS.has(agent) || handoffAgentId === agent || !BUILTINS.has(reviewAgentId) ||
        reviewAgentId === (handoffAgentId ?? agent)) fail(400, '须选择首位承接者和独立检测 Agent；交接者不能相同');
    return [
      { kind: 'work', agentId: agent },
      ...(handoffAgentId == null ? [] : [{ kind: 'work', agentId: handoffAgentId }]),
      { kind: 'review', agentId: reviewAgentId },
      ...(continueAgentId == null ? [] : [{ kind: 'continue', agentId: continueAgentId }]),
    ];
  }

  const dispatchStatus = kind => ({ work: 'queued', review: 'verification', continue: 'continuation' })[kind];
  function managedAgent(host) {
    const agent = BUILTIN_HALL_AGENTS[host];
    if (!agent || !Object.hasOwn(BUILTIN_HALL_AGENTS, host)) fail(400, '内置 Agent 无效');
    const actor = { id: agent.id, kind: 'worker' };
    tx(() => {
      if (getAgent.get(agent.id)) {
        if (!db.prepare('SELECT 1 FROM hall_managed WHERE agent=?').get(agent.id)) fail(409, '内置 Agent 标识已被占用');
      } else {
        // Managed agents have no reusable CLI secret. Only this server-side
        // capability can act for them, with a distinct per-attempt lease.
        db.prepare('INSERT INTO hall_agents VALUES (?,?,?,?,?,NULL)').run(agent.id, agent.name, host, 'worker', 'managed');
        db.prepare('INSERT INTO hall_managed(agent) VALUES (?)').run(agent.id);
      }
    });
    function owned({ taskId, token }) {
      const row = getTask.get(taskId), job = dispatchFor.get(taskId);
      const plan = job && getPlan(job), step = plan?.[job.step];
      if (!row || !job?.token || job.token !== token || step?.agentId !== agent.id || job.expires <= clock()) fail(409, '执行租约已失效');
      return { row, job, plan, step };
    }
    return {
      presence(model) {
        if (model !== null) field(model, '模型名称', 160);
        tx(() => {
          db.prepare('UPDATE hall_managed SET model=? WHERE agent=?').run(model, agent.id);
          db.prepare('UPDATE hall_agents SET last_seen=? WHERE id=?').run(model ? clock() : null, agent.id);
        });
      },
      take() {
        const now = clock();
        return tx(() => {
          expire(now);
          if (db.prepare("SELECT 1 FROM hall_dispatch WHERE token IS NOT NULL AND json_extract(plan,'$['||step||'].agentId')=?").get(agent.id)) return null;
          const found = db.prepare(`SELECT d.* FROM hall_dispatch d JOIN hall_tasks t ON t.id=d.task
            WHERE d.token IS NULL AND json_extract(d.plan,'$['||d.step||'].agentId')=?
            AND t.status=CASE json_extract(d.plan,'$['||d.step||'].kind')
              WHEN 'work' THEN 'queued' WHEN 'review' THEN 'verification' WHEN 'continue' THEN 'continuation' END
            ORDER BY t.updated,t.id LIMIT 1`).get(agent.id);
          if (!found) return null;
          const step = getPlan(found)[found.step], row = getTask.get(found.task);
          const token = randomUUID();
          db.prepare('UPDATE hall_dispatch SET token=?,expires=? WHERE task=?').run(token, now + LEASE_MS, row.id);
          const phase = step.kind === 'work' ? 'claim' : step.kind === 'review' ? 'review-start' : 'progress-start';
          const task = transition(row, phase, { ...actor, kind: step.kind === 'review' ? 'reviewer' : 'worker' }, {
            status: step.kind === 'work' ? 'running' : row.status,
            lease: step.kind === 'work' ? now + LEASE_MS : null,
          }, now);
          return { task, token, kind: step.kind, hasHandoff: getPlan(found)[found.step + 1]?.kind === 'work' };
        });
      },
      renew(attempt) {
        const now = clock();
        tx(() => {
          const { row } = owned(attempt);
          db.prepare('UPDATE hall_dispatch SET expires=? WHERE task=?').run(now + LEASE_MS, row.id);
          db.prepare('UPDATE hall_agents SET last_seen=? WHERE id=?').run(now, agent.id);
          if (row.status === 'running') db.prepare('UPDATE hall_tasks SET lease=? WHERE id=?').run(now + LEASE_MS, row.id);
        });
      },
      finish(attempt, { evidence, verdict, error } = {}) {
        const now = clock();
        return tx(() => {
          const { row, job, plan, step } = owned(attempt);
          const next = plan[job.step + 1];
          if (step.kind === 'review' && !error && !['pass', 'changes'].includes(verdict)) fail(400, '无有效检测结论');
          const failed = error || (step.kind === 'review' && verdict === 'changes');
          const note = field(evidence, '执行回执', 4000);
          db.prepare('UPDATE hall_dispatch SET step=?,token=NULL,expires=NULL WHERE task=?').run(failed ? job.step : job.step + 1, row.id);
          const phase = error ? 'agent-error' : step.kind === 'review' ? 'review' : step.kind === 'continue' ? 'progress' : next?.kind === 'work' ? 'handoff' : 'submit';
          const status = failed ? 'attention' : step.kind === 'review' ? 'continuation' : next ? dispatchStatus(next.kind) : 'completed';
          return transition(row, phase, { ...actor, kind: step.kind === 'review' ? 'reviewer' : 'worker' }, {
            status, agent: !failed && next?.kind === 'work' ? next.agentId : row.agent,
            note, verdict: step.kind === 'review' && !error ? verdict : null,
          }, now);
        });
      },
    };
  }

  // Keep expiry durable even when the requested operation fails (e.g. stale
  // revision after a worker reconnects). The next transaction rechecks state.
  function maintain(now) { tx(() => expire(now)); }
  return {
    register,
    managedAgent,
    listOperator(projectId) { return list({ projectId }); },
    listAgent(credential, projectId) { return list({ projectId, actor: auth(credential) }); },
    heartbeat(credential) {
      const now = clock();
      return tx(() => {
        const actor = auth(credential);
        expire(now);
        noteSeen(actor, now);
        return { agentId: actor.id, seenAt: iso(now), heartbeatExpiresAt: iso(now + HEARTBEAT_MS) };
      });
    },
    asOperator(host, command) {
      const actor = operator(host), now = clock();
      maintain(now);
      return { task: tx(() => write(command, actor, now)) };
    },
    asAgent(credential, command) {
      const actor = auth(credential), now = clock();
      maintain(now);
      return { task: tx(() => {
        const result = write(command, actor, now);
        noteSeen(actor, now);
        return result;
      }) };
    },
    close() { db.close(); },
  };
}
