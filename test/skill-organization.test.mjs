import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { createSkillOrganizationStore, createSkillOrganizationController, revealInstalledSkill, SkillOrganizationBridge } from "../lib/skill-organization.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "aiyou-skills-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["a", "b"]) {
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, "SKILL.md"), "---\nname: same-name\ndescription: 图片制作测试\n---\nDo not execute this body.\n");
  }
  const catalog = await readInstalledSkillCatalog({ roots: [root] });
  const filePath = path.join(root, "preferences", "organization.json");
  const store = createSkillOrganizationStore({ filePath });
  return { root, catalog, filePath, store };
}

test("manual categories persist across controllers, name changes, reloads and simultaneous windows without moving Skill files", async (t) => {
  const { root, catalog, store, filePath } = await fixture(t);
  assert.equal(catalog.length, 2);
  const before = await readFile(catalog[0].skillFile, "utf8");
  const controller = createSkillOrganizationController({ store, readCatalog: async () => catalog });
  let view = await controller.request({ action: "createGroup", label: "我的流程", expectedVersion: 0 });
  const group = view.groups.at(-1);
  view = await controller.request({ action: "moveSkill", skillId: catalog[0].id, groupId: group.id, expectedVersion: 1 });
  assert.equal(view.catalog[0].categoryId, group.id);
  assert.equal(view.catalog[1].categoryId, "visual", "Same-name entry in another source remains separate");
  const fresh = createSkillOrganizationController({ store: createSkillOrganizationStore({ filePath }), readCatalog: async () => catalog });
  assert.deepEqual(await fresh.snapshot(), view);
  await assert.rejects(fresh.request({ action: "renameGroup", groupId: group.id, label: "新名字", expectedVersion: 1 }), { code: "SKILLS_CONFLICT" });
  view = await fresh.request({ action: "renameGroup", groupId: group.id, label: "新名字", expectedVersion: 2 });
  assert.equal(view.groups.at(-1).label, "新名字");
  assert.equal(view.catalog[0].categoryId, group.id);
  // Two versions race through separate store objects; only one may commit.
  const concurrent = await Promise.allSettled([controller.request({ action: "createGroup", label: "甲", expectedVersion: 3 }), fresh.request({ action: "createGroup", label: "乙", expectedVersion: 3 })]);
  assert.equal(concurrent.filter((entry) => entry.status === "fulfilled").length, 1);
  view = await controller.request({ action: "deleteGroup", groupId: group.id, expectedVersion: 4 });
  assert.equal(view.catalog[0].classificationSource, "automatic");
  assert.equal(view.catalog[0].categoryId, "visual");
  view = await controller.request({ action: "moveSkill", skillId: catalog[0].id, groupId: "office", expectedVersion: 5 });
  assert.equal(view.catalog[0].categoryId, "office");
  view = await controller.request({ action: "moveSkill", skillId: catalog[0].id, groupId: null, expectedVersion: 6 });
  assert.equal(view.catalog[0].categoryId, "visual");
  assert.equal(await readFile(catalog[0].skillFile, "utf8"), before);
  assert.equal((await readInstalledSkillCatalog({ roots: [root] })).length, 2);
});

test("invalid custom names, built-ins, arbitrary file inputs and stale identities cannot mutate preferences or launch files", async (t) => {
  const { catalog, store, filePath } = await fixture(t);
  const revealed = [];
  const controller = createSkillOrganizationController({ store, readCatalog: async () => catalog, reveal: async (entry) => { revealed.push(entry); return { status: "requested" }; } });
  for (const label of ["", "全部", "常用", "影视分镜", "a".repeat(25), "a\nb"]) await assert.rejects(controller.request({ action: "createGroup", label, expectedVersion: 0 }));
  await assert.rejects(controller.request({ action: "deleteGroup", groupId: "video", expectedVersion: 0 }));
  await assert.rejects(controller.request({ action: "moveSkill", skillId: "skill:unknown", groupId: "video", expectedVersion: 0 }));
  await assert.rejects(controller.request({ action: "moveSkill", skillId: catalog[0].id, groupId: "all", expectedVersion: 0 }));
  await assert.rejects(controller.request({ action: "revealSkill", skillId: catalog[0].id, path: "/another/file" }));
  await assert.rejects(controller.request({ action: "revealSkill", skillId: "same-name" }));
  assert.equal(revealed.length, 0);
  await controller.request({ action: "revealSkill", skillId: catalog[1].id });
  assert.equal(revealed[0].skillFile, catalog[1].skillFile);
  assert.equal((await store.read()).version, 0);
  await writeFile(filePath, "broken");
  await assert.rejects(controller.request({ action: "createGroup", label: "新分类", expectedVersion: 0 }));
  assert.equal(await readFile(filePath, "utf8"), "broken", "Unreadable configuration is never replaced silently");
});

test("reveal selects exact SKILL.md in its parent on macOS/Windows and refuses removed files", async (t) => {
  const { root, catalog } = await fixture(t);
  const launches = [];
  const hostPlatform = process.platform === "win32" ? "win32" : "darwin";
  const options = { platform: hostPlatform, env: { SystemRoot: "C:\\Windows" }, launch: async (...args) => { launches.push(args); } };
  await revealInstalledSkill(catalog[0], options);
  assert.deepEqual(launches[0].slice(0, 2), hostPlatform === "win32"
    ? ["C:\\Windows\\explorer.exe", ["/select,", catalog[0].skillFile]] : ["/usr/bin/open", ["-R", catalog[0].skillFile]]);
  assert.equal(launches[0][2].shell, false);
  const macFile = "/Users/fixture/Skills 测试/同名/SKILL.md";
  await revealInstalledSkill({ ...catalog[0], skillFile: macFile }, { platform: "darwin",
    statPath: async () => ({ isFile: () => true }), realPath: async () => macFile, launch: options.launch });
  assert.deepEqual(launches[1].slice(0, 2), ["/usr/bin/open", ["-R", macFile]]);
  const winFile = "C:\\Skills 测试\\同名\\SKILL.md";
  await revealInstalledSkill({ ...catalog[1], skillFile: winFile }, { platform: "win32", env: { SystemRoot: "C:\\Windows" },
    statPath: async () => ({ isFile: () => true }), realPath: async () => winFile, launch: options.launch });
  assert.deepEqual(launches[2].slice(0, 2), ["C:\\Windows\\explorer.exe", ["/select,", winFile]]);
  await rm(catalog[0].skillFile);
  await assert.rejects(revealInstalledSkill(catalog[0], options), /不存在/);
  if (process.platform !== "win32") {
    await symlink(catalog[1].skillFile, path.join(root, "a", "SKILL.md"));
    await assert.rejects(revealInstalledSkill(catalog[0], options), /链接已改变/);
  }
  assert.equal(launches.length, 3);
});

test("Skills bridge isolates its binding, rejects iframe requests and deduplicates actions", async () => {
  const events = new Map(), calls = [], requests = [];
  const client = { on: (name, callback) => { events.set(name, callback); return () => events.delete(name); },
    executionContexts: new Map([[1, { id: 1, auxData: { isDefault: true, frameId: "top" } }], [2, { id: 2, auxData: { isDefault: true, frameId: "child" } }]]),
    send: async (name, value) => { calls.push({ name, value }); return name === "Page.getFrameTree" ? { frameTree: { frame: { id: "top" } } } : {}; } };
  const bridge = new SkillOrganizationBridge({ request: async (payload) => { requests.push(payload); return {}; } });
  await bridge.install(client);
  assert.deepEqual(calls.filter((call) => call.name === "Runtime.addBinding").map((call) => call.value), [{ name: "__AIYOUCODEX_SKILLS_REQUEST__", executionContextId: 1 }]);
  const packet = { name: "__AIYOUCODEX_SKILLS_REQUEST__", executionContextId: 2, payload: JSON.stringify({ requestId: "test", action: "refresh" }) };
  await bridge.receive(packet); assert.equal(requests.length, 0);
  packet.executionContextId = 1;
  await bridge.receive(packet); await bridge.receive(packet);
  assert.equal(requests.length, 1);
  assert.match(calls.findLast((call) => call.name === "Runtime.evaluate").value.expression, /resolveSkillOrganizationRequest/);
  bridge.dispose();
});
