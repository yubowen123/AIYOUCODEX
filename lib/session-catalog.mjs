import { access } from "node:fs/promises";
import path from "node:path";

// Read metadata only, including the live WAL. Never repair/write the host DB.
// Older Codex/Node installations continue using the JSONL index fallback.
export async function readSessionCatalog(codexHome) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  let db;
  try {
    await access(dbPath);
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 250 });
    const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map(row => row.name));
    if (!["id", "title", "updated_at"].every(name => columns.has(name))) return null;
    const fields = ["id", "title", "updated_at", "name", "updated_at_ms", "recency_at", "recency_at_ms",
      "cwd", "rollout_path", "archived", "source", "project_id"].filter(name => columns.has(name));
    return db.prepare(`SELECT ${fields.join(",")} FROM threads`).all().map(row => ({
      threadId: String(row.id || "").toLowerCase(),
      title: String(row.name || "").trim(), fallbackTitle: String(row.title || "").trim(),
      updatedAtMs: Number(row.recency_at_ms) || Number(row.recency_at) * 1000
        || Number(row.updated_at_ms) || Number(row.updated_at) * 1000 || 0,
      cwd: row.cwd || "", rolloutPath: row.rollout_path || "", projectId: row.project_id || "",
      excluded: Boolean(row.archived) || String(row.source || "").includes('"subagent"'),
    }));
  } catch {
    return null;
  } finally { db?.close(); }
}
