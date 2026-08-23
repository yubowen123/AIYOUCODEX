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
  assert.match(source, /codex-conversation-preview-fallback-tooltip/);
  assert.match(source, /handlePreviewPointerOver/);
  assert.match(source, /handlePreviewPointerOut/);
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

test("public shortcut grid exposes bundled project management but excludes private entries", () => {
  assert.match(source, /HIDDEN_SHORTCUT_NAMES = new Set\(\)/);
  assert.match(source, /else findNativeShortcutButton\(item\.name\)\?\.click\(\)/,
    "native shortcut cards must resolve the current source button after another injector replaces it");
  assert.match(source, /schemaVersion: 4/);
  assert.match(source, /hidden\.filter\(\(value\) => !value\.startsWith\("native:"\)\)/);
  assert.match(source, /savedShortcutSettings\.schemaVersion !== 4[\s\S]*localStorage\.setItem\(SHORTCUT_SETTINGS_STORAGE_KEY/);
  assert.match(source, /button\.dataset\.codexSidebarShortcutUrl = item\.url/);
  assert.doesNotMatch(source, /TV_SHORTCUT_URL|__codexTvHostV1|data-codex-tv-open/);
  assert.doesNotMatch(source, /TV_SHORTCUT_URL|__codexTvHostV1|data-codex-tv-open/);
});

test("shortcut discovery supports Codex navigation buttons wrapped by contents containers", () => {
  assert.match(source, /function shortcutSiblingGroup\(button\)/);
  assert.match(source, /:scope > button, :scope > \* > button/);
  assert.match(source, /const navigationGroup = shortcutSiblingGroup\(pullRequests\)/);
  assert.match(source, /shortcutGroupButtons\(navigationGroup\)/);
});

test("header controls opt their shared toolbar host out of the Electron drag region", () => {
  assert.match(source, /data-codex-sidebar-header-controls/);
  assert.match(source, /webkitAppRegion = "no-drag"/);
  assert.match(source, /removeProperty\("-webkit-app-region"\)/);
});

test("view switch responds on pointer down before Codex can consume the click", () => {
  assert.match(source, /button\.onpointerdown = handleViewTogglePointerDown/);
  assert.match(source, /event\.detail > 0/);
});

test("section enhancement fails closed when Codex native anchors are incomplete", () => {
  assert.match(source, /NATIVE_ANCHOR_GRACE_MS = 1_800/);
  assert.match(source, /sectionSourcesMissingSince[\s\S]*scheduleAnchorRetry\(\)[\s\S]*clearSectionEnhancement\(\)/);
  assert.match(source, /folderSourcesMissingSince[\s\S]*scheduleAnchorRetry\(\)[\s\S]*clearFolderEnhancement\(\)/);
});

test("priority-only Codex sidebars retain virtual tabs, project search, and folder filters", () => {
  assert.match(source, /function nativePrioritySource\(\)/);
  assert.match(source, /data-codex-sidebar-priority-native-hidden/);
  assert.match(source, /data-codex-sidebar-virtual-section/);
  assert.match(source, /function ensureVirtualPinnedRows\(\)/);
  assert.match(source, /function virtualFolderSourceItems\(project\)/);
});

test("virtual folder catalog rows participate in card-view enhancement", () => {
  assert.match(
    source,
    /#\$\{ALL_PROJECTS_PANEL_ID\}, \[data-codex-sidebar-virtual-folder-panel\]/,
  );
});

test("running Taskboard threads receive a reduced-motion-safe blue border glow", () => {
  assert.match(source, /data-codex-project-running/);
  assert.match(source, /codex-running-border-flow/);
  assert.match(source, /setActiveProjectThreads/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test("pinned conversations are exclusive to the pinned tab", () => {
  assert.match(source, /data-codex-sidebar-pinned-outside-hidden/);
  assert.match(source, /recentCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.match(source, /interruptedCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.match(source, /return searchCatalog[\s\S]*filter\(\(entry\) => !pinnedThreadIds\.has/);
  assert.doesNotMatch(source, /function ensurePinnedProjectRows/);
});

test("folder create action is bound to the selected folder and restores native markup", () => {
  assert.match(source, /nativeFolderCreateButton/);
  assert.match(source, /codexSidebarFolderCreate = item\.id/);
  assert.match(source, /在“\$\{item\.label\}”文件夹下创建项目/);
  assert.match(source, /removeAttribute\("data-codex-sidebar-folder-create"\)/);
});
