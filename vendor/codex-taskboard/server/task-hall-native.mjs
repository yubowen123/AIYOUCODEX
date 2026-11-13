import { open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { THREAD_ID_PATTERN } from "./thread-activity.mjs";

const FRESH_MS = 12 * 60_000;
const CHUNK = 512 * 1024;
const COLD_LIMIT = 16 * 1024 * 1024;
const MAX_CANDIDATES = 96;
const UNAVAILABLE = Object.freeze({ available: false, items: Object.freeze([]) });
const terminal = new Set(["turn_aborted", "turn_failed", "task_failed"]);
const empty = () => ({ available: true, items: [] });

function lifecycle(line) {
  // The overwhelming majority of lines are not lifecycle events; avoid
  // deserializing tool output or message text.
  if (!line.includes('"event_msg"') || !/"(?:task_started|task_complete|turn_aborted|turn_failed|task_failed)"/u.test(line)) return null;
  try {
    const entry = JSON.parse(line);
    if (entry?.type !== "event_msg") return null;
    const type = entry.payload?.type;
    if (terminal.has(type)) return { state: "idle" };
    const started = Date.parse(entry.timestamp);
    if (type === "task_complete" && Number.isFinite(started)) return { state: "completed", completed: started };
    return type === "task_started" && Number.isFinite(started) ? { state: "running", started } : null;
  } catch { return null; }
}

async function lastEvent(handle, size, floor) {
  // Find newline-delimited records in reverse. An oversized ordinary record
  // is discarded without keeping its body. Skip the trailing partial write.
  let end = size, suffix = "", partial = true, overflow = false;
  while (end > floor) {
    const start = Math.max(floor, end - CHUNK);
    const bytes = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    const chunks = bytes.subarray(0, bytesRead).toString("utf8").split("\n");
    for (let i = chunks.length - 1; i >= 1; i--) {
      if (partial) { partial = false; suffix = ""; overflow = false; continue; }
      if (!overflow) {
        const result = lifecycle(chunks[i] + suffix);
        if (result) return result;
      }
      suffix = "";
      overflow = false;
    }
    if (chunks.length > 1 || !overflow) {
      suffix = chunks[0] + suffix;
      if (suffix.length > CHUNK) { suffix = ""; overflow = true; }
    }
    end = start;
  }
  if (!floor && !partial && !overflow) return lifecycle(suffix);
  return null;
}

const activityTitle = row => [row.name, row.title].find(s => typeof s === "string" && s.trim())?.trim().slice(0, 160) || "未命名对话";

export function createCodexHallActivity({ codexHome, codexStatePath, clock = Date.now } = {}) {
  const cache = new Map();
  let pending, lastRead, readAt = -Infinity;

  async function read() {
    const now = clock();
    let db;
    try {
      const files = (await readdir(codexHome)).filter(name => /^state_\d+\.sqlite$/u.test(name))
        .sort((a,b) => Number(b.match(/\d+/u)[0]) - Number(a.match(/\d+/u)[0]));
      if (!files.length) return null;
      db = new DatabaseSync(path.join(codexHome, files[0]), { readOnly: true, timeout: 200 });
      const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map(row => row.name));
      if (!["id", "title", "rollout_path", "archived", "source", "originator", "updated_at"].every(key => columns.has(key))) return null;
      const updated = columns.has("updated_at_ms") ? "coalesce(updated_at_ms, updated_at * 1000)" : "updated_at * 1000";
      const optional = ["name", "project_id", "thread_source", "attached_thread_parent_id"].filter(key => columns.has(key));
      const rows = db.prepare(`SELECT id,title,rollout_path${optional.length ? "," + optional.join(",") : ""}
        FROM threads WHERE archived=0 AND source='vscode' AND originator='Codex Desktop' AND ${updated}>=?
        ORDER BY ${updated} DESC LIMIT ?`).all(now-FRESH_MS, MAX_CANDIDATES);
      db.close(); db = undefined;
      const root = await realpath(path.join(codexHome, "sessions")).catch(() => null);
      if (!root) return { live: [], completed: [] };
      const live = [], completed = [];
      for (const row of rows) {
        if (!THREAD_ID_PATTERN.test(row.id) || row.attached_thread_parent_id ||
            (row.thread_source && row.thread_source !== "user") || typeof row.rollout_path !== "string") continue;
        try {
          const resolved = await realpath(row.rollout_path);
          const relative = path.relative(root, resolved);
          if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
              !path.basename(resolved).endsWith("-" + row.id + ".jsonl")) continue;
          const handle = await open(resolved, "r");
          try {
            const s = await handle.stat();
            if (!s.isFile() || s.mtimeMs < now - FRESH_MS) continue;
            const old = cache.get(row.id);
            const same = old?.path === resolved && old.inode === s.ino && s.size >= old.size;
            const unchanged = same && old.size === s.size && old.mtime === s.mtimeMs;
            const incremental = same && s.size > old.size && s.size - old.size < COLD_LIMIT && old.event;
            const floor = incremental ? Math.max(0, old.size - CHUNK) : Math.max(0, s.size - COLD_LIMIT);
            const event = unchanged ? old.event : await lastEvent(handle, s.size, floor) ?? (incremental ? old.event : null);
            cache.set(row.id, {path:resolved,inode:s.ino,size:s.size,mtime:s.mtimeMs,event});
            if (event?.state === "running" && event.started <= now + 60_000) {
              live.push({threadId:row.id,title:activityTitle(row),startedAt:new Date(event.started).toISOString(),
                updatedAt:new Date(s.mtimeMs).toISOString(), projectId:row.project_id || ""});
            } else if (event?.state === "completed" && event.completed >= now - 10 * 60_000 && event.completed <= now + 30_000) {
              completed.push({threadId:row.id, at:event.completed, projectId:row.project_id || ""});
            }
          } finally { await handle.close(); }
        } catch { cache.delete(row.id); }
      }
      const current = new Set(rows.map(row => row.id));
      for (const key of cache.keys()) if (!current.has(key)) cache.delete(key);
      return { live, completed };
    } catch { return null; }
    finally { db?.close(); }
  }

  return async (projectId) => {
    if (!pending && clock() - readAt >= 1250) {
      pending = read().then(value => { lastRead = value; readAt = clock(); }).finally(() => { pending = null; });
    }
    await pending;
    if (!lastRead) return UNAVAILABLE;
    if (projectId && !lastRead.live.length && !lastRead.completed.length) return empty();
    let assignments = {};
    if (projectId) {
      try {
        assignments = JSON.parse(await readFile(codexStatePath, "utf8"))["thread-project-assignments"] || {};
      } catch { /* An explicit SQLite project ID may still be available. */ }
    }
    const inScope = ({threadId,projectId:localId}) => {
      if (!projectId) return true;
      const assignment = Object.hasOwn(assignments, threadId) ? assignments[threadId] : null;
      if (assignment?.projectId) return assignment.projectKind === "local" && assignment.projectId === projectId;
      return localId === projectId;
    };
    const completedAt = lastRead.completed.filter(inScope).reduce((latest, item) => Math.max(latest,item.at), 0);
    return { available: true, items: lastRead.live.filter(inScope).map(({projectId:_,...item}) => item),
      ...(completedAt ? { lastCompletedAt: new Date(completedAt).toISOString() } : {}) };
  };
}
