import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const THREAD_ID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function latestMessageTime(lines) {
  let latest = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const payload = entry.payload;
      const message = entry.type === "event_msg" && ["user_message", "agent_message"].includes(payload?.type)
        || entry.type === "response_item" && payload?.type === "message"
          && ["user", "assistant"].includes(payload.role) && payload.channel !== "analysis";
      if (!message || typeof entry.timestamp !== "string") continue;
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
    } catch { /* A partial JSONL write is not a new message. */ }
  }
  return latest;
}

// Read metadata for exact IDs only. Never scan all histories or retain message bodies.
export function createThreadActivityReader({ codexHome, maxTailBytes = 2 * 1024 * 1024, maxEntries = 1024 }) {
  const cache = new Map();
  let pending = Promise.resolve();

  async function readFileTime(threadId, filePath) {
    const resolved = await realpath(filePath);
    const root = await realpath(codexHome);
    const relative = path.relative(root, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)
      || !["sessions", "archived_sessions"].includes(relative.split(path.sep)[0])
      || !path.basename(resolved).endsWith(`-${threadId}.jsonl`)) return null;
    const handle = await open(resolved, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return null;
      const previous = cache.get(threadId);
      const sameFile = previous?.path === resolved && previous?.inode === stat.ino;
      if (sameFile && previous.size === stat.size && previous.mtime === stat.mtimeMs) return previous.timestamp;
      const prior = sameFile && stat.size > previous.size ? Date.parse(previous.timestamp || "") || 0 : 0;
      let cursor = stat.size;
      let suffix = "";
      let latest = 0;
      let lastChunk = true;
      // Cold reads walk backwards to the most recent message, even when a long
      // tool run follows it. Warm reads inspect only appended bytes. Each chunk
      // and partial record is bounded; no history or message body is retained.
      const floor = prior ? Math.max(0, previous.size - maxTailBytes) : 0;
      while (cursor > floor && !latest) {
        const length = Math.min(cursor - floor, maxTailBytes);
        cursor -= length;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, cursor);
        let text = buffer.subarray(0, bytesRead).toString("utf8") + suffix;
        if (lastChunk) {
          const end = text.lastIndexOf("\n");
          if (end < 0) continue;
          text = text.slice(0, end);
          lastChunk = false;
        }
        const first = cursor > 0 ? text.indexOf("\n") : -1;
        suffix = cursor > 0 ? (first >= 0 ? text.slice(0, first) : text).slice(0, maxTailBytes) : "";
        latest = latestMessageTime((cursor > 0 ? (first >= 0 ? text.slice(first + 1) : "") : text).split("\n"));
      }
      const time = Math.max(latest, prior);
      const timestamp = time ? new Date(time).toISOString() : null;
      cache.delete(threadId);
      cache.set(threadId, { path: resolved, inode: stat.ino, size: stat.size, mtime: stat.mtimeMs, timestamp });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return timestamp;
    } finally { await handle.close(); }
  }

  async function read(threadIds) {
    const byThread = Object.fromEntries(threadIds.map((id) => [id, null]));
    let database;
    try {
      const names = (await readdir(codexHome)).filter((name) => /^state_\d+\.sqlite$/.test(name))
        .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (!names.length) return { available: false, byThread };
      database = new DatabaseSync(path.join(codexHome, names[0]), { readOnly: true });
      const query = database.prepare("SELECT rollout_path FROM threads WHERE id = ?");
      const files = threadIds.map((id) => [id, query.get(id)?.rollout_path]);
      database.close(); database = null;
      for (const [id, file] of files) {
        if (typeof file !== "string") { cache.delete(id); continue; }
        try { byThread[id] = await readFileTime(id, file); } catch { cache.delete(id); }
      }
      return { available: true, byThread };
    } catch { return { available: false, byThread }; }
    finally { database?.close(); }
  }

  return (ids) => {
    const threadIds = [...new Set(ids.filter((id) => typeof id === "string" && THREAD_ID_PATTERN.test(id)).map((id) => id.toLowerCase()))];
    // Windows/macOS and multiple open boards share one bounded read queue.
    const result = pending.then(() => read(threadIds));
    pending = result.catch(() => {});
    return result;
  };
}
