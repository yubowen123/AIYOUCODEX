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

test("managed local shortcuts use the same panel without becoming deletable custom entries", () => {
  assert.match(source, /__CODEX_SIDEBAR_MANAGED_SHORTCUTS__/);
  assert.match(source, /function normalizedManagedShortcuts\(\)/);
  assert.match(source, /dataset\.codexSidebarShortcutManaged = item\.id/);
  assert.match(source, /item\.custom \|\| item\.managed/);
  assert.match(source, /if \(item\.custom\) \{\s*const remove/s);
});

test("settings opens on pointerdown and header controls converge on one stable order", () => {
  assert.match(source, /button\.onpointerdown = handleShortcutSettingsPointerDown/);
  assert.match(source, /function handleShortcutSettingsPointerDown\(event\)/);
  assert.match(source, /const before = settingsButton\?\.parentElement === host \? settingsButton : searchSlot/);
  assert.match(source, /button\.nextElementSibling !== searchSlot\) host\.insertBefore\(button, searchSlot\)/);
});

test("settings exposes the AIYOUcodex brand without changing its accessibility contract", () => {
  assert.match(source, /<h2>AIYOUcodex 设置<\/h2>/);
  assert.match(source, /button\.title = "AIYOUcodex 快捷入口设置"/);
  assert.match(source, /button\.setAttribute\("aria-label", "管理快捷入口"\)/);
});

test("native activity view suspends project section enhancement", () => {
  assert.match(source, /function nativeActivityViewOpen\(\)/);
  assert.match(source, /关闭活动视图\|close activity view/);
  assert.match(source, /if \(nativeActivityViewOpen\(\)\) \{\s*if \(sectionEnhancementMounted\(\)\) clearSectionEnhancement\(\);\s*ensureRecoveredConversationHistory\(\);/s);
});
