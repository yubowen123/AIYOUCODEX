#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

export const REQUIRED_PRIVATE_IGNORE_RULES = Object.freeze([
  "managed-shortcuts.json",
  "*.private.json",
  "*.local.json",
  ".aiyoucodex-private/",
]);

export function isPrivateConfigPath(filePath) {
  const normalized = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) || "";
  return (
    /^managed-shortcuts(?:\.[a-z0-9_-]+)*\.json$/iu.test(basename)
    || /\.(?:private|local)\.json$/iu.test(basename)
    || segments.includes(".aiyoucodex-private")
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
    const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (path.resolve(repositoryRoot) !== path.resolve(root)) return null;
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
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

export function verifyPublicBoundary(root = defaultRoot) {
  assertPrivateIgnoreRules(root);

  const tracked = trackedPaths(root);
  if (tracked) assertNoPrivateConfigPaths(tracked, "Git tracked files");

  const packed = packedPaths(root);
  assertNoPrivateConfigPaths(packed, "npm package");

  return Object.freeze({
    trackedFilesChecked: tracked?.length ?? 0,
    packageFilesChecked: packed.length,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = verifyPublicBoundary();
    process.stdout.write(
      `Public boundary verified: ${result.trackedFilesChecked} tracked files and ${result.packageFilesChecked} package files checked.\n`,
    );
  } catch (error) {
    process.stderr.write(`Public boundary verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
