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

test("workspace menu pages stay in a shared side panel and accept conversation commands", () => {
  assert.match(source, /data-codex-workspace-side-panel/);
  assert.match(source, /function workspaceCommand\(value\)/);
  assert.match(source, /routeWorkspaceCommand/);
  assert.match(source, /typeof api\?\.search === "function"\) void api\.search\(command\.query\)/);
  assert.match(source, /setSkillCatalog/);
  assert.match(source, /添加到对话/);
  assert.match(source, /codex-asset-console-close[\s\S]{0,520}-webkit-app-region:\s*no-drag/);
  assert.match(source, /codex-asset-console-close[\s\S]{0,420}pointer-events:\s*auto/);
  assert.match(source, /function setAssetConsoleHostLayer\(active\)/);
  assert.match(source, /host\.style\.setProperty\("z-index", "40"\)/);
  assert.match(source, /action: "search", query: pendingAssetConsoleQuery/);
  assert.doesNotMatch(source, /Array\.from\(mount\.surface\.children\)[\s\S]{0,180}CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE/);
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

test("recovered history is host-pushed into the native conversation flow and renders text safely", () => {
  assert.match(source, /setConversationHistory/);
  assert.match(source, /data-thread-find-target/);
  assert.match(source, /data-user-message-bubble/);
  assert.match(source, /data-local-conversation-final-assistant/);
  assert.match(source, /data-codex-recovered-history-flow/);
  assert.match(source, /body\.textContent = recoveredMessageDisplayText\(message\.text\)/);
  assert.doesNotMatch(source, /body\.innerHTML = message\.text/);
  assert.doesNotMatch(source, /codex-complete-history-page/);
  assert.doesNotMatch(source, /搜索这次任务的全部对话/);
  assert.doesNotMatch(source, /返回实时对话/);
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

test("project tab actions include a selected-folder new-chat proxy", () => {
  assert.match(source, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(
    source,
    /#\$\{SECTION_TABS_ID\} \[data-codex-sidebar-project-actions\] \{[\s\S]{0,180}min-width:\s*58px/,
  );
  assert.match(source, /\[data-codex-sidebar-current-folder-new-chat\]/);
  assert.match(source, /data-codex-sidebar-current-folder-new-chat\][\s\S]{0,180}flex:\s*0 0 26px/);
  assert.match(source, /dataset\.codexSidebarCurrentFolderNewChat\s*=\s*item\.id/);
  assert.match(source, /`在“\$\{item\.label\}”中新建对话`/);
  assert.match(source, /function handleCurrentFolderNewChat[\s\S]{0,420}nativeFolderCreateButton\(item\)[\s\S]{0,220}source\.click\(\)/);
  assert.match(source, /button\.hidden = true/);
});

test("public shortcut grid exposes bundled project management and accepts external managed entries", () => {
  assert.match(source, /HIDDEN_SHORTCUT_NAMES = new Set\(\)/);
  assert.match(source, /else findNativeShortcutButton\(item\.name\)\?\.click\(\)/,
    "native shortcut cards must resolve the current source button after another injector replaces it");
  assert.match(source, /schemaVersion: 4/);
  assert.match(source, /hidden\.filter\(\(value\) => !value\.startsWith\("native:"\)\)/);
  assert.match(source, /savedShortcutSettings\.schemaVersion !== 4[\s\S]*localStorage\.setItem\(SHORTCUT_SETTINGS_STORAGE_KEY/);
  assert.match(source, /button\.dataset\.codexSidebarShortcutUrl = item\.url/);
  assert.match(source, /Array\.isArray\(window\[MANAGED_SHORTCUTS_GLOBAL\]\)/);
  assert.match(source, /managed:\s*true/);
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
  assert.match(source, /function virtualFolderSourceItems\(excludedIds = new Set\(\), sourceIndexOffset = 0\)/);
  assert.match(source, /sourceMode: virtualItems\.length \? "hybrid" : "native"/);
});

test("virtual folder catalog rows participate in card-view enhancement", () => {
  assert.match(
    source,
    /#\$\{ALL_PROJECTS_PANEL_ID\}, \[data-codex-sidebar-virtual-folder-panel\]/,
  );
});

test("native project folders merge catalog-only conversations and sort them by real activity", () => {
  assert.match(source, /function reconcileNativeFolderCatalog\(item\)/);
  assert.match(source, /createCatalogThreadRow\(entry, "folder"\)/);
  assert.match(source, /desired\.sort\(\(left, right\) => right\.time - left\.time/);
  assert.match(source, /if \(selected\) reconcileNativeFolderCatalog\(item\)/);
});

test("new native conversations replace catalog placeholders without duplicate cards", () => {
  assert.match(source, /function isTemporaryThreadId\(value\)/);
  assert.match(source, /startsWith\("client-new-thread:"\)/);
  assert.match(source, /const temporaryNativeCatalogId = new Map\(\)/);
  assert.match(source, /nativeAliasByCatalogId\.get\(threadId\)/);
  assert.match(source, /temporaryNativeCatalogId\.has\(threadId\)/);
});

test("folder reconciliation never removes React-owned rows during the first message send", () => {
  assert.match(source, /list\.dataset\.codexSidebarFolderCatalogList = "true"/);
  assert.match(source, /listItem\.style\.order = String\(index\)/);
  assert.match(source, /data-codex-sidebar-native-alias-hidden/);
  assert.match(source, /row\?\.dataset\.codexSidebarFolderCatalogRow !== "true"/);
  assert.doesNotMatch(source, /list\.replaceChildren\(\.\.\.desiredChildren\)/);
});

test("folder cards collapse short retry bursts and keep native controls on a full bottom row", () => {
  assert.match(source, /const FOLDER_DUPLICATE_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(source, /function dedupeFolderCatalogEntries\(sourceEntries\)/);
  assert.match(source, /entry\.dedupeKey/);
  assert.match(source, /data-codex-sidebar-semantic-duplicate-hidden/);
  assert.match(source, /\[data-codex-sidebar-semantic-duplicate-hidden\]\s*\{/);
  assert.doesNotMatch(source, /\[data-codex-sidebar-semantic-duplicate-hidden="true"\]/);
  assert.match(source, /control\.style\.order = String\(desired\.length \+ index\)/);
  assert.match(source, /data-codex-sidebar-folder-control-item/);
  assert.match(source, /grid-column: 1 \/ -1 !important/);
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
  assert.match(source, /在“\$\{item\.label\}”中新建对话/);
  assert.doesNotMatch(source, /在“\$\{item\.label\}”文件夹下创建项目/);
  assert.match(source, /removeAttribute\("data-codex-sidebar-folder-create"\)/);
});
