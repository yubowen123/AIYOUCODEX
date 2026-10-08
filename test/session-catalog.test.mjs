import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PreviewRepository } from "../lib/preview-data.mjs";

test("live WAL catalog updates without JSONL changes, includes new chats, excludes archived and agents", async t => {
  const home = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), "aiyou-live-catalog-"));
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  t.after(async () => { db.close(); await rm(home, { recursive: true, force: true }); });
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,name TEXT,updated_at INTEGER,recency_at_ms INTEGER,cwd TEXT,archived INTEGER,source TEXT)");
  const ids = Array.from({ length: 4 }, (_, i) => `11111111-1111-4111-8111-11111111111${i}`);
  const insert = db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)");
  const at = Date.parse("2026-10-08T10:00:00Z");
  insert.run(ids[0], "original input", "Current name", at / 1000, at, "/project", 0, "vscode");
  insert.run(ids[1], "archived", "Archived", at / 1000, at, "/project", 1, "vscode");
  insert.run(ids[2], "agent", "Agent", at / 1000, at, "/project", 0, '{"subagent":{}}');
  await writeFile(path.join(home, "session_index.jsonl"), ids.slice(0, 3).map(id => JSON.stringify({ id, thread_name: "Stale name", updated_at: "2026-01-01T00:00:00Z" })).join("\n"));
  await writeFile(path.join(home, ".codex-global-state.json"), JSON.stringify({ "local-projects": { p: { name: "Project", rootPaths: ["/project"] } } }));
  const repository = new PreviewRepository({ codexHome: home });
  const first = await repository.readRecentCatalog();
  assert.deepEqual(first.map(e => e.threadId), [ids[0]]);
  assert.equal(first[0].title, "Current name");
  assert.equal(first[0].projectId, "p");
  insert.run(ids[3], "new input", "New conversation", at / 1000 + 60, at + 60_000, "/project", 0, "vscode");
  assert.deepEqual((await repository.readRecentCatalog()).map(e => e.threadId), [ids[3], ids[0]]);
  db.prepare("UPDATE threads SET recency_at_ms=? WHERE id=?").run(at + 120_000, ids[0]);
  assert.deepEqual((await repository.readRecentCatalog()).map(e => e.threadId), [ids[0], ids[3]]);
  db.prepare("UPDATE threads SET archived=1 WHERE id=?").run(ids[0]);
  assert.deepEqual((await repository.readRecentCatalog()).map(e => e.threadId), [ids[3]]);
});

test("older SQLite schema and missing JSONL index still deliver current thread metadata", async t => {
  const home = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), "aiyou-old-catalog-"));
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  t.after(async () => { db.close(); await rm(home, { recursive: true, force: true }); });
  db.exec("CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER)");
  db.prepare("INSERT INTO threads VALUES(?,?,?)").run("11111111-1111-4111-8111-111111111111", "New conversation", 1791453600);
  const entries = await new PreviewRepository({ codexHome: home }).readRecentCatalog();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "New conversation");
  assert.equal(entries[0].updatedAt, new Date(1791453600 * 1000).toISOString());
});

test("touching a live rollout does not change conversation time; new assistant activity still does", async t => {
  const home = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), "aiyou-activity-catalog-"));
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  t.after(async () => { db.close(); await rm(home, { recursive: true, force: true }); });
  const id = "11111111-1111-4111-8111-111111111111";
  const sessions = path.join(home, "sessions");
  await mkdir(sessions);
  const rollout = path.join(sessions, `rollout-${id}.jsonl`);
  const at = Date.parse("2026-10-08T10:00:00Z");
  db.exec("CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER,recency_at_ms INTEGER,rollout_path TEXT)");
  db.prepare("INSERT INTO threads VALUES(?,?,?,?,?)").run(id, "Conversation", at / 1000, at, rollout);
  await writeFile(rollout, JSON.stringify({ timestamp: new Date(at).toISOString(), type: "event_msg", payload: { type: "user_message", message: "Real request" } }) + "\n");
  await utimes(rollout, new Date("2030-01-01"), new Date("2030-01-01"));
  const repository = new PreviewRepository({ codexHome: home });
  assert.equal((await repository.readRecentCatalog())[0].updatedAt, new Date(at).toISOString());
  await appendFile(rollout, JSON.stringify({ timestamp: new Date(at + 60_000).toISOString(), type: "event_msg", payload: { type: "agent_message", message: "Real reply" } }) + "\n");
  assert.equal((await repository.readRecentCatalog())[0].updatedAt, new Date(at + 60_000).toISOString());
});
