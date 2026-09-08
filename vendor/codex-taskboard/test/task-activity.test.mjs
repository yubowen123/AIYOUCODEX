import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compareTaskActivity, taskActivity, taskActivityLabel } from "../shared/task-activity.mjs";
import { createThreadActivityReader, latestMessageTime } from "../server/thread-activity.mjs";
import { createTaskboardServer } from "../server/index.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const missing = "22222222-2222-4222-8222-222222222222";
const old = "2026-08-01T10:00:00.000Z";
const recent = "2026-09-08T01:00:00.000Z";
const newer = "2026-09-08T02:00:00.000Z";
const record = (timestamp, type = "agent_message") => JSON.stringify({ timestamp, type: "event_msg", payload: { type, message: "fixture private message" } });

test("latest real message wins over manual order and property edits; fallback is explicit and stable", () => {
  const items = [
    { id: "old", threadId: missing, createdAt: old, updatedAt: newer, sortOrder: 1 },
    { id: "chat", threadId: id, createdAt: old, sortOrder: 90 },
    { id: "comment", createdAt: old, lastCommentAt: newer, sortOrder: 100 },
  ];
  const activity = { [id]: recent };
  assert.deepEqual([...items].sort((a, b) => compareTaskActivity(a, b, activity)).map((item) => item.id), ["comment", "chat", "old"]);
  assert.equal(taskActivity(items[1], activity).source, "conversation");
  assert.equal(taskActivity({ ...items[1], lastCommentAt: newer }, activity).source, "comment");
  assert.equal(taskActivity({ ...items[0], lastCommentAt: "bad" }).timestamp, old);
  assert.match(taskActivityLabel(items[0]), /创建时间（暂无消息）/);
  assert.equal(taskActivityLabel({ id: "unknown" }), "消息时间未知");
  assert.deepEqual([{ id: "b" }, { id: "a" }].sort(compareTaskActivity).map((item) => item.id), ["a", "b"]);
  assert.equal(items[0].id, "old", "sorting does not mutate the source catalog");
});

test("tools, analysis, token reports and lifecycle timestamps are not user-facing messages", () => {
  const lines = [record(old, "user_message"), record(recent), record(newer, "token_count"), record(newer, "task_complete"),
    JSON.stringify({ timestamp: newer, type: "response_item", payload: { type: "message", role: "assistant", channel: "analysis" } }), "{partial"];
  assert.equal(new Date(latestMessageTime(lines)).toISOString(), recent);
  lines.push(JSON.stringify({ timestamp: newer, type: "response_item", payload: { type: "message", role: "assistant", channel: "final" } }));
  assert.equal(new Date(latestMessageTime(lines)).toISOString(), newer);
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "task-activity-"));
  const home = path.join(directory, "codex");
  await mkdir(path.join(home, "sessions"), { recursive: true });
  const file = path.join(home, "sessions", `rollout-${id}.jsonl`);
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, updated_at INTEGER)");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?)").run(id, file, Date.now());
  db.close();
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, home, file };
}

test("bounded metadata reader handles cold tool-heavy tails, appends, partial writes, truncation and missing IDs", async (t) => {
  const { home, file } = await fixture(t);
  await writeFile(file, `${record(old)}\n${Array(30).fill(record(newer, "token_count")).join("\n")}\n`);
  const read = createThreadActivityReader({ codexHome: home, maxTailBytes: 512, maxEntries: 2 });
  assert.deepEqual(await read([id, missing]), { available: true, byThread: { [id]: old, [missing]: null } });
  assert.equal((await read([id])).byThread[id], old, "unchanged file cache agrees");
  await appendFile(file, record(recent));
  assert.equal((await read([id])).byThread[id], old, "unterminated final line does not advance recency");
  await appendFile(file, "\n");
  assert.equal((await read([id])).byThread[id], recent);
  await appendFile(file, `${record(newer)}\n`);
  assert.equal((await read([id.toUpperCase()])).byThread[id], newer);
  await writeFile(file, `${record(old)}\n`);
  assert.equal((await read([id])).byThread[id], old, "truncation invalidates cached latest timestamp");
  await rm(file);
  assert.equal((await read([id])).byThread[id], null);
});

test("local endpoint returns only exact-ID timestamps, rejects paths and exposes latest comment metadata", async (t) => {
  const { directory, home, file } = await fixture(t);
  await writeFile(file, `${record(recent)}\n`);
  const app = createTaskboardServer({ dataDirectory: path.join(directory, "board"), codexStatePath: path.join(home, ".codex-global-state.json") });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());
  const url = `http://127.0.0.1:${address.port}`;
  async function post(route, body) {
    return fetch(url + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  const response = await post("/api/local/thread-activity", { threadIds: [id] });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { available: true, byThread: { [id]: recent } });
  assert.doesNotMatch(text, /fixture private|rollout|sessions/);
  for (const body of [{ threadIds: [file] }, { threadIds: [id], path: file }, { threadIds: Array(501).fill(id) }]) {
    assert.equal((await post("/api/local/thread-activity", body)).status, 400);
  }
  assert.equal((await fetch(url + "/api/local/thread-activity")).status, 405);
  assert.equal((await post("/api/local/thread-activity?path=x", { threadIds: [] })).status, 400);
  const taskResponse = await post("/api/tasks", { projectId: "local", title: "Fixture", threadId: id });
  assert.equal(taskResponse.status, 201);
  const { task } = await taskResponse.json();
  assert.equal(task.lastCommentAt, null);
  const commentResponse = await post(`/api/tasks/${task.id}/comments`, { body: "Fixture comment", threadId: id });
  assert.equal(commentResponse.status, 201);
  const { comment } = await commentResponse.json();
  const list = await (await fetch(url + "/api/tasks?projectId=local")).json();
  assert.equal(list.tasks[0].lastCommentAt, comment.createdAt);
  assert.equal(app.database.getTask(task.id).lastCommentAt, comment.createdAt);
});
