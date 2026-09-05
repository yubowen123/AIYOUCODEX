import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { isPrivateConfigPath } from "../scripts/verify-public-boundary.mjs";

const projectRoot = path.resolve(".");
const macOnly = { skip: process.platform !== "darwin" };

test("public installer copies a portable runtime and activates it under the current user", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-install-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  try {
    const result = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: testHome,
        CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
        CODEX_SIDEBAR_INSTALL_DIR: installDir,
        CODEX_SIDEBAR_NODE: process.execPath,
        CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
        CODEX_SIDEBAR_SKIP_OPEN: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AIYOUcodex installed/);
    await access(path.join(testHome, "Applications", "AIYOUcodex.app"));
    await access(path.join(installDir, "scripts", "injector.mjs"));
    await access(path.join(installDir, "scripts", "runtime.mjs"));
    await access(path.join(installDir, "inject", "conversation-preview.user.js"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "dist", "web", "index.html"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "server", "index.mjs"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "inject", "codex-taskboard.user.js"));
    const taskboardManifest = JSON.parse(await readFile(
      path.join(installDir, "vendor", "codex-taskboard", "VERSION.json"),
      "utf8",
    ));
    assert.equal(taskboardManifest.version, "0.2.0-codexoptimiz.20260831");
    assert.equal(taskboardManifest.snapshotSource, "019fe64a-ace1-7793-92aa-4d91195005ec");
    const publicRuntime = [
      await readFile(path.join(installDir, "scripts", "injector.mjs"), "utf8"),
      await readFile(path.join(installDir, "inject", "conversation-preview.user.js"), "utf8"),
    ].join("\n");
    assert.match(publicRuntime, /readManagedShortcuts\(\)/,
      "the public runtime must keep loading normalized shortcuts from the external local profile");
    const installedPaths = await readdir(installDir, { recursive: true });
    assert.deepEqual(installedPaths.filter(isPrivateConfigPath), [],
      "the installed public runtime must not contain local-only profiles");
    assert.match(publicRuntime, /HIDDEN_SHORTCUT_NAMES = new Set\(\)/,
      "The public UI must expose every native shortcut, including bundled project management");
    const plistPath = path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist");
    const plist = await readFile(plistPath, "utf8");
    assert.match(plist, new RegExp(installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(plist, /scripts\/runtime\.mjs/);
    assert.doesNotMatch(plist, /\/Users\/yubowen/);
    await assert.rejects(access(path.join(installDir, ".git")));
    await assert.rejects(access(path.join(installDir, "codex-folder-switcher-verification.png")));
    const previousRuntime = await readFile(path.join(installDir, "scripts", "runtime.mjs"), "utf8");
    const upgraded = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot, encoding: "utf8", env: { ...process.env, HOME: testHome,
        CODEX_SIDEBAR_SOURCE_DIR: projectRoot, CODEX_SIDEBAR_INSTALL_DIR: installDir,
        CODEX_SIDEBAR_NODE: process.execPath, CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1", CODEX_SIDEBAR_SKIP_OPEN: "1" },
    });
    assert.equal(upgraded.status, 0, upgraded.stderr);
    const backups = (await readdir(path.dirname(installDir))).filter((name) => name.startsWith(".codex-sidebar-enhancer-previous-"));
    assert.equal(backups.length, 1, "An update must retain the previous runtime until live acceptance");
    assert.equal(await readFile(path.join(path.dirname(installDir), backups[0], "scripts", "runtime.mjs"), "utf8"), previousRuntime);
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("public uninstaller removes only the installed runtime, LaunchAgent, launcher, and logs", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-uninstall-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  const sharedEnv = {
    ...process.env,
    HOME: testHome,
    CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
    CODEX_SIDEBAR_INSTALL_DIR: installDir,
    CODEX_SIDEBAR_NODE: process.execPath,
    CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
    CODEX_SIDEBAR_SKIP_OPEN: "1",
  };
  try {
    const installed = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(installed.status, 0, installed.stderr);

    const removed = spawnSync("/bin/bash", ["uninstall.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /AIYOUcodex uninstalled/);
    await assert.rejects(access(installDir));
    await assert.rejects(access(path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist")));
    await assert.rejects(access(path.join(testHome, "Applications", "AIYOUcodex.app")));
    await assert.rejects(access(path.join(testHome, "Applications", "Codex Sidebar Enhancer.app")));
    await assert.rejects(access(path.join(testHome, "Library", "Logs", "CodexSidebarEnhancer")));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});
