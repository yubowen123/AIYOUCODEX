import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSkillGroups, resolveSkillFavorites, skillMatchesGroup } from "../lib/skill-groups.mjs";

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
    { id: "common", label: "常用", keywords: [], builtin: true },
    { id: "custom", label: "开发", keywords: ["Node", "C++"], builtin: false },
    { id: "all", label: "全部", keywords: [], builtin: true },
  ], defaultFavorites: ["skill:1", "legacy"] });
  assert.equal(normalizeSkillGroups(null).groups.length, 8);
  assert.equal(normalizeSkillGroups({ groups: [] }).groups.length, 2);
  assert.equal(normalizeSkillGroups({ categories: [{ label: "配置分类", keywords: ["word"] }] }).groups[1].id, "配置分类");
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
  defaults.groups[1].keywords.push("modified");
  assert.equal(normalizeSkillGroups().groups[1].keywords.includes("modified"), false);
  const result = normalizeSkillGroups({ groups: Array.from({ length: 100 }, (_, index) => ({ id: String(index), label: `Group ${index}`, keywords: ["x".repeat(1000)] })), defaultFavorites: Array.from({ length: 500 }, (_, index) => String(index)) });
  assert.equal(result.groups.length, 34);
  assert.equal(result.groups[1].keywords[0].length, 80);
  assert.equal(result.defaultFavorites.length, 128);
});
