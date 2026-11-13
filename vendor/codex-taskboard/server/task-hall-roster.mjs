import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const unknown = { usageCount: null, usageBasis: "unknown" };
const count = usageCount => ({ usageCount, usageBasis: "sessions" });
const maxFiles = 10_000;

async function countQuery(file, sql) {
  let db;
  try {
    if (!(await lstat(file)).isFile()) return null;
    db = new DatabaseSync(file, { readOnly: true, timeout: 250 });
    const value = Number(db.prepare(sql).get()?.n);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
  finally { db?.close(); }
}

async function countEntries(root, match, maxDepth = 6) {
  const unique = new Set();
  let entriesSeen = 0, foundRoot = false;
  async function walk(directory, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      if (!(await lstat(directory)).isDirectory()) return;
      entries = await readdir(directory, { withFileTypes: true });
      if (!depth) foundRoot = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    for (const entry of entries) {
      if (++entriesSeen > maxFiles) throw Error("session limit");
      if (entry.isSymbolicLink() || /^(?:subagents?|debug|file-history|logs)$/iu.test(entry.name)) continue;
      const full = path.join(directory,entry.name);
      if (match(entry, depth)) { unique.add(entry.name); continue; }
      if (entry.isDirectory()) await walk(full,depth+1);
    }
  }
  try { await walk(root,0);return foundRoot ? unique.size : null; }
  catch { return null; }
}

async function sessionCount(profile, env, home) {
  const { id, root } = profile;
  if (id === "codex") {
    const files = (await readdir(root)).filter(x => /^state_\d+\.sqlite$/u.test(x))
      .sort((a,b) => Number(b.match(/\d+/u)[0]) - Number(a.match(/\d+/u)[0]));
    return files.length ? countQuery(path.join(root,files[0]),
      "SELECT count(*) AS n FROM threads WHERE thread_source='user' AND archived=0 AND attached_thread_parent_id IS NULL AND source IN ('vscode','cli')") : null;
  }
  if (id === "hermes") return countQuery(path.join(root,"state.db"),"SELECT count(*) AS n FROM sessions");
  if (id === "kimi-work") {
    const dir = profile.presenceRoots?.find(item=>path.basename(item)==="daimon");
    return dir ? countQuery(path.join(dir,"agents/main/sessions/hosted-logical/conversations.sqlite"),
      "SELECT count(DISTINCT conversation_id) AS n FROM conversations") : null;
  }
  if (id === "dsh") return countEntries(path.join(env.DSH_HOME || path.join(home,".dsh"),"sessions"),
    (e,depth)=>depth===1 && e.isDirectory() && /^session-[a-f\d-]{36}$/iu.test(e.name), 1);
  const locations = {
    "claude-code": path.join(env.CLAUDE_CONFIG_DIR || root,"projects"),
    workbuddy:path.join(root,"projects"),codebuddy:path.join(root,"projects"),
    "kimi-code":path.join(root,"sessions"),openclaw:path.join(root,"agents"),
  };
  if (id === "openclaw") {
    // Native OpenClaw sessions sit below each agent's sessions/ directory,
    // while agent workspaces may contain unrelated JSONL.
    const agents = await readdir(locations[id], { withFileTypes:true });
    if (agents.length > 128) return null;
    let total=0, seen=false;
    for (const entry of agents.filter(e=>e.isDirectory())) {
      const n = await countEntries(path.join(locations[id],entry.name,"sessions"),
        e=>e.isFile() && /^[a-f\d-]{36}\.jsonl$/iu.test(e.name),0);
      if (n !== null) { seen=true;total+=n; }
    }
    return seen ? total : null;
  }
  if (!Object.hasOwn(locations,id)) return null;
  return countEntries(locations[id], e=>e.isFile() && /\.jsonl$/iu.test(e.name) && !/^(?:agent-|request_dump)/iu.test(e.name));
}

/** Metadata-only discovery; no provider login, agent invocation or transcript reads. */
export function createHallRoster({ discovery, profiles, home=homedir(), env=process.env, clock=Date.now,
    ttlMs=30_000, readUsage=sessionCount } = {}) {
  let cached, pending, lastScan=-Infinity;
  return async function roster() {
    if (cached && clock()-lastScan < ttlMs) return cached;
    if (!pending) pending=(async()=>{
      try {
        const [scan, rows] = await Promise.all([discovery.scan(), profiles(home,env)]);
        if (!scan?.results || !Array.isArray(rows)) throw Error("discovery unavailable");
        const items = await Promise.all(rows.filter(p=>scan.results[p.id]?.installed===true).map(async p=>{
          const usage = await Promise.resolve().then(()=>readUsage(p,env,home)).catch(()=>null);
          return {id:p.id==="claude-code"?"claude":p.id,name:p.name,
            ...(Number.isSafeInteger(usage) && usage>=0 ? count(usage) : unknown)};
        }));
        cached={available:true,items};
      } catch { cached={available:false,items:[]}; }
      lastScan=clock();
      return cached;
    })().finally(()=>{pending=null;});
    return pending;
  };
}
