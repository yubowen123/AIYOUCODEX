import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_SHORTCUTS_ENV,
  managedShortcutsPath,
  normalizeManagedShortcuts,
  readManagedShortcuts,
} from "../lib/managed-shortcuts.mjs";

test("managed shortcut configuration lives outside the replaceable install directory", () => {
  assert.equal(
    managedShortcutsPath({ platform: "darwin", homeDir: "/Users/example", env: {} }),
    "/Users/example/Library/Application Support/Codex Sidebar Enhancer Data/managed-shortcuts.json",
  );
  assert.equal(
    managedShortcutsPath({
      platform: "win32",
      homeDir: "C:\\Users\\example",
      env: { LOCALAPPDATA: "D:\\Profile\\Local" },
    }),
    "D:\\Profile\\Local\\CodexSidebarEnhancer\\Data\\managed-shortcuts.json",
  );
  assert.equal(
    managedShortcutsPath({
      platform: "linux",
      homeDir: "/home/example",
      env: { XDG_CONFIG_HOME: "/var/example-config" },
    }),
    "/var/example-config/codex-sidebar-enhancer/managed-shortcuts.json",
  );
});

test("managed shortcut path supports an explicit environment override", () => {
  assert.equal(
    managedShortcutsPath({
      platform: "darwin",
      homeDir: "/Users/example",
      env: { [MANAGED_SHORTCUTS_ENV]: "/opt/sidebar/private-shortcuts.json" },
    }),
    "/opt/sidebar/private-shortcuts.json",
  );
});

test("the injector reads the external profile and publishes only normalized entries to the renderer", async () => {
  const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ readManagedShortcuts \} from "\.\.\/lib\/managed-shortcuts\.mjs"/);
  assert.match(source, /readManagedShortcuts\(\)/);
  assert.match(source, /window\.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__ = \$\{JSON\.stringify\(managedShortcuts\)\}/);
  assert.doesNotMatch(source, /Runtime\.addBinding|Page\.setBypassCSP/);
});

test("managed shortcuts are normalized without carrying unknown data into the renderer", () => {
  const shortcuts = normalizeManagedShortcuts({
    schemaVersion: 1,
    shortcuts: [{
      id: "production-tool",
      name: "Production Tool",
      url: "https://example.invalid/workspace",
      icon: "play",
      openMode: "internal",
      keepAlive: true,
    }],
  });

  assert.deepEqual(shortcuts, [{
    id: "production-tool",
    name: "Production Tool",
    url: "https://example.invalid/workspace",
    icon: "play",
    openMode: "internal",
    keepAlive: true,
  }]);
  assert.ok(Object.isFrozen(shortcuts));
  assert.ok(Object.isFrozen(shortcuts[0]));
});

test("managed shortcuts reject unsafe, ambiguous, and unsupported fields", () => {
  const base = {
    id: "tool",
    name: "Tool",
    url: "https://example.invalid/",
    icon: "link",
    openMode: "browser",
  };
  const normalize = (shortcut) => normalizeManagedShortcuts({ schemaVersion: 1, shortcuts: [shortcut] });

  assert.throws(() => normalize({ ...base, id: "UPPER" }), /portable identifier/);
  assert.throws(() => normalize({ ...base, name: " Tool" }), /trimmed string/);
  assert.throws(() => normalize({ ...base, name: "x".repeat(25) }), /between 1 and 24/);
  assert.throws(() => normalize({ ...base, name: "Tool\nOverride" }), /trimmed string/);
  assert.throws(() => normalize({ ...base, url: " https:\/\/example.invalid\/" }), /HTTP\(S\)/);
  assert.throws(() => normalize({ ...base, url: "file:///tmp/private" }), /HTTP\(S\)/);
  assert.throws(() => normalize({ ...base, url: "https://user:secret@example.invalid/" }), /without credentials/);
  assert.throws(() => normalize({ ...base, icon: "remote-svg" }), /icon is not supported/);
  assert.throws(() => normalize({ ...base, openMode: "popup" }), /internal or browser/);
  assert.throws(() => normalize({ ...base, keepAlive: "yes" }), /keepAlive must be a boolean/);
  assert.throws(() => normalize({ ...base, keepAlive: true }), /only for internal shortcuts/);
  assert.throws(() => normalize({ ...base, privateToken: "secret" }), /unsupported field/);
  assert.throws(
    () => normalizeManagedShortcuts({ schemaVersion: 1, shortcuts: [base, base] }),
    /duplicated/,
  );
});

test("managed shortcuts read from disk and treat a missing file as an empty profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-shortcuts-"));
  const filePath = path.join(directory, "managed-shortcuts.json");
  try {
    assert.deepEqual(await readManagedShortcuts({ filePath }), []);
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      shortcuts: [{
        id: "local-library",
        name: "Local Library",
        url: "http://127.0.0.1:5177/",
        icon: "assets",
        openMode: "internal",
      }],
    }));
    assert.deepEqual(await readManagedShortcuts({ filePath }), [{
      id: "local-library",
      name: "Local Library",
      url: "http://127.0.0.1:5177/",
      icon: "assets",
      openMode: "internal",
    }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed JSON is reported instead of being partially accepted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-shortcuts-invalid-"));
  const filePath = path.join(directory, "managed-shortcuts.json");
  try {
    await writeFile(filePath, "{not-json");
    await assert.rejects(readManagedShortcuts({ filePath }), /not valid JSON/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
