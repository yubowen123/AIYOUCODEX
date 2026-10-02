import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreviewRepository } from "../lib/preview-data.mjs";

test("remote project registry is independent of local history and host-scoped without importing secrets", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-remote-projects-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, ".codex-global-state.json");
  await writeFile(file, JSON.stringify({ "remote-projects": [
    { id: "same", hostId: "remote:one", label: "同名项目", remotePath: "/Users/test/a", secret: "must-not-copy" },
    { id: "same", hostId: "remote:two", label: "同名项目", remotePath: "/Users/test/a" },
    { id: "local", hostId: "local", label: "不是远程", remotePath: "/Users/test/a" },
  ] }));
  const repository = new PreviewRepository({ codexHome: root });
  const first = await repository.readRemoteProjectCatalog();
  assert.equal(first.length, 2);
  assert.notEqual(first[0].id, first[1].id);
  assert.ok(!JSON.stringify(first).includes("must-not-copy"));
  assert.ok(first.every(item => item.remote && !Object.hasOwn(item, "projectRootPath")));
  assert.equal(await repository.readRemoteProjectCatalog(), first, "Unchanged state uses the metadata cache");
  await writeFile(file, '{"remote-projects":[{"id":"third","hostId":"remote:three","label":"新远程项目","remotePath":"/new"}]}');
  assert.equal((await repository.readRemoteProjectCatalog())[0].label, "新远程项目");
  await writeFile(file, "{invalid");
  assert.deepEqual(await repository.readRemoteProjectCatalog(), []);
});
