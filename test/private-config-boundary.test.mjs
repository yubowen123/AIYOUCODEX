import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNoPrivateConfigPaths,
  isPrivateConfigPath,
  verifyPublicBoundary,
} from "../scripts/verify-public-boundary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local shortcut profiles and private overrides are recognized at any depth", () => {
  const privatePaths = [
    "managed-shortcuts.json",
    "config/managed-shortcuts.local.json",
    "nested/account.private.json",
    ".aiyoucodex-private/shortcuts.json",
    "nested/.aiyoucodex-private/profile.json",
  ];
  for (const filePath of privatePaths) assert.equal(isPrivateConfigPath(filePath), true, filePath);

  const publicPaths = [
    "lib/managed-shortcuts.mjs",
    "test/managed-shortcuts.test.mjs",
    "asset-browser/asset-browser.config.example.json",
  ];
  for (const filePath of publicPaths) assert.equal(isPrivateConfigPath(filePath), false, filePath);
});

test("the public-boundary assertion identifies every leaked path", () => {
  assert.throws(
    () => assertNoPrivateConfigPaths([
      "lib/runtime.mjs",
      "profiles/managed-shortcuts.json",
      "profiles/device.local.json",
    ], "fixture"),
    /profiles\/device\.local\.json[\s\S]*profiles\/managed-shortcuts\.json/u,
  );
});

test("tracked files and the npm package exclude all local-only configuration", () => {
  const result = verifyPublicBoundary(root);
  assert.ok(result.trackedFilesChecked > 0);
  assert.ok(result.packageFilesChecked > 0);
});

test("npm ignore rules physically exclude local-only profiles from a package", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "aiyoucodex-public-boundary-"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      name: "aiyoucodex-public-boundary-fixture",
      version: "1.0.0",
    }));
    await writeFile(path.join(fixture, ".npmignore"), await readFile(path.join(root, ".npmignore"), "utf8"));
    await writeFile(path.join(fixture, "managed-shortcuts.json"), "{}\n");
    await mkdir(path.join(fixture, "nested"));
    await writeFile(path.join(fixture, "nested", "device.local.json"), "{}\n");
    await writeFile(path.join(fixture, "nested", "account.private.json"), "{}\n");
    await mkdir(path.join(fixture, ".aiyoucodex-private"));
    await writeFile(path.join(fixture, ".aiyoucodex-private", "profile.json"), "{}\n");
    await writeFile(path.join(fixture, "public.json"), "{}\n");

    const packed = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: fixture,
      encoding: "utf8",
      shell: process.platform === "win32",
    }))[0].files.map((entry) => entry.path);

    assert.ok(packed.includes("public.json"));
    assert.deepEqual(packed.filter(isPrivateConfigPath), []);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
