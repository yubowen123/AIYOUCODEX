import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNoPrivateConfigPaths,
  assertNoPrivateContent,
  containsPrivateContent,
  isPrivateConfigPath,
  verifyPublicBoundary,
} from "../scripts/verify-public-boundary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local shortcut profiles and private overrides are recognized at any depth", () => {
  const privatePaths = [
    "managed-shortcuts.json",
    "config/managed-shortcuts.local.json",
    "nested/account.private.json",
    "nested/channels.private.mjs",
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
    "efficiency/conversation-folders/directories.json",
    "nested/conversation-folders/directories.json.tmp-123",
    "conversation-folders/directories.json.lock/owner.json",
    ".aiyoucodex-thread.json",
    "nested/.aiyoucodex-thread.json",
    "skills/organization.json",
    "nested/skills/provenance.json",
    "nested\\skills\\provenance.json.lock\\owner.json",
    "skills/organization.json.tmp-123",
    "model-arena/settings.json",
    "nested/model-arena/assets.json",
    "nested/model-arena/runs.json.tmp-123",
    "nested/model-arena/settings.json.lock/owner.json",
    "nested/model-arena/runs/one.json",
    "nested\\model-arena\\media\\one.mp4",
  ];
  for (const filePath of privatePaths) assert.equal(isPrivateConfigPath(filePath), true, filePath);

  const publicPaths = [
    "lib/managed-shortcuts.mjs",
    "test/managed-shortcuts.test.mjs",
    "asset-browser/asset-browser.config.example.json",
    "vendor/state.json",
    "state.json",
    "lib/efficiency-store.mjs",
    "lib/conversation-folders.mjs",
    "test/conversation-folders.test.mjs",
    "docs/CONVERSATION-FOLDERS.md",
    "test/efficiency-hook.test.mjs",
    "docs/OUTPUT-EFFICIENCY.md",
    "examples/hooks.json",
    "lib/skill-organization.mjs",
    "lib/skill-provenance.mjs",
    "lib/model-arena/media.mjs",
    "model-arena/public/app.js",
    "model-arena/public/style.css",
    "model-arena/public/index.html",
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
  assert.ok(result.contentFilesChecked > 0);
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
    await writeFile(path.join(fixture, "nested", "channels.private.mjs"), "export default {};\n");
    await mkdir(path.join(fixture, ".aiyoucodex-private"));
    await writeFile(path.join(fixture, ".aiyoucodex-private", "profile.json"), "{}\n");
    await writeFile(path.join(fixture, "public.json"), "{}\n");
    for (const relative of [
      "efficiency/state.json", "nested/efficiency/state.json", "efficiency/state.json.lock/owner.json",
      "efficiency/state.json.tmp-123", "efficiency/hook-events.json", "hook-events.json",
      "nested/hook-events.json.tmp-123", "hooks.json.aiyou-backup-123", "nested/hooks.json.aiyou-backup-123",
      "hooks.json.tmp-123", "hooks.json.lock/owner.json", "hooks.json.lock.reaper/owner.json",
      "efficiency/conversation-folders/directories.json", "nested/conversation-folders/directories.json.tmp-123",
      "conversation-folders/directories.json.lock/owner.json", ".aiyoucodex-thread.json", "nested/.aiyoucodex-thread.json",
      "skills/organization.json", "nested/skills/provenance.json", "skills/organization.json.tmp-123",
      "skills/provenance.json.lock/owner.json",
      "model-arena/settings.json", "model-arena/assets.json", "model-arena/runs.json",
      "nested/model-arena/settings.json.tmp-123", "nested/model-arena/settings.json.lock/owner.json",
      "model-arena/runs/one.json", "model-arena/media/one.mp4",
      "model-arena/public/index.html", "model-arena/public/app.js", "lib/model-arena/media.mjs",
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
    assert.ok(packed.includes("model-arena/public/app.js"), "arena UI must remain packaged");
    assert.ok(packed.includes("lib/model-arena/media.mjs"), "media implementation is not runtime media");
    assert.deepEqual(packed.filter(isPrivateConfigPath), []);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("content fingerprints catch case variants, domains and identifiers without reporting matches", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "aiyoucodex-content-boundary-"));
  const token = "fixturechannel";
  const fingerprints = [createHash("sha256").update(token).digest("hex")];
  try {
    for (const text of ["FixtureChannel", "FIXTURECHANNEL_API_KEY", "https://api.fixturechannel.invalid", "fixturechannelProvider"]) {
      assert.equal(containsPrivateContent(text, fingerprints), true, text);
    }
    assert.equal(containsPrivateContent("generic public provider", fingerprints), false);
    await writeFile(path.join(fixture, "provider.mjs"), `export const provider = "${token}";\n`);
    assert.throws(() => assertNoPrivateContent(fixture, ["provider.mjs"], "Fixture", { fingerprints }), (error) => {
      assert.match(error.message, /internal-only channel content:\nprovider\.mjs/u);
      assert.equal(error.message.includes(token), false, "the match itself is not copied to logs");
      return true;
    });
    await writeFile(path.join(fixture, "provider.mjs"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(token, "utf16le")]));
    assert.throws(() => assertNoPrivateContent(fixture, ["provider.mjs"], "Fixture", { fingerprints }), /provider\.mjs/u);
    await writeFile(path.join(fixture, "provider.mjs"), "export const provider = 'public';\n");
    // Binary assets are not read or parsed by this text-source guard.
    await writeFile(path.join(fixture, "thumbnail.png"), token);
    assert.equal(assertNoPrivateContent(fixture, ["provider.mjs", "thumbnail.png"], "Fixture", { fingerprints }), 1);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("publication inspects both tracked source and untracked npm candidates", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "aiyoucodex-package-content-"));
  const token = "fixturechannel";
  const fingerprints = [createHash("sha256").update(token).digest("hex")];
  try {
    for (const ignore of [".gitignore", ".npmignore"]) await writeFile(path.join(fixture, ignore), await readFile(path.join(root, ignore), "utf8"));
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({ name: "aiyoucodex-content-fixture", version: "1.0.0" }));
    execFileSync("git", ["init", "--quiet"], { cwd: fixture, stdio: "ignore" });
    await writeFile(path.join(fixture, "provider.mjs"), `export const channel = "${token}";\n`);
    execFileSync("git", ["add", "provider.mjs"], { cwd: fixture, stdio: "ignore" });
    assert.throws(() => verifyPublicBoundary(fixture, { fingerprints }), /internal-only channel content:[\s\S]*provider\.mjs/u);
    await writeFile(path.join(fixture, "provider.mjs"), "export const channel = 'generic';\n");
    await writeFile(path.join(fixture, "draft.md"), `Internal configuration: ${token}\n`);
    assert.throws(() => verifyPublicBoundary(fixture, { fingerprints }), /internal-only channel content:[\s\S]*draft\.md/u);
    await writeFile(path.join(fixture, "draft.md"), "Public configuration\n");
    await writeFile(path.join(fixture, "channel.private.mjs"), `export const channel = "${token}";\n`);
    assert.ok(verifyPublicBoundary(fixture, { fingerprints }).contentFilesChecked > 0);
    execFileSync("git", ["add", "-f", "channel.private.mjs"], { cwd: fixture, stdio: "ignore" });
    assert.throws(() => verifyPublicBoundary(fixture, { fingerprints }), /local-only configuration:[\s\S]*channel\.private\.mjs/u);
  } finally { await rm(fixture, { recursive: true, force: true }); }
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
    await mkdir(path.join(fixture, "skills"));
    await writeFile(path.join(fixture, "skills", "provenance.json"), "{}\n");
    execFileSync("git", ["add", "-f", "skills/provenance.json"], { cwd: fixture, stdio: "ignore" });
    assert.throws(() => verifyPublicBoundary(fixture), /skills\/provenance\.json/u);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
