import { access, open, stat } from "node:fs/promises";
import path from "node:path";

const provenanceCache = new Map();
const npcWorkspace = cwd => /(?:^|[\\/])\.private-world[\\/](?:sqlite|postgres)[\\/]npc-workspaces[\\/][^\\/]+(?:[\\/]|$)/u.test(String(cwd || ""));

function agentSource(source) {
  if (typeof source === "string") {
    if (/^sub_?agent$/i.test(source)) return true;
    try { source = JSON.parse(source); } catch { return false; }
  }
  return !!source && typeof source === "object" && Object.keys(source).some(key => /^sub_?agent$/i.test(key));
}

// Only the generator's metadata establishes provenance; prompt/title similarity
// must never hide a user chat. Read the bounded header, never the conversation.
export async function isGeneratedNpcSession(codexHome, thread) {
  if (!npcWorkspace(thread.cwd) || thread.forkedFromId) return false;
  if (thread.originator) return thread.originator === "interactive_agent_studio";
  const filePath = path.resolve(thread.rolloutPath || ".");
  if (!filePath.startsWith(`${path.resolve(codexHome, "sessions")}${path.sep}`) || !filePath.endsWith(".jsonl")) return false;
  let handle;
  try {
    const info = await stat(filePath);
    const key = `${filePath}:${info.size}:${info.mtimeMs}`;
    let metadata = provenanceCache.get(key);
    if (!metadata) {
      handle = await open(filePath, "r");
      const buffer = Buffer.alloc(128 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const first = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]);
      metadata = first?.type === "session_meta" ? first.payload || {} : {};
      // Cache metadata fields only, not prompts or session contents.
      metadata = { id: metadata.id, cwd: metadata.cwd, originator: metadata.originator, forkedFromId: metadata.forked_from_id || metadata.forkedFromId };
      if (provenanceCache.size >= 1024) provenanceCache.delete(provenanceCache.keys().next().value);
      provenanceCache.set(key, metadata);
    }
    return String(metadata.id || "").toLowerCase() === thread.threadId
      && metadata.originator === "interactive_agent_studio" && npcWorkspace(metadata.cwd) && !metadata.forkedFromId;
  } catch { return false; }
  finally { await handle?.close().catch(() => {}); }
}

// Read metadata only, including the live WAL. Never repair/write the host DB.
// Older Codex/Node installations continue using the JSONL index fallback.
export async function readSessionCatalog(codexHome) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  let db;
  let rows;
  try {
    await access(dbPath);
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 250 });
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map(row => row.name));
    if (!["id", "title", "updated_at"].every(name => columns.has(name))) return null;
    const fields = ["id", "title", "updated_at", "name", "updated_at_ms", "recency_at", "recency_at_ms",
      "cwd", "rollout_path", "archived", "source", "thread_source", "originator", "forked_from_id", "project_id"].filter(name => columns.has(name));
    rows = db.prepare(`SELECT ${fields.join(",")} FROM threads`).all().map(row => ({
      threadId: String(row.id || "").toLowerCase(),
      title: String(row.name || "").trim(), fallbackTitle: String(row.title || "").trim(),
      updatedAtMs: Number(row.recency_at_ms) || Number(row.recency_at) * 1000
        || Number(row.updated_at_ms) || Number(row.updated_at) * 1000 || 0,
      cwd: row.cwd || "", rolloutPath: row.rollout_path || "", projectId: row.project_id || "",
      originator: row.originator || "", forkedFromId: row.forked_from_id || "",
      isSubagent: agentSource(row.source) || agentSource(row.thread_source),
      excluded: Boolean(row.archived) || agentSource(row.source) || agentSource(row.thread_source),
    }));
  } catch {
    return null;
  } finally { db?.close(); }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(16, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row.isSubagent && await isGeneratedNpcSession(codexHome, row)) row.excluded = row.isSubagent = true;
    }
  }));
  return rows;
}
