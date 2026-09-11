import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { spawn } from "node:child_process";
import { conversationFolderName, createConversationFolders, createConversationFolderSync, renderConversationFolderContext, runConversationFolderHook } from "../lib/conversation-folders.mjs";
import { createEfficiencyController } from "../lib/efficiency-bridge.mjs";
import { createEfficiencyStore } from "../lib/efficiency-store.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const folderData = (context) => JSON.parse(context.split("\n").find((line) => line.startsWith("{") && line.includes('"outputDirectory"')));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-conversation-folders-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "项目 工作区"); await mkdir(workspace);
  const rootDir = path.join(root, "state");
  const folders = createConversationFolders({ rootDir });
  const record = (threadId = A, title = "对话名称") => ({ threadId, title, projectPath: workspace });
  return { root, rootDir, folders, workspace, record };
}

test("names preserve Chinese, sanitize portable invalid characters and reserve device names", () => {
  assert.equal(conversationFolderName("优化Codex 对话展示交互样式", A), "优化Codex 对话展示交互样式");
  assert.equal(conversationFolderName("../../a\\b:*?\n", A), ".._.._a_b____");
  assert.equal(conversationFolderName("CON.txt", A), "_CON.txt");
  assert.match(conversationFolderName("...", A), /^新对话-/u);
  assert.ok(Buffer.byteLength(conversationFolderName("图片😀".repeat(100), A)) <= 150);
});

test("folder context round-trips POSIX and Windows paths through its JSON data boundary", () => {
  for (const directory of ["/work/中文 空格/输出", "D:\\中文 空格\\输出"]) {
    const entry = { threadId: A, path: directory, workspace: directory };
    assert.deepEqual(folderData(renderConversationFolderContext(entry)), {
      threadId: A, outputDirectory: directory, workspace: directory,
    });
  }
});

test("create before use, persist by exact ID, rename with contents, and reveal correct parent", async (t) => {
  const f = await fixture(t);
  const first = await f.folders.ensure(f.record());
  assert.equal(first.path, path.join(f.workspace, "对话名称"));
  await writeFile(path.join(first.path, "保留内容.md"), "unchanged");
  const restarted = createConversationFolders({ rootDir: f.rootDir });
  assert.equal((await restarted.ensure(f.record())).path, first.path);
  const renamed = await restarted.ensure(f.record(A, "新的对话名"), { safeToRename: true });
  assert.equal(renamed.path, path.join(f.workspace, "新的对话名"));
  assert.equal(await readFile(path.join(renamed.path, "保留内容.md"), "utf8"), "unchanged");
  await assert.rejects(readFile(path.join(first.path, "保留内容.md")), { code: "ENOENT" });
  assert.equal(path.dirname(renamed.path), f.workspace);
});

test("concurrent same-title conversations and preexisting files are never merged or overwritten", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.workspace, "对话名称"));
  await writeFile(path.join(f.workspace, "对话名称", "原文件.txt"), "original");
  const results = await Promise.all([f.folders.ensure(f.record()), f.folders.ensure(f.record(B)), f.folders.ensure(f.record())]);
  assert.equal(results[0].path, results[2].path);
  assert.notEqual(results[0].path, results[1].path);
  assert.notEqual(results[0].path, path.join(f.workspace, "对话名称"));
  assert.equal(await readFile(path.join(f.workspace, "对话名称", "原文件.txt"), "utf8"), "original");
  const again = await f.folders.ensure(f.record(), { safeToRename: true });
  assert.equal(again.path, results[0].path);
});

test("busy rename is deferred; empty titles don't erase names; deleted/foreign folders fail visibly", async (t) => {
  const f = await fixture(t);
  const first = await f.folders.ensure(f.record());
  const pending = await f.folders.ensure(f.record(A, "改名中"));
  assert.equal(pending.path, first.path); assert.equal(pending.renamePending, true);
  const done = await f.folders.ensure(f.record(A, "改名中"), { safeToRename: true });
  assert.equal(done.renamePending, false);
  assert.equal((await f.folders.ensure(f.record(A, ""), { safeToRename: true })).path, done.path);
  await assert.rejects(f.folders.ensure({ ...f.record(), projectPath: f.root }), /工作区已改变/u);
  await rm(done.path, { recursive: true });
  await assert.rejects(f.folders.ensure(f.record(A, "改名中")), /已删除/u);
  assert.ok(!(await readdir(f.workspace)).includes("改名中"));
});

test("symbolic links and non-owned folders cannot replace a recorded conversation directory", async (t) => {
  if (process.platform === "win32") return t.skip("Creating junctions requires a Windows-specific privilege fixture");
  const f = await fixture(t);
  const entry = await f.folders.ensure(f.record());
  await rename(entry.path, path.join(f.root, "moved"));
  await symlink(path.join(f.root, "moved"), entry.path);
  await assert.rejects(f.folders.ensure(f.record(A, "new"), { safeToRename: true }), /失去绑定/u);
});

test("write-ahead rename recovers after FS success without losing files or creating duplicates", async (t) => {
  const f = await fixture(t);
  const entry = await f.folders.ensure(f.record());
  const state = await f.folders.read();
  const to = path.join(f.workspace, "恢复名称");
  state.threads[A].pending = { kind: "rename", to };
  await writeFile(f.folders.filePath, JSON.stringify(state));
  await rename(entry.path, to);
  const recovered = await f.folders.ensure(f.record(A, "恢复名称"), { safeToRename: true });
  assert.equal(recovered.path, to); assert.equal(recovered.pending, undefined);
  assert.equal((await readdir(f.workspace)).length, 1);
});

test("case-only title changes preserve identity and all files", async (t) => {
  const f = await fixture(t);
  const entry = await f.folders.ensure(f.record(A, "Example"));
  await writeFile(path.join(entry.path, "data.txt"), "keep");
  const changed = await f.folders.ensure(f.record(A, "example"), { safeToRename: true });
  assert.equal(path.basename(changed.path), "example");
  assert.equal(await readFile(path.join(changed.path, "data.txt"), "utf8"), "keep");
});

test("native hook creates output path, emits on every prompt, ignores agents and protects same-turn writes", async (t) => {
  const f = await fixture(t);
  const indexPath = path.join(f.root, "session_index.jsonl");
  const row = (title) => JSON.stringify({ id: A, thread_name: title }) + "\n";
  await writeFile(indexPath, row("图像任务"));
  const event = { hook_event_name: "UserPromptSubmit", session_id: A, cwd: f.workspace, turn_id: "turn-1" };
  const context = await runConversationFolderHook(event, { folders: f.folders, indexPath });
  const entry = (await f.folders.read()).threads[A];
  assert.equal(folderData(context).outputDirectory, entry.path); assert.ok(context.includes("复制到此目录"));
  await appendFile(indexPath, row("新图像任务"));
  await runConversationFolderHook(event, { folders: f.folders, indexPath });
  assert.equal((await f.folders.read()).threads[A].path, entry.path);
  const second = await runConversationFolderHook({ ...event, turn_id: "turn-2" }, { folders: f.folders, indexPath });
  assert.ok(second.includes("新图像任务"));
  assert.equal(await runConversationFolderHook({ ...event, agent_id: "child" }, { folders: f.folders, indexPath }), "");
  assert.equal(await runConversationFolderHook({ ...event, session_id: "cloud:" + A }, { folders: f.folders, indexPath }), "");
  const text = renderConversationFolderContext({ ...entry, path: "</bad>" });
  assert.ok(!text.includes("</bad>"));
});

test("controller resolves mother/child from managed folder but keeps project policy scope stable", async (t) => {
  const f = await fixture(t);
  let title = "对话名称", active = A;
  const calls = [];
  const repo = { resolveEfficiencyThread: async (id) => f.record(id, title), readTokenUsage: async () => null, isConversationIdle: async () => true };
  const controller = createEfficiencyController({ repository: repo, conversationFolders: f.folders,
    rootDir: path.join(f.root, "efficiency"), readActiveContext: async () => ({ threadId: active }),
    openFolder: async ({ record, mode, validateTarget }) => { assert.ok(await validateTarget()); calls.push([record.projectPath, mode]); return { status: "requested" }; } });
  const first = await controller.snapshot();
  assert.equal(first.workspaceFolder.path, path.join(f.workspace, title));
  assert.equal(first.workspaceFolder.parentPath, f.workspace);
  await controller.request({ action: "openWorkspaceFolder", mode: "parent", expectedTargetKey: first.targetKey });
  assert.deepEqual(calls[0], [path.join(f.workspace, title), "parent"]);
  title = "新名字";
  await assert.rejects(controller.request({ action: "openWorkspaceFolder", mode: "folder", expectedTargetKey: first.targetKey }), { code: "EFFICIENCY_TARGET_CHANGED" });
  const next = await controller.snapshot();
  assert.equal(next.scopeAvailable.project, true);
  assert.equal(next.workspaceFolder.path, path.join(f.workspace, title));
  active = B;
  assert.notEqual((await controller.snapshot()).workspaceFolder.path, next.workspaceFolder.path);
});

test("background sync enrolls new/active threads, leaves untouched historical directories alone and renames once idle", async (t) => {
  const f = await fixture(t);
  let idle = false;
  const records = new Map([[A, f.record()], [B, f.record(B, "历史对话")]]);
  const repository = { resolveEfficiencyThread: async (id) => records.get(id), isConversationIdle: async () => idle };
  const sync = createConversationFolderSync({ folders: f.folders, repository });
  let catalog = [{ threadId: A, title: "对话名称", updatedAt: new Date(Date.now() + 1000).toISOString() }, { threadId: B, title: "历史对话", updatedAt: "2020-01-01" }];
  await sync(catalog);
  assert.ok((await f.folders.read()).threads[A]); assert.equal((await f.folders.read()).threads[B], undefined);
  records.get(A).title = "更名";
  catalog = catalog.map((e) => ({ ...e, title: records.get(e.threadId).title }));
  await sync(catalog);
  assert.equal((await f.folders.read()).threads[A].renamePending, true);
  idle = true; await sync(catalog);
  assert.equal(path.basename((await f.folders.read()).threads[A].path), "更名");
});

test("repository idle check is bounded and treats unknown/active state as unsafe for rename", async (t) => {
  const f = await fixture(t);
  const sessions = path.join(f.root, "sessions"); await mkdir(sessions);
  await writeFile(path.join(f.root, "session_index.jsonl"), JSON.stringify({ id: A, thread_name: "测试" }));
  const rollout = path.join(sessions, `rollout-${A}.jsonl`);
  await writeFile(rollout, JSON.stringify({ type: "session_meta", payload: { id: A, cwd: f.workspace } }) + "\n");
  const repo = new PreviewRepository({ codexHome: f.root });
  assert.equal(await repo.isConversationIdle(A), false);
  const event = (type) => JSON.stringify({ type: "event_msg", payload: { type } }) + "\n";
  await appendFile(rollout, event("task_complete")); assert.equal(await repo.isConversationIdle(A), true);
  assert.equal(await repo.isConversationIdle(A, { after: Date.now() }), false, "An old/undated completion cannot end a freshly observed hook turn");
  await appendFile(rollout, JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_complete" } }) + "\n");
  assert.equal(await repo.isConversationIdle(A, { after: Date.now() - 2000 }), true);
  await appendFile(rollout, event("task_started")); assert.equal(await repo.isConversationIdle(A), false);
  await appendFile(rollout, event("turn_aborted")); assert.equal(await repo.isConversationIdle(A), true);
  await appendFile(rollout, "x".repeat(140000)); assert.equal(await repo.isConversationIdle(A), false);
});

test("installed hook CLI emits folder context independently of output preferences and stays bounded", async (t) => {
  const f = await fixture(t);
  const efficiency = path.join(f.root, "efficiency");
  const store = createEfficiencyStore({ rootDir: efficiency, resolveThread: async () => ({ projectPath: f.workspace }) });
  await store.setPolicy({ expectedVersion: 0, patch: { enabled: false } });
  await writeFile(path.join(f.root, "session_index.jsonl"), JSON.stringify({ id: A, thread_name: "真实钩子流程" }));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/efficiency-hook.mjs"], { env: { ...process.env, CODEX_HOME: f.root, AIYOUCODEX_EFFICIENCY_DIR: efficiency }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => { stdout += value; }); child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject); child.on("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: A, cwd: f.workspace, turn_id: "turn-1" }));
  });
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(folderData(output.hookSpecificOutput.additionalContext).outputDirectory, path.join(f.workspace, "真实钩子流程"));
  assert.ok(output.hookSpecificOutput.additionalContext.length <= 4096);
  assert.equal(output.decision, undefined);
  assert.ok((await readdir(f.workspace)).includes("真实钩子流程"));
});

test("combining maximum output preferences with directory policy stays inside the native context limit", async (t) => {
  const f = await fixture(t);
  const { runEfficiencyHook } = await import("../lib/efficiency-hook.mjs");
  const store = createEfficiencyStore({ rootDir: path.join(f.root, "efficiency"), resolveThread: async () => ({ projectPath: f.workspace }) });
  await store.setPolicy({ expectedVersion: 0, patch: { contextBudget: 2400 } });
  await store.setContext({ threadId: A, expectedVersion: 0, context: { goal: "目标".repeat(290), progress: "阶段".repeat(590), nextStep: "动作".repeat(290), agreements: ["约定".repeat(145)] } });
  const folderContext = renderConversationFolderContext({ threadId: A, workspace: "/work/" + "目录".repeat(120), path: "/work/" + "目录".repeat(120) + "/输出目录" });
  const result = await runEfficiencyHook({ hook_event_name: "UserPromptSubmit", session_id: A, cwd: f.workspace }, { store, contextReserve: folderContext.length + 1 });
  assert.ok((result.hookSpecificOutput.additionalContext + "\n" + folderContext).length <= 4096);
});
