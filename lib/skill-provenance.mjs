import path from "node:path";
import { open, stat, realpath } from "node:fs/promises";
import { managedShortcutsPath } from "./managed-shortcuts.mjs";
import { readEfficiencyJson, writeEfficiencyJson, withEfficiencyFileLock } from "./efficiency-store.mjs";

const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const normalize = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : process.platform === "darwin" ? value.normalize("NFC") : value;
const empty = () => ({ schemaVersion: 2, roots: [], files: {} });

// Accept only actual patch invocations and their paired successful tool result.
// In particular, mentions, reads, assistant claims, shell examples and failed
// patches are not provenance. Never evaluate JavaScript found in a rollout.
export function skillPatchInvocation(payload) {
  let patch, wrapped = false;
  if (/^(?:functions\.)?apply_patch$/.test(payload?.name || "")) {
    patch = payload.input;
    if (!patch && payload.arguments) {
      try { const args = JSON.parse(payload.arguments); patch = args.patch || args.input; } catch {}
    }
  } else if (/^(?:functions\.)?exec$/.test(payload?.name || "")) {
    const input = payload.input || payload.arguments || "";
    // A first, unconditional awaited call with a JSON string literal. Other
    // wrapper shapes stay unknown rather than attributing speculative writes.
    const match = input.match(/^\s*(?:\/\/ @exec:[^\n]*\n)?\s*(?:text\(\s*)?await tools\.apply_patch\(("(?:[^"\\]|\\.)*")\)\s*\)?\s*;/u);
    if (!match || (input.match(/tools\.apply_patch\(/gu) || []).length !== 1) return null;
    try { patch = JSON.parse(match[1]); wrapped = true; } catch { return null; }
  }
  if (typeof patch !== "string" || !patch.startsWith("*** Begin Patch") || !patch.trimEnd().endsWith("*** End Patch")) return null;
  const changes = [];
  for (const line of patch.split(/\r?\n/u)) {
    const match = line.match(/^\*\*\* (Add File|Update File|Move to): (.+)$/u);
    if (match) changes.push({ file: match[2], kind: match[1] === "Add File" ? "created" : "updated" });
  }
  return changes.length ? { changes, wrapped } : null;
}

function successfulResult(payload, wrapped) {
  const raw = payload.output;
  const parts = Array.isArray(raw) ? raw.map((part) => part?.text || "") : [typeof raw === "string" ? raw : JSON.stringify(raw ?? "")];
  if (parts.some((text) => /Failed to find expected|patch rejected|Error:|isError"\s*:\s*true/u.test(text))) return false;
  if (wrapped) return /^Script completed\b/u.test(parts[0]) && parts[1]?.trim() === "{}";
  return parts.some((text) => /Success\. Updated the following files:/u.test(text));
}

export function createSkillProvenanceIndex({ listSessions, filePath = path.join(path.dirname(managedShortcutsPath()), "skills", "provenance.json"),
  byteBudget = 32 * 1024 * 1024, timeBudgetMs = 500, maxLineBytes = 2 * 1024 * 1024 } = {}) {
  let sessionSnapshot = null, sessionSnapshotAt = 0;
  async function trace(skill, catalog) {
    return withEfficiencyFileLock(filePath, async () => {
      const roots = catalog.map((entry) => ({ id: entry.id, root: normalize(path.dirname(entry.skillFile)) })).sort((a, b) => b.root.length - a.root.length);
      let state = await readEfficiencyJson(filePath, empty());
      if (state.schemaVersion !== 2 || !state.files || !Array.isArray(state.roots)) state = empty();
      // Catalog/workspace switches must not invalidate a multi-GB history index.
      // Remember exact paths, not a name or the currently selected workspace.
      state.roots = [...new Set([...state.roots, ...roots.map((entry) => entry.root)])];
      if (!sessionSnapshot || Date.now() - sessionSnapshotAt > 5000) {
        sessionSnapshot = (await listSessions()).filter((entry) => uuid(entry.threadId)); sessionSnapshotAt = Date.now();
      }
      const sessions = sessionSnapshot;
      const live = new Set(sessions.map((entry) => entry.threadId));
      for (const id of Object.keys(state.files)) if (!live.has(id)) delete state.files[id];
      let budget = byteBudget, remaining = 0, checked = 0, unavailable = 0;
      const started = Date.now();
      for (const session of sessions) {
        let info;
        try { info = await stat(session.filePath); if (!info.isFile()) throw new Error(); } catch { unavailable += 1; continue; }
        let cursor = state.files[session.threadId];
        if (!cursor || cursor.identity !== `${info.dev}:${info.ino}` || info.size < cursor.offset
          || (info.size === cursor.size && info.mtimeMs !== cursor.mtime)) {
          cursor = state.files[session.threadId] = { identity: `${info.dev}:${info.ino}`, offset: 0, size: info.size, mtime: info.mtimeMs, cwd: "", verified: false, pending: {}, records: {}, skipped: 0 };
        }
        cursor.size = info.size; cursor.mtime = info.mtimeMs;
        if (cursor.offset < info.size && budget > 0 && Date.now() - started < timeBudgetMs) {
          const handle = await open(session.filePath, "r");
          try {
            while (cursor.offset < info.size && budget > 0 && Date.now() - started < timeBudgetMs) {
              const size = Math.min(maxLineBytes, info.size - cursor.offset);
              const buffer = Buffer.alloc(size);
              const { bytesRead } = await handle.read(buffer, 0, size, cursor.offset);
              if (!bytesRead) break;
              budget -= bytesRead;
              const last = buffer.subarray(0, bytesRead).lastIndexOf(10);
              if (last < 0) {
                // Keep an unfinished final line for the next append. A huge line
                // is skipped in bounded chunks; its absence is disclosed.
                if (bytesRead < maxLineBytes) break;
                cursor.offset += bytesRead; cursor.skipping = true; cursor.skipped += 1; continue;
              }
              let lines = buffer.subarray(0, last).toString("utf8").split("\n");
              if (cursor.skipping) { lines.shift(); cursor.skipping = false; }
              for (const line of lines) {
                if (!/"type"\s*:\s*"(?:session_meta|turn_context|custom_tool_call|function_call|custom_tool_call_output|function_call_output|patch_apply_end)"/u.test(line.slice(0, 400))) continue;
                let event;
                try { event = JSON.parse(line); } catch { continue; }
                await ingest(event, cursor, session.threadId, state.roots);
              }
              cursor.offset += last + 1;
            }
          } finally { await handle.close(); }
        }
        if (cursor.offset < info.size) remaining += 1;
        else checked += 1;
      }
      await writeEfficiencyJson(filePath, state);
      const coverageLimited = unavailable > 0 || Object.values(state.files).some((cursor) => cursor.skipped > 0);
      if (remaining) return { status: "indexing", checked, total: sessions.length, message: `正在建立本地追溯索引（${checked}/${sessions.length} 个对话），可继续其他操作；再次追溯会接着处理。` };
      const candidates = sessions.flatMap((session) => {
        const changes = Object.entries(state.files[session.threadId]?.records || {}).filter(([file]) => roots.find((entry) => file.startsWith(entry.root + "/"))?.id === skill.id);
        return changes.flatMap(([, records]) => [records.updated, records.created].filter(Boolean)).map((record) => ({ ...record, threadId: session.threadId, title: session.title }));
      }).sort((a, b) => b.timestamp - a.timestamp);
      // An update of an older incarnation must not override a later creation.
      const selected = candidates[0];
      if (!selected) return { status: "unassociated", message: "未找到可验证的创建或优化对话。仅使用、提及或外部安装的 Skill 不自动关联。", coverageLimited };
      return { status: "found", ...selected, coverageLimited,
        message: `${selected.kind === "updated" ? "最近可验证的优化" : "创建"}对话：${selected.title || "未命名对话"}${coverageLimited ? "（部分历史记录不可读取）" : ""}` };
    });
  }

  async function ingest(event, cursor, threadId, roots) {
    const payload = event.payload;
    if (event.type === "session_meta") { cursor.verified = payload?.id === threadId; cursor.cwd = payload?.cwd || ""; return; }
    if (!cursor.verified) return;
    if (event.type === "turn_context" && path.isAbsolute(payload?.cwd || "")) { cursor.cwd = payload.cwd; return; }
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp)) return;
    const record = async (changes) => {
      for (const change of changes) {
        if (!path.isAbsolute(change.file) && !path.isAbsolute(cursor.cwd)) continue;
        let file = path.resolve(cursor.cwd || ".", change.file);
        try { file = await realpath(file); } catch {}
        const canonical = normalize(file);
        if (path.basename(file) === "SKILL.md") {
          const root = normalize(path.dirname(file)); if (!roots.includes(root)) roots.push(root);
        }
        if (!roots.some((root) => canonical.startsWith(root + "/"))) continue;
        const kind = change.kind === "created" && path.basename(file) === "SKILL.md" ? "created" : "updated";
        const slot = cursor.records[canonical] ||= {};
        const previous = slot[kind];
        if (!previous || timestamp > previous.timestamp) slot[kind] = { kind, timestamp, file };
      }
    };
    if (event.type === "event_msg" && payload?.type === "patch_apply_end" && payload.success === true && payload.changes) {
      const changes = Object.entries(payload.changes).flatMap(([file, change]) => {
        const kind = String(change?.type || "").toLowerCase();
        return ["add", "update"].includes(kind) ? [{ file: change.move_path || file, kind: kind === "add" ? "created" : "updated" }] : [];
      });
      await record(changes); return;
    }
    if (event.type !== "response_item") return;
    if (["custom_tool_call", "function_call"].includes(payload?.type)) {
      const call = skillPatchInvocation(payload);
      if (call && typeof payload.call_id === "string" && /^[a-zA-Z0-9_-]{1,160}$/u.test(payload.call_id) && !["__proto__", "constructor", "prototype"].includes(payload.call_id)) {
        // Keep only paths and action kinds, never the patch or chat text.
        cursor.pending[payload.call_id] = { ...call, cwd: cursor.cwd };
        const keys = Object.keys(cursor.pending); if (keys.length > 100) delete cursor.pending[keys[0]];
      }
    } else if (["custom_tool_call_output", "function_call_output"].includes(payload?.type)) {
      const call = Object.hasOwn(cursor.pending, payload.call_id) ? cursor.pending[payload.call_id] : null; delete cursor.pending[payload.call_id];
      if (call && successfulResult(payload, call.wrapped)) {
        const current = cursor.cwd; cursor.cwd = call.cwd;
        await record(call.changes); cursor.cwd = current;
      }
    }
  }
  return { trace, filePath };
}
