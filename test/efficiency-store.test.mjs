import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { canonicalEfficiencyProject, createEfficiencyStore, efficiencyRootPath, normalizeEfficiencyPolicy, withEfficiencyFileLock } from "../lib/efficiency-store.mjs";

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "aiyou-efficiency-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return { rootDir, store: createEfficiencyStore({ rootDir, resolveThread: async (id) => id === "unknown" ? null : { projectPath: rootDir } }) };
}
test("efficiency policies inherit global → project → thread and reset safely", async (t) => {
  const { store } = await fixture(t);
  let view = await store.read({ threadId: "thread-a" });
  assert.equal(view.effective.mode, "smart");
  view = await store.setPolicy({ expectedVersion: view.version, patch: { mode: "concise", defaultSkills: [{ id: "test-skill", source: "local" }] } });
  view = await store.setPolicy({ scope: "project", threadId: "thread-a", expectedVersion: view.version, patch: { mode: "detailed" } });
  assert.equal((await store.read({ threadId: "thread-b" })).effective.mode, "detailed");
  view = await store.setPolicy({ scope: "thread", threadId: "thread-a", expectedVersion: view.version, patch: { mode: "smart", defaultSkills: [] } });
  assert.equal(view.effective.mode, "smart");
  assert.deepEqual(view.effective.defaultSkills, []);
  view = await store.setPolicy({ scope: "thread", threadId: "thread-a", expectedVersion: view.version, patch: { mode: null, defaultSkills: null } });
  assert.equal(view.effective.mode, "detailed");
  assert.deepEqual(view.effective.defaultSkills, [{ id: "test-skill", source: "local" }]);
});
test("efficiency store rejects invalid identity, unknown thread and ambiguous project", async (t) => {
  const { rootDir, store } = await fixture(t);
  for (const threadId of ["../escape", "__proto__", "constructor", "bad/name"]) await assert.rejects(store.read({ threadId }));
  await assert.rejects(store.read({ threadId: "unknown" }), /Unknown/);
  const projectless = createEfficiencyStore({ rootDir, resolveThread: async () => ({}) });
  await assert.rejects(projectless.setPolicy({ scope: "project", threadId: "a", expectedVersion: 0, patch: { mode: "concise" } }), /no associated project/);
  await assert.rejects(createEfficiencyStore({ rootDir }).read({ threadId: "a" }), /authoritative/);
  assert.throws(() => normalizeEfficiencyPolicy({ contextBudget: Infinity }));
  assert.throws(() => normalizeEfficiencyPolicy({ stopBlocker: true }));
});
test("efficiency contexts are manual, thread-isolated and use independent optimistic versions", async (t) => {
  const { store } = await fixture(t);
  let view = await store.setContext({ threadId: "a", expectedVersion: 0, context: { goal: "用户确认的目标", references: ["docs/spec.md"] } });
  assert.equal(view.context.version, 1);
  assert.equal(view.version, 0);
  assert.equal((await store.read({ threadId: "b" })).context.goal, "");
  await assert.rejects(store.setContext({ threadId: "a", expectedVersion: 0, context: {} }), { code: "EFFICIENCY_CONFLICT" });
  await assert.rejects(store.setPolicy({ expectedVersion: 99, patch: { mode: "concise" } }), { code: "EFFICIENCY_CONFLICT" });
  await assert.rejects(store.setContext({ threadId: "a", expectedVersion: 1, context: { rawHistory: "not allowed" } }));
  await assert.rejects(store.setContext({ threadId: "a", expectedVersion: 1, context: { goal: "x".repeat(601) } }));
  view = await store.setPolicy({ expectedVersion: 0, patch: { mode: "concise" } });
  assert.equal(view.version, 1);
  assert.equal((await store.read({ threadId: "a" })).context.goal, "用户确认的目标");
});
test("canonical project identities normalize Windows case, separators and native symlinks", async (t) => {
  assert.deepEqual(await canonicalEfficiencyProject("C:\\Work\\Folder\\", { platform: "win32" }), await canonicalEfficiencyProject("c:/work/folder", { platform: "win32" }));
  assert.match(efficiencyRootPath({ platform: "win32", homeDir: "C:\\Users\\User", env: {} }), /CodexSidebarEnhancer\\Data\\efficiency$/);
  assert.notEqual((await canonicalEfficiencyProject("/work/\u00e9", { platform: "linux" })).key, (await canonicalEfficiencyProject("/work/e\u0301", { platform: "linux" })).key);
  const { rootDir } = await fixture(t);
  if (process.platform !== "win32") {
    const alias = `${rootDir}-alias`;
    await symlink(rootDir, alias);
    t.after(() => rm(alias, { force: true }));
    assert.equal((await canonicalEfficiencyProject(rootDir)).key, (await canonicalEfficiencyProject(alias)).key);
  }
});
test("multi-process context writers never lose another thread's update", async (t) => {
  const { rootDir, store } = await fixture(t);
  const moduleUrl = pathToFileURL(path.resolve("lib/efficiency-store.mjs")).href;
  await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve, reject) => {
    const source = `import {createEfficiencyStore} from ${JSON.stringify(moduleUrl)}; const store=createEfficiencyStore({rootDir:${JSON.stringify(rootDir)},resolveThread:async()=>({projectPath:${JSON.stringify(rootDir)}})}); await store.setContext({threadId:'thread-${index}',expectedVersion:0,context:{goal:'goal-${index}'}});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe"] });
    let error = ""; child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error)));
  })));
  for (let index = 0; index < 8; index += 1) assert.equal((await store.read({ threadId: `thread-${index}` })).context.goal, `goal-${index}`);
  assert.equal(Object.keys(JSON.parse(await readFile(store.filePath, "utf8")).contexts).length, 8);
});
test("simultaneous stale policy writes produce one success and one explicit conflict", async (t) => {
  const { store } = await fixture(t);
  const results = await Promise.allSettled(["concise", "detailed"].map((mode) => store.setPolicy({ expectedVersion: 0, patch: { mode } })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "EFFICIENCY_CONFLICT");
});
test("malformed or future state is not silently replaced", async (t) => {
  const { store } = await fixture(t);
  await writeFile(store.filePath, "invalid json");
  await assert.rejects(store.setPolicy({ expectedVersion: 0, patch: {} }));
  assert.equal(await readFile(store.filePath, "utf8"), "invalid json");
  await writeFile(store.filePath, JSON.stringify({ schemaVersion: 999, version: 0, global: {}, projects: {}, threads: {}, contexts: {} }));
  await assert.rejects(store.read(), /Unsupported/);
});
test("a live process lock times out rather than being stolen", async (t) => {
  const { store } = await fixture(t);
  await mkdir(`${store.filePath}.lock`);
  await writeFile(path.join(`${store.filePath}.lock`, "owner.json"), JSON.stringify({ pid: process.pid, token: "live", createdAt: 0 }));
  await assert.rejects(withEfficiencyFileLock(store.filePath, () => {}, { timeoutMs: 30 }), { code: "EFFICIENCY_BUSY" });
});
test("Windows transient lock acquisition errors retry before running exactly one writer", async (t) => {
  const { store } = await fixture(t);
  const errors = ["EPERM", "EACCES", "EBUSY"];
  let attempts = 0;
  let writes = 0;
  const result = await withEfficiencyFileLock(store.filePath, async () => {
    writes += 1;
    assert.equal(attempts, 4);
    assert.equal(JSON.parse(await readFile(path.join(`${store.filePath}.lock`, "owner.json"), "utf8")).pid, process.pid);
    return "saved";
  }, {
    platform: "win32",
    mkdirLock: async (...args) => {
      assert.equal(writes, 0);
      const code = errors[attempts++];
      if (code) throw Object.assign(new Error("Directory pending deletion"), { code });
      return mkdir(...args);
    },
  });
  assert.equal(result, "saved");
  assert.equal(writes, 1);
  await assert.rejects(readFile(path.join(`${store.filePath}.lock`, "owner.json")), { code: "ENOENT" });
});
test("persistent Windows acquisition errors time out without touching another writer's lock", async (t) => {
  const { store } = await fixture(t);
  const ownerPath = path.join(`${store.filePath}.lock`, "owner.json");
  const owner = JSON.stringify({ pid: process.pid, token: "other-writer", createdAt: 0 });
  await mkdir(`${store.filePath}.lock`);
  await writeFile(ownerPath, owner);
  let writes = 0;
  await assert.rejects(withEfficiencyFileLock(store.filePath, () => { writes += 1; }, {
    timeoutMs: 30,
    platform: "win32",
    mkdirLock: async () => { throw Object.assign(new Error("Still busy"), { code: "EPERM" }); },
  }), { code: "EFFICIENCY_BUSY" });
  assert.equal(writes, 0);
  assert.equal(await readFile(ownerPath, "utf8"), owner);
});
test("non-Windows permission failures and unrelated acquisition errors fail immediately", async (t) => {
  const { store } = await fixture(t);
  for (const [platform, code] of [["darwin", "EPERM"], ["win32", "ENOENT"]]) {
    let attempts = 0;
    await assert.rejects(withEfficiencyFileLock(store.filePath, () => assert.fail("Writer must not run"), {
      platform,
      mkdirLock: async () => { attempts += 1; throw Object.assign(new Error("Not retryable"), { code }); },
    }), { code });
    assert.equal(attempts, 1);
  }
});
test("a dead process lock is recovered without dropping its already saved state", async (t) => {
  const { store } = await fixture(t);
  await store.setContext({ threadId: "a", expectedVersion: 0, context: { goal: "preserved" } });
  const pid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    child.on("error", reject); child.on("exit", () => resolve(child.pid));
  });
  await mkdir(`${store.filePath}.lock`);
  await writeFile(path.join(`${store.filePath}.lock`, "owner.json"), JSON.stringify({ pid, token: "dead", createdAt: 0 }));
  await store.setPolicy({ expectedVersion: 0, patch: { mode: "concise" } });
  assert.equal((await store.read({ threadId: "a" })).context.goal, "preserved");
});
