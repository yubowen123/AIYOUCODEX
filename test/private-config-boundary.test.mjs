import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    "efficiency/state.json",
    "nested/efficiency/state.json.tmp-123",
    "nested/efficiency/state.json.lock/owner.json",
    "efficiency/hook-events.json",
    "hook-events.json",
    "nested/hook-events.json.tmp-123",
    "nested/hooks.json.aiyou-backup-123",
    "nested/hooks.json.tmp-123",
    "nested/hooks.json.lock/owner.json",
    "nested/hooks.json.lock.stale-123/owner.json",
    "nested\\efficiency\\state.json",
  ];
  for (const filePath of privatePaths) assert.equal(isPrivateConfigPath(filePath), true, filePath);

  const publicPaths = [
    "lib/managed-shortcuts.mjs",
    "test/managed-shortcuts.test.mjs",
    "asset-browser/asset-browser.config.example.json",
    "vendor/state.json",
    "state.json",
    "lib/efficiency-store.mjs",
    "test/efficiency-hook.test.mjs",
    "docs/OUTPUT-EFFICIENCY.md",
    "examples/hooks.json",
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
    for (const relative of [
      "efficiency/state.json", "nested/efficiency/state.json", "efficiency/state.json.lock/owner.json",
      "efficiency/state.json.tmp-123", "efficiency/hook-events.json", "hook-events.json",
      "nested/hook-events.json.tmp-123", "hooks.json.aiyou-backup-123", "nested/hooks.json.aiyou-backup-123",
      "hooks.json.tmp-123", "hooks.json.lock/owner.json", "hooks.json.lock.reaper/owner.json",
      "vendor/state.json",
    ]) {
      await mkdir(path.dirname(path.join(fixture, relative)), { recursive: true });
      await writeFile(path.join(fixture, relative), "{}\n");
    }

    const packed = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: fixture,
      encoding: "utf8",
      shell: process.platform === "win32",
    }))[0].files.map((entry) => entry.path);

    assert.ok(packed.includes("public.json"));
    assert.ok(packed.includes("vendor/state.json"), "ordinary vendor state.json must not be globally excluded");
    assert.deepEqual(packed.filter(isPrivateConfigPath), []);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("publication refuses accidentally force-tracked output-efficiency runtime state", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "aiyoucodex-runtime-boundary-"));
  try {
    for (const ignore of [".gitignore", ".npmignore"]) await writeFile(path.join(fixture, ignore), await readFile(path.join(root, ignore), "utf8"));
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({ name: "aiyoucodex-boundary-fixture", version: "1.0.0" }));
    await mkdir(path.join(fixture, "efficiency"));
    await writeFile(path.join(fixture, "efficiency", "state.json"), '{"privateUserContext":"fixture only"}\n');
    execFileSync("git", ["init", "--quiet"], { cwd: fixture, stdio: "ignore" });
    execFileSync("git", ["add", "-f", "efficiency/state.json"], { cwd: fixture, stdio: "ignore" });
    assert.throws(() => verifyPublicBoundary(fixture), /Git tracked files contains local-only configuration:[\s\S]*efficiency\/state\.json/u);
    const alias = path.join(fixture, "checkout-alias");
    await symlink(fixture, alias, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => verifyPublicBoundary(alias), /Git tracked files contains local-only configuration:[\s\S]*efficiency\/state\.json/u);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
