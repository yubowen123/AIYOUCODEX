import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("shortcut settings persist visibility and custom entries", () => {
  assert.match(source, /codex-conversation-preview:shortcut-settings/);
  assert.match(source, /codexSidebarShortcutSettings/);
  assert.match(source, /codexShortcutVisible/);
  assert.match(source, /data-codex-shortcut-custom-form/);
  assert.match(source, /localStorage\.setItem\(SHORTCUT_SETTINGS_STORAGE_KEY/);
});

test("built-in workspace enhancements participate in the same visibility menu", () => {
  assert.match(source, /name:\s*"Skills 分组"/);
  assert.match(source, /name:\s*"资产控制台"/);
  assert.match(source, /kind:\s*"enhancement"/);
  assert.match(source, /openSkillsGrouping/);
  assert.match(source, /openAssetConsolePanel/);
  assert.match(source, /shortcutCatalog\.filter\(\(item\) => item\.kind !== "settings"\)/);
});

test("custom shortcuts support preset icons and both open modes", () => {
  assert.match(source, /SHORTCUT_ICON_PRESETS/);
  assert.match(source, /data-codex-shortcut-icon/);
  assert.match(source, /value="internal"/);
  assert.match(source, /value="browser"/);
  assert.match(source, /openCustomShortcutPanel/);
  assert.match(source, /openCustomShortcutInBrowser/);
});

test("custom shortcut URLs are restricted to http and https", () => {
  assert.match(source, /url\.protocol !== "https:" && url\.protocol !== "http:"/);
});
