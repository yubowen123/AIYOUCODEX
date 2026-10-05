import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LayaHistoryIndex, LocalLayaRuntime, createLayaSearchController, cleanSearchText } from "../lib/laya-search.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "laya-index-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const filesById = new Map(), catalog = [];
  async function add(threadId, projectId, text) {
    const file = path.join(dir, `${threadId}.jsonl`); filesById.set(threadId, file);
    catalog.push({ threadId, projectId, projectName: "同名项目", title: "普通任务" });
    await writeFile(file, JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } }) + "\n");
  }
  const repository = { filesById, readRecentCatalog: async () => catalog };
  const index = new LayaHistoryIndex({ repository, cachePath: path.join(dir, "index.json") });
  return { dir, repository, index, add, catalog, filesById };
}

test("full history content recall, separate same-name projects, hidden rules, incremental update and deletion", async t => {
  const f = await fixture(t);
  await f.add("a", "p1", "将电影对白重新配音，制作 AI 用量吐槽短视频。" + "这是无关的段落。".repeat(100) + "最后进行了字幕清理与口型同步。");
  await f.add("b", "p2", "修订书稿批注，导出 Word 文档。");
  await f.add("c", "p2", "# AGENTS.md instructions\n视频、AI用量、配音");
  await writeFile(f.filesById.get("c"), JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "刚才搜索的描述是：AI 用量配音视频，口型同步。" }] } }) + "\n", { flag: "a" });
  await f.index.refresh(true);
  assert.equal(f.index.profiles.size, 2);
  assert.equal(f.index.candidates("那个将对白改成 AI 用量视频的工作")[0].id, "p1");
  assert.equal(f.index.candidates("口型同步")[0].hits[0].threadId, "a", "Earlier and later content are both indexed");
  assert.equal(f.index.documents.find(x => x.threadId === "c").chunks.length, 0, "Progress reports cannot contaminate retrieval");
  assert.equal(cleanSearchText("API_KEY=abcd1234 sk-abcdefghijklmnop"), "[已隐藏] [已隐藏]");
  assert.equal(cleanSearchText('"apiKey": "private-demo" Bearer private-demo 0123456789abcdef0123456789abcdef'), '"apiKey": [已隐藏] Bearer [已隐藏] [已隐藏]');
  await writeFile(f.filesById.get("b"), JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "这是新加入的铝型材建模任务" }] } }) + "\n");
  await f.index.refresh(true);
  assert.equal(f.index.candidates("铝型材")[0].id, "p2");
  f.catalog.splice(0, 1); await f.index.refresh(true);
  assert.equal(f.index.candidates("口型同步").length, 0, "Deleted catalog sources cannot reappear from cache");
});

test("deployment must successfully start inference; runtime errors disable and preserve fallback", async t => {
  const f = await fixture(t); await f.add("a", "p1", "AI 用量配音视频");
  const runtime = { ready: false, start: async () => { throw new Error("No inference"); }, stop() {} };
  const controller = createLayaSearchController({ repository: f.repository, index: f.index, runtime, statePath: path.join(f.dir, "state.json") });
  await assert.rejects(controller.request({ action: "toggle", enabled: true }), /Laya/);
  assert.equal(controller.snapshot().enabled, false);
  runtime.start = async () => { runtime.ready = true; };
  runtime.request = async (action, items) => ({ items: items.map(x => ({ id: x.id, choice: action === "profile" ? "视频剧本" : "unrelated" })) });
  await controller.request({ action: "toggle", enabled: true });
  const good = await controller.request({ action: "search", query: "配音视频" });
  assert.equal(good.results[0].projectId, "p1", "A weak model answer cannot remove real lexical evidence");
  assert.equal(good.results[0].hits[0].threadId, "a");
  runtime.request = async () => { throw new Error("GPU failure"); };
  const failed = await controller.request({ action: "search", query: "配音视频" });
  assert.equal(failed.fallback, true); assert.equal(failed.status.enabled, false);
  await assert.rejects(controller.request({ action: "search", query: "x".repeat(201) }));
});

test("a checkpoint file alone does not pass deployment gate", async t => {
  const f = await fixture(t); const model = path.join(f.dir, "fake-model"); await mkdir(model);
  await writeFile(path.join(model, "model.safetensors"), "not a checkpoint");
  const configPath = path.join(f.dir, "runtime.json");
  await writeFile(configPath, JSON.stringify({ pythonPath: process.execPath, modelPath: model }));
  const runtime = new LocalLayaRuntime({ configPath }); t.after(() => runtime.stop());
  await assert.rejects(runtime.start()); assert.equal(runtime.ready, false);
});
