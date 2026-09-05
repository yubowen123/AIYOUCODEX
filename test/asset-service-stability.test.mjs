import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { savePlainTextAsset, textContentRevision, textEditPolicy } from "../vendor/codex-workspace-enhancer/asset-browser/text-asset-safety.js";
import { CoalescingPathUpdateQueue } from "../vendor/codex-workspace-enhancer/asset-browser/asset-index-update-utils.js";
import { collectAssetDirectory, changedAssetCandidates, RecoveringAssetWatchers } from "../vendor/codex-workspace-enhancer/asset-browser/asset-index-reconciliation.js";
import { PersistentAssetIndex } from "../vendor/codex-workspace-enhancer/asset-browser/persistent-asset-index.js";

test("structured documents reject overwrite without touching original bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-readonly-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const extension of [".docx", ".doc", ".rtf"]) {
    const target = path.join(root, `document${extension}`);
    const original = Buffer.from("table\0image\0style\0original\0");
    await fs.writeFile(target, original);
    assert.equal(textEditPolicy(target).editable, false);
    await assert.rejects(savePlainTextAsset(target, { content: "unsafe edit", expectedRevision: textContentRevision(original) }), { statusCode: 415 });
    assert.deepEqual(await fs.readFile(target), original);
  }
  assert.equal((await fs.readdir(root)).length, 3, "readonly attempts must not create temporary or backup files");
});

test("plain text saves preserve a recovery copy and reject external or concurrent stale edits", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-safe-save-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "prompt.md");
  await fs.writeFile(target, "original");
  const revision = textContentRevision(Buffer.from("original"));
  await assert.rejects(savePlainTextAsset(target, { content: "missing revision" }), { statusCode: 409 });
  const results = await Promise.allSettled([
    savePlainTextAsset(target, { content: "first", expectedRevision: revision }),
    savePlainTextAsset(target, { content: "stale second", expectedRevision: revision }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].reason.statusCode, 409);
  assert.equal(await fs.readFile(results[0].value.backupPath, "utf8"), "original");
  assert.equal(await fs.readFile(target, "utf8"), "first");
  await fs.writeFile(target, "external edit");
  await assert.rejects(savePlainTextAsset(target, { content: "old UI", expectedRevision: results[0].value.revision }), { statusCode: 409 });
  assert.equal(await fs.readFile(target, "utf8"), "external edit");
});

test("non-UTF8 text is readonly and UTF8 BOM survives edits", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-encoding-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, bytes] of [["utf16.txt", Buffer.from("\uFEFF编码", "utf16le")], ["legacy.md", Buffer.from([0xd6, 0xd0, 0xce, 0xc4])], ["binary.txt", Buffer.from("a\0b")]]) {
    const target = path.join(root, name);
    await fs.writeFile(target, bytes);
    assert.equal(textEditPolicy(target, bytes).editable, false);
    await assert.rejects(savePlainTextAsset(target, { content: "bad edit", expectedRevision: textContentRevision(bytes) }), { statusCode: 415 });
    assert.deepEqual(await fs.readFile(target), bytes);
  }
  const bomTarget = path.join(root, "bom.txt");
  const bomBytes = Buffer.from("\uFEFForiginal", "utf8");
  await fs.writeFile(bomTarget, bomBytes);
  assert.equal(textEditPolicy(bomTarget, bomBytes).editable, true);
  await savePlainTextAsset(bomTarget, { content: "edited", expectedRevision: textContentRevision(bomBytes) });
  assert.deepEqual(await fs.readFile(bomTarget), Buffer.from("\uFEFFedited", "utf8"));
});

test("partial event failures retry only failed paths and exhaustion does not lose later events", async () => {
  const calls = [];
  const good = path.resolve("/assets/good.png");
  const bad = path.resolve("/assets/bad.png");
  const queue = new CoalescingPathUpdateQueue(async (paths) => {
    calls.push(paths);
    return { retryPaths: calls.length < 3 ? paths.filter((item) => item === bad) : [] };
  }, { retryDelayMs: 0 });
  await queue.enqueue([good, bad]);
  assert.deepEqual(calls, [[good, bad], [bad], [bad]]);
  let attempts = 0;
  const exhausted = new CoalescingPathUpdateQueue(async () => { attempts += 1; throw new Error("disk unavailable"); }, { retryDelayMs: 0 });
  await assert.rejects(exhausted.enqueue([bad]), /disk unavailable/);
  assert.equal(attempts, 3);
  exhausted.worker = async () => ({ recovered: true });
  assert.deepEqual(await exhausted.enqueue([good]), { recovered: true });
});

test("watcher errors, unknown filenames and replaced roots trigger safe calibration and reattachment", async () => {
  const root = path.resolve("/assets");
  const handles = [];
  const dirty = [];
  const changes = [];
  let inode = 1;
  const watchers = new RecoveringAssetWatchers({
    stat: async () => ({ dev: 1, ino: inode, isDirectory: () => true }),
    watch: (_root, _options, callback) => {
      const handle = new EventEmitter();
      handle.callback = callback;
      handle.close = () => handle.emit("close");
      handles.push(handle);
      return handle;
    },
    onChange: (filePath) => changes.push(filePath),
    onDirty: (filePath) => dirty.push(filePath),
  });
  await watchers.reconcile([root]);
  handles[0].callback("rename", null);
  handles[0].callback("change", "hero.png");
  handles[0].emit("error", new Error("watch lost"));
  assert.equal(watchers.handles.size, 0);
  await watchers.reconcile([root]);
  assert.equal(handles.length, 2);
  inode = 2;
  await watchers.reconcile([root]);
  assert.equal(handles.length, 3);
  assert.deepEqual(changes, [path.join(root, "hero.png")]);
  assert.ok(dirty.length >= 4);
  watchers.closeAll();
});

test("metadata calibration keeps unchanged media cached and reports inaccessible subtrees", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-calibration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stable = path.join(root, "stable.png");
  const changed = path.join(root, "changed.txt");
  const inaccessible = path.join(root, "inaccessible");
  await fs.mkdir(inaccessible);
  await fs.writeFile(stable, "image fixture");
  await fs.writeFile(changed, "new text");
  const stableStats = await fs.stat(stable);
  const io = { ...fs, readdir: async (directory, options) => {
    if (directory === inaccessible) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return fs.readdir(directory, options);
  } };
  const inventory = await collectAssetDirectory(root, new Set([".png", ".txt"]), { io });
  assert.deepEqual(inventory.failedPaths, [inaccessible]);
  const delta = await changedAssetCandidates(inventory.files, [{ sourcePath: stable, size: stableStats.size, mtimeMs: stableStats.mtimeMs }]);
  assert.deepEqual(delta.changed, [changed]);
  const limited = await collectAssetDirectory(root, new Set([".png", ".txt"]), { limit: 1 });
  assert.deepEqual(limited.failedPaths, [root], "truncated enumeration must not delete unseen assets");
});

test("metadata calibration covers 35001 assets while an explicit budget preserves truncated subtrees", async () => {
  const root = path.resolve("/synthetic-asset-calibration");
  const io = { readdir: async () => Array.from({ length: 35001 }, (_, index) => ({
    name: `image-${String(index).padStart(5, "0")}.png`, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
  })) };
  const complete = await collectAssetDirectory(root, new Set([".png"]), { io });
  assert.equal(complete.files.length, 35001);
  assert.equal(complete.truncated, false);
  assert.deepEqual(complete.failedPaths, []);
  const bounded = await collectAssetDirectory(root, new Set([".png"]), { io, limit: 12 });
  assert.equal(bounded.files.length, 12);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(bounded.failedPaths, [root], "incomplete enumeration must protect all unseen cached rows from deletion");
  assert.equal(bounded.limit, 12);
});

test("index coalesces durable writes, skips unchanged patches and rolls back memory after I/O failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-write-batch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const index = new PersistentAssetIndex({ filePath: path.join(root, "index.json") });
  const persist = index.persistState.bind(index);
  let writes = 0;
  index.persistState = async (state) => { writes += 1; await persist(state); };
  const projects = ["a", "b"].map((id) => ({ id, name: id, folders: [path.join(root, id)] }));
  await Promise.all(projects.map((project) => index.replaceProject(project, [])));
  assert.equal(writes, 1);
  await index.patchProject(projects[0], { upserts: [] });
  assert.equal(writes, 1, "no-op patch does not serialize the full index");
  index.persistState = async () => { throw new Error("disk full"); };
  await assert.rejects(index.patchProject(projects[0], { upserts: [{ id: "unsaved", sourcePath: path.join(root, "a.png") }] }), /disk full/);
  assert.deepEqual((await index.getProject("a")).assets, []);
  index.persistState = persist;
  await index.patchProject(projects[1], { upserts: [{ id: "saved", sourcePath: path.join(root, "b.png") }] });
  const disk = new PersistentAssetIndex({ filePath: path.join(root, "index.json") });
  assert.deepEqual((await disk.getProject("a")).assets, []);
  assert.equal((await disk.getProject("b")).assets[0].id, "saved");
});

test("invalid or unreadable persistent indexes fail closed and can retry after recovery", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-invalid-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "index.json");
  const project = { id: "safe", name: "Safe", folders: [root] };
  for (const original of ["{corrupted json", JSON.stringify({ schemaVersion: 999, projects: {} }), JSON.stringify({ schemaVersion: 1, projects: null })]) {
    await fs.writeFile(target, original);
    const index = new PersistentAssetIndex({ filePath: target });
    await assert.rejects(index.getProject("safe"));
    await assert.rejects(index.replaceProject(project, []));
    assert.equal(await fs.readFile(target, "utf8"), original, "failure must not overwrite an existing index with empty state");
    await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, projects: {} }));
    assert.equal(await index.getProject("safe"), null, "a failed load promise must be retryable");
  }
  const directoryIndex = new PersistentAssetIndex({ filePath: root });
  await assert.rejects(directoryIndex.load(), { code: "EISDIR" });
});

test("built-in index changes use copy-on-write while arbitrary mutation rollback preserves nested assets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-cow-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const index = new PersistentAssetIndex({ filePath: path.join(root, "index.json") });
  const a = { id: "a", name: "A", folders: [root] };
  const b = { id: "b", name: "B", folders: [root] };
  await Promise.all([
    index.replaceProject(a, [{ id: "a1", sourcePath: path.join(root, "a.png"), tags: ["original"] }]),
    index.replaceProject(b, [{ id: "b1", sourcePath: path.join(root, "b.png"), tags: ["other"] }]),
  ]);
  const beforeA = await index.getProjectSnapshot("a");
  const beforeB = await index.getProjectSnapshot("b");
  await index.patchProject(a, { upserts: [{ ...beforeA.assets[0], tags: ["updated"] }] });
  assert.strictEqual(await index.getProjectSnapshot("b"), beforeB, "unrelated project data is not deep cloned");
  assert.deepEqual(beforeA.assets[0].tags, ["original"], "old snapshots remain immutable through internal writes");
  const persist = index.persistState.bind(index);
  index.persistState = async () => { throw new Error("failure"); };
  await assert.rejects(index.mutate((draft) => { draft.projects.a.assets[0].tags.push("must rollback"); }), /failure/);
  assert.deepEqual((await index.getProjectSnapshot("a")).assets[0].tags, ["updated"]);
  await assert.rejects(index.patchProject(b, { upserts: [{ id: "not committed", sourcePath: path.join(root, "x.png") }] }), /failure/);
  assert.strictEqual(await index.getProjectSnapshot("b"), beforeB);
  index.persistState = persist;
});
