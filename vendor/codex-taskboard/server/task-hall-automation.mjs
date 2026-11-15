import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_RULES = 100;
const MAX_RUNS = 120;
const ID = /^[\w.:-]{1,160}$/u;
const AUTOMATIC_TRIGGERS = new Set(["interval", "issue-created"]);
const DSH_TRIGGERS = new Set(["after", "at", "every", "daily", "weekly", "cron"]);
const PIPELINE_RUN_STATES = new Set(["queued", "running", "waiting", "scheduled", "failed", "interrupted", "canceled", "completed"]);
const describe = (id, name, result) => ({ source: { id, name, available: result !== null }, items: result ?? [] });

function date(value) {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 && time < 253402300800000 ? new Date(time).toISOString() : null;
}

function row(source, kind, { id, title, status, trigger, nextAt, updatedAt, projectId }) {
  const clean = typeof title === "string" ? title.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 160) : "";
  if (!clean || typeof id !== "string" || !ID.test(id)) return null;
  return { id: source + ":" + kind + ":" + id, source, kind, title: clean, status, ...(trigger ? { trigger } : {}),
    nextAt: date(nextAt), updatedAt: date(updatedAt), projectId: typeof projectId === "string" && ID.test(projectId) ? projectId : null };
}

async function withDatabase(file, read) {
  if (!file) return null;
  let db;
  try {
    if (!(await lstat(file)).isFile()) return null;
    db = new DatabaseSync(file, { readOnly: true, timeout: 200 });
    return read(db);
  } catch { return null; }
  finally { db?.close(); }
}

const codexRuleState = status => status === "ACTIVE" ? "active" : status === "PAUSED" ? "paused" : "unknown";
const codexTrigger = kind => ["heartbeat", "cron"].includes(kind) ? kind : undefined;
function codexRunState(value) {
  if (typeof value !== "string") return "unknown";
  const status = value.toLowerCase().replace(/-/gu, "_");
  return ({
    running: "running", in_progress: "running", pending: "queued", queued: "queued",
    completed: "completed", succeeded: "completed", failed: "failed",
    interrupted: "interrupted", canceled: "canceled", cancelled: "canceled",
  })[status] ?? "unknown";
}

async function codexSqlite(file, projectId, codexProjectId) {
  return withDatabase(file, db => {
    const columns = new Set(db.prepare("PRAGMA table_info(automations)").all().map(x => x.name));
    if (!["id", "name", "status", "updated_at"].every(column => columns.has(column))) return null;
    if (projectId && (!codexProjectId || !columns.has("project_id"))) return [];
    const optional = ["kind", "next_run_at", "project_id"].filter(column => columns.has(column));
    const where = projectId ? " WHERE project_id=?" : "";
    const args = projectId ? [codexProjectId] : [];
    const rules = db.prepare(`SELECT id,name,status,updated_at${optional.length ? "," + optional.join(",") : ""}
      FROM automations${where} ORDER BY updated_at DESC,id LIMIT ?`).all(...args, MAX_RULES);
    const result = rules.map(item => row("codex-native", "rule", {
      id:item.id, title:item.name, status:codexRuleState(item.status), trigger:codexTrigger(item.kind),
      nextAt:item.status === "ACTIVE" ? item.next_run_at : null, updatedAt:item.updated_at,
      projectId:projectId ?? item.project_id,
    })).filter(Boolean);
    const runColumns = new Set(db.prepare("PRAGMA table_info(automation_runs)").all().map(x => x.name));
    if (["automation_id","thread_id","status","updated_at"].every(column => runColumns.has(column))) {
      const runs = db.prepare(`SELECT r.thread_id,r.status,r.updated_at,a.name${optional.includes("kind") ? ",a.kind" : ""}${optional.includes("project_id") ? ",a.project_id" : ""}
        FROM automation_runs r JOIN automations a ON a.id=r.automation_id
        ${projectId ? "WHERE a.project_id=?" : ""}
        ORDER BY r.updated_at DESC,r.thread_id LIMIT ?`).all(...args,MAX_RUNS);
      result.push(...runs.map(item=>row("codex-native","run",{
        id:item.thread_id,title:item.name,status:codexRunState(item.status),trigger:codexTrigger(item.kind),
        updatedAt:item.updated_at,projectId:projectId ?? item.project_id,
      })).filter(Boolean));
    }
    return result;
  });
}

async function definition(file, directoryId) {
  // Only the scalar metadata header and confirmed fields are consumed. This
  // fallback never guesses a next time or interprets any prompt or RRULE.
  let handle;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 128 * 1024) return null;
    handle = await open(file, "r");
    const data = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(data,0,data.length,0);
    if (bytesRead > info.size) return null;
    const lines = data.subarray(0,bytesRead).toString("utf8").split(/\r?\n/u);
    let quoted = null;
    const fields = Object.create(null);
    for (const line of lines) {
      if (quoted) {
        if (line.includes(quoted)) quoted = null;
        continue;
      }
      if (/^\s*\[/u.test(line)) break;
      const field = /^\s*([\w-]+)\s*=\s*(.*)$/u.exec(line);
      if (!field) continue;
      const [,key,value] = field;
      const marker = value.startsWith('"""') ? '"""' : value.startsWith("'''") ? "'''" : null;
      if (marker) { if (!value.slice(3).includes(marker)) quoted = marker; continue; }
      if (!["id","name","status","kind","updated_at"].includes(key)) continue;
      const basic = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/u.exec(value);
      const literal = /^'([^']*)'\s*(?:#.*)?$/u.exec(value);
      const integer = /^(\d+)\s*(?:#.*)?$/u.exec(value);
      if (basic) fields[key] = JSON.parse(basic[1]);
      else if (literal) fields[key] = literal[1];
      else if (integer) fields[key] = Number(integer[1]);
    }
    if (fields.id !== directoryId) return null;
    return row("codex-native","rule",{id:fields.id,title:fields.name,status:codexRuleState(fields.status),
      trigger:codexTrigger(fields.kind),updatedAt:fields.updated_at});
  } catch { return null; }
  finally { await handle?.close().catch(()=>{}); }
}

async function codexFiles(home) {
  try {
    const directory = join(home,"automations");
    if (!(await lstat(directory)).isDirectory()) return null;
    const catalog = await opendir(directory);
    const result = [];
    let scanned = 0;
    for await (const item of catalog) {
      if (++scanned > 200 || result.length >= MAX_RULES) break;
      if (!item.isDirectory() || !ID.test(item.name)) continue;
      const entry = await definition(join(directory,item.name,"automation.toml"),item.name);
      if (entry) result.push(entry);
    }
    return result.sort((a,b)=>(b.updatedAt || "").localeCompare(a.updatedAt || ""));
  } catch { return null; }
}

async function readCodex({ codexHome, projectId, codexProjectId }) {
  const result = await codexSqlite(join(codexHome,"sqlite","codex.db"),projectId,codexProjectId);
  return result ?? (projectId ? null : await codexFiles(codexHome));
}

async function readPipeline(file, projectId) {
  return withDatabase(file, db => {
    const projectFilter = projectId ? " AND project=?" : "";
    const args = projectId ? [projectId] : [];
    const rules = db.prepare(`SELECT id,project,next,
      json_extract(value,'$.name') AS name,json_extract(value,'$.trigger') AS trigger,json_extract(value,'$.enabled') AS enabled
      FROM pipeline_rules WHERE json_extract(value,'$.trigger') IN ('interval','issue-created')${projectFilter}
      ORDER BY rowid DESC LIMIT ?`).all(...args,MAX_RULES);
    const runs = db.prepare(`SELECT id,project,event,status,
      json_extract(value,'$.title') AS title,json_extract(value,'$.updatedAt') AS updatedAt,json_extract(value,'$.nextAt') AS nextAt
      FROM pipeline_runs WHERE (event LIKE 'interval:%' OR event LIKE 'issue-created:%')${projectFilter}
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'waiting' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END,
      rowid DESC LIMIT ?`).all(...args,MAX_RUNS);
    return [
      ...rules.map(item => row("pipeline","rule",{id:item.id,title:item.name,status:item.enabled === 1 ? "enabled" : "disabled",
        trigger:AUTOMATIC_TRIGGERS.has(item.trigger) ? item.trigger : undefined,
        nextAt:item.enabled === 1 ? item.next : null,projectId:item.project})),
      ...runs.map(item => row("pipeline","run",{id:item.id,title:item.title,
        status:PIPELINE_RUN_STATES.has(item.status) ? item.status : "unknown",
        trigger:item.event.startsWith("interval:") ? "interval" : "issue-created",
        nextAt:item.status === "scheduled" ? item.nextAt : null,updatedAt:item.updatedAt,projectId:item.project})),
    ].filter(Boolean);
  });
}

async function readDsh(schedule, projectId) {
  if (typeof schedule?.catalog !== "function") return null;
  // The native catalog binds reminders to sessions, not AIYOU projects.
  if (projectId) return [];
  try {
    const rows = await schedule.catalog();
    if (!Array.isArray(rows)) return null;
    return rows.slice(0,MAX_RULES).flatMap(item => {
      if (!item || !DSH_TRIGGERS.has(item.kind)) return [];
      const result = [row("dsh-native","rule",{id:item.id,title:item.title,
        status:item.status === "active" ? "active" : item.status === "inactive" ? "disabled" : "unknown",
        trigger:item.kind,nextAt:item.status === "active" ? item.scheduledAt : null})];
      const delivery = item.lastDelivery;
      if (date(delivery?.deliveredAt) && typeof delivery.messageId === "string" && ID.test(delivery.messageId)
        && typeof item.id === "string" && ID.test(item.id)) {
        result.push(row("dsh-native","run",{id:item.id+":"+delivery.messageId,title:item.title,status:"delivered",
          trigger:item.kind,updatedAt:delivery.deliveredAt}));
      }
      return result.filter(Boolean);
    });
  } catch { return null; }
}

/** Metadata-only dashboard projection. No schedule, run, session, or rule is mutated. */
export async function readHallScheduledActivity({ pipelineFile, codexHome, codexProjectId, dshNative = false, dshSchedule, projectId } = {}) {
  const requests = [readPipeline(pipelineFile,projectId).then(result=>describe("pipeline","AIYOU 自动规则",result))];
  if (codexHome) requests.push(readCodex({codexHome,projectId,codexProjectId}).then(result=>describe("codex-native","Codex 原生自动任务",result)));
  if (dshNative) requests.push(readDsh(dshSchedule,projectId).then(result=>describe("dsh-native","DSH 原生定时提醒",result)));
  const result = await Promise.all(requests);
  return {sources:result.map(x=>x.source),items:result.flatMap(x=>x.items)};
}
