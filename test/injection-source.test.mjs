import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("injection uses stable Codex sidebar and tooltip anchors", () => {
  assert.match(source, /data-app-action-sidebar-thread-row/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /data-app-action-sidebar-thread-title/);
  assert.match(source, /role=\\?"tooltip/);
});

test("hover previews contain all requested fields and clamp message bodies to three lines", () => {
  assert.match(source, /核心总结/);
  assert.match(source, /最近输入/);
  assert.match(source, /最近输出/);
  assert.match(source, /-webkit-line-clamp:\s*3/);
});

test("injection is idempotent and reversible", () => {
  assert.match(source, /__codexConversationPreviewInjection__/);
  assert.match(source, /destroy/);
  assert.match(source, /\.remove\(\)/);
});

test("renderer receives host-pushed previews without a local HTTP fetch", () => {
  assert.match(source, /setPreviews/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("sidebar groups use accessible tabs and preserve native project actions", () => {
  assert.match(source, /role", "tablist"/);
  assert.match(source, /role", "tab"/);
  assert.match(source, /role", "tabpanel"/);
  assert.match(source, /aria-selected/);
  assert.match(source, /data-codex-sidebar-project-actions/);
  assert.match(source, /codexSidebarProjectActionSource/);
  assert.match(source, /ArrowRight/);
});

test("public shortcut grid excludes non-public native entries", () => {
  assert.match(source, /HIDDEN_SHORTCUT_NAMES = new Set\(\["站点", "插件", "项目管理"\]\)/);
  assert.match(source, /button\.dataset\.codexSidebarShortcutUrl = item\.url/);
  assert.doesNotMatch(source, /TV_SHORTCUT_URL|__codexTvHostV1|data-codex-tv-open/);
  assert.doesNotMatch(source, /setHomeProjects|HOME_PROJECT_SHELF_ID|data-codex-taskboard-open/);
});

test("folder create action is bound to the selected folder and restores native markup", () => {
  assert.match(source, /nativeFolderCreateButton/);
  assert.match(source, /codexSidebarFolderCreate = item\.id/);
  assert.match(source, /在“\$\{item\.label\}”文件夹下创建项目/);
  assert.match(source, /removeAttribute\("data-codex-sidebar-folder-create"\)/);
});
