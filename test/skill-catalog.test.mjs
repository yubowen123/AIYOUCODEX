import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";

test("installed Skill catalog preserves distinct sources with the same internal name", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-catalog-"));
  const primary = path.join(fixture, "primary");
  const fallback = path.join(fixture, "fallback");
  try {
    await mkdir(path.join(primary, "demo", "agents"), { recursive: true });
    await mkdir(path.join(fallback, "demo"), { recursive: true });
    await writeFile(path.join(primary, "demo", "SKILL.md"), "---\nname: demo\ndescription: Search local assets\n---\n");
    await writeFile(path.join(primary, "demo", "agents", "openai.yaml"), "interface:\n  display_name: 本地资产检索\n");
    await writeFile(path.join(fallback, "demo", "SKILL.md"), "---\nname: demo\ndescription: fallback\n---\n");

    const catalog = await readInstalledSkillCatalog({ roots: [primary, fallback] });
    assert.equal(catalog.length, 2);
    const preferred = catalog.find((skill) => skill.title === "本地资产检索");
    assert.equal(preferred.name, "demo");
    assert.equal(preferred.description, "Search local assets");
    assert.equal(preferred.path, await realpath(path.join(primary, "demo")));
    assert.equal(preferred.skillFile, path.join(preferred.path, "SKILL.md"));
    assert.equal(preferred.source, "custom");
    assert.match(preferred.id, /^skill:[a-f0-9]{64}$/u);
    assert.equal(new Set(catalog.map((skill) => skill.id)).size, 2);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

async function createSkill(root, name, description = "Fixture") {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
  return directory;
}

test("repository skills include cwd through git root, with user and plugin roots", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-scope-"));
  try {
    const homeDir = path.join(fixture, "home");
    const repo = path.join(fixture, "repo");
    const cwd = path.join(repo, "packages", "feature");
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(repo, ".git"), "gitdir: worktree-meta\n");
    await createSkill(path.join(fixture, ".agents", "skills"), "outside-repo");
    await createSkill(path.join(repo, ".agents", "skills"), "repo-skill");
    await createSkill(path.join(repo, "packages", ".agents", "skills"), "parent-skill");
    await createSkill(path.join(cwd, ".agents", "skills"), "cwd-skill");
    await createSkill(path.join(homeDir, ".codex", "skills"), "codex-user");
    await createSkill(path.join(homeDir, ".agents", "skills"), "agents-user");
    await createSkill(path.join(homeDir, ".codex", "plugins", "cache", "plug", "1", "skills"), "plugin");
    const catalog = await readInstalledSkillCatalog({ homeDir, cwd });
    assert.deepEqual(catalog.map((skill) => skill.name).sort(), ["agents-user", "codex-user", "cwd-skill", "parent-skill", "plugin", "repo-skill"]);
    assert.equal(catalog.filter((skill) => skill.source === "repository").length, 3);
    assert.equal(catalog.find((skill) => skill.name === "plugin").source, "plugin");
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("non-repository lookup does not include ancestor skills", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-no-git-"));
  try {
    const cwd = path.join(fixture, "workspace");
    await createSkill(path.join(fixture, ".agents", "skills"), "unrelated");
    await createSkill(path.join(cwd, ".agents", "skills"), "local");
    const catalog = await readInstalledSkillCatalog({ homeDir: path.join(fixture, "empty-home"), cwd });
    assert.deepEqual(catalog.map((skill) => skill.name), ["local"]);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("symlink discovery follows external skill directories without cycles or duplicate identities", async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-links-"));
  try {
    const root = path.join(fixture, "root");
    const target = await createSkill(path.join(fixture, "external"), "linked-skill");
    await mkdir(root, { recursive: true });
    try {
      await symlink(target, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
      await symlink(root, path.join(target, "cycle"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip(`Symbolic links unavailable: ${error.code}`); return; }
      throw error;
    }
    const catalog = await readInstalledSkillCatalog({ roots: [root, target] });
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].skillFile, await realpath(path.join(target, "SKILL.md")));
    const direct = await readInstalledSkillCatalog({ roots: [target] });
    assert.equal(catalog[0].id, direct[0].id);
    assert.equal(catalog[0].sourceRoot, root);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("catalog scan skips ignored trees and reports bounded traversal", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-bounds-"));
  try {
    await createSkill(path.join(fixture, "node_modules"), "ignored");
    await createSkill(fixture, "first");
    await createSkill(fixture, "second");
    const diagnostics = [];
    const catalog = await readInstalledSkillCatalog({ roots: [fixture], limits: { maxSkills: 1 }, onDiagnostic: (value) => diagnostics.push(value) });
    assert.equal(catalog.length, 1);
    assert.notEqual(catalog[0].name, "ignored");
    assert.equal(diagnostics[0].truncated, true);
    assert.equal(diagnostics[0].skills, 1);
    const limited = [];
    await readInstalledSkillCatalog({ roots: [fixture], limits: { maxEntries: 1 }, onDiagnostic: (value) => limited.push(value) });
    assert.equal(limited[0].entries, 1);
    assert.equal(limited[0].truncated, true);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("catalog reads bounded metadata including CRLF and multiline YAML without loading large bodies", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-metadata-"));
  try {
    const directory = await createSkill(fixture, "demo");
    await writeFile(path.join(directory, "SKILL.md"), '\uFEFF---\r\nname: "stable-id"\r\ndescription: >-\r\n  First line\r\n  second line\r\n---\r\n' + "x".repeat(100_000));
    const catalog = await readInstalledSkillCatalog({ roots: [fixture], limits: { maxMetadataBytes: 512 } });
    assert.equal(catalog[0].name, "stable-id");
    assert.equal(catalog[0].description, "First line second line");
    assert.equal((await readInstalledSkillCatalog({ roots: [path.join(fixture, "missing")] })).length, 0);
    assert.deepEqual(await readInstalledSkillCatalog({ roots: [] }), []);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("directory and depth limits permit metadata in the current directory but stop deeper trees", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-depth-"));
  try {
    const direct = await createSkill(fixture, "direct");
    await createSkill(path.join(direct, "nested"), "deep");
    const diagnostics = [];
    const oneDirectory = await readInstalledSkillCatalog({ roots: [direct], limits: { maxDirectories: 1 }, onDiagnostic: (value) => diagnostics.push(value) });
    assert.deepEqual(oneDirectory.map((skill) => skill.name), ["direct"]);
    assert.equal(diagnostics[0].directories, 1);
    assert.equal(diagnostics[0].truncated, true);
    const shallow = await readInstalledSkillCatalog({ roots: [fixture], limits: { maxDepth: 1 } });
    assert.deepEqual(shallow.map((skill) => skill.name), ["direct"]);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
