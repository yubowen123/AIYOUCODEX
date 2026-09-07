import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build"]);
const DEFAULT_LIMITS = Object.freeze({
  maxDirectories: 12_000, maxEntries: 60_000, maxSkills: 5_000,
  maxDepth: 16, maxMetadataBytes: 65_536, maxDurationMs: 15_000,
});

function scanLimits(values = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [
    key,
    Number.isSafeInteger(values?.[key]) && values[key] > 0 ? Math.min(values[key], fallback) : fallback,
  ]));
}

function unquote(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  return text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : text;
}

function frontmatterValue(source, key) {
  const block = String(source || "").replace(/^\uFEFF/u, "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/u)?.[1] || "";
  const match = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "mu"));
  if (!match) return "";
  const value = match[1].trim();
  if (/^[>|][-+]?$/u.test(value)) {
    const remainder = block.slice(match.index + match[0].length);
    return remainder.match(/^(?:\r?\n[ \t]+[^\n]*)+/u)?.[0]
      ?.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join(" ") || "";
  }
  return unquote(value);
}

async function metadataPrefix(filePath, maxBytes) {
  let handle;
  try {
    if (!(await stat(filePath)).isFile()) return "";
    handle = await open(filePath, "r");
    if (!(await handle.stat()).isFile()) return "";
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch { return ""; } finally { await handle?.close(); }
}

async function repositoryRoots(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return [];
  const ancestors = [];
  let directory = path.resolve(cwd);
  // Worktrees have a .git file, while ordinary checkouts have a directory.
  for (let depth = 0; depth < 64; depth += 1) {
    ancestors.push(directory);
    try {
      await lstat(path.join(directory, ".git"));
      return ancestors.map((parent) => ({ path: path.join(parent, ".agents", "skills"), source: "repository" }));
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  // Outside a repository, do not pull unrelated ancestor directories into scope.
  return [{ path: path.join(path.resolve(cwd), ".agents", "skills"), source: "repository" }];
}

async function readSkill(skillPath, root, priority, limits) {
  let canonicalFile;
  try {
    canonicalFile = await realpath(skillPath);
    if (!(await stat(canonicalFile)).isFile()) return null;
  } catch { return null; }
  const source = await metadataPrefix(canonicalFile, limits.maxMetadataBytes);
  if (!source) return null;
  const directory = path.dirname(canonicalFile);
  const name = frontmatterValue(source, "name") || path.basename(directory);
  const description = frontmatterValue(source, "description") || "打开查看 Skill 详情";
  const yaml = await metadataPrefix(path.join(directory, "agents", "openai.yaml"), limits.maxMetadataBytes);
  const displayName = unquote(yaml.match(/^\s*display_name:[ \t]*(.+)$/mu)?.[1]);
  return {
    id: `skill:${createHash("sha256").update(canonicalFile).digest("hex")}`,
    name, title: displayName || name, description, path: directory,
    skillFile: canonicalFile, source: root.source, sourceRoot: root.path, priority,
  };
}

async function scanRoot(root, priority, state) {
  async function walk(directory, depth) {
    if (state.exhausted() || depth > state.limits.maxDepth || state.directories >= state.limits.maxDirectories) {
      state.truncated = true;
      return;
    }
    let canonicalDirectory;
    try { canonicalDirectory = await realpath(directory); } catch { return; }
    if (state.visited.has(canonicalDirectory)) return;
    state.visited.add(canonicalDirectory);
    state.directories += 1;
    let entries;
    try { entries = await opendir(canonicalDirectory); } catch { return; }
    for await (const entry of entries) {
      if (state.exhausted()) { state.truncated = true; break; }
      state.entries += 1;
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(canonicalDirectory, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(entryPath);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch { continue; }
      }
      if (isFile && entry.name === "SKILL.md") {
        const skill = await readSkill(entryPath, root, priority, state.limits);
        if (skill && !state.skills.has(skill.id)) state.skills.set(skill.id, skill);
      } else if (isDirectory) await walk(entryPath, depth + 1);
    }
  }
  await walk(root.path, 0);
}

/** Metadata-only discovery. Limits bound linked plugin trees as well as repository roots. */
export async function readInstalledSkillCatalog({
  homeDir = os.homedir(), roots, cwd = process.cwd(), limits, onDiagnostic,
} = {}) {
  const candidates = Array.isArray(roots)
    ? roots.slice(0, 128).filter((root) => typeof root === "string" && root.trim()).map((root) => ({ path: path.resolve(root), source: "custom" }))
    : [
      ...await repositoryRoots(cwd),
      { path: path.join(homeDir, ".codex", "skills"), source: "user" },
      { path: path.join(homeDir, ".agents", "skills"), source: "user" },
      { path: path.join(homeDir, ".codex", "plugins", "cache"), source: "plugin" },
    ];
  const state = {
    limits: scanLimits(limits), visited: new Set(), skills: new Map(),
    entries: 0, directories: 0, truncated: Array.isArray(roots) && roots.length > 128, startedAt: Date.now(),
    exhausted() {
      return this.entries >= this.limits.maxEntries || this.skills.size >= this.limits.maxSkills
        || Date.now() - this.startedAt >= this.limits.maxDurationMs;
    },
  };
  for (const [priority, root] of candidates.entries()) {
    if (state.exhausted()) { state.truncated = true; break; }
    await scanRoot(root, priority, state);
  }
  if (typeof onDiagnostic === "function") onDiagnostic({
    truncated: state.truncated, directories: state.directories, entries: state.entries, skills: state.skills.size,
  });
  return [...state.skills.values()].map(({ priority: _priority, ...skill }) => skill)
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN") || left.skillFile.localeCompare(right.skillFile));
}
