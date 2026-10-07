import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installClaudeDependencies } from "../scripts/setup-claude-dependencies.mjs";
import { installBundledThemes } from "../lib/bundled-theme-install.mjs";
import { registerThemePackage } from "../lib/theme-catalog.mjs";

test("offline dependencies reject a stale lock and do not invoke npm", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-offline-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = Buffer.from('{"lockfileVersion":3}'); await writeFile(path.join(root, "package-lock.json"), lock);
  const versions = { "@anthropic-ai/claude-agent-sdk": "0.3.286", "smol-toml": "1.9.0" };
  for (const [name, version] of Object.entries(versions)) {
    const dir = path.join(root, "node_modules", name); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ version }));
  }
  const binaryDir = path.join(root, "node_modules", `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`);
  await mkdir(binaryDir, { recursive: true }); await writeFile(path.join(binaryDir, process.platform === "win32" ? "claude.exe" : "claude"), "fixture");
  const metadata = { platform: process.platform, arch: process.arch, versions,
    lockSha256: createHash("sha256").update(lock).digest("hex") };
  await writeFile(path.join(root, "bundled-dependencies.json"), JSON.stringify(metadata));
  const options = { root, env: { CODEX_SIDEBAR_PREBUNDLED: "1", PATH: "" }, run: () => { throw Error("npm must never run"); } };
  assert.equal(await installClaudeDependencies(options), true);
  await writeFile(path.join(root, "package-lock.json"), "changed");
  await assert.rejects(installClaudeDependencies(options), /package lock/);
});

test("fresh install registers three themes and an upgrade preserves custom catalog selection", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "aiyou-bundled-themes-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const installDir = path.join(home, "Runtime with spaces"), themeDir = path.join(installDir, "themes");
  await cp(new URL("../themes/", import.meta.url), themeDir, { recursive: true });
  const options = { home, installDir, nodePath: path.join(installDir, "runtime/node/bin/node") };
  const fresh = await installBundledThemes(options);
  assert.deepEqual(fresh.installed, ["mecha-control", "pink-candy", "beach-vacation"]);
  let catalog = JSON.parse(await readFile(path.join(themeDir, "catalog.json"), "utf8"));
  assert.equal(catalog.initial, "mecha-control");
  const customSource = await readFile(path.join(themeDir, "packages", "pink-candy", "theme.js"), "utf8");
  const frameSource = await readFile(path.join(themeDir, "packages", "pink-candy", "frame.js"), "utf8");
  await registerThemePackage(themeDir, { id: "personal-theme", name: "用户主题", prefKey: "aiyoucodex.theme.personal-theme.v1", source: customSource, frameSource });
  catalog = JSON.parse(await readFile(path.join(themeDir, "catalog.json"), "utf8"));
  catalog.initial = "personal-theme"; await writeFile(path.join(themeDir, "catalog.json"), JSON.stringify(catalog));
  await installBundledThemes(options);
  catalog = JSON.parse(await readFile(path.join(themeDir, "catalog.json"), "utf8"));
  assert.equal(catalog.initial, "personal-theme"); assert.equal(catalog.entries.length, 4);
  assert.equal(await readFile(path.join(themeDir, "packages", "personal-theme", "theme.js"), "utf8"), customSource);
  const plist = await readFile(fresh.plistPath, "utf8");
  assert.ok(plist.includes(options.nodePath)); assert.ok(plist.includes("theme-worker.mjs"));
});
