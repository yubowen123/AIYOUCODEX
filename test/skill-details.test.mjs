import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile, mkdir, open, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { summarizeSkillDocument, createSkillDetailsReader } from "../lib/skill-details.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { createSkillOrganizationController } from "../lib/skill-organization.mjs";

test("Skill usage/scenarios are excerpts, not invented or executed instructions", () => {
  const data = summarizeSkillDocument({ id: "fixture", description: "stale" }, "---\nname: example\ndescription: 新的准确介绍\n---\n# Example\n## 适用场景\n生成角色图\n## 使用方法\n1. 提供参考图\n### 参数\n设置尺寸\n```md\n## 输出结果\nnot a heading\n```\n## 输出结果\n图片文件\n## 输入要求\n参考图片\n");
  assert.equal(data.overview, "新的准确介绍");
  assert.equal(data.scenarios[0].text, "生成角色图");
  assert.match(data.usage[0].text, /### 参数/);
  assert.equal(data.outputs[0].text, "图片文件");
  assert.equal(data.inputs[0].text, "参考图片");
  const simple = summarizeSkillDocument({ id: "plain" }, "# Skill\n\n<img onerror='bad()'>\nOnly an overview.");
  assert.deepEqual(simple.scenarios, []); assert.deepEqual(simple.usage, []);
  assert.match(simple.document, /onerror/);
  const english = summarizeSkillDocument({ id: "en" }, "## When to use\nA case\n## Quick start\nDo this\n## Required inputs\nFile\n## Deliverables\nOutput");
  for (const kind of ["scenarios", "usage", "inputs", "outputs"]) assert.equal(english[kind].length, 1);
});

test("details read lazily, cache by file revision, bind exact same-name Skill and reject changed links", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "skill-details-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["a", "b"]) { await mkdir(path.join(root, name)); await writeFile(path.join(root, name, "SKILL.md"), `---\nname: same\ndescription: ${name}\n---\n## 使用方法\n${name}`); }
  const catalog = await readInstalledSkillCatalog({ roots: [root] });
  let reads = 0;
  const reader = createSkillDetailsReader({ openFile: (...args) => { reads++; return open(...args); } });
  const controller = createSkillOrganizationController({ readCatalog: async () => catalog, describe: reader });
  assert.equal(reads, 0);
  const first = await controller.request({ action: "describeSkill", skillId: catalog[0].id });
  assert.equal(first.skillDetails.overview, "a");
  await controller.request({ action: "describeSkill", skillId: catalog[0].id }); assert.equal(reads, 1);
  assert.equal((await reader(catalog[1])).overview, "b");
  await writeFile(catalog[0].skillFile, "---\nname: same\ndescription: c\n---\n## 使用方法\nc");
  assert.equal((await reader(catalog[0])).overview, "c");
  await writeFile(catalog[0].skillFile, "## 使用方法\n" + "字".repeat(30_000));
  const bounded = await reader(catalog[0]);
  assert.equal(bounded.truncated, true); assert.ok(bounded.document.length <= 24_000); assert.ok(bounded.usage[0].text.length <= 6000);
  await assert.rejects(controller.request({ action: "describeSkill", skillId: "same" }));
  await assert.rejects(controller.request({ action: "describeSkill", skillId: catalog[0].id, path: catalog[1].skillFile }));
  await rm(catalog[0].skillFile); await assert.rejects(reader(catalog[0]), /不存在/);
  if (process.platform !== "win32") { await symlink(catalog[1].skillFile, catalog[0].skillFile); await assert.rejects(reader(catalog[0]), /链接已改变/); }
});
