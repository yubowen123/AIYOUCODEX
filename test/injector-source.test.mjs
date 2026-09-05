import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");

test("injector only evaluates the public renderer in the top-level Codex frame", () => {
  assert.match(source, /if \(window\.top === window\)/);
  assert.doesNotMatch(source, /Runtime\.addBinding|Page\.setBypassCSP|TV_URL|readTaskboardSnapshot/);
});

test("persistent managed pages preload in one stable renderer only", () => {
  assert.match(source, /selectPersistentOwnerTargetId/);
  assert.match(source, /document\.hasFocus\(\) && document\.visibilityState === 'visible'/);
  assert.match(source, /ensureManagedShortcut\?\.\(.*\{ visible: false \}/);
  assert.match(source, /shortcut\.openMode === "internal" && shortcut\.keepAlive === true/);
  assert.match(source, /window\.__CODEX_SIDEBAR_RENDERER_TARGET_ID__/);
});
