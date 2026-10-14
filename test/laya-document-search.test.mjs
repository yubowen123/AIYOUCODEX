import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createLayaDocumentSearch } from "../lib/laya-document-search.mjs";
import { createSkillSearchController } from "../lib/skill-search.mjs";

test("body retrieval, multilingual intent ranking and source-only IDs", async () => {
  const requests = [];
  const search = createLayaDocumentSearch({ runtime: { request: async (action, items, query) => {
    requests.push({ action, items, query });
    return { items: [{ id: "voice", choice: "match" }, { id: "music", choice: "related" }, { id: "invented", choice: "match" }], elapsedMs: 12 };
  } } });
  const result = await search.search({ query: "把声音转成文字", documents: [
    { id: "voice", title: "Audio helper", text: "Full document: transcription converts speech to readable text." },
    { id: "music", title: "Music", text: "Audio soundtrack editing." },
    { id: "slides", title: "Slides", text: "Presentation slide design." },
  ] });
  assert.equal(result.engine, "laya");
  assert.equal(result.results[0].id, "voice");
  assert.match(result.results[0].snippet, /transcription/);
  assert.ok(result.results.every(row => row.id !== "invented"));
  assert.equal(requests[0].action, "rank-documents");
});

test("full-text evidence and model input redact secret values", async () => {
  const secret = "sk-aSecretValueThatMustNeverReachModel";
  let received;
  const search = createLayaDocumentSearch({ runtime: { request: async (_action, items) => {
    received = JSON.stringify(items);
    return { items: items.map(item => ({ id: item.id, choice: "match" })) };
  } } });
  const result = await search.search({ query: "海底角色", documents: [{ id: "underwater", title: "普通名称", text: `api_key: ${secret}\n描述：海底角色的人物插画。` }] });
  assert.equal(received.includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.match(result.results[0].snippet, /海底角色/);
});

test("all recalled resources survive the bounded model shortlist and pagination cache is stable", async () => {
  let calls = 0;
  const search = createLayaDocumentSearch({ runtime: { request: async (_action, items) => {
    calls += 1; assert.equal(items.length, 24);
    return { items: items.map(item => ({ id: item.id, choice: "related" })) };
  } } });
  const documents = Array.from({ length: 80 }, (_, id) => ({ id: String(id), title: `角色 ${id}`, text: "海底角色设计" }));
  const first = await search.search({ query: "角色", documents, limit: documents.length, scope: "assets", revision: "a" });
  const second = await search.search({ query: "角色", documents, limit: documents.length, scope: "assets", revision: "a" });
  assert.equal(first.results.length, 80);
  assert.equal(first.coverage.candidates, 24);
  assert.equal(first.coverage.indexed, 80);
  assert.deepEqual(first, second); assert.equal(calls, 1);
});

test("same-query concurrent requests deduplicate while project/revision/body changes invalidate results", async () => {
  let calls = 0;
  const search = createLayaDocumentSearch({ runtime: { request: async (_action, items) => {
    calls += 1; await new Promise(resolve => setTimeout(resolve, 10));
    return { items: items.map(item => ({ id: item.id, choice: "match" })) };
  } } });
  const input = { query: "配音", documents: [{ id: "a", title: "配音", text: "原内容" }], scope: "p1", revision: "1" };
  await Promise.all([search.search(input), search.search(input)]); assert.equal(calls, 1);
  await search.search({ ...input, scope: "p2" });
  await search.search({ ...input, revision: "2" });
  await search.search({ ...input, documents: [{ ...input.documents[0], text: "改后的配音内容" }] });
  assert.equal(calls, 4);
});

test("model failures retain lexical evidence and the next search can recover", async () => {
  let fail = true;
  const search = createLayaDocumentSearch({ runtime: { request: async (_action, items) => {
    if (fail) throw new Error("offline runtime unavailable");
    return { items: items.map(item => ({ id: item.id, choice: "match" })) };
  } } });
  const input = { query: "对白", documents: [{ id: "a", title: "普通文件", text: "这是对白配音的制作说明。" }] };
  assert.equal((await search.search(input)).fallback, true);
  assert.equal((await search.search(input)).results[0].id, "a");
  fail = false; assert.equal((await search.search(input)).engine, "laya");
  await assert.rejects(search.search({ ...input, query: "x".repeat(201) }), { code: "LAYA_SEARCH_ERROR" });
});

test("cross-language small catalogs use only validated model decisions", async () => {
  const search = createLayaDocumentSearch({ runtime: { request: async (_action, items) => ({ items: items.map(row => ({ id: row.id, choice: row.id === "a" ? "match" : "unrelated" })) }) } });
  const result = await search.search({ query: "寂静雨夜", documents: [{ id: "a", title: "Rain", text: "A quiet night outdoors." }, { id: "b", title: "Spreadsheet", text: "Expense calculations." }] });
  assert.deepEqual(result.results.map(row => row.id), ["a"]);
});

test("Skills read only admitted catalog files, refresh changed bodies, and never trust request paths", async t => {
  const root = await mkdtemp(path.join(process.env.AIYOU_TEST_OUTPUT || os.tmpdir(), "laya-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "SKILL.md"); await writeFile(file, "标题普通，正文包含海底人物的设计步骤。\n");
  const catalog = [{ id: "skill:a", title: "普通工具", name: "tool", description: "说明", skillFile: file }];
  const controller = createSkillSearchController({ readCatalog: async () => catalog, runtime: { request: async (_action, items) => ({ items: items.map(row => ({ id: row.id, choice: "match" })) }) } });
  assert.equal((await controller.request({ query: "海底人物", skillIds: ["skill:a"], path: "/private/secret" })).results[0].id, "skill:a");
  assert.deepEqual((await controller.request({ query: "海底人物", skillIds: ["not-admitted"] })).results, []);
  await writeFile(file, "已经改成机械角色制作，体积也发生变化。\n");
  assert.match((await controller.request({ query: "机械角色" })).results[0].snippet, /机械角色/);
  await assert.rejects(controller.request({ query: "角色", skillIds: [123] }), { code: "LAYA_SEARCH_ERROR" });
});
