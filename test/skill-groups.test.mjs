import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSkillGroups, resolveSkillFavorites, skillMatchesGroup, automaticSkillCategory, presentSkillOrganization, DEFAULT_GROUPS } from "../lib/skill-groups.mjs";

test("skill groups retain required built-ins and safe configurable categories", () => {
  const normalized = normalizeSkillGroups({ groups: [
    { id: "common", label: "replace", keywords: ["bad"] },
    { id: "custom", label: "开发", keywords: [" Node ", "Node", "C++", ""] },
    { id: "custom", label: "duplicate", keywords: ["skip"] },
    { id: "other", label: "开发", keywords: ["skip"] },
    { id: "all", label: "replace", keywords: ["bad"] },
    null, "bad", { label: "empty", keywords: [] },
  ], defaultFavorites: ["skill:1", "skill:1", " legacy ", null] });
  assert.deepEqual(normalized, { groups: [
    { id: "all", label: "全部", keywords: [], builtin: true },
    { id: "common", label: "常用", keywords: [], builtin: true },
    { id: "custom", label: "开发", keywords: ["Node", "C++"], builtin: false },
    { id: "empty", label: "empty", keywords: [], builtin: false },
  ], defaultFavorites: ["skill:1", "legacy"] });
  assert.equal(normalizeSkillGroups(null).groups.length, 8);
  assert.equal(normalizeSkillGroups({ groups: [] }).groups.length, 2);
  assert.equal(normalizeSkillGroups({ categories: [{ label: "配置分类", keywords: ["word"] }] }).groups[2].id, "配置分类");
});

test("skill category matching is literal and case-insensitive, never a regex", () => {
  const skill = { id: "skill:1", title: "Node C++", description: "type-check", name: "compiler" };
  assert.equal(skillMatchesGroup(skill, { keywords: ["node"] }), true);
  assert.equal(skillMatchesGroup(skill, { keywords: ["C++"] }), true);
  assert.equal(skillMatchesGroup(skill, { keywords: [".*"] }), false);
  assert.equal(skillMatchesGroup(skill, { keywords: ["(a+)+$"] }), false);
  assert.equal(skillMatchesGroup(skill, { id: "all" }), true);
  assert.equal(skillMatchesGroup(skill, { id: "common" }, ["skill:1"]), true);
  assert.equal(skillMatchesGroup(skill, { id: "common" }, ["Node C++"]), false);
});

test("favorites migrate unambiguous legacy references without selecting same-name skills together", () => {
  const catalog = [
    { id: "skill:a", name: "same", title: "同名", skillFile: "/a/SKILL.md", path: "/a" },
    { id: "skill:b", name: "same", title: "同名", skillFile: "/b/SKILL.md", path: "/b" },
    { id: "skill:c", name: "unique", title: "唯一", skillFile: "/c/SKILL.md", path: "/c" },
  ];
  assert.deepEqual(resolveSkillFavorites(["same", "同名", "unique", "skill:a", "/b/SKILL.md", "missing", "唯一"], catalog), ["skill:c", "skill:a", "skill:b"]);
  assert.deepEqual(resolveSkillFavorites(null, catalog), []);
});

test("group configuration is bounded and normalizing defaults does not mutate shared values", () => {
  const defaults = normalizeSkillGroups();
  defaults.groups[2].keywords.push("modified");
  assert.equal(normalizeSkillGroups().groups[2].keywords.includes("modified"), false);
  const result = normalizeSkillGroups({ groups: Array.from({ length: 100 }, (_, index) => ({ id: String(index), label: `Group ${index}`, keywords: ["x".repeat(1000)] })), defaultFavorites: Array.from({ length: 500 }, (_, index) => String(index)) });
  assert.equal(result.groups.length, 34);
  assert.equal(result.groups[2].keywords[0].length, 80);
  assert.equal(result.defaultFavorites.length, 128);
});

test("six exclusive automatic categories cover every Skill, metadata-only with explicit manual precedence", () => {
  const cases = [
    ["seedance-video", "video"], ["nolan-visual-prompts", "video"], ["aimv-orchestrator", "video"],
    ["imagegen", "visual"], ["alibaba-mj-image", "visual"], ["knowledge-card-generator", "visual"],
    ["suno-music-production", "audio"], ["voice", "audio"], ["aiyou-audio-storyboard", "audio"],
    ["screenplay-humanizer-cn", "writing"], ["deep-research", "writing"], ["podcast-to-article", "writing"],
    ["dingtalk-chat", "office"], ["Spreadsheets", "office"], ["manage-taskboard", "office"],
    ["skill-creator", "tools"], ["systematic-debugging", "tools"], ["new-unknown-capability", "tools"],
    ["ckm:brand", "visual"], ["guangbo-ai-podcast", "audio"], ["creative-shortdrama-workflow", "video"],
    ["interactive-drama", "video"], ["screenplay-visual-storyboard-json", "video"], ["video-backend", "tools"],
  ];
  for (const [name, category] of cases) assert.equal(automaticSkillCategory({ name }), category, name);
  assert.equal(automaticSkillCategory({ name: "skill-creator", description: "生成图片和视频技能" }), "tools", "Precise name outranks incidental description words");
  const catalog = cases.map(([name], i) => ({ id: `skill:${i}`, name }));
  const view = presentSkillOrganization(catalog, { version: 2, groups: [{ id: "custom-one", label: "我的流程" }], assignments: { "skill:0": "custom-one" } });
  assert.deepEqual(view.groups.slice(0, 2).map((g) => g.id), ["all", "common"]);
  assert.equal(DEFAULT_GROUPS.length, 6);
  assert.equal(view.catalog[0].categoryId, "custom-one");
  assert.equal(view.catalog[0].automaticCategoryId, "video");
  assert.equal(view.catalog[0].classificationSource, "manual");
  assert.equal(view.groups.slice(2).reduce((sum, group) => sum + view.catalog.filter((skill) => skill.categoryId === group.id).length, 0), catalog.length, "Every entry assigned exactly once");
  assert.equal(presentSkillOrganization(catalog, { assignments: { "skill:0": "deleted" } }).catalog[0].categoryId, "video");
});
