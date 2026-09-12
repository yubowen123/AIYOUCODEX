#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

export const REQUIRED_PRIVATE_IGNORE_RULES = Object.freeze([
  "managed-shortcuts.json",
  "*.private.json",
  "*.private.mjs",
  "*.local.json",
  ".aiyoucodex-private/",
  "**/efficiency/state.json",
  "**/efficiency/state.json.*",
  "hook-events.json",
  "hook-events.json.*",
  "hooks.json.aiyou-backup-*",
  "hooks.json.tmp-*",
  "hooks.json.lock/",
  "hooks.json.lock.*",
  "**/conversation-folders/directories.json",
  "**/conversation-folders/directories.json.*",
  ".aiyoucodex-thread.json",
  "**/skills/organization.json",
  "**/skills/organization.json.*",
  "**/skills/provenance.json",
  "**/skills/provenance.json.*",
  "**/model-arena/settings.json",
  "**/model-arena/settings.json.*",
  "**/model-arena/assets.json",
  "**/model-arena/assets.json.*",
  "**/model-arena/runs.json",
  "**/model-arena/runs.json.*",
  "**/model-arena/runs/",
  "**/model-arena/media/",
]);

// Internal channel identifiers are represented by case-insensitive token/domain
// fingerprints so the guard does not itself publish the names it is protecting.
export const PRIVATE_CONTENT_FINGERPRINTS = Object.freeze([
  "9752edb799ab5a61cf9ca42566df40f0e98ab4f70a57a0d5df288d013d37fc40",
  "0c4a3a8767909741bbe57349c8f8dfe855a2776fffa97b50e1a2584026539e58",
]);

const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".avif", ".heic",
  ".mp4", ".mov", ".mkv", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".m4a",
  ".zip", ".gz", ".tgz", ".br", ".7z", ".tar", ".pdf", ".docx", ".xlsx",
  ".pptx", ".woff", ".woff2", ".ttf", ".otf", ".exe", ".dll", ".dylib",
  ".so", ".node", ".wasm", ".dmg", ".sqlite", ".db",
]);

export function containsPrivateContent(content, fingerprints = PRIVATE_CONTENT_FINGERPRINTS) {
  const denied = new Set(fingerprints);
  const examined = new Set();
  const matches = (value) => {
    const normalized = value.toLowerCase();
    if (examined.has(normalized)) return false;
    examined.add(normalized);
    return denied.has(createHash("sha256").update(normalized).digest("hex"));
  };
  for (const [candidate] of String(content).matchAll(/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*/gu)) {
    if (matches(candidate)) return true;
    for (const part of candidate.split(/[.-]/u)) {
      if (matches(part)) return true;
      // Also catch ordinary camelCase names and environment-variable segments.
      for (const [word] of part.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/gu)) {
        if (matches(word)) return true;
      }
    }
  }
  return false;
}

export function assertNoPrivateContent(root, paths, label, { fingerprints = PRIVATE_CONTENT_FINGERPRINTS } = {}) {
  const leaked = [];
  let checked = 0;
  for (const relative of [...new Set(paths)].sort()) {
    if (binaryExtensions.has(path.extname(relative).toLowerCase())) continue;
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`${label} contains an invalid path`);
    // Git still lists deletions in an unstaged worktree; only existing package
    // source is inspected here. CI inspects the actual committed checkout.
    if (!existsSync(filename)) continue;
    const info = statSync(filename);
    if (!info.isFile()) continue;
    if (info.size > 16 * 1024 * 1024) throw new Error(`${label} contains oversized text requiring review: ${relative}`);
    const bytes = readFileSync(filename);
    // UTF-16 source can be produced by Windows tooling. Do not let its NULs
    // bypass a source check; ordinary binary assets are excluded above.
    let content;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) content = bytes.subarray(2).toString("utf16le");
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const copy = Buffer.from(bytes.subarray(2));
      if (copy.length % 2) throw new Error(`${label} contains invalid text encoding: ${relative}`);
      content = copy.swap16().toString("utf16le");
    } else content = bytes.toString("utf8");
    checked += 1;
    if (containsPrivateContent(content, fingerprints)) leaked.push(relative);
  }
  if (leaked.length) throw new Error(`${label} contains internal-only channel content:\n${leaked.join("\n")}`);
  return checked;
}

export function isPrivateConfigPath(filePath) {
  const normalized = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) || "";
  return (
    /^managed-shortcuts(?:\.[a-z0-9_-]+)*\.json$/iu.test(basename)
    || /\.(?:private|local)\.json$/iu.test(basename)
    || /\.private\.mjs$/iu.test(basename)
    || segments.includes(".aiyoucodex-private")
    || basename === ".aiyoucodex-thread.json"
    || segments.some((segment, index) => segment.toLowerCase() === "conversation-folders"
      && /^directories\.json(?:\.|$)/iu.test(segments[index + 1] || ""))
    || segments.some((segment) => /^hook-events\.json(?:\.|$)/iu.test(segment))
    || segments.some((segment) => /^hooks\.json\.(?:aiyou-backup-|tmp-|lock(?:\.|$))/iu.test(segment))
    || segments.some((segment, index) => segment.toLowerCase() === "efficiency"
      && /^state\.json(?:\.|$)/iu.test(segments[index + 1] || ""))
    || segments.some((segment, index) => segment.toLowerCase() === "skills"
      && /^(?:organization|provenance)\.json(?:\.|$)/iu.test(segments[index + 1] || ""))
    || segments.some((segment, index) => segment.toLowerCase() === "model-arena"
      && (/^(?:settings|assets|runs)\.json(?:\.|$)/iu.test(segments[index + 1] || "")
        || /^(?:runs|media)$/iu.test(segments[index + 1] || "")))
  );
}

export function assertNoPrivateConfigPaths(paths, label) {
  const leaked = [...paths].filter(isPrivateConfigPath).sort();
  if (leaked.length) {
    throw new Error(`${label} contains local-only configuration:\n${leaked.join("\n")}`);
  }
}

function readIgnoreRules(filePath) {
  return new Set(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

export function assertPrivateIgnoreRules(root) {
  for (const filename of [".gitignore", ".npmignore"]) {
    const filePath = path.join(root, filename);
    if (!existsSync(filePath)) throw new Error(`${filename} is required for the public-boundary guard`);
    const rules = readIgnoreRules(filePath);
    const missing = REQUIRED_PRIVATE_IGNORE_RULES.filter((rule) => !rules.has(rule));
    if (missing.length) {
      throw new Error(`${filename} is missing local-only exclusions: ${missing.join(", ")}`);
    }
  }
}

function trackedPaths(root) {
  try {
    // Let Git resolve its own checkout and restrict the listing to this package.
    // Comparing Git's root spelling with Node's path can silently skip a valid
    // Windows short-path checkout or a macOS symlink. The explicit pathspec also
    // prevents an enclosing repository's unrelated files from entering the check.
    return execFileSync("git", ["ls-files", "-z", "--", "."], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function packedPaths(root) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }))[0];
  return result.files.map((entry) => entry.path);
}

export function verifyPublicBoundary(root = defaultRoot, options = {}) {
  assertPrivateIgnoreRules(root);

  const tracked = trackedPaths(root);
  if (tracked) assertNoPrivateConfigPaths(tracked, "Git tracked files");

  const packed = packedPaths(root);
  assertNoPrivateConfigPaths(packed, "npm package");

  // npm includes non-ignored untracked files too. Inspect the union so an
  // internal draft document cannot leak via a package before it enters Git.
  const contentFilesChecked = assertNoPrivateContent(root, [...(tracked || []), ...packed], "Public source/package", options);

  return Object.freeze({
    trackedFilesChecked: tracked?.length ?? 0,
    packageFilesChecked: packed.length,
    contentFilesChecked,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = verifyPublicBoundary();
    process.stdout.write(
      `Public boundary verified: ${result.trackedFilesChecked} tracked files, ${result.packageFilesChecked} package files and ${result.contentFilesChecked} text contents checked.\n`,
    );
  } catch (error) {
    process.stderr.write(`Public boundary verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
