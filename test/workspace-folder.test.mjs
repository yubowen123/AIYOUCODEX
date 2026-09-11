import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeWorkspaceFolder, workspaceFolderCommand, openWorkspaceFolder } from "../lib/workspace-folder.mjs";
import { createEfficiencyController } from "../lib/efficiency-bridge.mjs";

test("macOS and Windows choose reveal vs enter without a shell, including Chinese and spaces", () => {
  const mac = "/Users/example/项目 空格/子目录 $(no-execution)";
  assert.deepEqual(workspaceFolderCommand(mac, "parent", { platform: "darwin" }), { command: "/usr/bin/open", args: ["-R", mac] });
  assert.deepEqual(workspaceFolderCommand(mac, "folder", { platform: "darwin" }), { command: "/usr/bin/open", args: [mac] });
  const win = "D:\\项目 空格\\子目录 & no-execution";
  const env = { SystemRoot: "C:\\Windows" };
  assert.deepEqual(workspaceFolderCommand(win, "parent", { platform: "win32", env }), { command: "C:\\Windows\\explorer.exe", args: ["/select,", win] });
  assert.deepEqual(workspaceFolderCommand(win, "folder", { platform: "win32", env }).args, [win]);
  assert.equal(describeWorkspaceFolder({ threadId: "a", projectPath: win }, { platform: "win32" }).available, true);
});

test("missing, foreign, relative, network and control-character paths cannot open a local folder", () => {
  const view = (projectPath, platform = "darwin") => describeWorkspaceFolder({ threadId: "a", projectPath }, { platform });
  for (const value of [null, "relative", "https://example.com", "C:\\other-host", "/bad\npath"]) assert.equal(view(value).available, false);
  for (const value of ["/Users/example", "C:relative", "\\\\server\\share", "C:\\bad\"path"]) assert.equal(view(value, "win32").available, false);
  assert.equal(view("/", "darwin").canRevealParent, false);
  assert.equal(view("C:\\", "win32").canRevealParent, false);
  assert.equal(view("/tmp/project", "linux").available, false);
});

test("real directory checks preserve named symlinks, refuse files/deletions and stop a raced target before OS launch", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-folder-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "中文 空格 项目");
  await mkdir(folder);
  const calls = [];
  const options = { platform: "darwin", launch: async (...args) => { calls.push(args); } };
  const record = { threadId: "a", projectPath: folder };
  const request = { record, mode: "parent", validateTarget: async () => true };
  const result = await openWorkspaceFolder(request, options);
  assert.equal(result.status, "requested");
  assert.deepEqual(calls[0].slice(0, 2), ["/usr/bin/open", ["-R", folder]]);
  assert.equal(calls[0][2].shell, false);
  await assert.rejects(openWorkspaceFolder({ ...request, validateTarget: async () => false }, options), /已变化/u);
  await assert.rejects(openWorkspaceFolder({ ...request, mode: "invalid" }, options), /请选择/u);
  const file = path.join(root, "not-a-folder.txt"); await writeFile(file, "fixture");
  await assert.rejects(openWorkspaceFolder({ ...request, record: { ...record, projectPath: file } }, options), /不是文件夹/u);
  assert.equal(calls.length, 1);
  if (process.platform !== "win32") {
    const link = path.join(root, "named-link"); await symlink(folder, link);
    await openWorkspaceFolder({ ...request, record: { ...record, projectPath: link } }, options);
    assert.deepEqual(calls.at(-1)[1], ["-R", link]);
  }
  await rm(folder, { recursive: true });
  await assert.rejects(openWorkspaceFolder(request, options), /不存在/u);
  await assert.rejects(openWorkspaceFolder(request, { ...options, statPath: async () => { throw Object.assign(new Error(), { code: "EACCES" }); } }), /权限/u);
  await assert.rejects(openWorkspaceFolder(request, { ...options, statPath: async () => ({ isDirectory: () => true }), launch: async () => { throw new Error("os failure"); } }), /未确认打开/u);
});

test("controller resolves exact local identity and refuses renderer paths, stale targets and changed directories", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "aiyou-folder-controller-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  let active = "a";
  const records = new Map(["a", "b"].map((threadId) => [threadId, { threadId, title: "同名任务", projectPath: path.join(rootDir, threadId) }]));
  const calls = [];
  const controller = createEfficiencyController({ rootDir, readActiveContext: async () => ({ threadId: active }),
    repository: { resolveEfficiencyThread: async (id) => records.get(id), readTokenUsage: async () => null },
    openFolder: async ({ record, mode, validateTarget }) => { assert.equal(await validateTarget(), true); calls.push({ record, mode }); return { status: "requested" }; },
  });
  const a = await controller.snapshot();
  await controller.request({ action: "openWorkspaceFolder", mode: "folder", expectedTargetKey: a.targetKey });
  assert.equal(calls[0].record.projectPath, records.get("a").projectPath);
  await assert.rejects(controller.request({ action: "openWorkspaceFolder", mode: "folder", expectedTargetKey: a.targetKey, path: "/arbitrary" }), /外部路径/u);
  active = "b";
  await assert.rejects(controller.request({ action: "openWorkspaceFolder", mode: "parent", expectedTargetKey: a.targetKey }), { code: "EFFICIENCY_TARGET_CHANGED" });
  active = "a"; records.get("a").projectPath = path.join(rootDir, "changed");
  await assert.rejects(controller.request({ action: "openWorkspaceFolder", mode: "parent", expectedTargetKey: a.targetKey }), { code: "EFFICIENCY_TARGET_CHANGED" });
  assert.equal(calls.length, 1);
});
