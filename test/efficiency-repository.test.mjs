import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreviewRepository } from "../lib/preview-data.mjs";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-09-06T12:00:00Z";
const token = (counters) => JSON.stringify({ timestamp: NOW, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: counters } } });
const indexRow = (id, title = "同名任务") => JSON.stringify({ id, thread_name: title, updated_at: NOW });
const meta = (id, cwd) => JSON.stringify({ type: "session_meta", payload: { id, cwd } });
const message = (id, role, text) => JSON.stringify({ timestamp: NOW, type: "response_item", payload: {
  id, type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }],
} });

async function fixture(t) {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-efficiency-repository-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const sessions = path.join(codexHome, "sessions", "2026", "09", "06");
  await mkdir(sessions, { recursive: true });
  return {
    codexHome, index: path.join(codexHome, "session_index.jsonl"),
    file: (id) => path.join(sessions, "rollout-" + id + ".jsonl"),
  };
}

test("efficiency thread resolution uses exact local identity and authoritative session metadata", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, [indexRow(FIRST), indexRow(SECOND)].join("\n"));
  await writeFile(f.file(FIRST), [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", cwd: "/not-authoritative" } }),
    meta(FIRST, "/work/first"),
  ].join("\n"));
  await writeFile(f.file(SECOND), meta(SECOND, "C:\\Projects\\Second"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.deepEqual(await repository.resolveEfficiencyThread("local:" + FIRST.toUpperCase()), { threadId: FIRST, projectPath: "/work/first", title: "同名任务" });
  assert.deepEqual(await repository.resolveEfficiencyThread(SECOND), { threadId: SECOND, projectPath: "C:\\Projects\\Second", title: "同名任务" });
  for (const id of ["同名任务", "local:client-new-thread:temporary", "cloud:" + FIRST, "prefix:" + FIRST, FIRST + "/suffix", MISSING, null]) {
    assert.equal(await repository.resolveEfficiencyThread(id), null, String(id));
  }
});

test("files without a local index entry and index entries without files are not efficiency targets", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(SECOND));
  await writeFile(f.file(FIRST), [meta(FIRST, "/work"), token({ total_tokens: 999 })].join("\n"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.equal(await repository.resolveEfficiencyThread(FIRST), null);
  assert.equal(await repository.resolveEfficiencyThread(SECOND), null);
  assert.equal(await repository.readTokenUsage(FIRST), null);
  assert.equal(await repository.readTokenUsage(SECOND), null);
});

test("missing thread refreshes once and discovers a newly indexed local session", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), meta(FIRST, "/first"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  await repository.ensureIndex();
  await appendFile(f.index, "\n" + indexRow(SECOND, "新任务"));
  await writeFile(f.file(SECOND), meta(SECOND, "/second"));
  let refreshes = 0;
  const refresh = repository.refreshIndex.bind(repository);
  repository.refreshIndex = async () => { refreshes += 1; return refresh(); };
  assert.deepEqual(await repository.resolveEfficiencyThread(SECOND), { threadId: SECOND, projectPath: "/second", title: "新任务" });
  assert.equal(refreshes, 1);
  assert.equal(await repository.resolveEfficiencyThread(MISSING), null);
  assert.equal(refreshes, 2);
});

test("unknown cwd never falls back to process directory, and a cached missing header retries once", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), JSON.stringify({ type: "event_msg", payload: { cwd: "/untrusted" } }));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.deepEqual(await repository.resolveEfficiencyThread(FIRST), { threadId: FIRST, projectPath: null, title: "同名任务" });
  await writeFile(f.file(FIRST), meta(FIRST, "/now-available"));
  assert.equal((await repository.resolveEfficiencyThread(FIRST)).projectPath, "/now-available");
});

test("session metadata with another thread id does not provide an efficiency workspace", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), meta(SECOND, "/other-thread"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.equal((await repository.resolveEfficiencyThread(FIRST)).projectPath, null);
});

test("readPreview caches actual token usage, readTokenUsage reuses it and invalidates on file update", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, [indexRow(FIRST), indexRow(SECOND)].join("\n"));
  await writeFile(f.file(FIRST), [meta(FIRST, "/first"), token({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })].join("\n") + "\n");
  await writeFile(f.file(SECOND), [meta(SECOND, "/second"), token({ total_tokens: 999 })].join("\n"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  await repository.readPreview(FIRST, "同名任务");
  const cached = repository.cache.get(FIRST);
  assert.equal(cached.tokenUsage.cumulative.totalTokens, 15);
  assert.strictEqual(await repository.readTokenUsage("local:" + FIRST), cached.tokenUsage);
  assert.strictEqual(repository.cache.get(FIRST), cached);
  assert.equal((await repository.readTokenUsage(SECOND)).cumulative.totalTokens, 999);
  assert.equal(await repository.readTokenUsage(MISSING), null);
  assert.equal(await repository.readTokenUsage("同名任务"), null);
  assert.equal(await repository.readTokenUsage("cloud:" + FIRST), null);
  await appendFile(f.file(FIRST), token({ input_tokens: 20, total_tokens: 30 }) + "\n");
  assert.equal((await repository.readTokenUsage(FIRST)).cumulative.totalTokens, 30);
  assert.notStrictEqual(repository.cache.get(FIRST), cached);
});

test("token repository preserves actual zero and unknown without reading other session usage", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, [indexRow(FIRST), indexRow(SECOND)].join("\n"));
  await writeFile(f.file(FIRST), token({ input_tokens: 0, total_tokens: 0 }));
  await writeFile(f.file(SECOND), meta(SECOND, "/second"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.deepEqual((await repository.readTokenUsage(FIRST)).cumulative, { inputTokens: 0, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null, totalTokens: 0 });
  assert.equal(await repository.readTokenUsage(SECOND), null);
});

test("token repository honors bounded tail and never scans full history to fill missing totals", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), meta(FIRST, "/first") + "\n" + token({ total_tokens: 999 }) + "\n" + "x".repeat(4096) + "\n");
  const repository = new PreviewRepository({ codexHome: f.codexHome, maxTailBytes: 512 });
  assert.equal(await repository.readTokenUsage(FIRST), null);
  await appendFile(f.file(FIRST), token({ input_tokens: 0 }) + "\n");
  assert.equal((await repository.readTokenUsage(FIRST)).cumulative.inputTokens, 0);
  assert.equal((await repository.readTokenUsage(FIRST)).cumulative.totalTokens, null);
});

test("simultaneous missing lookups share one safe refresh and deleted files never expose cached tokens", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), token({ total_tokens: 1 }));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  assert.equal((await repository.readTokenUsage(FIRST)).cumulative.totalTokens, 1);
  let refreshes = 0;
  const refresh = repository.refreshIndex.bind(repository);
  repository.refreshIndex = async () => { refreshes += 1; return refresh(); };
  const missing = await Promise.all([
    repository.resolveEfficiencyThread(MISSING),
    repository.readTokenUsage(MISSING),
    repository.resolveEfficiencyThread(SECOND),
  ]);
  assert.deepEqual(missing, [null, null, null]);
  assert.equal(refreshes, 1);
  await rm(f.file(FIRST));
  assert.equal(await repository.readTokenUsage(FIRST), null);
  assert.equal(await repository.resolveEfficiencyThread(FIRST), null);
});

test("context history is exact-thread, bounded, visible text only and never creates a full-history cache", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, [indexRow(FIRST), indexRow(SECOND)].join("\n"));
  await writeFile(f.file(FIRST), [meta(FIRST, "/first"), ...Array.from({ length: 45 }, (_, index) => message(String(index), index % 2 ? "assistant" : "user", `消息${index}`)),
    message("system", "system", "do not summarize this"),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "private tool output" } }),
  ].join("\n"));
  await writeFile(f.file(SECOND), message("other", "user", "其他同名对话"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  const history = await repository.readContextHistory("local:" + FIRST);
  assert.equal(history.threadId, FIRST);
  assert.equal(history.limited, true);
  assert.equal(history.messages.length, 40);
  assert.equal(history.messages[0].text, "消息5");
  assert.equal(history.messages.at(-1).text, "消息44");
  assert.doesNotMatch(JSON.stringify(history), /private tool|do not summarize|其他同名/u);
  assert.equal(repository.conversationHistoryCache.size, 0);
  for (const id of ["同名任务", "cloud:" + FIRST, MISSING]) assert.equal(await repository.readContextHistory(id), null);
});

test("context tail does not reuse stale equal-size cache and retains a full-text receipt hash", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), message("one", "user", "旧的任务"));
  const repository = new PreviewRepository({ codexHome: f.codexHome });
  const before = await repository.readContextHistory(FIRST);
  repository.conversationHistoryCache.set(FIRST, { size: Buffer.byteLength(message("one", "user", "旧的任务")), messages: before.messages });
  await writeFile(f.file(FIRST), message("one", "user", "新的任务"));
  await utimes(f.file(FIRST), new Date("2026-09-07T01:00:00Z"), new Date("2026-09-07T01:00:00Z"));
  const after = await repository.readContextHistory(FIRST);
  assert.equal(after.messages[0].text, "新的任务");
  assert.notEqual(after.sourceRevision, before.sourceRevision);
  const prompt = "审阅后的中文下一步".repeat(900);
  await appendFile(f.file(FIRST), "\n" + message("long", "user", prompt));
  const long = (await repository.readContextHistory(FIRST)).messages.at(-1);
  assert.equal(long.text.length, 6000);
  assert.equal(long.contentHash, createHash("sha256").update(prompt).digest("hex"));
});

test("context history respects configured recent-byte limit and deleted sources", async (t) => {
  const f = await fixture(t);
  await writeFile(f.index, indexRow(FIRST));
  await writeFile(f.file(FIRST), message("old", "user", "很久以前") + "\n" + "x".repeat(4096) + "\n" + message("new", "user", "最新消息"));
  const repository = new PreviewRepository({ codexHome: f.codexHome, maxTailBytes: 512 });
  assert.deepEqual((await repository.readContextHistory(FIRST)).messages.map((entry) => entry.text), ["最新消息"]);
  await rm(f.file(FIRST));
  assert.equal(await repository.readContextHistory(FIRST), null);
  assert.equal(await repository.readContextSourceRevision(FIRST), null);
});
