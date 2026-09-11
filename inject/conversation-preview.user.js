(() => {
  "use strict";

  const SENTINEL = "__codexConversationPreviewInjection__";
  const RUNTIME_VERSION = "2026-09-11.4";
  const DOCUMENT_EPOCH = `${performance.timeOrigin}:${globalThis.crypto?.randomUUID?.() || Math.random()}`;
  const STYLE_ID = "codex-conversation-preview-style";
  const TOGGLE_ID = "codex-conversation-view-toggle";
  const SWITCH_THUMB_CLASS = "codex-conversation-view-switch-thumb";
  const USAGE_ID = "codex-conversation-usage-status";
  const USAGE_TEXT_CLASS = "codex-conversation-usage-text";
  const USAGE_VALUE_CLASS = "codex-conversation-usage-value";
  const USAGE_FILL_CLASS = "codex-conversation-usage-fill";
  const SHORTCUT_GRID_ID = "codex-sidebar-shortcut-grid";
  const SHORTCUT_CARD_CLASS = "codex-sidebar-shortcut-card";
  const SHORTCUT_ICON_CLASS = "codex-sidebar-shortcut-icon";
  const SHORTCUT_LABEL_CLASS = "codex-sidebar-shortcut-label";
  const SHORTCUT_SETTINGS_ID = "codex-sidebar-shortcut-settings-dialog";
  const SHORTCUT_SETTINGS_BUTTON_ID = "codex-sidebar-shortcut-settings-button";
  const SHORTCUT_SETTINGS_STORAGE_KEY = "codex-conversation-preview:shortcut-settings";
  const EFFICIENCY_PANEL_ID = "aiyoucodex-efficiency-panel";
  const TASK_CONTEXT_BUTTON_ID = "aiyoucodex-task-context-open";
  const WORKSPACE_FOLDER_BUTTON_ID = "aiyoucodex-workspace-folder-open";
  const WORKSPACE_FOLDER_MENU_ID = "aiyoucodex-workspace-folder-menu";
  const EFFICIENCY_BINDING = "__AIYOUCODEX_EFFICIENCY_REQUEST__";
  const EFFICIENCY_MODES = { smart: "智能", concise: "精简", detailed: "详细" };
  const EFFICIENCY_SCOPES = { global: "全局默认", project: "当前项目", thread: "当前对话" };
  const MANAGED_SHORTCUTS_GLOBAL = "__CODEX_SIDEBAR_MANAGED_SHORTCUTS__";
  const RENDERER_TARGET_ID_GLOBAL = "__CODEX_SIDEBAR_RENDERER_TARGET_ID__";
  const CUSTOM_SHORTCUT_PAGE_ID = "codex-custom-shortcut-page";
  const CUSTOM_SHORTCUT_FRAME_ID = "codex-custom-shortcut-frame";
  const CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE = "data-codex-custom-shortcut-hidden";
  const CUSTOM_SHORTCUT_HOST_ATTRIBUTE = "data-codex-custom-shortcut-host";
  const ASSET_CONSOLE_PAGE_ID = "codex-asset-console-page";
  const ASSET_CONSOLE_FRAME_ID = "codex-asset-console-frame";
  const ASSET_CONSOLE_OPEN_INTENT_KEY = "aiyoucodex:asset-console-open:v1";
  const RECOVERED_HISTORY_FLOW_ATTRIBUTE = "data-codex-recovered-history-flow";
  const RECOVERED_HISTORY_MESSAGE_ATTRIBUTE = "data-codex-recovered-history-message";
  const RECOVERED_HISTORY_CONTENT_ATTRIBUTE = "data-codex-recovered-history-content";
  const SKILL_ORGANIZER_ID = "codex-skill-organizer";
  const SKILL_FAVORITES_KEY = "codex-workspace-enhancer:skill-favorites-v1";
  const SKILL_OPEN_REQUEST_STORAGE_KEY = "codex-workspace-enhancer:skill-open-request-v1";
  const SKILL_OPEN_REQUEST_TTL_MS = 15_000;
  const SKILL_NATIVE_SECTION_ATTR = "data-codex-skill-native-section";
  const WORKSPACE_PANEL_ATTRIBUTE = "data-codex-workspace-side-panel";
  const WORKSPACE_PANEL_WIDTH_KEY = "codex-workspace-enhancer:side-panel-width-v1";
  const WORKSPACE_PANEL_EVENT = "codex-workspace-panel:open";
  const SHORTCUT_ICON_PRESETS = {
    link: '<path d="M10.2 13.8 13.8 10.2M8.1 15.9l-1.4 1.4a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M15.9 8.1l1.4-1.4a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/>',
    book: '<path d="M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a3 3 0 0 0-3-3H4zM20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a3 3 0 0 1 3-3h5z"/>',
    sparkle: '<path d="m12 2 1.5 5.2L19 9l-5.5 1.8L12 16l-1.5-5.2L5 9l5.5-1.8zM5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8z"/>',
    play: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
    skills: '<path d="M5 5.5h6M5 9h9M5 12.5h5M16.5 4v8M13 8h7M6 17.5h12M8.5 15v5M15.5 15v5"/>',
    assets: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4V2M17 4V2M3 9h18M8 13h3v3H8zM14 13h3v3h-3z"/>',
  };
  const HIDDEN_SHORTCUT_NAMES = new Set();
  const SECTION_TABS_ID = "codex-sidebar-section-tabs";
  const SECTION_TAB_STORAGE_KEY = "codex-conversation-preview:section-tab";
  const NATIVE_SECTION_NAMES = ["置顶", "项目", "最近"];
  const SECTION_NAMES = [...NATIVE_SECTION_NAMES, "中断"];
  const NATIVE_SHORTCUT_LABEL_ALIASES = new Map([
    ["新对话", "新对话"],
    ["new chat", "新对话"],
    ["拉取请求", "拉取请求"],
    ["pull request", "拉取请求"],
    ["pull requests", "拉取请求"],
    ["站点", "站点"],
    ["sites", "站点"],
    ["已安排", "已安排"],
    ["scheduled", "已安排"],
    ["插件", "插件"],
    ["plugins", "插件"],
    ["更多", "更多"],
    ["more", "更多"],
    ["explore", "更多"],
    ["探索", "更多"],
  ]);
  const NATIVE_SECTION_LABEL_ALIASES = new Map([
    ["置顶", "置顶"],
    ["pinned", "置顶"],
    ["项目", "项目"],
    ["projects", "项目"],
    ["最近", "最近"],
    ["recents", "最近"],
    ["中断", "中断"],
    ["interrupted", "中断"],
  ]);
  const RECENT_LIST_ID = "codex-sidebar-global-recent-list";
  const RECENT_VISIBLE_LIMIT = 30;
  const INTERRUPTED_PANEL_ID = "codex-sidebar-interrupted-panel";
  const INTERRUPTED_LIST_ID = "codex-sidebar-interrupted-list";
  const FOLDER_SWITCHER_ID = "codex-sidebar-folder-switcher";
  const ALL_FOLDER_ID = "__all__";
  const ALL_PROJECTS_PANEL_ID = "codex-sidebar-all-projects";
  const FOLDER_STORAGE_KEY = "codex-conversation-preview:folder-id";
  const PINNED_THREAD_TIMES_STORAGE_KEY = "codex-conversation-preview:pinned-thread-times";
  const VIEW_STORAGE_KEY = "codex-conversation-preview:view-mode";
  const THREAD_STATUS_STORAGE_KEY = "codex-conversation-preview:thread-statuses";
  const NATIVE_ANCHOR_GRACE_MS = 1_800;
  const STATUS_BUTTON_CLASS = "codex-conversation-status-button";
  const STATUS_MENU_ID = "codex-conversation-status-menu";
  const SUMMARY_CLASS = "codex-conversation-core-summary";
  const DETAILS_CLASS = "codex-conversation-hover-details";
  const FALLBACK_TOOLTIP_ID = "codex-conversation-preview-fallback-tooltip";
  const CARD_CONTENT_CLASS = "codex-conversation-card-content";
  const CARD_TITLE_CLASS = "codex-conversation-card-title";
  const CARD_SUMMARY_CLASS = "codex-conversation-card-summary";
  const TIME_CLASS = "codex-conversation-card-time";
  const TAGS_CLASS = "codex-conversation-card-tags";
  const ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
  const RUNTIME_TOKEN = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  try { window[SENTINEL]?.destroy?.(); } catch {}

  let destroyed = false;
  let workspaceFolderButton = null;
  let workspaceFolderMenu = null;
  let workspaceFolderMenuTarget = "";
  let workspaceFolderPending = null;
  let workspaceFolderMessage = "";
  let observer = null;
  let syncTimer = null;
  let syncing = false;
  let lastSyncAt = null;
  let syncCount = 0;
  let componentErrors = {};
  const snapshotSignatures = new Map();
  let anchorRetryTimer = null;
  let previews = new Map();
  let shortcutSources = new Map();
  let shortcutSourcesMissingSince = 0;
  let shortcutCatalog = [];
  let shortcutSettings = {
    schemaVersion: 4,
    hidden: Array.from(HIDDEN_SHORTCUT_NAMES, (name) => `native:${name}`),
    custom: [],
  };
  let customShortcutPage = null;
  let customShortcutFrame = null;
  let customShortcutFrames = new Map();
  let customShortcutLastFocusedElement = null;
  // Same-document reinjection must not create another native browser tab.
  const nativeShortcutRecords = window.__AIYOUCODEX_NATIVE_SHORTCUT_RECORDS__ ||= new Map();
  for (const record of nativeShortcutRecords.values()) {
    if (record.status === "requested") record.status = "unconfirmed";
  }
  let nativeShortcutNotice = null;
  const nativeShortcutTimers = new Set();
  let assetConsole = { available: false, label: "资产控制台", mode: "embedded" };
  let assetConsolePage = null;
  let assetConsoleFrame = null;
  let assetConsoleReturnFocus = null;
  let assetConsoleRestorePending = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(ASSET_CONSOLE_OPEN_INTENT_KEY) || "null");
    const targetId = String(window[RENDERER_TARGET_ID_GLOBAL] || "");
    assetConsoleRestorePending = saved?.open === true && saved.targetId === targetId;
  } catch {}
  let conversationHistory = null;
  let historySignature = "";
  let recoveredHistorySignature = "";
  let skillOrganizerSource = null;
  let skillOrganizerCatalog = [];
  let skillOrganizerCatalogSignature = "";
  let skillOrganizerFilter = "all";
  let skillOrganization = { version: 0, groups: [{ id: "all", label: "全部", builtin: true }, { id: "common", label: "常用", builtin: true }] };
  const skillOrganizationRequests = new Map();
  let skillOrganizationMessage = "";
  let skillContextCleanup = null;
  let skillDetailsDialog = null;
  let skillDetailsEntry = null;
  let skillDetailsGeneration = 0;
  let skillDetailsReturnFocus = null;
  const skillDetailsRequests = new Map();
  let skillTraceGeneration = 0;
  let skillOrganizerQuery = "";
  let skillOrganizerNativeVisible = false;
  let skillOrganizerFavorites = null;
  let skillOrganizerRenderFrame = null;
  let skillOrganizerRenderGeneration = 0;
  let skillOrganizerOpening = false;
  let skillOrganizerOpenGeneration = 0;
  let skillOrganizerOpenObserver = null;
  let skillOrganizerOpenTimer = null;
  let hostSkillCatalog = [];
  let efficiencySnapshot = null;
  let efficiencyPanel = null;
  let efficiencyReturnFocus = null;
  let efficiencyMountSurface = null;
  let efficiencyResizeObserver = null;
  let efficiencyLayoutFrame = null;
  let efficiencyScope = "global";
  let efficiencyView = "settings";
  let efficiencyExecutionPreview = null;
  let efficiencySummaryReplaceRequested = false;
  let efficiencyTargetChanged = false;
  let efficiencyMessage = "";
  let efficiencyError = "";
  let efficiencyTaskDraft = null;
  let efficiencySkillsSignature = "";
  const efficiencyDrafts = new Map();
  const efficiencyRequests = new Map();
  const efficiencyTargetDrafts = new Map();
  const workspaceResizeCleanups = new Set();
  let skillContextMenu = null;
  let pendingAssetConsoleQuery = "";
  let lastWorkspaceCommand = { text: "", at: 0 };
  let sectionSources = new Map();
  let sectionTogglePending = new Map();
  let sectionSourcesMissingSince = 0;
  let folderSources = new Map();
  let folderTogglePending = new Map();
  let folderSourcesMissingSince = 0;
  let usage = {
    available: false,
    text: "剩余量 --",
    remainingPercent: null,
    tone: "muted",
    ariaLabel: "Codex 剩余量暂不可用",
  };
  let layoutAnchored = false;
  let viewMode = "list";
  let activeSectionTab = null;
  let activeFolderId = null;
  let folderSearchQuery = "";
  let folderPreSearchId = null;
  let folderTagsExpanded = false;
  let searchCatalog = [];
  let searchCatalogByProject = new Map();
  let searchCatalogByThread = new Map();
  let recentCatalog = [];
  let recentCatalogByThread = new Map();
  let interruptedCatalog = [];
  let interruptedCatalogByThread = new Map();
  let pinnedThreadIds = new Set();
  let pinnedThreadTimes = {};
  let activeProjectThreadIds = new Set();
  let folderSearchExpansionPending = null;
  let folderSearchRevealKey = "";
  let threadStatuses = {};
  let openStatusButton = null;
  let hoveredPreviewRow = null;
  try {
    const savedShortcutSettings = JSON.parse(localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY) || "null");
    if (savedShortcutSettings && typeof savedShortcutSettings === "object") {
      const hidden = Array.isArray(savedShortcutSettings.hidden)
        ? savedShortcutSettings.hidden.filter((value) => typeof value === "string")
        : shortcutSettings.hidden;
      const custom = Array.isArray(savedShortcutSettings.custom)
        ? savedShortcutSettings.custom.filter((item) => item && typeof item === "object")
        : [];
      shortcutSettings = {
        schemaVersion: 4,
        // v1-v3 shipped with native entries hidden by default. Restore every
        // built-in once so an update cannot look incomplete; later v4 choices
        // remain user-controlled and persistent.
        hidden: savedShortcutSettings.schemaVersion === 4
          ? hidden
          : hidden.filter((value) => !value.startsWith("native:")),
        custom,
      };
      if (savedShortcutSettings.schemaVersion !== 4) {
        localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(shortcutSettings));
      }
    }
  } catch {}
  try { viewMode = localStorage.getItem(VIEW_STORAGE_KEY) === "card" ? "card" : "list"; } catch {}
  try {
    const savedSectionTab = localStorage.getItem(SECTION_TAB_STORAGE_KEY);
    if (SECTION_NAMES.includes(savedSectionTab)) activeSectionTab = savedSectionTab;
  } catch {}
  try { activeFolderId = localStorage.getItem(FOLDER_STORAGE_KEY) || null; } catch {}
  try {
    const savedPinnedThreadTimes = JSON.parse(localStorage.getItem(PINNED_THREAD_TIMES_STORAGE_KEY) || "null");
    if (savedPinnedThreadTimes && typeof savedPinnedThreadTimes === "object" && !Array.isArray(savedPinnedThreadTimes)) {
      pinnedThreadTimes = savedPinnedThreadTimes;
      pinnedThreadIds = new Set(Object.keys(savedPinnedThreadTimes));
    }
  } catch {}
  try {
    const savedThreadStatuses = JSON.parse(localStorage.getItem(THREAD_STATUS_STORAGE_KEY) || "null");
    if (savedThreadStatuses && typeof savedThreadStatuses === "object" && !Array.isArray(savedThreadStatuses)) {
      threadStatuses = savedThreadStatuses;
    }
  } catch {}

  function normalizedNativeLabel(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/gu, " ")
      .toLocaleLowerCase();
  }

  function canonicalShortcutLabel(value) {
    const label = String(value || "").trim();
    return NATIVE_SHORTCUT_LABEL_ALIASES.get(normalizedNativeLabel(label)) || label;
  }

  function canonicalSectionLabel(value) {
    const label = String(value || "").trim();
    const normalized = normalizedNativeLabel(label);
    if (normalized === "优先级" || normalized === "priority") return "优先级";
    return NATIVE_SECTION_LABEL_ALIASES.get(normalized) || label;
  }

  function isPinActionLabel(value) {
    return ["置顶聊天", "取消置顶聊天", "pin chat", "unpin chat"].includes(normalizedNativeLabel(value));
  }

  function canonicalPinActionLabel(value) {
    const normalized = normalizedNativeLabel(value);
    if (normalized === "置顶聊天" || normalized === "pin chat") return "pin";
    if (normalized === "取消置顶聊天" || normalized === "unpin chat") return "unpin";
    return "";
  }

  function isProjectActionsLabel(value, folderLabel) {
    const actual = normalizedNativeLabel(value);
    const folder = String(folderLabel || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
    return Boolean(folder) && [
      `${folder} 的项目操作`,
      `Project actions for ${folder}`,
    ].some((candidate) => normalizedNativeLabel(candidate) === actual);
  }

  function isFolderCreateLabel(value, folderLabel) {
    const actual = normalizedNativeLabel(value);
    const folder = String(folderLabel || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
    return Boolean(folder) && [
      `在 ${folder} 中开始新聊天`,
      `Start new chat in ${folder}`,
    ].some((candidate) => normalizedNativeLabel(candidate) === actual);
  }

  function isShowMoreLabel(value) {
    return ["展开显示", "显示更多", "show more", "show all"].includes(normalizedNativeLabel(value));
  }

  function installStyles() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @property --codex-running-angle {
        syntax: "<angle>";
        inherits: false;
        initial-value: 0deg;
      }
      @keyframes codex-running-border-flow {
        to { --codex-running-angle: 360deg; }
      }
      ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"] {
        height: auto !important;
        min-height: 48px !important;
        padding-top: 5px !important;
        padding-bottom: 5px !important;
      }
      ${ROW_SELECTOR}[data-codex-sidebar-search-match="true"] {
        background: color-mix(in srgb, var(--color-accent, #2f80ed) 10%, transparent) !important;
        box-shadow: inset 3px 0 0 color-mix(in srgb, var(--color-accent, #2f80ed) 65%, transparent);
      }
      [data-codex-conversation-preview-title="true"] {
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: center !important;
        gap: 0 !important;
        min-height: 38px;
      }
      [data-codex-conversation-preview-title="true"] > [data-thread-title="true"] {
        flex: 0 0 auto !important;
        width: 100%;
        line-height: 20px;
      }
      .${SUMMARY_CLASS} {
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 62%, transparent));
        font-size: 12px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CARD_CONTENT_CLASS} {
        display: none;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        align-items: stretch;
        gap: 10px 8px !important;
      }
      [data-codex-sidebar-pinned-outside-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-native-alias-hidden] {
        display: none !important;
      }
      [data-codex-sidebar-semantic-duplicate-hidden] {
        display: none !important;
      }
      [data-codex-sidebar-folder-control-item="true"] {
        grid-column: 1 / -1 !important;
        width: 100% !important;
      }
      html:not([data-codex-conversation-view="card"]) [data-codex-sidebar-folder-catalog-list="true"] {
        display: flex !important;
        flex-direction: column;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"],
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > *,
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > * > *:not(.${STATUS_BUTTON_CLASS}) {
        min-width: 0 !important;
        width: 100% !important;
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"] {
        position: relative;
        width: 100% !important;
        height: 168px !important;
        min-height: 168px !important;
        max-height: 168px !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden;
        scroll-margin-top: 176px;
        scroll-margin-bottom: 88px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent) !important;
        border-radius: 13px !important;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 68%, transparent) !important;
        box-shadow: 0 7px 22px color-mix(in srgb, black 6%, transparent);
        backdrop-filter: blur(14px) saturate(112%);
        -webkit-backdrop-filter: blur(14px) saturate(112%);
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-conversation-preview-enhanced="true"]:hover,
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[aria-current="page"] {
        border-color: color-mix(in srgb, currentColor 17%, transparent) !important;
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 76%, transparent) !important;
        box-shadow: 0 9px 26px color-mix(in srgb, black 8%, transparent);
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"] {
        isolation: isolate;
        border-color: color-mix(in srgb, #2f95ff 58%, transparent) !important;
        box-shadow: 0 7px 22px color-mix(in srgb, black 6%, transparent),
          0 0 0 1px color-mix(in srgb, #2f95ff 26%, transparent),
          0 0 15px color-mix(in srgb, #2f95ff 24%, transparent) !important;
      }
      html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"]::before {
        position: absolute;
        z-index: 3;
        inset: -0.5px;
        padding: 1.5px;
        border-radius: inherit;
        background: conic-gradient(from var(--codex-running-angle),
          transparent 0deg 205deg,
          color-mix(in srgb, #2f95ff 20%, transparent) 230deg,
          #4ba9ff 260deg,
          #b9e9ff 278deg,
          #2f95ff 296deg,
          transparent 330deg 360deg);
        content: "";
        pointer-events: none;
        filter: drop-shadow(0 0 4px color-mix(in srgb, #2f95ff 62%, transparent));
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        animation: codex-running-border-flow 2.4s linear infinite;
      }
      html[data-codex-conversation-view="card"] [data-codex-conversation-preview-title="true"] {
        display: none !important;
      }
      html[data-codex-conversation-view="card"] .${CARD_CONTENT_CLASS} {
        display: grid;
        position: absolute;
        z-index: 1;
        inset: 0;
        box-sizing: border-box;
        grid-template-rows: 40px 16px 36px 24px;
        align-content: start;
        gap: 6px;
        padding: 14px;
        pointer-events: none;
      }
      .${CARD_TITLE_CLASS} {
        display: -webkit-box;
        min-width: 0;
        max-height: 40px;
        overflow: hidden;
        padding-right: 38px;
        color: var(--color-token-text-primary, var(--color-token-foreground, inherit));
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .${TIME_CLASS} {
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 58%, transparent));
        font-size: 11px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CARD_SUMMARY_CLASS} {
        display: -webkit-box;
        min-width: 0;
        height: 36px;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 64%, transparent));
        font-size: 12px;
        line-height: 18px;
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .${TAGS_CLASS} {
        display: grid;
        min-width: 0;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        gap: 5px;
        overflow: hidden;
      }
      .${TAGS_CLASS} > span {
        min-width: 0;
        max-width: none;
        overflow: hidden;
        padding: 2px 5px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 68%, transparent));
        font-size: 10px;
        font-weight: 500;
        line-height: 18px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        html[data-codex-conversation-view="card"] ${ROW_SELECTOR}[data-codex-project-running="true"]::before {
          animation: none;
          background: #2f95ff;
        }
      }
      .${STATUS_BUTTON_CLASS} {
        display: none;
      }
      html[data-codex-conversation-view="card"] .${STATUS_BUTTON_CLASS} {
        display: inline-flex;
        position: absolute;
        z-index: 12;
        top: 9px;
        right: 9px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 72%, transparent);
        box-shadow: 0 2px 8px color-mix(in srgb, black 9%, transparent), inset 0 0 0 0.5px color-mix(in srgb, currentColor 10%, transparent);
        cursor: pointer;
        pointer-events: auto;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .${STATUS_BUTTON_CLASS}::before {
        width: 14px;
        height: 14px;
        border: 2px solid color-mix(in srgb, white 72%, transparent);
        border-radius: 50%;
        background: #b5b7ba;
        box-shadow: 0 0 0 2px color-mix(in srgb, #8f9296 22%, transparent);
        content: "";
      }
      .${STATUS_BUTTON_CLASS}[data-status="urgent-important"]::before {
        background: #ef4755;
        box-shadow: 0 0 0 2px color-mix(in srgb, #ef4755 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="urgent-or-important"]::before {
        background: #f28a16;
        box-shadow: 0 0 0 2px color-mix(in srgb, #f28a16 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="not-urgent"]::before {
        background: #2fa56b;
        box-shadow: 0 0 0 2px color-mix(in srgb, #2fa56b 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="unmarked"]::before,
      .${STATUS_BUTTON_CLASS}[data-status="clear"]::before {
        border-color: color-mix(in srgb, white 58%, transparent);
        background: #b5b7ba;
        box-shadow: 0 0 0 2px color-mix(in srgb, #8f9296 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}:hover {
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 90%, transparent);
        transform: scale(1.04);
      }
      .${STATUS_BUTTON_CLASS}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${STATUS_MENU_ID} {
        display: flex;
        position: fixed;
        z-index: 10000;
        width: 214px;
        flex-direction: column;
        gap: 3px;
        box-sizing: border-box;
        padding: 8px;
        border: 0.5px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 16px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 92%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 18px 50px color-mix(in srgb, black 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 38%, transparent);
        backdrop-filter: blur(22px) saturate(120%);
        -webkit-backdrop-filter: blur(22px) saturate(120%);
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option] {
        display: grid;
        width: 100%;
        height: 42px;
        grid-template-columns: 22px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 0;
        border-radius: 11px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 14px;
        font-weight: 570;
        line-height: 20px;
        text-align: left;
        cursor: pointer;
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option]:hover,
      #${STATUS_MENU_ID} [data-codex-conversation-status-option]:focus-visible {
        outline: 0;
        background: color-mix(in srgb, currentColor 7%, transparent);
      }
      #${STATUS_MENU_ID} [data-codex-conversation-status-option="clear"] {
        margin-top: 4px;
        border-top: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 0 0 11px 11px;
      }
      #${STATUS_MENU_ID} .codex-conversation-status-option-dot {
        width: 16px;
        height: 16px;
        box-sizing: border-box;
        border: 2px solid color-mix(in srgb, white 70%, transparent);
        border-radius: 50%;
        background: var(--codex-status-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-status-color) 22%, transparent);
      }
      #${STATUS_MENU_ID} .codex-conversation-status-option-check {
        color: var(--color-token-text-primary, currentColor);
        font-size: 18px;
        line-height: 1;
        text-align: center;
      }
      [data-codex-sidebar-shortcut-source-hidden="true"],
      [data-codex-sidebar-shortcut-source-group-hidden="true"] {
        display: none !important;
      }
      [${CUSTOM_SHORTCUT_HOST_ATTRIBUTE}="true"] {
        position: relative !important;
        z-index: 31 !important;
        pointer-events: none !important;
      }
      [${CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE}="true"] {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #${SHORTCUT_GRID_ID} {
        display: grid !important;
        width: 100%;
        min-width: 0;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        align-items: stretch;
        gap: 6px;
      }
      #${SHORTCUT_GRID_ID} > [data-codex-sidebar-shortcut-card-wrap] {
        position: relative;
        min-width: 0;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS} {
        display: flex;
        position: relative;
        width: 100%;
        min-width: 0;
        height: 66px;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 5px;
        box-sizing: border-box;
        padding: 7px 4px 6px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 72%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 3px 10px color-mix(in srgb, black 4%, transparent);
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}:hover,
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}[data-active="true"] {
        border-color: color-mix(in srgb, currentColor 17%, transparent);
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 82%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 25%, transparent), 0 5px 14px color-mix(in srgb, black 7%, transparent);
        transform: translateY(-1px);
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS}:focus-visible,
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"]:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight);
        outline-offset: 2px;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} {
        display: inline-flex;
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} svg,
      #${SHORTCUT_GRID_ID} .${SHORTCUT_ICON_CLASS} img {
        display: block;
        width: 18px !important;
        height: 18px !important;
      }
      #${SHORTCUT_GRID_ID} .${SHORTCUT_LABEL_CLASS} {
        display: block;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 72%, transparent));
        font-size: 10px;
        font-weight: 550;
        line-height: 14px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SHORTCUT_GRID_ID} .codex-sidebar-shortcut-status {
        position: absolute;
        z-index: 2;
        top: 7px;
        right: 7px;
        width: 6px;
        height: 6px;
        border: 2px solid var(--color-token-main-surface-primary, Canvas);
        border-radius: 50%;
        background: var(--vscode-textLink-foreground, #2f95ff);
        pointer-events: none;
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"] {
        display: inline-flex;
        position: absolute;
        z-index: 3;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0.5px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 7px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 88%, transparent);
        color: var(--color-token-description-foreground, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 7%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"]:hover {
        background: var(--color-token-list-hover-background, Canvas);
        color: var(--color-token-text-primary, currentColor);
      }
      #${SHORTCUT_GRID_ID} [data-codex-sidebar-shortcut-quick="true"] svg {
        width: 12px !important;
        height: 12px !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID} {
        display: inline-flex !important;
        flex: 0 0 28px !important;
        width: 28px !important;
        min-width: 28px !important;
        max-width: 28px !important;
        height: 28px !important;
        min-height: 28px !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 9px !important;
        background: transparent !important;
        color: var(--color-token-description-foreground, currentColor) !important;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID}:hover {
        background: color-mix(in srgb, currentColor 7%, transparent) !important;
        color: var(--color-token-text-primary, currentColor) !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${SHORTCUT_SETTINGS_BUTTON_ID} svg {
        width: 18px !important;
        height: 18px !important;
      }
      #${SHORTCUT_SETTINGS_ID} {
        width: min(430px, calc(100vw - 32px));
        max-height: min(680px, calc(100vh - 48px));
        margin: auto;
        padding: 0;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 16%, transparent);
        border-radius: 18px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 94%, transparent);
        color: var(--color-token-text-primary, CanvasText);
        box-shadow: 0 24px 70px color-mix(in srgb, black 24%, transparent);
        backdrop-filter: blur(24px) saturate(125%);
      }
      #${SHORTCUT_SETTINGS_ID}::backdrop {
        background: color-mix(in srgb, black 28%, transparent);
        backdrop-filter: blur(4px);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-shell {
        display: flex;
        max-height: min(680px, calc(100vh - 48px));
        flex-direction: column;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 18px 12px;
      }
      #${SHORTCUT_SETTINGS_ID} h2,
      #${SHORTCUT_SETTINGS_ID} h3 {
        margin: 0;
        font-weight: 650;
      }
      #${SHORTCUT_SETTINGS_ID} h2 { font-size: 17px; }
      #${SHORTCUT_SETTINGS_ID} h3 { font-size: 13px; }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-settings-close] {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: inherit;
        font-size: 20px;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-body {
        min-height: 0;
        padding: 0 18px 18px;
        overflow: auto;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
        margin: 10px 0 18px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 11px;
        background: color-mix(in srgb, currentColor 3%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row > span {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-settings-row input {
        accent-color: var(--vscode-textLink-foreground, #2f95ff);
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-delete] {
        padding: 2px 5px;
        border: 0;
        background: transparent;
        color: color-mix(in srgb, currentColor 55%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-custom-form] {
        display: grid;
        gap: 11px;
        padding: 13px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 13px;
        background: color-mix(in srgb, currentColor 3%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field {
        display: grid;
        gap: 6px;
        color: color-mix(in srgb, currentColor 68%, transparent);
        font-size: 11px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input[type="text"],
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input[type="url"] {
        width: 100%;
        height: 34px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 9px;
        outline: none;
        background: color-mix(in srgb, Canvas 86%, transparent);
        color: inherit;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-field input:focus-visible {
        border-color: var(--vscode-textLink-foreground, #2f95ff);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground, #2f95ff) 17%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-icon-options {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon] {
        display: grid;
        height: 35px;
        place-items: center;
        padding: 0;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, Canvas 72%, transparent);
        color: inherit;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon][aria-pressed="true"] {
        border-color: var(--vscode-textLink-foreground, #2f95ff);
        background: color-mix(in srgb, var(--vscode-textLink-foreground, #2f95ff) 12%, transparent);
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-icon] svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-open-modes {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      #${SHORTCUT_SETTINGS_ID} .codex-shortcut-open-modes label {
        display: flex;
        height: 34px;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, Canvas 72%, transparent);
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-error] {
        min-height: 16px;
        color: #e5484d;
        font-size: 11px;
      }
      #${SHORTCUT_SETTINGS_ID} [data-efficiency-open-error] {
        color: #e5484d; font-size: 12px; margin: -10px 0 14px;
      }
      #${SHORTCUT_SETTINGS_ID} [data-efficiency-open-error]:empty { display: none; }
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-save] {
        height: 36px;
        border: 0;
        border-radius: 10px;
        background: var(--vscode-textLink-foreground, #2f95ff);
        color: white;
        font-weight: 650;
        cursor: pointer;
      }
      #${SHORTCUT_SETTINGS_ID} [data-aiyou-efficiency-open] {
        display: flex; width: 100%; justify-content: space-between; align-items: center;
        padding: 12px; margin-bottom: 18px; border-radius: 10px;
        border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
        background: color-mix(in srgb, Canvas 90%, #3981ef 10%); cursor: pointer;
      }
      #${EFFICIENCY_PANEL_ID} {
        position: relative; z-index: 45; display: grid; grid-template-rows: auto minmax(0, 1fr);
        box-sizing: border-box; flex: 0 1 var(--codex-workspace-panel-width, 560px);
        width: var(--codex-workspace-panel-width, 560px); min-width: 0;
        max-width: min(840px, calc(100vw - 320px)); height: 100%; min-height: 0;
        background: Canvas; color: CanvasText; border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        box-shadow: -8px 0 24px #0000000b; pointer-events: auto; -webkit-app-region: no-drag;
        font-size: 13px; line-height: 1.55;
      }
      #${EFFICIENCY_PANEL_ID}[hidden] { display: none !important; }
      #${EFFICIENCY_PANEL_ID} [hidden] { display: none !important; }
      #${TASK_CONTEXT_BUTTON_ID} { flex: 0 0 auto; pointer-events: auto; -webkit-app-region: no-drag; cursor: pointer; height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font-size: 12px; white-space: nowrap; }
      #${TASK_CONTEXT_BUTTON_ID}:hover { background: #80808018; }
      #${TASK_CONTEXT_BUTTON_ID}:focus-visible { outline: 2px solid #328bfa; outline-offset: -2px; }
      #${TASK_CONTEXT_BUTTON_ID}:disabled { opacity: .4; cursor: default; }
      #${TASK_CONTEXT_BUTTON_ID}[hidden] { display: none !important; }
      #${WORKSPACE_FOLDER_BUTTON_ID} { flex: 0 0 auto; display: inline-flex; gap: 4px; align-items: center; pointer-events: auto; -webkit-app-region: no-drag; cursor: pointer; height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; white-space: nowrap; }
      #${WORKSPACE_FOLDER_BUTTON_ID}:hover { background: #80808018; }
      #${WORKSPACE_FOLDER_BUTTON_ID}:focus-visible { outline: 2px solid #328bfa; outline-offset: -2px; }
      #${WORKSPACE_FOLDER_BUTTON_ID}[hidden], #${WORKSPACE_FOLDER_MENU_ID}[hidden] { display: none !important; }
      #${WORKSPACE_FOLDER_MENU_ID} { position: fixed; inset: auto; margin: 0; z-index: 2147483000; box-sizing: border-box; width: 300px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; padding: 8px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; background: Canvas; color: CanvasText; box-shadow: 0 8px 32px #0002; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: auto; -webkit-app-region: no-drag; }
      #${WORKSPACE_FOLDER_MENU_ID} * { box-sizing: border-box; -webkit-app-region: no-drag; }
      #${WORKSPACE_FOLDER_MENU_ID}::backdrop { background: transparent; pointer-events: none; }
      #${WORKSPACE_FOLDER_MENU_ID} button { display: block; width: 100%; border: 0; border-radius: 8px; padding: 10px; text-align: left; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      #${WORKSPACE_FOLDER_MENU_ID} button:hover, #${WORKSPACE_FOLDER_MENU_ID} button:focus-visible { background: #328bfa16; outline: 2px solid transparent; }
      #${WORKSPACE_FOLDER_MENU_ID} button:focus-visible { outline-color: #328bfa; }
      #${WORKSPACE_FOLDER_MENU_ID} button:disabled { opacity: .45; cursor: default; }
      #${WORKSPACE_FOLDER_MENU_ID} small { display: block; font-size: 11px; opacity: .7; }
      #${WORKSPACE_FOLDER_MENU_ID} [data-workspace-folder-path], #${WORKSPACE_FOLDER_MENU_ID} [role="status"] { margin: 4px 10px; font-size: 11px; overflow-wrap: anywhere; }
      #${WORKSPACE_FOLDER_MENU_ID} [data-workspace-folder-path] { opacity: .7; }
      #${EFFICIENCY_PANEL_ID}[data-efficiency-viewport-overlay="true"] {
        position: fixed !important; z-index: 100; flex: none;
        left: var(--aiyou-efficiency-left); top: var(--aiyou-efficiency-top);
        width: var(--aiyou-efficiency-width) !important; height: var(--aiyou-efficiency-height) !important;
        min-width: 0; max-width: 100vw; max-height: 100vh; margin: 0;
      }
      #${EFFICIENCY_PANEL_ID} * { box-sizing: border-box; -webkit-app-region: no-drag; }
      #${EFFICIENCY_PANEL_ID} > header {
        position: relative; z-index: 5; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 12px 16px; background: Canvas; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-close] {
        position: relative; z-index: 6; flex: 0 0 36px; width: 36px; height: 36px; min-width: 36px;
        font-size: 22px; pointer-events: auto; cursor: pointer;
      }
      #${EFFICIENCY_PANEL_ID} .aiyou-efficiency-body { overflow: auto; padding: 16px; overscroll-behavior: contain; }
      #${EFFICIENCY_PANEL_ID} h2 { margin: 0; min-width: 0; font-size: 16px; font-weight: 650; }
      #${EFFICIENCY_PANEL_ID} h3 { margin: 0 0 8px; font-size: 14px; font-weight: 650; }
      #${EFFICIENCY_PANEL_ID} p { margin: 6px 0; }
      #${EFFICIENCY_PANEL_ID} section, #${EFFICIENCY_PANEL_ID} fieldset {
        min-width: 0; margin: 0 0 16px; padding: 14px; border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 12px;
      }
      #${EFFICIENCY_PANEL_ID} fieldset:disabled { opacity: .65; }
      #${EFFICIENCY_PANEL_ID} label { display: grid; gap: 5px; margin: 9px 0; }
      #${EFFICIENCY_PANEL_ID} button, #${EFFICIENCY_PANEL_ID} select, #${EFFICIENCY_PANEL_ID} textarea, #${EFFICIENCY_PANEL_ID} input {
        font: inherit; color: inherit; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: Canvas;
      }
      #${EFFICIENCY_PANEL_ID} textarea, #${EFFICIENCY_PANEL_ID} select, #${EFFICIENCY_PANEL_ID} input { width: 100%; padding: 8px 10px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-inherit-wrap] { display: flex; align-items: center; gap: 8px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-inherit-wrap][hidden] { display: none !important; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-inherit] { width: auto; }
      #${EFFICIENCY_PANEL_ID} textarea { min-height: 66px; resize: vertical; }
      #${EFFICIENCY_PANEL_ID} button { min-height: 32px; padding: 5px 10px; cursor: pointer; }
      #${EFFICIENCY_PANEL_ID} button:disabled { opacity: .5; cursor: default; }
      #${EFFICIENCY_PANEL_ID} :focus-visible { outline: 2px solid #328bfa; outline-offset: 2px; }
      #${EFFICIENCY_PANEL_ID} .aiyou-efficiency-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-save] { color: white; background: #287df0; border-color: #287df0; }
      #${EFFICIENCY_PANEL_ID} .aiyou-efficiency-note { color: color-mix(in srgb, currentColor 66%, transparent); font-size: 12px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-error] { color: #db3c45; white-space: pre-wrap; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-message] { color: #237445; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-stale] { padding: 10px; border-radius: 9px; background: #ffb9001c; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-selected-skills] { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-results] { max-height: 170px; overflow: auto; display: grid; gap: 5px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-results] button { text-align: left; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-skill-results] small { display: block; opacity: .65; overflow-wrap: anywhere; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-execution-prompt] { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 42vh; overflow: auto; padding: 10px; border: 1px solid #80808030; border-radius: 8px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-summary-sources] { white-space: pre-wrap; overflow-wrap: anywhere; }
      #${EFFICIENCY_PANEL_ID} .aiyou-usage-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
      #${EFFICIENCY_PANEL_ID} .aiyou-usage-heading h3 { margin: 0; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-target] { overflow-wrap: anywhere; font-weight: 600; }
      #${EFFICIENCY_PANEL_ID} .aiyou-usage-totals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
      #${EFFICIENCY_PANEL_ID} .aiyou-usage-totals > div { min-width: 0; padding: 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 5%, Canvas); }
      #${EFFICIENCY_PANEL_ID} .aiyou-usage-totals strong { display: block; font-size: 20px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-section] summary { cursor: pointer; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-section] table { width: 100%; table-layout: fixed; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-section] th, #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-section] td {
        padding: 6px 3px; text-align: right; vertical-align: top; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      }
      #${EFFICIENCY_PANEL_ID} [data-efficiency-usage-section] th:first-child { text-align: left; width: 40%; }
      #${CUSTOM_SHORTCUT_PAGE_ID} {
        position: relative;
        z-index: 30;
        display: grid;
        grid-template-rows: 44px minmax(0, 1fr);
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        background: Canvas;
        color: CanvasText;
        box-shadow: -12px 0 32px color-mix(in srgb, black 8%, transparent);
        pointer-events: auto;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID}[hidden] { display: none !important; }
      #${CUSTOM_SHORTCUT_PAGE_ID}[data-codex-custom-shortcut-state="parked"] {
        display: grid !important;
        position: fixed !important;
        top: 0 !important;
        left: -12000px !important;
        width: var(--codex-workspace-panel-width, min(680px, 48vw)) !important;
        height: 100vh !important;
        min-width: 420px !important;
        max-width: 1000px !important;
        opacity: 0 !important;
        box-shadow: none !important;
        pointer-events: none !important;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} .codex-custom-shortcut-header {
        display: flex;
        position: relative;
        z-index: 4;
        align-items: center;
        justify-content: space-between;
        padding: 0 52px 0 16px;
        border-bottom: 0.5px solid color-mix(in srgb, currentColor 12%, transparent);
        font-size: 13px;
        font-weight: 620;
        pointer-events: auto !important;
        -webkit-app-region: no-drag !important;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} [data-codex-custom-shortcut-close] {
        position: relative;
        z-index: 5;
        display: grid;
        place-items: center;
        flex: 0 0 40px;
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: inherit;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        pointer-events: auto !important;
        touch-action: manipulation;
        -webkit-app-region: no-drag !important;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} .codex-custom-shortcut-frame-stack {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} iframe[data-codex-custom-shortcut-frame] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: Canvas;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} iframe[data-codex-custom-shortcut-active="false"] {
        position: fixed !important;
        top: 44px !important;
        left: -12000px !important;
        width: var(--codex-workspace-panel-width, min(680px, 48vw)) !important;
        height: calc(100vh - 44px) !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      [data-codex-sidebar-section-heading-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-priority-native-hidden="true"] {
        display: none !important;
      }
      [data-codex-sidebar-virtual-section][hidden],
      [data-codex-sidebar-virtual-folder-panel][hidden] {
        display: none !important;
      }
      #${SECTION_TABS_ID} {
        display: grid !important;
        position: relative;
        flex: 0 0 auto;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        min-width: 0;
        min-height: 42px;
        margin: 0 8px -6px;
        padding: 4px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 68%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 4px 14px color-mix(in srgb, black 4%, transparent);
        backdrop-filter: blur(14px) saturate(112%);
        -webkit-backdrop-filter: blur(14px) saturate(112%);
      }
      #${SECTION_TABS_ID} [role="tablist"] {
        display: grid;
        min-width: 0;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        gap: 3px;
        overflow: hidden;
      }
      #${SECTION_TABS_ID} [role="tab"] {
        display: inline-flex;
        min-width: 0;
        height: 32px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0 4px;
        overflow: hidden;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 64%, transparent));
        font-size: 12px;
        font-weight: 560;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
      }
      #${SECTION_TABS_ID} [role="tab"]:hover {
        color: var(--color-token-text-primary, currentColor);
        background: color-mix(in srgb, currentColor 5%, transparent);
      }
      #${SECTION_TABS_ID} [role="tab"][aria-selected="true"] {
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 88%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 10%, transparent), inset 0 0 0 0.5px color-mix(in srgb, currentColor 8%, transparent);
      }
      #${SECTION_TABS_ID} [role="tab"]:focus-visible,
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] button:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 1px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] {
        display: flex;
        width: auto;
        min-width: 58px;
        height: 32px;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions][hidden] {
        display: none !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] {
        display: flex !important;
        align-items: center;
        gap: 2px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] > *,
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] [data-codex-sidebar-project-actions-source] > * > * {
        pointer-events: auto !important;
        opacity: 1 !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] button {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        min-height: 26px !important;
        padding: 3px !important;
        border-radius: 8px !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-current-folder-new-chat] {
        display: inline-flex;
        flex: 0 0 26px;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-current-folder-new-chat]:hover {
        background: color-mix(in srgb, currentColor 6%, transparent);
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-current-folder-new-chat][hidden] {
        display: none !important;
      }
      #${SECTION_TABS_ID} [data-codex-sidebar-project-actions] svg {
        width: 17px !important;
        height: 17px !important;
      }
      [data-codex-sidebar-folder-heading-hidden="true"] {
        display: none !important;
      }
      #${FOLDER_SWITCHER_ID} {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 8px;
        box-sizing: border-box;
        margin: 2px 0 10px;
        padding: 9px;
        border: 0.5px solid color-mix(in srgb, currentColor 9%, transparent);
        border-radius: 13px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 63%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 20%, transparent), 0 4px 14px color-mix(in srgb, black 3%, transparent);
        backdrop-filter: blur(13px) saturate(110%);
        -webkit-backdrop-filter: blur(13px) saturate(110%);
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-row {
        display: grid;
        min-width: 0;
        grid-template-columns: minmax(0, 1fr) 58px;
        align-items: center;
        gap: 6px;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-shell {
        position: relative;
        min-width: 0;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-search-icon {
        display: inline-flex;
        position: absolute;
        z-index: 1;
        top: 50%;
        left: 10px;
        align-items: center;
        justify-content: center;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 58%, transparent));
        pointer-events: none;
        transform: translateY(-50%);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search] {
        width: 100%;
        min-width: 0;
        height: 34px;
        box-sizing: border-box;
        padding: 0 32px;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 10px;
        outline: 0;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 80%, transparent);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 1px 2px color-mix(in srgb, black 3%, transparent);
        font-size: 12px;
        line-height: 18px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]::placeholder {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 52%, transparent));
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]:focus-visible {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 38%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-token-accent-foreground, Highlight) 14%, transparent);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear] {
        display: inline-flex;
        position: absolute;
        z-index: 2;
        top: 50%;
        right: 5px;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--color-token-description-foreground, currentColor);
        cursor: pointer;
        transform: translateY(-50%);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear]:hover {
        background: color-mix(in srgb, currentColor 7%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] {
        display: flex;
        width: 58px;
        height: 32px;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions][hidden] {
        display: none !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] {
        display: flex !important;
        width: auto !important;
        max-width: none !important;
        align-items: center;
        gap: 2px !important;
        overflow: visible !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > *,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > * > *,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source] > * > * > * {
        width: auto !important;
        overflow: visible !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] button {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        min-height: 26px !important;
        padding: 3px !important;
        border-radius: 8px !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] svg {
        width: 17px !important;
        height: 17px !important;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tags] {
        display: grid;
        min-width: 0;
        max-height: 62px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: start;
        gap: 6px;
        overflow: hidden;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tags][data-expanded="true"] {
        max-height: none;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag] {
        display: inline-flex;
        min-width: 0;
        height: 28px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0 10px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-token-main-surface-primary, Canvas) 66%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 67%, transparent));
        font-size: 11px;
        font-weight: 520;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]:hover {
        border-color: color-mix(in srgb, currentColor 18%, transparent);
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 82%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag][aria-pressed="true"] {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 24%, transparent);
        background: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 10%, var(--color-token-main-surface-primary, Canvas));
        color: var(--color-token-text-primary, currentColor);
        box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 10%, transparent), 0 2px 6px color-mix(in srgb, black 5%, transparent);
        font-weight: 620;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-clear]:focus-visible,
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions] button:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 1px !important;
      }
      #${ALL_PROJECTS_PANEL_ID} {
        min-width: 0;
        padding-top: 8px;
      }
      #${ALL_PROJECTS_PANEL_ID} [data-codex-sidebar-all-project-list] {
        min-width: 0;
      }
      [data-codex-sidebar-recent-native-hidden="true"] {
        display: none !important;
      }
      #${RECENT_LIST_ID},
      #${INTERRUPTED_LIST_ID} {
        min-width: 0;
      }
      #${FOLDER_SWITCHER_ID} .codex-sidebar-folder-meta {
        display: flex;
        min-width: 0;
        min-height: 20px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-result] {
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 56%, transparent));
        font-size: 10px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand] {
        display: inline-flex;
        flex: 0 0 auto;
        height: 22px;
        align-items: center;
        gap: 3px;
        padding: 0 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--color-token-description-foreground, currentColor);
        font-size: 10px;
        line-height: 16px;
        cursor: pointer;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand]:hover {
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand] svg {
        transition: transform 150ms ease;
      }
      #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand][aria-expanded="true"] svg {
        transform: rotate(180deg);
      }
      #${USAGE_ID} {
        display: grid !important;
        position: relative;
        flex: 0 0 112px !important;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        box-sizing: border-box !important;
        width: 112px !important;
        min-width: 112px !important;
        max-width: 112px !important;
        height: 28px !important;
        min-height: 28px !important;
        margin: 0 !important;
        padding: 3px 8px 6px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 74%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 68%, transparent));
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent);
        font-variant-numeric: tabular-nums;
      }
      #${USAGE_ID}[data-tone="muted"] {
        opacity: 0.68;
      }
      #${USAGE_ID} .${USAGE_TEXT_CLASS} {
        min-width: 0;
        overflow: hidden;
        font-size: 10px;
        font-weight: 500;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${USAGE_ID} .${USAGE_VALUE_CLASS} {
        margin-left: 4px;
        color: var(--color-token-text-primary, currentColor);
        font-size: 12px;
        font-weight: 650;
        line-height: 16px;
        white-space: nowrap;
      }
      #${USAGE_ID} .codex-conversation-usage-track {
        position: absolute;
        right: 8px;
        bottom: 3px;
        left: 8px;
        height: 2px;
        overflow: hidden;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 9%, transparent);
      }
      #${USAGE_ID} .${USAGE_FILL_CLASS} {
        display: block;
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: var(--color-token-accent-foreground, currentColor);
        opacity: 0.56;
        transition: width 180ms ease;
      }
      #${USAGE_ID}[data-tone="warning"] .${USAGE_FILL_CLASS} {
        background: #b7791f;
        opacity: 0.78;
      }
      #${USAGE_ID}[data-tone="critical"] .${USAGE_FILL_CLASS} {
        background: #c2413b;
        opacity: 0.82;
      }
      #${TOGGLE_ID} {
        display: inline-flex !important;
        position: relative;
        flex: 0 0 52px !important;
        align-items: center !important;
        justify-content: flex-start !important;
        box-sizing: border-box !important;
        width: 52px !important;
        min-width: 52px !important;
        max-width: 52px !important;
        height: 28px !important;
        min-height: 28px !important;
        margin: 0 !important;
        padding: 3px !important;
        overflow: visible !important;
        border: 0.5px solid color-mix(in srgb, currentColor 14%, transparent) !important;
        border-radius: 999px !important;
        background: color-mix(in srgb, currentColor 6%, transparent) !important;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 66%, transparent));
        box-shadow: inset 0 1px 2px color-mix(in srgb, black 5%, transparent);
        cursor: pointer;
        transition: background-color 160ms ease, border-color 160ms ease;
      }
      #${TOGGLE_ID}:hover {
        border-color: color-mix(in srgb, currentColor 20%, transparent) !important;
        background: color-mix(in srgb, currentColor 9%, transparent) !important;
      }
      #${TOGGLE_ID}[aria-checked="true"] {
        border-color: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 22%, transparent) !important;
        background: color-mix(in srgb, var(--color-token-accent-foreground, currentColor) 12%, transparent) !important;
      }
      #${TOGGLE_ID}:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight) !important;
        outline-offset: 2px !important;
      }
      #${TOGGLE_ID} .${SWITCH_THUMB_CLASS} {
        display: inline-flex;
        flex: 0 0 22px;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-token-main-surface-primary, Canvas);
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 1px 4px color-mix(in srgb, black 20%, transparent), 0 0 0 0.5px color-mix(in srgb, currentColor 10%, transparent);
        transform: translateX(0);
        transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms ease;
      }
      #${TOGGLE_ID}[aria-checked="true"] .${SWITCH_THUMB_CLASS} {
        transform: translateX(24px);
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] {
        width: min(30rem, calc(100vw - 16px)) !important;
        max-width: min(30rem, calc(100vw - 16px)) !important;
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] [class*="max-w-"] {
        max-width: none !important;
        width: 100% !important;
      }
      #${FALLBACK_TOOLTIP_ID} {
        position: fixed;
        z-index: 1000;
        width: min(30rem, calc(100vw - 16px));
        max-width: min(30rem, calc(100vw - 16px));
        padding: 12px 14px;
        border: 1px solid var(--color-token-border, color-mix(in srgb, currentColor 14%, transparent));
        border-radius: 14px;
        background: var(--color-token-bg-primary, Canvas);
        color: var(--color-token-foreground, CanvasText);
        box-shadow: 0 12px 34px color-mix(in srgb, black 18%, transparent);
        pointer-events: none;
      }
      #${FALLBACK_TOOLTIP_ID} .codex-conversation-preview-tooltip-title {
        overflow: hidden;
        font-size: 14px;
        font-weight: 650;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${DETAILS_CLASS} {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 7px;
        margin-top: 4px;
        padding-top: 8px;
        border-top: 0.5px solid var(--color-token-border, color-mix(in srgb, currentColor 16%, transparent));
      }
      .${DETAILS_CLASS} .codex-conversation-preview-block {
        display: grid;
        min-width: 0;
        grid-template-columns: 52px minmax(0, 1fr);
        align-items: start;
        gap: 8px;
      }
      .${DETAILS_CLASS} .codex-conversation-preview-label {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 62%, transparent));
        font-size: 12px;
        line-height: 18px;
      }
      [${RECOVERED_HISTORY_FLOW_ATTRIBUTE}="true"] {
        display: flex;
        min-width: 0;
        flex-direction: column;
      }
      [${RECOVERED_HISTORY_CONTENT_ATTRIBUTE}="true"] {
        height: auto !important;
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"] {
        display: flex;
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 12px 0;
        contain: layout style paint;
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"][data-role="user"] {
        justify-content: flex-end;
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"][data-role="assistant"] {
        justify-content: flex-start;
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"] .codex-recovered-history-body {
        min-width: 0;
        max-width: 100%;
        color: inherit;
        font: inherit;
        font-size: var(--text-size-chat, 14px);
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        user-select: text;
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"][data-role="user"] .codex-recovered-history-body {
        max-width: 77%;
        padding: 10px 14px;
        border-radius: 16px;
        background: color-mix(in srgb, currentColor 5%, transparent);
      }
      [${RECOVERED_HISTORY_MESSAGE_ATTRIBUTE}="true"][data-role="assistant"] .codex-recovered-history-body {
        width: 100%;
      }
      #${ASSET_CONSOLE_PAGE_ID} {
        position: relative;
        z-index: 1000;
        display: grid;
        grid-template-rows: 50px minmax(0, 1fr);
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        overflow: hidden;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        background: var(--color-token-bg-primary, #fff);
        box-shadow: -12px 0 32px color-mix(in srgb, black 8%, transparent);
        pointer-events: auto;
      }
      #${ASSET_CONSOLE_PAGE_ID}[hidden] { display: none !important; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-header {
        position: relative;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 8px 0 16px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        pointer-events: auto !important;
        -webkit-app-region: no-drag !important;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-title { font-size: 15px; font-weight: 650; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-local {
        padding: 3px 8px;
        border-radius: 999px;
        color: #22764a;
        background: color-mix(in srgb, #2fa56b 13%, transparent);
        font-size: 11px;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-spacer { flex: 1; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-close,
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-retry {
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 9px;
        background: color-mix(in srgb, currentColor 4%, transparent);
        color: inherit;
        cursor: pointer;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-close {
        position: relative;
        z-index: 5;
        display: grid;
        place-items: center;
        flex: 0 0 40px;
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        padding: 0;
        font-size: 20px;
        line-height: 1;
        pointer-events: auto !important;
        touch-action: manipulation;
        -webkit-app-region: no-drag !important;
      }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-body { position: relative; min-height: 0; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-state {
        position: absolute;
        inset: 0;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 12px;
        color: color-mix(in srgb, currentColor 65%, transparent);
      }
      #${ASSET_CONSOLE_PAGE_ID}[data-state="ready"] .codex-asset-console-state { display: none; }
      #${ASSET_CONSOLE_PAGE_ID}[data-state="loading"] .codex-asset-console-retry { display: none; }
      #${ASSET_CONSOLE_FRAME_ID} { width: 100%; height: 100%; border: 0; background: #fff; }
      [${SKILL_NATIVE_SECTION_ATTR}="hidden"] { display: none !important; }
      #${SKILL_ORGANIZER_ID} {
        display: grid;
        position: relative;
        z-index: 30;
        flex: 0 0 var(--codex-workspace-panel-width, min(680px, 48vw));
        width: var(--codex-workspace-panel-width, min(680px, 48vw));
        min-width: 420px;
        max-width: min(1000px, calc(100vw - 360px));
        height: 100%;
        min-height: 0;
        grid-template-rows: auto auto auto auto minmax(0, 1fr);
        gap: 12px;
        box-sizing: border-box;
        margin: 0;
        padding: 16px;
        overflow: hidden;
        border: 0;
        border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 0;
        background: var(--color-token-bg-primary, #fff);
        box-shadow: -12px 0 32px color-mix(in srgb, #24364b 9%, transparent);
      }
      #${SKILL_ORGANIZER_ID}[hidden] { display: none !important; }
      #${SKILL_ORGANIZER_ID} .codex-skill-organizer-head,
      #${SKILL_ORGANIZER_ID} .codex-skill-result-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #${SKILL_ORGANIZER_ID} h2 { margin: 0; font-size: 18px; }
      #${SKILL_ORGANIZER_ID} p { margin: 3px 0 0; color: color-mix(in srgb, currentColor 58%, transparent); font-size: 12px; }
      #${SKILL_ORGANIZER_ID} button { color: inherit; font: inherit; }
      #${SKILL_ORGANIZER_ID} .codex-skill-native-toggle {
        padding: 7px 11px;
        border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
        border-radius: 9px;
        background: transparent;
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 11px;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 11px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-search input {
        width: 100%;
        height: 38px;
        border: 0;
        outline: 0;
        background: transparent;
        color: inherit;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter-list { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 7px; padding-bottom: 4px; }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter { flex: 0 0 auto; white-space: nowrap; }
      #${SKILL_ORGANIZER_ID} .codex-skill-head-actions { display: flex; align-items: center; gap: 6px; }
      #${SKILL_ORGANIZER_ID} .codex-skill-status { display: block; font-size: 11px; font-weight: normal; max-width: 360px; }
      #${SKILL_ORGANIZER_ID} .codex-skill-category { display: block; margin-top: 4px; font-size: 10px; opacity: .65; }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager {
        position: absolute; inset: 12px; z-index: 50; overflow: auto; padding: 16px;
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 12px;
        background: var(--color-token-bg-primary, Canvas); box-shadow: 0 8px 30px #0002;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager[hidden] { display: none; }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager form { display: flex; gap: 6px; margin-top: 12px; align-items: center; }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager input { flex: 1; min-width: 0; padding: 9px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager button { padding: 7px; border: 1px solid #8886; border-radius: 6px; background: transparent; cursor: pointer; }
      #${SKILL_ORGANIZER_ID} .codex-skill-group-manager button:disabled { opacity: .5; cursor: wait; }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter {
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 999px;
        background: transparent;
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-filter[aria-pressed="true"] {
        border-color: color-mix(in srgb, #2f80ed 48%, transparent);
        background: color-mix(in srgb, #2f80ed 11%, transparent);
        color: #1767c0;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
        align-content: start;
        overflow: auto;
        padding-right: 2px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px 30px;
        align-items: center;
        gap: 8px;
        min-height: 80px;
        padding: 10px 11px;
        border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, currentColor 2.5%, transparent);
        cursor: pointer;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row:hover { border-color: color-mix(in srgb, #2f80ed 35%, transparent); }
      #${SKILL_ORGANIZER_ID} .codex-skill-name {
        display: block;
        min-width: 0;
        overflow: hidden;
        font-size: 13px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-description {
        display: -webkit-box;
        min-width: 0;
        min-height: 32px;
        max-height: 32px;
        overflow: hidden;
        margin-top: 3px;
        color: color-mix(in srgb, currentColor 56%, transparent);
        font-size: 11px;
        line-height: 16px;
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-favorite {
        width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 18px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-favorite[aria-pressed="true"] { color: #d89400; background: #fff5d5; }
      #${SKILL_ORGANIZER_ID} .codex-skill-empty { grid-column: 1 / -1; padding: 30px; text-align: center; color: color-mix(in srgb, currentColor 58%, transparent); }
      #${SKILL_ORGANIZER_ID} .codex-skill-close {
        width: 32px; height: 32px; border: 0; border-radius: 9px; background: color-mix(in srgb, currentColor 6%, transparent); cursor: pointer; font-size: 20px;
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-use {
        width: 30px; height: 30px; border: 0; border-radius: 8px; background: color-mix(in srgb, #2f80ed 10%, transparent); color: #1767c0; cursor: pointer; font-size: 16px;
      }
      .codex-skill-context-menu {
        position: fixed; inset: auto; margin: 0; z-index: 10000; min-width: 190px; max-width: calc(100vw - 16px); max-height: min(440px, calc(100vh - 16px)); overflow: auto; padding: 6px; color: var(--color-token-text-primary, CanvasText); border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; background: var(--color-token-bg-primary, Canvas); box-shadow: 0 14px 34px color-mix(in srgb, black 20%, transparent); -webkit-app-region: no-drag;
      }
      .codex-skill-context-menu button { width: 100%; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .codex-skill-context-menu button:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
      .codex-skill-context-menu button:disabled { opacity: .5; cursor: not-allowed; }
      #aiyoucodex-skill-details { width: min(820px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 0; border: 1px solid #cfd3dc; border-radius: 18px; overflow: hidden; color: #20232b; background: #fff; font: 14px/1.65 system-ui, sans-serif; -webkit-app-region: no-drag; }
      #aiyoucodex-skill-details[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
      #aiyoucodex-skill-details::backdrop { background: #17233755; }
      #aiyoucodex-skill-details header { display: flex; align-items: flex-start; gap: 18px; padding: 18px 24px; border-bottom: 1px solid #e5e7eb; }
      #aiyoucodex-skill-details header > div { flex: 1; min-width: 0; }
      #aiyoucodex-skill-details h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
      #aiyoucodex-skill-details p { margin: 6px 0; }
      #aiyoucodex-skill-details button { padding: 8px 12px; background: #f4f5f7; border: 1px solid #ddd; border-radius: 9px; cursor: pointer; -webkit-app-region: no-drag; }
      #aiyoucodex-skill-details button:disabled { opacity: .5; cursor: default; }
      #aiyoucodex-skill-details [data-skill-detail-close] { width: 36px; height: 36px; flex: none; padding: 0; font-size: 24px; }
      #aiyoucodex-skill-details [data-skill-detail-body] { overflow: auto; overscroll-behavior: contain; padding: 4px 24px 20px; }
      #aiyoucodex-skill-details section { margin-top: 20px; }
      #aiyoucodex-skill-details h3 { font-size: 16px; margin: 0 0 8px; }
      #aiyoucodex-skill-details .skill-document-text { white-space: pre-wrap; overflow-wrap: anywhere; }
      #aiyoucodex-skill-details summary { cursor: pointer; margin-top: 20px; }
      #aiyoucodex-skill-details footer { padding: 12px 24px; border-top: 1px solid #e5e7eb; display: flex; flex-wrap: wrap; gap: 8px; }
      #aiyoucodex-skill-details [data-skill-detail-status] { width: 100%; color: #666; }
      #aiyoucodex-skill-details [data-skill-detail-use] { background: #3478f6; color: white; border-color: transparent; }
      [${WORKSPACE_PANEL_ATTRIBUTE}]::before {
        content: ""; position: absolute; z-index: 5; top: 0; bottom: 0; left: -4px; width: 8px; cursor: ew-resize;
      }
      .${DETAILS_CLASS} .codex-conversation-preview-text {
        display: -webkit-box;
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-foreground, inherit);
        font-size: 13px;
        line-height: 18px;
        white-space: normal;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function rowKey(row) {
    return `${row.getAttribute("data-app-action-sidebar-thread-id") || ""}\n${row.getAttribute("data-app-action-sidebar-thread-title") || ""}`;
  }

  function formatCatalogCommunication(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "时间待更新";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (startDate === startToday) return `今天 ${time}`;
    if (startDate === startToday - 86_400_000) return `昨天 ${time}`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function catalogPreviewForRow(row) {
    const threadId = normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id"));
    const entry = searchCatalogByThread.get(threadId)
      || recentCatalogByThread.get(threadId)
      || interruptedCatalogByThread.get(threadId);
    if (!entry) return null;
    const title = entry.title || row.getAttribute("data-app-action-sidebar-thread-title") || "未命名对话";
    const subject = title
      .replace(/^(创建|构建|优化|更新|安装|调研|查找|梳理|整理|生成|制作)+/u, "")
      .replace(/skills?/ig, "")
      .trim()
      .slice(0, 8) || "任务主题";
    return {
      catalogOnly: true,
      threadId: entry.threadId,
      updatedAt: entry.updatedAt,
      summary: `正在读取“${title}”的核心总结…`,
      recentInput: "",
      recentOutput: "",
      lastCommunication: formatCatalogCommunication(entry.updatedAt),
      tags: [subject, entry.projectName || "未分类项目", entry.interruptionLabel || "最近请求"],
    };
  }

  function previewForRow(row) {
    const preview = previews.get(rowKey(row)) || catalogPreviewForRow(row);
    if (!preview || !row.hasAttribute("data-codex-sidebar-interrupted-row")) return preview;
    const entry = interruptedCatalogByThread.get(normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")));
    if (!entry?.interruptionLabel) return preview;
    const tags = Array.isArray(preview.tags) ? preview.tags.slice(0, 2) : [];
    return { ...preview, tags: [...tags, entry.interruptionLabel].slice(-3) };
  }

  function visibleRows() {
    return Array.from(document.querySelectorAll(ROW_SELECTOR)).filter((row) => {
      if (!row.isConnected) return false;
      const sectionPanel = row.closest("[data-codex-sidebar-section-panel]");
      if (sectionPanel?.hidden) return false;
      if (row.closest('[data-codex-sidebar-recent-native-hidden="true"]')) return false;
      if (row.hasAttribute("data-codex-sidebar-all-project-row")) {
        return Boolean(row.closest(
          `#${ALL_PROJECTS_PANEL_ID}, [data-codex-sidebar-virtual-folder-panel]`,
        ));
      }
      const folderPanel = row.closest("[data-codex-sidebar-folder-panel]");
      return !folderPanel?.hidden;
    });
  }

  const STATUS_OPTIONS = [
    { value: "urgent-important", label: "紧急且重要", color: "#ef4755" },
    { value: "urgent-or-important", label: "紧急或重要", color: "#f28a16" },
    { value: "not-urgent", label: "不紧急", color: "#2fa56b" },
    { value: "clear", label: "清除标注", color: "#b5b7ba" },
  ];
  const UNMARKED_STATUS = { value: "unmarked", label: "未标记", color: "#b5b7ba" };

  function threadStatusKey(row) {
    return row.getAttribute("data-app-action-sidebar-thread-id") || rowKey(row);
  }

  function threadStatus(key) {
    return STATUS_OPTIONS.some((option) => option.value !== "clear" && option.value === threadStatuses[key])
      ? threadStatuses[key]
      : UNMARKED_STATUS.value;
  }

  function statusOption(value) {
    return STATUS_OPTIONS.find((option) => option.value === value) || UNMARKED_STATUS;
  }

  function persistThreadStatuses() {
    try { localStorage.setItem(THREAD_STATUS_STORAGE_KEY, JSON.stringify(threadStatuses)); } catch {}
  }

  function updateStatusButton(button, value) {
    const option = statusOption(value);
    button.dataset.status = option.value;
    button.setAttribute("aria-label", `状态：${option.label}`);
    button.title = option.label;
  }

  function closeStatusMenu({ focus = false } = {}) {
    document.getElementById(STATUS_MENU_ID)?.remove();
    if (openStatusButton) {
      openStatusButton.setAttribute("aria-expanded", "false");
      if (focus && openStatusButton.isConnected) openStatusButton.focus();
    }
    openStatusButton = null;
  }

  function positionStatusMenu(menu, button) {
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(innerWidth - menuRect.width - 8, Math.max(8, rect.right - menuRect.width));
    const below = rect.bottom + gap;
    const top = below + menuRect.height <= innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuRect.height - gap);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function chooseThreadStatus(key, value) {
    if (value === "clear") delete threadStatuses[key];
    else threadStatuses[key] = statusOption(value).value;
    persistThreadStatuses();
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((button) => {
      if (button.dataset.threadStatusKey === key) updateStatusButton(button, threadStatus(key));
    });
    closeStatusMenu();
  }

  function handleStatusMenuKeydown(event) {
    const items = Array.from(event.currentTarget.querySelectorAll("[data-codex-conversation-status-option]"));
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = items[(index + 1 + items.length) % items.length];
    else if (event.key === "ArrowUp") next = items[(index - 1 + items.length) % items.length];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items.at(-1);
    else if (event.key === "Escape") {
      event.preventDefault();
      closeStatusMenu({ focus: true });
      return;
    }
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function openThreadStatusMenu(row, button) {
    if (openStatusButton === button && document.getElementById(STATUS_MENU_ID)) {
      closeStatusMenu({ focus: true });
      return;
    }
    closeStatusMenu();
    const key = threadStatusKey(row);
    const current = threadStatus(key);
    const menu = document.createElement("div");
    menu.id = STATUS_MENU_ID;
    menu.dataset.codexConversationStatusMenu = "true";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "设置项目状态");
    menu.onkeydown = handleStatusMenuKeydown;
    for (const option of STATUS_OPTIONS) {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.codexConversationStatusOption = option.value;
      item.setAttribute("role", option.value === "clear" ? "menuitem" : "menuitemradio");
      if (option.value !== "clear") item.setAttribute("aria-checked", String(option.value === current));
      item.style.setProperty("--codex-status-color", option.color);
      const dot = document.createElement("span");
      dot.className = "codex-conversation-status-option-dot";
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = option.label;
      const check = document.createElement("span");
      check.className = "codex-conversation-status-option-check";
      check.setAttribute("aria-hidden", "true");
      if (option.value === current && option.value !== "clear") {
        check.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m3.5 8.2 2.8 2.8 6.2-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      item.append(dot, label, check);
      item.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        chooseThreadStatus(key, option.value);
      };
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    openStatusButton = button;
    button.setAttribute("aria-expanded", "true");
    positionStatusMenu(menu, button);
    requestAnimationFrame(() => (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"))?.focus());
  }

  function ensureCardStatusButton(row) {
    let button = Array.from(row.children).find((node) => node.classList?.contains(STATUS_BUTTON_CLASS));
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = STATUS_BUTTON_CLASS;
      button.dataset.codexConversationStatusButton = "true";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openThreadStatusMenu(row, button);
      };
      row.appendChild(button);
    }
    const key = threadStatusKey(row);
    button.dataset.threadStatusKey = key;
    updateStatusButton(button, threadStatus(key));
  }

  function handleStatusDocumentPointerDown(event) {
    const menu = document.getElementById(STATUS_MENU_ID);
    if (!menu || menu.contains(event.target) || openStatusButton?.contains(event.target)) return;
    closeStatusMenu();
  }

  function applySummary(row, preview) {
    const titleHost = row.querySelector("[data-thread-title-trigger=\"true\"]");
    if (!titleHost) return;
    row.setAttribute("data-codex-conversation-preview-enhanced", "true");
    const threadId = normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id"));
    if (activeProjectThreadIds.has(threadId)) row.setAttribute("data-codex-project-running", "true");
    else row.removeAttribute("data-codex-project-running");
    if (preview && !preview.catalogOnly && preview.updatedAt) {
      row.setAttribute("data-codex-conversation-preview-loaded", "true");
    } else {
      row.removeAttribute("data-codex-conversation-preview-loaded");
    }
    const cardItem = row.closest('[role="listitem"]');
    cardItem?.setAttribute("data-codex-conversation-card-item", "true");
    cardItem?.parentElement?.setAttribute("data-codex-conversation-card-grid", "true");
    titleHost.setAttribute("data-codex-conversation-preview-title", "true");
    let summary = titleHost.querySelector(`.${SUMMARY_CLASS}`);
    if (!summary) {
      summary = document.createElement("div");
      summary.className = SUMMARY_CLASS;
      titleHost.appendChild(summary);
    }
    const value = preview?.summary || "正在读取核心总结…";
    if (summary.textContent !== value) summary.textContent = value;
    summary.title = value;
    applyCardDetails(row, preview);
    ensureCardStatusButton(row);
  }

  function applyCardDetails(row, preview) {
    let card = Array.from(row.children).find((node) => node.classList?.contains(CARD_CONTENT_CLASS));
    if (!card) {
      card = document.createElement("div");
      card.className = CARD_CONTENT_CLASS;
      card.setAttribute("aria-hidden", "true");
      const title = document.createElement("div");
      title.className = CARD_TITLE_CLASS;
      const time = document.createElement("div");
      time.className = TIME_CLASS;
      const summary = document.createElement("div");
      summary.className = CARD_SUMMARY_CLASS;
      const tags = document.createElement("div");
      tags.className = TAGS_CLASS;
      card.append(title, time, summary, tags);
      row.appendChild(card);
    }

    const title = card.querySelector(`.${CARD_TITLE_CLASS}`);
    const time = card.querySelector(`.${TIME_CLASS}`);
    const summary = card.querySelector(`.${CARD_SUMMARY_CLASS}`);
    const tags = card.querySelector(`.${TAGS_CLASS}`);
    const titleValue = row.getAttribute("data-app-action-sidebar-thread-title") || "未命名对话";
    const summaryValue = preview?.summary || "正在提炼本次对话的核心内容…";
    title.textContent = titleValue;
    title.title = titleValue;
    time.textContent = preview?.lastCommunication || "正在读取时间";
    summary.textContent = summaryValue;
    summary.title = summaryValue;

    const subjectFallback = titleValue
      .replace(/^(创建|构建|优化|更新|安装|调研|查找|梳理|整理|生成|制作)+/u, "")
      .replace(/skills?/ig, "")
      .trim()
      .slice(0, 8) || "任务主题";
    const values = Array.isArray(preview?.tags) && preview.tags.length
      ? preview.tags.slice(0, 3)
      : [subjectFallback, "内容提炼中", "结果更新中"];
    while (values.length < 3) values.push(["任务主题", "内容提炼中", "结果更新中"][values.length]);
    const signature = values.join("\n");
    if (tags.dataset.values !== signature) {
      tags.dataset.values = signature;
      tags.replaceChildren(...values.map((value) => {
        const tag = document.createElement("span");
        tag.textContent = value;
        tag.title = value;
        return tag;
      }));
    }
  }

  function switchIcon(mode) {
    if (mode === "card") {
      return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.15"/></svg>`;
    }
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`;
  }

  function updateViewState() {
    document.documentElement.setAttribute("data-codex-conversation-view", viewMode);
    const button = document.getElementById(TOGGLE_ID);
    if (!button) return;
    const isCard = viewMode === "card";
    const label = isCard
      ? "卡片视图已开启，切换为列表视图"
      : "卡片视图已关闭，切换为卡片视图";
    button.setAttribute("aria-checked", String(isCard));
    button.setAttribute("aria-label", label);
    button.title = label;
    if (button.dataset.mode !== viewMode || !button.querySelector(`.${SWITCH_THUMB_CLASS}`)) {
      button.dataset.mode = viewMode;
      button.innerHTML = `<span class="${SWITCH_THUMB_CLASS}" aria-hidden="true">${switchIcon(viewMode)}</span>`;
    }
  }

  function handleViewToggle(event) {
    event.preventDefault();
    event.stopPropagation();
    viewMode = viewMode === "card" ? "list" : "card";
    try { localStorage.setItem(VIEW_STORAGE_KEY, viewMode); } catch {}
    layoutAnchored = false;
    updateViewState();
    scheduleSync();
  }

  function handleViewTogglePointerDown(event) {
    if (event.button !== 0) return;
    handleViewToggle(event);
  }

  function handleViewToggleClick(event) {
    if (event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleViewToggle(event);
  }

  function shortcutItemKey(item) {
    if (item?.kind === "enhancement") return `enhancement:${item.id}`;
    if (item?.managed) return `managed:${item.id}`;
    return item?.custom ? `custom:${item.id}` : `native:${item?.name || ""}`;
  }

  function validShortcutUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizedCustomShortcuts() {
    const seen = new Set();
    return shortcutSettings.custom.flatMap((raw) => {
      const id = typeof raw?.id === "string" && raw.id ? raw.id : "";
      const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 24) : "";
      const url = validShortcutUrl(raw?.url);
      if (!id || !name || !url || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        name,
        url,
        icon: Object.hasOwn(SHORTCUT_ICON_PRESETS, raw.icon) ? raw.icon : "link",
        openMode: raw.openMode === "browser" ? "browser" : "internal",
        custom: true,
      }];
    });
  }

  function normalizedManagedShortcuts() {
    const seen = new Set();
    const configured = Array.isArray(window[MANAGED_SHORTCUTS_GLOBAL])
      ? window[MANAGED_SHORTCUTS_GLOBAL]
      : [];
    return configured.flatMap((raw) => {
      const id = typeof raw?.id === "string" ? raw.id.trim().slice(0, 80) : "";
      const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 24) : "";
      const url = validShortcutUrl(raw?.url);
      if (!id || !name || !url || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        name,
        url,
        icon: Object.hasOwn(SHORTCUT_ICON_PRESETS, raw.icon) ? raw.icon : "link",
        openMode: ["browser", "in-app"].includes(raw.openMode) ? raw.openMode : "internal",
        keepAlive: raw.keepAlive === true && raw.openMode !== "browser",
        managed: true,
      }];
    });
  }

  function persistShortcutSettings() {
    shortcutSettings = {
      schemaVersion: 4,
      hidden: Array.from(new Set(shortcutSettings.hidden.filter((value) => typeof value === "string"))),
      custom: normalizedCustomShortcuts(),
    };
    try { localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(shortcutSettings)); } catch {}
  }

  function presetShortcutSvg(icon) {
    const paths = SHORTCUT_ICON_PRESETS[icon] || SHORTCUT_ICON_PRESETS.link;
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  function settingsShortcutSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" stroke="currentColor" stroke-width="1.7"/><path d="m19 13.2 1.5 1.2-1.7 2.9-1.8-.7a7.6 7.6 0 0 1-2.1 1.2l-.3 1.9h-3.4l-.3-1.9a7.6 7.6 0 0 1-2.1-1.2l-1.8.7-1.7-2.9 1.5-1.2a7.5 7.5 0 0 1 0-2.4L5.3 9.6 7 6.7l1.8.7a7.6 7.6 0 0 1 2.1-1.2l.3-1.9h3.4l.3 1.9A7.6 7.6 0 0 1 17 7.4l1.8-.7 1.7 2.9-1.5 1.2a7.5 7.5 0 0 1 0 2.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  }

  function openCustomShortcutInBrowser(item) {
    const url = validShortcutUrl(item?.url);
    if (!url) return false;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }

  function nativeShortcutThreadId() {
    const nodes = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-id]'))
      .filter((node) => node.getAttribute("data-app-action-sidebar-thread-active") === "true"
        || node.getAttribute("data-app-action-sidebar-thread-selected") === "true"
        || node.getAttribute("aria-current") === "page");
    const ids = new Set(nodes.map((node) => normalizedThreadId(node.getAttribute("data-app-action-sidebar-thread-id"))));
    const id = ids.size === 1 ? Array.from(ids)[0] : "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
  }

  function showNativeShortcutNotice(text, record = null) {
    nativeShortcutNotice?.remove();
    const notice = document.createElement("section");
    notice.id = "aiyoucodex-native-shortcut-notice";
    notice.setAttribute("role", "status");
    notice.dataset.browserTabId = record?.browserTabId || "";
    notice.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:min(380px,calc(100vw - 48px));padding:16px;border:1px solid #bbc2ca;border-radius:12px;background:Canvas;color:CanvasText;box-shadow:0 4px 20px #0002;pointer-events:auto;-webkit-app-region:no-drag";
    const message = document.createElement("p");
    message.textContent = text;
    message.style.cssText = "margin:0 0 8px;font-size:14px;line-height:1.5";
    const dismiss = document.createElement("button");
    dismiss.textContent = "知道了";
    dismiss.type = "button";
    dismiss.style.cssText = "min-height:32px;padding:4px 12px;cursor:pointer;-webkit-app-region:no-drag";
    dismiss.onclick = () => notice.remove();
    notice.append(message, dismiss);
    document.body.appendChild(notice);
    nativeShortcutNotice = notice;
  }

  function openNativeBrowserShortcut(item, { toggle = false } = {}) {
    const url = validShortcutUrl(item?.url);
    const conversationId = nativeShortcutThreadId();
    if (!url || !conversationId) {
      showNativeShortcutNotice("请先打开一个明确的对话，再打开此网页；没有创建新标签。");
      return { ok: false, reason: "current-thread-unavailable" };
    }
    if (typeof window.electronBridge?.sendMessageFromView !== "function") {
      showNativeShortcutNotice("当前宿主没有可用的 Codex 浏览器接口；未重新加载网页。");
      return { ok: false, reason: "native-browser-unavailable" };
    }
    const key = JSON.stringify([conversationId, shortcutItemKey(item), url]);
    let record = nativeShortcutRecords.get(key);
    closeOtherWorkspacePanels("native-browser");
    if (record) {
      // No URL on reveal/toggle: preserve the current canvas, history and draft.
      window.postMessage({ type: "toggle-browser-panel", conversationId,
        browserTabId: record.browserTabId, ...(toggle ? {} : { open: true }),
        source: "manual", initiator: "side_panel_menu" }, window.location.origin);
      if (record.status === "unconfirmed") showNativeShortcutNotice("Codex 尚未确认网页加载。请检查右侧浏览器标签；为保护画布，没有自动刷新或重复创建。", record);
      return { ok: true, status: record.status, browserTabId: record.browserTabId, created: false };
    }
    record = { conversationId, browserTabId: crypto.randomUUID(), url, name: item.name, status: "requested" };
    nativeShortcutRecords.set(key, record);
    showNativeShortcutNotice(`正在请求 Codex 浏览器打开 ${item.name}…`, record);
    window.postMessage({ type: "open-browser-tab", conversationId,
      browserTabId: record.browserTabId, initialUrl: url,
      source: "manual", initiator: "side_panel_menu" }, window.location.origin);
    const timer = setTimeout(() => {
      nativeShortcutTimers.delete(timer);
      if (destroyed || record.status !== "requested") return;
      record.status = "unconfirmed";
      if (nativeShortcutThreadId() === conversationId) {
        showNativeShortcutNotice("Codex 浏览器未确认加载完成，可能尚未启用或当前任务未显示。请检查右侧浏览器标签；没有自动刷新，也没有创建第二个页面。", record);
      }
    }, 10000);
    nativeShortcutTimers.add(timer);
    return { ok: true, status: "requested", browserTabId: record.browserTabId, created: true };
  }

  function handleNativeShortcutMessage(event) {
    if (event.source !== window && event.source !== null) return;
    if (event.origin !== window.location.origin && !(event.source === null && event.origin === "")) return;
    const data = event.data;
    if (data?.type !== "browser-sidebar-state" || !data.snapshot) return;
    const record = Array.from(nativeShortcutRecords.values()).find((value) =>
      value.conversationId === data.conversationId && value.browserTabId === data.browserTabId);
    if (!record) return;
    const snapshot = data.snapshot;
    if (snapshot.loadError) {
      if (record.status === "failed") return;
      record.status = "failed";
      if (nativeShortcutThreadId() === record.conversationId) showNativeShortcutNotice(`${record.name} 加载失败，请在 Codex 浏览器中查看具体错误；没有自动重试。`, record);
      return;
    }
    const committedUrl = validShortcutUrl(snapshot.committedUrl);
    if (committedUrl && new URL(committedUrl).origin === new URL(record.url).origin
      && snapshot.isLoading === false && snapshot.isWaitingForResponse === false) {
      record.status = "loaded";
      if (nativeShortcutNotice?.dataset.browserTabId === record.browserTabId) nativeShortcutNotice.remove();
    }
  }

  function handleCustomShortcutPolicyViolation(event) {
    if (event.disposition !== "enforce" || !["frame-src", "child-src"].includes(event.effectiveDirective)) return;
    const record = Array.from(customShortcutFrames.values()).find((value) =>
      value.url === event.blockedURI || new URL(value.url).origin === event.blockedURI);
    if (!record) return;
    record.blocked = true;
    if (!customShortcutPageIsVisible() || customShortcutPage.dataset.codexCustomShortcutItem !== record.key) return;
    showNativeShortcutNotice("当前 Codex 不允许此网页使用旧式嵌入。可切换到 Codex 浏览器面板；不会修改宿主安全策略。");
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "使用 Codex 浏览器打开";
    open.style.cssText = "display:block;min-height:36px;margin-top:8px;cursor:pointer;-webkit-app-region:no-drag";
    open.onclick = () => openNativeBrowserShortcut(record.item);
    nativeShortcutNotice.appendChild(open);
  }

  function restoreCustomShortcutNativeContent() {
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE));
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HOST_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HOST_ATTRIBUTE));
  }

  function savedWorkspacePanelWidth() {
    let value = 680;
    try { value = Number(localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY)) || value; } catch {}
    return Math.max(420, Math.min(value, Math.max(420, window.innerWidth - 360)));
  }

  function initializeWorkspacePanel(page, panelName) {
    page.setAttribute(WORKSPACE_PANEL_ATTRIBUTE, panelName);
    page.style.setProperty("--codex-workspace-panel-width", `${savedWorkspacePanelWidth()}px`);
    page.addEventListener("pointerdown", (event) => {
      const rect = page.getBoundingClientRect();
      if (event.button !== 0 || Math.abs(event.clientX - rect.left) > 8) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = rect.width;
      const move = (moveEvent) => {
        const width = Math.max(420, Math.min(startWidth + startX - moveEvent.clientX, Math.max(420, window.innerWidth - 360)));
        page.style.setProperty("--codex-workspace-panel-width", `${width}px`);
      };
      const up = () => {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        workspaceResizeCleanups.delete(up);
        if (destroyed) return;
        const width = Math.round(page.getBoundingClientRect().width);
        try { localStorage.setItem(WORKSPACE_PANEL_WIDTH_KEY, String(width)); } catch {}
      };
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      workspaceResizeCleanups.add(up);
    }, true);
    return page;
  }

  function announceWorkspacePanel(panel) {
    window.postMessage({ type: WORKSPACE_PANEL_EVENT, panel }, window.location.origin);
  }

  function closeOtherWorkspacePanels(panel) {
    if (panel !== "custom") closeCustomShortcutPanel(false);
    if (panel !== "asset") closeAssetConsolePanel({ notify: false, restoreFocus: false });
    if (panel !== "skills") closeSkillsGrouping(false);
    if (panel !== "efficiency") closeEfficiencyPanel(false);
    if (panel !== "taskboard") window.__codexTaskboardInjection__?.close?.(false);
    announceWorkspacePanel(panel);
  }

  function findCustomShortcutPageMount() {
    let frameHost = document.querySelector(".app-shell-main-content-frame");
    if (!frameHost?.closest?.("[data-app-shell-main-content-layout]")) {
      const viewport = document.querySelector("[data-app-shell-main-content-layout]");
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect();
        frameHost = Array.from(viewport.children).find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width >= viewportRect.width * 0.8
            && rect.height >= viewportRect.height * 0.7;
        }) || null;
      }
    }
    const viewport = frameHost?.closest?.("[data-app-shell-main-content-layout]");
    const surface = viewport?.parentElement
      || document.querySelector("main")
      || document.querySelector('[role="main"]');
    if (!surface || surface.closest("aside")) return null;
    return { surface };
  }

  function createCustomShortcutPage() {
    const page = document.createElement("section");
    page.id = CUSTOM_SHORTCUT_PAGE_ID;
    page.hidden = true;
    page.dataset.codexCustomShortcutState = "hidden";
    const header = document.createElement("header");
    header.className = "codex-custom-shortcut-header";
    const title = document.createElement("span");
    title.dataset.codexCustomShortcutTitle = "true";
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.codexCustomShortcutClose = "true";
    close.setAttribute("aria-label", "关闭内置网页");
    close.textContent = "×";
    close.onclick = () => closeCustomShortcutPanel();
    header.append(title, close);
    const frameStack = document.createElement("div");
    frameStack.className = "codex-custom-shortcut-frame-stack";
    page.append(header, frameStack);
    return initializeWorkspacePanel(page, "custom");
  }

  function updateCustomShortcutKeepAliveState() {
    if (!customShortcutPage) return;
    const mounted = Array.from(customShortcutFrames.values()).some((record) =>
      record.keepAlive && record.frame.isConnected,
    );
    if (mounted) customShortcutPage.dataset.codexCustomShortcutKeepAliveMounted = "true";
    else customShortcutPage.removeAttribute("data-codex-custom-shortcut-keep-alive-mounted");
  }

  function customShortcutPageIsVisible() {
    return customShortcutPage?.dataset.codexCustomShortcutState === "visible"
      && customShortcutPage.hidden === false;
  }

  function setCustomShortcutPageVisibility(visible) {
    if (!customShortcutPage) return;
    const keepAliveMounted = customShortcutPage.dataset.codexCustomShortcutKeepAliveMounted === "true";
    if (visible) {
      customShortcutPage.hidden = false;
      customShortcutPage.dataset.codexCustomShortcutState = "visible";
      customShortcutPage.setAttribute("aria-hidden", "false");
      return;
    }
    customShortcutPage.dataset.codexCustomShortcutState = keepAliveMounted ? "parked" : "hidden";
    customShortcutPage.hidden = !keepAliveMounted;
    customShortcutPage.setAttribute("aria-hidden", "true");
  }

  function removeCustomShortcutFrame(key) {
    const record = customShortcutFrames.get(key);
    if (!record) return;
    record.frame.remove();
    customShortcutFrames.delete(key);
    if (customShortcutFrame === record.frame) customShortcutFrame = null;
    updateCustomShortcutKeepAliveState();
  }

  function ensureCustomShortcutFrame(item, url) {
    const key = shortcutItemKey(item);
    const existing = customShortcutFrames.get(key);
    if (existing?.frame?.isConnected && existing.url === url) {
      existing.keepAlive = item.keepAlive === true;
      existing.frame.dataset.codexCustomShortcutKeepAlive = String(existing.keepAlive);
      updateCustomShortcutKeepAliveState();
      return { ...existing, created: false };
    }
    if (existing) removeCustomShortcutFrame(key);
    const frame = document.createElement("iframe");
    frame.title = item.name;
    frame.name = `codex-managed-shortcut|${encodeURIComponent(key)}|${encodeURIComponent(String(window[RENDERER_TARGET_ID_GLOBAL] || ""))}`;
    frame.src = url;
    frame.referrerPolicy = "no-referrer";
    frame.dataset.codexCustomShortcutFrame = key;
    frame.dataset.codexCustomShortcutActive = "false";
    frame.dataset.codexCustomShortcutKeepAlive = String(item.keepAlive === true);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation");
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    customShortcutPage.querySelector(".codex-custom-shortcut-frame-stack")?.appendChild(frame);
    const record = { key, url, item, keepAlive: item.keepAlive === true, frame };
    customShortcutFrames.set(key, record);
    updateCustomShortcutKeepAliveState();
    return { ...record, created: true };
  }

  function activateCustomShortcutFrame(record) {
    for (const candidate of customShortcutFrames.values()) {
      const active = candidate.key === record.key;
      candidate.frame.dataset.codexCustomShortcutActive = String(active);
      if (active) candidate.frame.id = CUSTOM_SHORTCUT_FRAME_ID;
      else candidate.frame.removeAttribute("id");
    }
    customShortcutFrame = record.frame;
    for (const [key, candidate] of customShortcutFrames) {
      if (key !== record.key && !candidate.keepAlive) removeCustomShortcutFrame(key);
    }
  }

  function ensureCustomShortcutPage(mount) {
    if (!customShortcutPage) customShortcutPage = createCustomShortcutPage();
    if (customShortcutPage.parentElement !== mount.surface) mount.surface.appendChild(customShortcutPage);
    return customShortcutPage;
  }

  function openCustomShortcutPanel(item) {
    if (item?.openMode === "in-app") return openNativeBrowserShortcut(item).ok;
    const url = validShortcutUrl(item?.url);
    if (!url) return false;
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("custom");
    ensureCustomShortcutPage(mount);
    customShortcutLastFocusedElement = document.activeElement;
    customShortcutPage.querySelector("[data-codex-custom-shortcut-title]").textContent = item.name;
    customShortcutPage.dataset.codexCustomShortcutItem = shortcutItemKey(item);
    const record = ensureCustomShortcutFrame(item, url);
    activateCustomShortcutFrame(record);
    setCustomShortcutPageVisibility(true);
    setWorkspacePanelHostLayer(customShortcutPage, true);
    document.documentElement.setAttribute("data-codex-custom-shortcut-open", "true");
    scheduleSync();
    return true;
  }

  function closeCustomShortcutPanel(restoreFocus = true) {
    const key = customShortcutPage?.dataset.codexCustomShortcutItem || "";
    const active = customShortcutFrames.get(key);
    setWorkspacePanelHostLayer(customShortcutPage, false);
    if (active && !active.keepAlive) removeCustomShortcutFrame(key);
    setCustomShortcutPageVisibility(false);
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-custom-shortcut-open");
    customShortcutPage?.removeAttribute("data-codex-custom-shortcut-item");
    if (restoreFocus) customShortcutLastFocusedElement?.focus?.();
    customShortcutLastFocusedElement = null;
    scheduleSync();
  }

  function ensureManagedShortcut(shortcutId, options = {}) {
    const item = normalizedManagedShortcuts().find((candidate) =>
      candidate.id === String(shortcutId || "") && ["internal", "in-app"].includes(candidate.openMode),
    );
    if (!item) return { ok: false, reason: "shortcut-not-found" };
    if (item.openMode === "in-app") {
      // Native page suspension is owned by Codex. Do not fake an iframe target
      // or report an unacknowledged request as a running background canvas.
      if (options?.visible !== true) return { ok: false, reason: "native-background-open-unavailable" };
      return openNativeBrowserShortcut(item);
    }
    if (options?.visible === true) {
      const opened = openCustomShortcutPanel(item);
      return opened
        ? { ok: true, visible: true, created: false }
        : { ok: false, visible: false, created: false, reason: "panel-mount-unavailable" };
    }
    if (item.keepAlive !== true) return { ok: false, reason: "keep-alive-disabled" };
    const mount = findCustomShortcutPageMount();
    const url = validShortcutUrl(item.url);
    if (!mount || !url) return { ok: false, reason: "panel-mount-unavailable" };
    ensureCustomShortcutPage(mount);
    const record = ensureCustomShortcutFrame(item, url);
    if (!customShortcutPageIsVisible()) setCustomShortcutPageVisibility(false);
    scheduleSync();
    return { ok: true, visible: customShortcutPageIsVisible(), created: record.created };
  }

  function currentCodexTaskContext() {
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    return {
      threadId: normalizedThreadId(active?.getAttribute("data-app-action-sidebar-thread-id") || ""),
      threadTitle: active?.getAttribute("data-app-action-sidebar-thread-title") || "",
    };
  }

  function normalizeRecoveredMessageText(value) {
    return String(value || "")
      .replace(/^附件：[^\n]*(?:\r?\n){1,2}/u, "")
      .replace(/[`*_~]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function recoveredMessageDisplayText(value) {
    return String(value || "")
      .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu, "")
      .replace(/<image\b[^>]*\bpath="[^"]+"[^>]*>/gu, "")
      .replace(/:codex-file-citation\{path="([^"]+)"[^}]*\}/gu, "$1")
      .replace(/^```[^\n]*\n?|```$/gmu, "")
      .replace(/\*\*([^*]+)\*\*/gu, "$1")
      .replace(/~~([^~]+)~~/gu, "$1")
      .replace(/`([^`]+)`/gu, "$1")
      .replace(/^#{1,6}\s+/gmu, "")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }

  function recoveredTextsMatch(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    return Math.min(left.length, right.length) >= 24 && (left.includes(right) || right.includes(left));
  }

  function clearRecoveredConversationHistory() {
    document.querySelectorAll(`[${RECOVERED_HISTORY_FLOW_ATTRIBUTE}="true"]`).forEach((node) => node.remove());
    document.querySelectorAll(`[${RECOVERED_HISTORY_CONTENT_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(RECOVERED_HISTORY_CONTENT_ATTRIBUTE));
    recoveredHistorySignature = "";
  }

  function nativeConversationFlowMount() {
    const conversation = document.querySelector('[data-thread-find-target="conversation"]');
    const historyContent = conversation?.firstElementChild;
    if (!(conversation instanceof HTMLElement) || !(historyContent instanceof HTMLElement)) return null;
    const turns = Array.from(historyContent.children).find((child) =>
      child instanceof HTMLElement && child.classList.contains("flex") && child.classList.contains("flex-col"),
    );
    if (!(turns instanceof HTMLElement)) return null;
    const children = Array.from(turns.children);
    const insertionReference = children.find((child, index) => index > 0 && (
      child.getAttribute("data-turn-key")?.startsWith("history-content:tail:")
      || child.querySelector('[data-local-conversation-final-assistant="true"]')
    )) || children.at(-1) || null;
    const scroll = conversation.closest(".thread-scroll-container");
    return { conversation, historyContent, turns, insertionReference, scroll: scroll instanceof HTMLElement ? scroll : null };
  }

  function nativeConversationSnapshot(mount) {
    const recoveredSelector = `[${RECOVERED_HISTORY_FLOW_ATTRIBUTE}="true"]`;
    const userTexts = Array.from(mount.conversation.querySelectorAll('[data-user-message-bubble="true"]'))
      .filter((node) => !node.closest(recoveredSelector))
      .map((node) => normalizeRecoveredMessageText(node.textContent));
    const assistantNodes = Array.from(mount.conversation.querySelectorAll('[data-markdown-text-style="assistant-message"]'))
      .filter((node) => !node.closest(recoveredSelector));
    for (const finalNode of mount.conversation.querySelectorAll('[data-local-conversation-final-assistant="true"]')) {
      if (!finalNode.closest(recoveredSelector) && !finalNode.querySelector('[data-markdown-text-style="assistant-message"]')) {
        assistantNodes.push(finalNode);
      }
    }
    const assistantTexts = assistantNodes.map((node) => normalizeRecoveredMessageText(node.textContent));
    const nativeText = normalizeRecoveredMessageText(Array.from(mount.turns.children)
      .filter((node) => !node.matches(recoveredSelector))
      .map((node) => node.textContent || "")
      .join("\n"));
    return { userTexts, assistantTexts, nativeText };
  }

  function historicalMessagesMissingFromNativeFlow(history, mount) {
    const snapshot = nativeConversationSnapshot(mount);
    const available = {
      user: snapshot.userTexts.map((text) => ({ text, used: false })),
      assistant: snapshot.assistantTexts.map((text) => ({ text, used: false })),
    };
    const missing = [];
    for (const message of history.messages) {
      const normalized = normalizeRecoveredMessageText(message.text);
      if (!normalized) continue;
      const candidates = available[message.role] || [];
      const match = candidates.find((candidate) => !candidate.used && recoveredTextsMatch(normalized, candidate.text));
      if (match) {
        match.used = true;
        continue;
      }
      if (message.role === "assistant" && normalized.length >= 24 && snapshot.nativeText.includes(normalized)) continue;
      missing.push(message);
    }
    return missing;
  }

  function createRecoveredConversationFlow(messages, signature) {
    const flow = document.createElement("section");
    flow.setAttribute(RECOVERED_HISTORY_FLOW_ATTRIBUTE, "true");
    flow.dataset.signature = signature;
    flow.setAttribute("aria-label", "已恢复的对话消息");
    const fragment = document.createDocumentFragment();
    for (const message of messages) {
      const article = document.createElement("article");
      article.setAttribute(RECOVERED_HISTORY_MESSAGE_ATTRIBUTE, "true");
      article.dataset.role = message.role;
      article.dataset.phase = message.phase || "";
      article.dataset.messageId = message.id || "";
      const body = document.createElement("div");
      body.className = "codex-recovered-history-body text-size-chat";
      body.textContent = recoveredMessageDisplayText(message.text);
      article.appendChild(body);
      fragment.appendChild(article);
    }
    flow.appendChild(fragment);
    return flow;
  }

  function ensureRecoveredConversationHistory() {
    const historyThreadId = normalizedThreadId(conversationHistory?.threadId);
    if (!historyThreadId || currentCodexTaskContext().threadId !== historyThreadId || !conversationHistory?.messages?.length) {
      clearRecoveredConversationHistory();
      return;
    }
    const mount = nativeConversationFlowMount();
    if (!mount) return;
    const missing = historicalMessagesMissingFromNativeFlow(conversationHistory, mount);
    if (!missing.length) {
      clearRecoveredConversationHistory();
      return;
    }
    const signature = `${historyThreadId}:${missing.map((message) => message.id || `${message.role}:${message.text}`).join("|")}`;
    const current = mount.turns.querySelector(`:scope > [${RECOVERED_HISTORY_FLOW_ATTRIBUTE}="true"]`);
    if (current?.dataset.signature === signature
      && current.parentElement === mount.turns
      && current.nextElementSibling === mount.insertionReference) {
      mount.historyContent.setAttribute(RECOVERED_HISTORY_CONTENT_ATTRIBUTE, "true");
      recoveredHistorySignature = signature;
      return;
    }
    const previousHeight = mount.scroll?.scrollHeight || 0;
    const previousScrollTop = mount.scroll?.scrollTop || 0;
    const reverseScroll = mount.scroll ? getComputedStyle(mount.scroll).flexDirection === "column-reverse" : false;
    const wasNearBottom = mount.scroll
      ? (reverseScroll
        ? Math.abs(mount.scroll.scrollTop) < 96
        : mount.scroll.scrollHeight - mount.scroll.scrollTop - mount.scroll.clientHeight < 96)
      : false;
    clearRecoveredConversationHistory();
    const flow = createRecoveredConversationFlow(missing, signature);
    mount.historyContent.setAttribute(RECOVERED_HISTORY_CONTENT_ATTRIBUTE, "true");
    mount.turns.insertBefore(flow, mount.insertionReference);
    recoveredHistorySignature = signature;
    if (mount.scroll) {
      const heightDelta = mount.scroll.scrollHeight - previousHeight;
      if (wasNearBottom) mount.scroll.scrollTop = reverseScroll ? 0 : mount.scroll.scrollHeight;
      else mount.scroll.scrollTop = previousScrollTop + (reverseScroll ? -heightDelta : heightDelta);
    }
  }

  function setConversationHistory(value) {
    const source = value && typeof value === "object" ? value : null;
    const threadId = normalizedThreadId(source?.threadId);
    const messages = (Array.isArray(source?.messages) ? source.messages : []).flatMap((message) => {
      const role = message?.role;
      const text = typeof message?.text === "string" ? message.text : "";
      if ((role !== "user" && role !== "assistant") || !text) return [];
      return [{
        id: String(message.id || ""),
        role,
        phase: role === "assistant" ? String(message.phase || "") : "",
        timestamp: typeof message.timestamp === "string" ? message.timestamp : null,
        text,
      }];
    });
    if (!threadId || !messages.length) {
      conversationHistory = null;
      historySignature = "";
      scheduleSync();
      return;
    }
    historySignature = `${threadId}:${source.sourceSize || 0}:${messages.length}`;
    conversationHistory = {
      threadId,
      title: String(source.title || ""),
      updatedAt: source.updatedAt || null,
      sourceSize: Number(source.sourceSize || 0),
      totalCount: messages.length,
      userCount: messages.filter((message) => message.role === "user").length,
      assistantCount: messages.filter((message) => message.role === "assistant").length,
      messages,
    };
    scheduleSync();
  }

  function notifyAssetConsole(action) {
    const binding = globalThis.codexSidebarOpenAssetConsole;
    if (typeof binding !== "function") return false;
    try {
      binding(JSON.stringify({ action, ...currentCodexTaskContext() }));
      return true;
    } catch {
      return false;
    }
  }

  function setWorkspacePanelHostLayer(page, active) {
    const host = page?.parentElement;
    if (!host) return;
    const marker = "data-codex-workspace-panel-host-layer";
    const previous = "data-codex-workspace-panel-host-z-index";
    if (active) {
      if (!host.hasAttribute(marker)) {
        host.setAttribute(marker, "true");
        host.setAttribute(previous, host.style.zIndex || "");
      }
      host.style.setProperty("z-index", "40");
      return;
    }
    if (!host.hasAttribute(marker)) return;
    const original = host.getAttribute(previous) || "";
    if (original) host.style.zIndex = original;
    else host.style.removeProperty("z-index");
    host.removeAttribute(marker);
    host.removeAttribute(previous);
  }

  function createAssetConsolePage() {
    const page = document.createElement("section");
    page.id = ASSET_CONSOLE_PAGE_ID;
    page.hidden = true;
    page.setAttribute("role", "dialog");
    page.setAttribute("aria-label", "资产控制台");
    page.innerHTML = `
      <header class="codex-asset-console-header">
        <span class="codex-asset-console-title">资产控制台</span>
        <span class="codex-asset-console-local">本机直连</span>
        <span class="codex-asset-console-spacer"></span>
        <button type="button" class="codex-asset-console-close" aria-label="关闭资产控制台">×</button>
      </header>
      <div class="codex-asset-console-body">
        <div class="codex-asset-console-state" role="status">
          <span class="codex-asset-console-message">正在连接本机资产库…</span>
          <button type="button" class="codex-asset-console-retry">重新连接</button>
        </div>
      </div>`;
    page.querySelector(".codex-asset-console-close").onclick = () => closeAssetConsolePanel();
    page.querySelector(".codex-asset-console-retry").onclick = () => {
      page.dataset.state = "loading";
      page.querySelector(".codex-asset-console-message").textContent = "正在连接本机资产库…";
      notifyAssetConsole("open");
    };
    return initializeWorkspacePanel(page, "asset");
  }

  function setAssetConsoleOpenIntent(open) {
    assetConsoleRestorePending = false;
    try {
      if (open) sessionStorage.setItem(ASSET_CONSOLE_OPEN_INTENT_KEY, JSON.stringify({
        open: true, targetId: String(window[RENDERER_TARGET_ID_GLOBAL] || ""),
      }));
      else sessionStorage.removeItem(ASSET_CONSOLE_OPEN_INTENT_KEY);
    } catch {}
  }

  function restoreAssetConsoleOpenIntent() {
    if (!assetConsoleRestorePending || destroyed || !assetConsole.available
      || typeof globalThis.codexSidebarOpenAssetConsole !== "function" || document.readyState === "loading") return;
    const anotherPanelVisible = Array.from(document.querySelectorAll(`[${WORKSPACE_PANEL_ATTRIBUTE}], #codex-taskboard-page`))
      .some((panel) => panel.id !== ASSET_CONSOLE_PAGE_ID && !panel.hidden && panel.getAttribute("aria-hidden") !== "true");
    if (anotherPanelVisible) { setAssetConsoleOpenIntent(false); return; }
    if (!findCustomShortcutPageMount()) return;
    // One attempt per restored document; a failed service connection remains a
    // visible retry state rather than repeatedly opening or stealing focus.
    assetConsoleRestorePending = false;
    openAssetConsolePanel();
  }

  function mountAssetConsolePage(surface) {
    if (!assetConsolePage || !surface) return false;
    const detached = !assetConsolePage.isConnected;
    const changingParent = assetConsolePage.parentElement !== surface;
    if ((detached || changingParent) && assetConsoleFrame) {
      // Removing an iframe's ancestor destroys its browsing context. Reusing
      // this detached reference as "ready" would display a dead/blank frame.
      assetConsoleFrame.remove();
      assetConsoleFrame = null;
      assetConsolePage.dataset.state = "loading";
    }
    if (changingParent) surface.appendChild(assetConsolePage);
    return detached;
  }

  function restoreDetachedAssetConsolePanel() {
    // Restore only a panel the user left open. Closing/switching panels is an
    // explicit visibility decision and must not be undone by a DOM observer.
    if (!assetConsolePage || assetConsolePage.hidden || assetConsolePage.isConnected) return;
    const mount = findCustomShortcutPageMount();
    if (!mount) { scheduleAnchorRetry(); return; }
    mountAssetConsolePage(mount.surface);
    setWorkspacePanelHostLayer(assetConsolePage, true);
    assetConsolePage.dataset.state = "loading";
    setTextIfChanged(assetConsolePage.querySelector(".codex-asset-console-message"), "界面结构已变化，正在重新连接资产库…");
    document.documentElement.setAttribute("data-codex-asset-console-open", "true");
    // This is a local recovery, not a keep-alive promise: obtain a fresh proxy
    // for the new browsing context without reinstalling the surrounding UI.
    if (!notifyAssetConsole("open")) {
      assetConsolePage.dataset.state = "error";
      setTextIfChanged(assetConsolePage.querySelector(".codex-asset-console-message"), "本机连接尚未就绪，请点击重新连接");
    }
  }

  function openAssetConsolePanel(options = {}) {
    pendingAssetConsoleQuery = typeof options?.query === "string" ? options.query.trim() : "";
    closeOtherWorkspacePanels("asset");
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    if (!assetConsolePage) assetConsolePage = createAssetConsolePage();
    setAssetConsoleOpenIntent(true);
    assetConsoleReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mountAssetConsolePage(mount.surface);
    setWorkspacePanelHostLayer(assetConsolePage, true);
    assetConsolePage.hidden = false;
    if (assetConsoleFrame?.isConnected && assetConsolePage.dataset.state === "ready") {
      if (pendingAssetConsoleQuery) {
        assetConsoleFrame.contentWindow?.postMessage({ source: "codex-sidebar-enhancer", action: "search", query: pendingAssetConsoleQuery }, "*");
      }
      document.documentElement.setAttribute("data-codex-asset-console-open", "true");
      scheduleSync();
      return true;
    }
    assetConsolePage.dataset.state = "loading";
    assetConsolePage.querySelector(".codex-asset-console-message").textContent = assetConsole.available
      ? "正在连接本机资产库…"
      : "资产控制台服务正在准备，请稍后重试";
    document.documentElement.setAttribute("data-codex-asset-console-open", "true");
    if (!notifyAssetConsole("open")) {
      assetConsolePage.dataset.state = "error";
      assetConsolePage.querySelector(".codex-asset-console-message").textContent = "本机连接尚未就绪";
    }
    scheduleSync();
    return true;
  }

  function closeAssetConsolePanel({ notify = true, restoreFocus = true, preserveIntent = false } = {}) {
    if (!preserveIntent) setAssetConsoleOpenIntent(false);
    if (assetConsolePage) assetConsolePage.hidden = true;
    setWorkspacePanelHostLayer(assetConsolePage, false);
    if (notify) {
      assetConsoleFrame?.remove();
      assetConsoleFrame = null;
    }
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-asset-console-open");
    if (notify) notifyAssetConsole("close");
    if (restoreFocus) assetConsoleReturnFocus?.focus?.();
    assetConsoleReturnFocus = null;
    scheduleSync();
  }

  function setAssetConsolePanel(value) {
    const state = value && typeof value === "object" ? value : {};
    if (!assetConsolePage?.isConnected || assetConsolePage.hidden) return;
    if (state.state !== "ready" || typeof state.url !== "string" || !state.url) {
      assetConsoleFrame?.remove();
      assetConsoleFrame = null;
      assetConsolePage.dataset.state = "error";
      assetConsolePage.querySelector(".codex-asset-console-message").textContent = state.message || "资产控制台暂时无法加载";
      return;
    }
    const body = assetConsolePage.querySelector(".codex-asset-console-body");
    if (assetConsoleFrame?.isConnected && assetConsoleFrame.src === state.url) {
      assetConsolePage.dataset.state = "ready";
      return;
    }
    assetConsoleFrame?.remove();
    const frame = document.createElement("iframe");
    frame.id = ASSET_CONSOLE_FRAME_ID;
    frame.title = "资产控制台";
    frame.src = state.url;
    frame.setAttribute("allow", "clipboard-read; clipboard-write; autoplay");
    frame.onload = () => {
      if (assetConsolePage) assetConsolePage.dataset.state = "ready";
      if (pendingAssetConsoleQuery) {
        frame.contentWindow?.postMessage({ source: "codex-sidebar-enhancer", action: "search", query: pendingAssetConsoleQuery }, "*");
      }
    };
    assetConsoleFrame = frame;
    body.appendChild(frame);
    assetConsolePage.dataset.state = "ready";
  }

  function currentComposer() {
    return Array.from(document.querySelectorAll('[contenteditable="true"]')).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 80 && rect.height > 20 && !node.closest(`#${ASSET_CONSOLE_PAGE_ID}`);
    }) || null;
  }

  function addAssetReferencesToComposer(assetPaths) {
    const composer = currentComposer();
    if (!composer || !assetPaths?.length) return false;
    const text = `${composer.textContent?.trim() ? "\n" : ""}${assetPaths.map((assetPath) => `参考资产：${assetPath}`).join("\n")}`;
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch {}
    if (!inserted) {
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  function isAbsoluteAssetPath(value) {
    const assetPath = typeof value === "string" ? value.trim() : "";
    return assetPath.startsWith("/")
      || /^[A-Za-z]:[\\/][^\0\r\n]*$/.test(assetPath)
      || /^[\\/]{2}[^\\/\0\r\n]+[\\/][^\\/\0\r\n]+(?:[\\/][^\0\r\n]*)?$/.test(assetPath);
  }

  function handleAssetConsoleMessage(event) {
    if (event.origin !== "https://web-sandbox.oaiusercontent.com" || event.source !== assetConsoleFrame?.contentWindow) return;
    const message = event.data;
    if (!message || message.source !== "asset-console") return;
    if (message.action === "return-to-codex") {
      closeAssetConsolePanel();
      requestAnimationFrame(() => currentComposer()?.focus());
      return;
    }
    const single = message.action === "use-in-codex";
    const multiple = message.action === "use-many-in-codex";
    if (!single && !multiple) return;
    const assetPaths = single
      ? [typeof message.path === "string" ? message.path.trim() : ""]
      : Array.isArray(message.paths) ? message.paths.map((assetPath) => typeof assetPath === "string" ? assetPath.trim() : "") : [];
    const valid = assetPaths.length > 0
      && assetPaths.length <= 8
      && assetPaths.every((assetPath) => assetPath.length < 4096 && isAbsoluteAssetPath(assetPath));
    const added = valid && addAssetReferencesToComposer(assetPaths);
    try {
      assetConsoleFrame.contentWindow.postMessage({
        source: "codex-sidebar-enhancer",
        action: added ? (multiple ? "assets-added" : "asset-added") : "asset-add-failed",
        count: added ? assetPaths.length : 0,
      }, event.origin);
    } catch {}
  }

  function loadSkillFavorites(catalog) {
    if (skillOrganizerFavorites) return skillOrganizerFavorites;
    try {
      const parsed = JSON.parse(localStorage.getItem(SKILL_FAVORITES_KEY) || "null");
      if (Array.isArray(parsed)) {
        skillOrganizerFavorites = new Set(parsed.filter((name) => typeof name === "string").flatMap((value) => {
          if (value.startsWith("skill:")) return [value];
          const exact = catalog.find((entry) => skillFavoriteKey(entry) === value);
          if (exact) return [skillFavoriteKey(exact)];
          const legacy = catalog.filter((entry) => entry.title === value || entry.name === value);
          return legacy.length === 1 ? [skillFavoriteKey(legacy[0])] : [];
        }));
        return skillOrganizerFavorites;
      }
    } catch {}
    const preferred = catalog.filter((entry) => /视频|导演|镜头|资产|工作台|提示词|知识|写作|skill/i.test(`${entry.title} ${entry.description}`));
    skillOrganizerFavorites = new Set((preferred.length ? preferred : catalog).slice(0, 10).map(skillFavoriteKey));
    try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
    return skillOrganizerFavorites;
  }

  function skillFavoriteKey(entry) {
    return String(entry.id || entry.path || entry.name || entry.title);
  }

  function skillEntryFromCard(card) {
    const titleNode = card.querySelector(".font-medium")
      || Array.from(card.querySelectorAll("div")).find((node) => node.classList.contains("truncate"));
    const title = titleNode?.textContent?.trim() || "";
    if (!title) return null;
    const descriptionNode = card.querySelector(".text-token-text-secondary.text-sm")
      || Array.from(card.querySelectorAll("div")).find((node) => node !== titleNode && node.classList.contains("line-clamp-1"));
    return { title, description: descriptionNode?.textContent?.trim() || "打开查看 Skill 详情", card };
  }

  function skillMatchesCategory(entry, category) {
    if (category === "all") return true;
    if (category === "common") return skillOrganizerFavorites?.has(skillFavoriteKey(entry)) === true;
    return entry.categoryId === category;
  }

  function clearSkillOrganizer() {
    skillTraceGeneration += 1; closeSkillDetails(false);
    skillOrganizerRenderGeneration += 1;
    if (skillOrganizerRenderFrame !== null) cancelAnimationFrame(skillOrganizerRenderFrame);
    skillOrganizerRenderFrame = null;
    document.getElementById(SKILL_ORGANIZER_ID)?.remove();
    document.querySelectorAll(`[${SKILL_NATIVE_SECTION_ATTR}]`).forEach((node) => node.removeAttribute(SKILL_NATIVE_SECTION_ATTR));
    skillOrganizerSource = null;
    skillOrganizerCatalog = [];
    skillOrganizerCatalogSignature = "";
    skillOrganizerFilter = "all";
    skillOrganizerQuery = "";
    skillOrganizerNativeVisible = false;
    closeSkillContextMenu();
  }

  function syncSkillOrganizerFilterSelection(shell, selected = skillOrganizerFilter) {
    shell?.querySelectorAll("[data-codex-skill-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.codexSkillFilter === selected));
    });
  }

  function scheduleSkillOrganizerRender() {
    const generation = ++skillOrganizerRenderGeneration;
    if (skillOrganizerRenderFrame !== null) cancelAnimationFrame(skillOrganizerRenderFrame);
    skillOrganizerRenderFrame = requestAnimationFrame(() => {
      skillOrganizerRenderFrame = null;
      if (generation !== skillOrganizerRenderGeneration) return;
      renderSkillOrganizer();
    });
  }

  function selectSkillOrganizerFilter(label) {
    if (!skillOrganization.groups.some((group) => group.id === label) || skillOrganizerFilter === label) return;
    skillOrganizerFilter = label;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    syncSkillOrganizerFilterSelection(shell, label);
    shell.setAttribute("aria-busy", "true");
    scheduleSkillOrganizerRender();
  }

  function renderSkillOrganizer() {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    loadSkillFavorites(skillOrganizerCatalog);
    if (skillOrganizerSource?.isConnected) {
      skillOrganizerSource.setAttribute(SKILL_NATIVE_SECTION_ATTR, skillOrganizerNativeVisible ? "visible" : "hidden");
    }
    const filters = shell.querySelector(".codex-skill-filter-list");
    // Reconcile by stable ID; polling and category changes never replace a
    // button between pointerdown and click, nor steal focus from search/forms.
    const existing = new Map([...filters.children].map((button) => [button.dataset.codexSkillFilter, button]));
    skillOrganization.groups.forEach(({ id, label }, index) => {
        const button = existing.get(id) || document.createElement("button");
        button.type = "button";
        button.className = "codex-skill-filter";
        button.dataset.codexSkillFilter = id;
        if (button.textContent !== label) button.textContent = label;
        button.onpointerdown = (event) => {
          if (event.button === 0) selectSkillOrganizerFilter(id);
        };
        button.onclick = () => selectSkillOrganizerFilter(id);
        if (filters.children[index] !== button) filters.insertBefore(button, filters.children[index] || null);
        existing.delete(id);
    });
    for (const button of existing.values()) button.remove();
    syncSkillOrganizerFilterSelection(shell);
    renderSkillOrganizationStatus();
    const terms = skillOrganizerQuery.toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
    const visible = skillOrganizerCatalog.filter((entry) => {
      const text = `${entry.title} ${entry.description}`.toLocaleLowerCase("zh-CN");
      return terms.every((term) => text.includes(term)) && skillMatchesCategory(entry, skillOrganizerFilter);
    });
    shell.querySelector(".codex-skill-result-count").textContent = `${visible.length} / ${skillOrganizerCatalog.length}`;
    const grid = shell.querySelector(".codex-skill-grid");
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "codex-skill-empty";
      empty.textContent = "没有找到匹配的 Skill";
      grid.replaceChildren(empty);
      shell.removeAttribute("aria-busy");
      return;
    }
    grid.replaceChildren(...visible.map((entry) => {
      const row = document.createElement("div");
      row.className = "codex-skill-row";
      row.dataset.skillId = skillFavoriteKey(entry);
      row.title = entry.skillFile || entry.path || entry.title;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const copy = document.createElement("span");
      copy.innerHTML = '<span class="codex-skill-name"></span><span class="codex-skill-description"></span><span class="codex-skill-category"></span>';
      copy.querySelector(".codex-skill-name").textContent = entry.title;
      copy.querySelector(".codex-skill-description").textContent = entry.description;
      const category = skillOrganization.groups.find((group) => group.id === entry.categoryId);
      copy.querySelector(".codex-skill-category").textContent = category ? `${category.label} · ${entry.classificationSource === "manual" ? "手动" : "自动"}` : "";
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "codex-skill-favorite";
      favorite.setAttribute("aria-pressed", String(skillOrganizerFavorites.has(skillFavoriteKey(entry))));
      favorite.setAttribute("aria-label", `${skillOrganizerFavorites.has(skillFavoriteKey(entry)) ? "取消常用" : "加入常用"}：${entry.title}`);
      favorite.textContent = "★";
      favorite.onclick = (event) => {
        event.stopPropagation();
        if (skillOrganizerFavorites.has(skillFavoriteKey(entry))) skillOrganizerFavorites.delete(skillFavoriteKey(entry));
        else skillOrganizerFavorites.add(skillFavoriteKey(entry));
        try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
        renderSkillOrganizer();
      };
      const use = document.createElement("button");
      use.type = "button";
      use.className = "codex-skill-use";
      use.setAttribute("aria-label", `添加到对话：${entry.title}`);
      use.title = "添加到对话";
      use.textContent = "+";
      use.onclick = (event) => { event.stopPropagation(); void addSkillToConversation(entry); };
      const open = () => openSkillDetails(entry, row);
      row.onclick = open;
      row.onkeydown = (event) => {
        if (event.target !== row) return;
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); const rect = row.getBoundingClientRect(); showSkillContextMenu(entry, rect.x + 12, rect.y + 12);
        } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
      };
      row.oncontextmenu = (event) => { event.preventDefault(); showSkillContextMenu(entry, event.clientX, event.clientY); };
      row.append(copy, favorite, use);
      return row;
    }));
    shell.removeAttribute("aria-busy");
  }

  function ensureSkillOrganizer() {
    if (hostSkillCatalog.length) return;
    const section = document.querySelector("section#skills-installed");
    if (!section) {
      if (skillOrganizerSource) clearSkillOrganizer();
      return;
    }
    skillOrganizerSource = section;
    const expand = Array.from(section.querySelectorAll('button[aria-expanded="false"]')).find((button) => /另有|查看|展开/.test(button.textContent || ""));
    if (expand) { expand.click(); return; }
    const catalog = Array.from(section.querySelectorAll('div[role="button"][tabindex="0"]'))
      .map(skillEntryFromCard)
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    if (!catalog.length) return;
    const catalogSignature = catalog.map((entry) => `${entry.title}\u0000${entry.description}`).join("\u0001");
    const catalogChanged = catalogSignature !== skillOrganizerCatalogSignature;
    if (catalogChanged) {
      skillOrganizerCatalog = catalog;
      skillOrganizerCatalogSignature = catalogSignature;
    } else {
      const currentCards = new Map(catalog.map((entry) => [entry.title, entry.card]));
      skillOrganizerCatalog.forEach((entry) => { entry.card = currentCards.get(entry.title) || entry.card; });
    }
    let shell = document.getElementById(SKILL_ORGANIZER_ID);
    let shellCreated = false;
    if (!shell || shell.nextElementSibling !== section) {
      shell?.remove();
      shell = document.createElement("section");
      shellCreated = true;
      shell.id = SKILL_ORGANIZER_ID;
      shell.innerHTML = `
        <div class="codex-skill-organizer-head"><div><h2>Skills 分组</h2><p>按工作环节整理已安装 Skill，并保留原生详情。</p></div><button type="button" class="codex-skill-native-toggle">完整列表</button></div>
        <label class="codex-skill-search"><input type="search" placeholder="搜索名称或用途" aria-label="搜索已安装 Skill"></label>
        <div class="codex-skill-filter-list" role="group" aria-label="Skills 分组"></div>
        <div class="codex-skill-result-head"><strong>已安装 Skills</strong><span class="codex-skill-result-count"></span></div>
        <div class="codex-skill-grid"></div>`;
      shell.querySelector("input").oninput = (event) => { skillOrganizerQuery = event.target.value.trim(); renderSkillOrganizer(); };
      shell.querySelector(".codex-skill-native-toggle").onclick = () => { skillOrganizerNativeVisible = !skillOrganizerNativeVisible; renderSkillOrganizer(); };
      section.parentElement?.insertBefore(shell, section);
    }
    if (shellCreated || catalogChanged) renderSkillOrganizer();
    finishSkillsGroupingOpen();
  }

  function updateSkillsGroupingShortcutState() {
    const button = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => candidate.dataset.codexSidebarShortcutName === "Skills 分组");
    if (!button) return;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    const active = skillOrganizerOpening || Boolean(shell && !shell.hidden);
    button.dataset.active = String(active);
    button.setAttribute("aria-current", String(active));
    button.setAttribute("aria-expanded", String(active));
    const label = button.querySelector(`.${SHORTCUT_LABEL_CLASS}`);
    if (skillOrganizerOpening) {
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "正在打开 Skills 分组");
      if (label) label.textContent = "正在打开…";
    } else {
      button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", `${active ? "收起" : "打开"}Skills 分组`);
      if (label) label.textContent = "Skills 分组";
    }
  }

  function finishSkillsGroupingOpen() {
    skillOrganizerOpening = false;
    skillOrganizerOpenObserver?.disconnect();
    skillOrganizerOpenObserver = null;
    if (skillOrganizerOpenTimer !== null) clearTimeout(skillOrganizerOpenTimer);
    skillOrganizerOpenTimer = null;
    try { localStorage.removeItem(SKILL_OPEN_REQUEST_STORAGE_KEY); } catch {}
    updateSkillsGroupingShortcutState();
  }

  function insertPlainTextIntoComposer(text) {
    const composer = currentComposer();
    if (!composer || !text) return false;
    composer.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch {}
    if (!inserted) range.insertNode(document.createTextNode(text));
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  async function addSkillToConversation(entry) {
    closeSkillContextMenu();
    let added = false;
    try {
      added = await window.__codexTaskboardInjection__?.addSkillToComposer?.({
        skillDisplayName: entry.title,
        skillName: entry.name || entry.title,
        skillPath: entry.path || "",
      }) === true;
    } catch {}
    if (!added) added = insertPlainTextIntoComposer(`${currentComposer()?.textContent?.trim() ? " " : ""}$${entry.name || entry.title} `);
    const useButton = Array.from(document.querySelectorAll(`#${SKILL_ORGANIZER_ID} .codex-skill-use`))
      .find((button) => button.getAttribute("aria-label") === `添加到对话：${entry.title}`);
    if (useButton) useButton.textContent = added ? "✓" : "!";
    return added;
  }

  function renderSkillOrganizationStatus() {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    shell.querySelectorAll("[data-skill-organization-status]").forEach((node) => { node.textContent = skillOrganizationMessage; });
    const pending = skillOrganizationRequests.size > 0;
    shell.querySelectorAll(".codex-skill-group-manager input, .codex-skill-group-manager button:not([data-skill-manager-close]), [data-skill-refresh]")
      .forEach((node) => { node.disabled = pending; });
  }

  function setSkillOrganization(value) {
    if (!value || !Number.isSafeInteger(value.version) || value.version < skillOrganization.version || !Array.isArray(value.groups) || !Array.isArray(value.catalog)) return;
    skillOrganization = { version: value.version, groups: value.groups };
    if (!value.groups.some((group) => group.id === skillOrganizerFilter)) skillOrganizerFilter = "all";
    setSkillCatalog(value.catalog);
  }

  function requestSkillOrganization(action, fields = {}) {
    if (skillOrganizationRequests.size || destroyed) return Promise.resolve(null);
    const binding = window.__AIYOUCODEX_SKILLS_REQUEST__;
    if (typeof binding !== "function") {
      skillOrganizationMessage = "本地分类服务尚未连接，请等待 AIYOUcodex 增强服务就绪。";
      renderSkillOrganizationStatus(); return Promise.resolve(null);
    }
    const requestId = `skills-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = { requestId, action, ...fields,
      ...(!["refresh", "revealSkill", "traceSkill"].includes(action) ? { expectedVersion: skillOrganization.version } : {}) };
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => resolveSkillOrganizationRequest({ requestId, ok: false,
        error: "操作结果尚未确认，请刷新后核对；不要重复新建分类。" }), action === "refresh" ? 25_000 : 10_000);
      skillOrganizationRequests.set(requestId, { resolve, timer, action });
    });
    skillOrganizationMessage = action === "refresh" ? "正在刷新目录…" : action === "revealSkill" ? "正在定位文件…" : action === "traceSkill" ? "正在查找创建 / 最近优化对话…" : "正在保存分类…";
    renderSkillOrganizationStatus();
    try { Promise.resolve(binding(JSON.stringify(payload))).catch(() => resolveSkillOrganizationRequest({ requestId, ok: false, error: "分类服务连接失败，请刷新核对。" })); }
    catch { resolveSkillOrganizationRequest({ requestId, ok: false, error: "分类请求未发送成功。" }); }
    return result;
  }

  function resolveSkillOrganizationRequest(response) {
    if (skillDetailsRequests.has(response?.requestId)) return resolveSkillDetailsRequest(response);
    const pending = skillOrganizationRequests.get(response?.requestId);
    if (!pending || destroyed) return false;
    clearTimeout(pending.timer); skillOrganizationRequests.delete(response.requestId);
    if (response.ok) {
      if (response.data?.catalog) setSkillOrganization(response.data);
      skillOrganizationMessage = response.data?.traceResult?.message || response.data?.revealResult?.message || (pending.action === "refresh" ? "目录已刷新 · 本地自动分类 · 0 Token" : "分类已保存，刷新与重启后仍保留。");
    } else skillOrganizationMessage = response.error || "操作未完成，请刷新后核对。";
    renderSkillOrganizationStatus(); pending.resolve(response.ok ? response.data : null);
    return true;
  }

  function openSkillGroupManager() {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    closeSkillContextMenu();
    let manager = shell.querySelector(".codex-skill-group-manager");
    if (!manager) { manager = document.createElement("div"); manager.className = "codex-skill-group-manager"; shell.appendChild(manager); }
    manager.hidden = false;
    manager.setAttribute("role", "region"); manager.setAttribute("aria-label", "分类管理");
    manager.innerHTML = '<div class="codex-skill-organizer-head"><strong>分类管理</strong><button type="button" data-skill-manager-close aria-label="关闭分类管理">×</button></div><p>6 个自动分类覆盖全部 Skills。右键卡片可手动移动，或恢复自动分类。</p><p>删除自定义分类只恢复其中 Skills 的自动分类，不删除或移动源文件。</p><form data-skill-create-group><input maxlength="24" required placeholder="自定义分类名称" aria-label="新分类名称"><button type="submit">新建分类</button></form><div data-skill-custom-groups></div><p role="status" data-skill-organization-status></p>';
    manager.querySelector("[data-skill-manager-close]").onclick = () => {
      manager.hidden = true; shell.querySelector("[data-skill-manage]")?.focus();
    };
    const create = manager.querySelector("[data-skill-create-group]");
    create.onsubmit = async (event) => {
      event.preventDefault();
      const result = await requestSkillOrganization("createGroup", { label: create.querySelector("input").value });
      if (result && !manager.hidden && manager.isConnected) openSkillGroupManager();
    };
    const list = manager.querySelector("[data-skill-custom-groups]");
    for (const group of skillOrganization.groups.filter((group) => !group.builtin)) {
      const row = document.createElement("form"); row.dataset.skillCustomGroup = group.id;
      const input = document.createElement("input"); input.value = group.label; input.maxLength = 24; input.required = true; input.setAttribute("aria-label", `分类名称：${group.label}`);
      const save = document.createElement("button"); save.type = "submit"; save.textContent = "改名";
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除分类";
      row.onsubmit = async (event) => {
        event.preventDefault();
        const result = await requestSkillOrganization("renameGroup", { groupId: group.id, label: input.value });
        if (result && !manager.hidden && manager.isConnected) openSkillGroupManager();
      };
      remove.onclick = async () => {
        const result = await requestSkillOrganization("deleteGroup", { groupId: group.id });
        if (result && !manager.hidden && manager.isConnected) openSkillGroupManager();
      };
      row.append(input, save, remove); list.appendChild(row);
    }
    renderSkillOrganizationStatus(); create.querySelector("input").focus();
  }

  function closeSkillContextMenu() {
    skillContextCleanup?.(); skillContextCleanup = null;
    skillContextMenu?.remove(); skillContextMenu = null;
  }

  function closeSkillDetails(restoreFocus = true) {
    skillDetailsGeneration += 1;
    for (const pending of skillDetailsRequests.values()) clearTimeout(pending.timer);
    skillDetailsRequests.clear();
    const origin = skillDetailsReturnFocus, id = skillDetailsEntry?.id;
    skillDetailsEntry = null; skillDetailsReturnFocus = null;
    if (skillDetailsDialog?.open) skillDetailsDialog.close();
    if (restoreFocus && !destroyed) {
      const row = [...document.querySelectorAll(`#${SKILL_ORGANIZER_ID} [data-skill-id]`)].find((node) => node.dataset.skillId === id);
      (origin?.isConnected ? origin : row || document.querySelector(`#${SKILL_ORGANIZER_ID} input`))?.focus();
    }
  }

  function openSkillDetails(entry, origin = null) {
    closeSkillContextMenu(); closeSkillDetails(false);
    skillDetailsEntry = entry; skillDetailsReturnFocus = origin;
    const generation = skillDetailsGeneration;
    if (!skillDetailsDialog) {
      const dialog = document.createElement("dialog"); dialog.id = "aiyoucodex-skill-details";
      dialog.setAttribute("aria-labelledby", "aiyoucodex-skill-details-title");
      dialog.innerHTML = '<header><div><h2 id="aiyoucodex-skill-details-title"></h2><p>使用方法与适用场景 · 本地说明</p></div><button type="button" data-skill-detail-close aria-label="关闭 Skill 介绍">×</button></header><div data-skill-detail-body></div><footer><p role="status" data-skill-detail-status></p><button type="button" data-skill-detail-use>添加到对话</button><button type="button" data-skill-detail-reveal>打开所在文件</button><button type="button" data-skill-detail-retry>重新读取</button></footer>';
      dialog.querySelector("[data-skill-detail-close]").onclick = () => closeSkillDetails();
      dialog.oncancel = (event) => { event.preventDefault(); closeSkillDetails(); };
      dialog.onclick = (event) => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeSkillDetails();
      };
      dialog.querySelector("[data-skill-detail-use]").onclick = () => {
        const selected = skillDetailsEntry; closeSkillDetails(false); if (selected) void addSkillToConversation(selected);
      };
      dialog.querySelector("[data-skill-detail-retry]").onclick = () => {
        if (skillDetailsEntry) openSkillDetails(skillDetailsEntry, skillDetailsReturnFocus);
      };
      dialog.querySelector("[data-skill-detail-reveal]").onclick = async () => {
        const selected = skillDetailsEntry, revision = skillDetailsGeneration;
        if (!selected) return;
        const result = await requestSkillOrganization("revealSkill", { skillId: selected.id });
        if (revision === skillDetailsGeneration) dialog.querySelector("[data-skill-detail-status]").textContent = result?.revealResult?.message || skillOrganizationMessage;
      };
      document.body.appendChild(dialog); skillDetailsDialog = dialog;
    }
    const dialog = skillDetailsDialog, body = dialog.querySelector("[data-skill-detail-body]");
    dialog.querySelector("h2").textContent = entry.title;
    const overview = document.createElement("p"); overview.className = "skill-document-text"; overview.textContent = entry.description || "";
    body.replaceChildren(overview);
    const available = Boolean(entry.skillFile && typeof window.__AIYOUCODEX_SKILLS_REQUEST__ === "function");
    dialog.querySelector("[data-skill-detail-reveal]").disabled = !available;
    const status = dialog.querySelector("[data-skill-detail-status]");
    status.textContent = available ? "正在读取此 Skill 的说明…" : "尚无准确的本地文件来源，请刷新目录后重试。";
    dialog.showModal(); dialog.querySelector("[data-skill-detail-close]").focus();
    if (!available) return;
    const requestId = `skill-details-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => resolveSkillDetailsRequest({ requestId, ok: false, error: "读取超时，请重新读取。" }), 20_000);
    skillDetailsRequests.set(requestId, { generation, skillId: entry.id, timer });
    try {
      Promise.resolve(window.__AIYOUCODEX_SKILLS_REQUEST__(JSON.stringify({ requestId, action: "describeSkill", skillId: entry.id })))
        .catch(() => resolveSkillDetailsRequest({ requestId, ok: false, error: "说明服务暂未连接，请重新读取。" }));
    } catch { resolveSkillDetailsRequest({ requestId, ok: false, error: "说明请求未发送成功，请重试。" }); }
  }

  function resolveSkillDetailsRequest(response) {
    const pending = skillDetailsRequests.get(response?.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer); skillDetailsRequests.delete(response.requestId);
    if (destroyed || !skillDetailsDialog?.open || pending.generation !== skillDetailsGeneration || pending.skillId !== skillDetailsEntry?.id) return false;
    const data = response.data?.skillDetails, dialog = skillDetailsDialog, status = dialog.querySelector("[data-skill-detail-status]");
    if (!response.ok || data?.skillId !== pending.skillId) { status.textContent = response.error || "说明来源不匹配，请刷新目录后重试。"; return true; }
    const body = dialog.querySelector("[data-skill-detail-body]"); body.replaceChildren();
    const text = (value, parent) => { const node = document.createElement("p"); node.className = "skill-document-text"; node.textContent = value; parent.appendChild(node); };
    const section = (title, excerpts, fallback = "") => {
      if (!excerpts?.length && !fallback) return;
      const node = document.createElement("section"), heading = document.createElement("h3"); heading.textContent = title; node.appendChild(heading);
      if (excerpts?.length) for (const excerpt of excerpts) {
        if (excerpt.heading && excerpt.heading !== title) { const label = document.createElement("strong"); label.textContent = excerpt.heading; node.appendChild(label); }
        text(excerpt.text + (excerpt.truncated ? "\n（内容较长，仅展示节选）" : ""), node);
      } else text(fallback, node);
      body.appendChild(node);
    };
    section("功能介绍", null, data.overview || "原文件未提供功能简介。");
    section("适用场景", data.scenarios, "原文件未单列适用场景，可参考功能介绍及下方原始说明。");
    section("使用方法", data.usage, "通用调用方式：点击下方‘添加到对话’，再说明目标、提供相关材料和期望的输出。原文件未单列使用步骤，请结合原始说明使用。");
    section("需要准备", data.inputs); section("预期产出", data.outputs);
    const original = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "查看原始 Skill 说明";
    original.appendChild(summary); text(data.document || "原文件没有正文。", original); body.appendChild(original);
    text(`来源：${data.skillFile}`, body);
    status.textContent = data.truncated ? "说明较长，当前展示节选；完整内容可通过‘打开所在文件’查看。" : "内容来自本地 SKILL.md。查看不会执行 Skill，也不会自动发送消息。";
    return true;
  }

  function showSkillContextMenu(entry, x, y) {
    closeSkillContextMenu();
    const menu = document.createElement("div");
    menu.className = "codex-skill-context-menu";
    menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", `Skill 操作：${entry.title}`);
    const actionable = Boolean(entry.skillFile && typeof window.__AIYOUCODEX_SKILLS_REQUEST__ === "function");
    const button = (label, action, disabled = false) => {
      const node = document.createElement("button"); node.type = "button"; node.textContent = label;
      node.setAttribute("role", "menuitem"); node.disabled = disabled; node.onclick = action; menu.appendChild(node); return node;
    };
    const position = () => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    };
    button("添加到对话", () => void addSkillToConversation(entry));
    const move = button("移动分类 ›", () => {
      menu.replaceChildren();
      button("← 返回", () => showSkillContextMenu(entry, x, y));
      for (const group of skillOrganization.groups.filter((group) => !["all", "common"].includes(group.id))) {
        const option = button(`${entry.categoryId === group.id ? "✓ " : ""}${group.label}`, async () => {
          closeSkillContextMenu();
          await requestSkillOrganization("moveSkill", { skillId: entry.id, groupId: group.id });
        });
        option.dataset.skillMoveGroup = group.id;
      }
      button("恢复自动分类", async () => { closeSkillContextMenu(); await requestSkillOrganization("moveSkill", { skillId: entry.id, groupId: null }); });
      button("＋ 新建 / 管理分类", openSkillGroupManager);
      position(); menu.querySelector("button")?.focus();
    }, !actionable || skillOrganizationRequests.size > 0);
    move.dataset.skillMenuMove = "true";
    const reveal = button("打开所在文件", async () => {
      closeSkillContextMenu(); await requestSkillOrganization("revealSkill", { skillId: entry.id });
    }, !actionable || skillOrganizationRequests.size > 0);
    reveal.title = "在所在文件夹中选中 SKILL.md"; reveal.dataset.skillMenuReveal = "true";
    const trace = button("追溯 skills", () => { closeSkillContextMenu(); void traceSkillConversation(entry); }, !actionable || skillOrganizationRequests.size > 0);
    trace.dataset.skillMenuTrace = "true"; trace.title = "打开最近可验证的优化对话；没有优化记录时打开创建对话";
    if (!actionable) move.title = reveal.title = "目录尚未提供准确 Skill 文件，请刷新目录后重试。";
    document.body.appendChild(menu);
    if (typeof menu.showPopover === "function") { menu.setAttribute("popover", "manual"); menu.showPopover(); }
    skillContextMenu = menu;
    position();
    const outside = (event) => { if (!menu.contains(event.target)) closeSkillContextMenu(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", position);
    skillContextCleanup = () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", position); };
    menu.onkeydown = (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    };
    menu.querySelector("button")?.focus();
  }

  async function traceSkillConversation(entry) {
    const generation = ++skillTraceGeneration, start = Date.now();
    while (!destroyed && generation === skillTraceGeneration) {
      const result = (await requestSkillOrganization("traceSkill", { skillId: entry.id }))?.traceResult;
      if (destroyed || generation !== skillTraceGeneration || !result) return;
      if (result.status === "found") {
        if (conversationRoute(result.threadId)) openAllProject({ threadId: result.threadId });
        else { skillOrganizationMessage = "关联对话标识无效，未跳转。"; renderSkillOrganizationStatus(); }
        return;
      }
      if (result.status !== "indexing") return;
      if (Date.now() - start > 180_000) {
        skillOrganizationMessage += " 历史较多，已保存进度，可稍后再次追溯。"; renderSkillOrganizationStatus(); return;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  function createHostSkillOrganizer() {
    const shell = document.createElement("section");
    shell.id = SKILL_ORGANIZER_ID;
    shell.hidden = true;
    shell.innerHTML = `
      <div class="codex-skill-organizer-head"><div><h2>Skills 分组</h2><p>本地自动分类 · 0 Token；右键分类、定位或添加到对话。</p></div><div class="codex-skill-head-actions"><button type="button" class="codex-skill-native-toggle" data-skill-manage>分类管理</button><button type="button" class="codex-skill-close" aria-label="关闭 Skills 分组">×</button></div></div>
      <label class="codex-skill-search"><input type="search" placeholder="搜索名称或用途" aria-label="搜索已安装 Skill"></label>
      <div class="codex-skill-filter-list" role="group" aria-label="Skills 分组"></div>
      <div class="codex-skill-result-head"><div><strong>已安装 Skills</strong><span class="codex-skill-status" role="status" data-skill-organization-status></span></div><span class="codex-skill-result-count"></span><button type="button" class="codex-skill-native-toggle" data-skill-refresh>刷新目录</button></div>
      <div class="codex-skill-grid"></div>`;
    shell.querySelector("input").oninput = (event) => { skillOrganizerQuery = event.target.value.trim(); renderSkillOrganizer(); };
    shell.querySelector(".codex-skill-close").onclick = () => closeSkillsGrouping();
    shell.querySelector("[data-skill-manage]").onclick = openSkillGroupManager;
    shell.querySelector("[data-skill-refresh]").onclick = () => void requestSkillOrganization("refresh");
    return initializeWorkspacePanel(shell, "skills");
  }

  function closeSkillsGrouping(restoreFocus = true) {
    skillTraceGeneration += 1;
    closeSkillDetails(false);
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (shell) shell.hidden = true;
    closeSkillContextMenu();
    const manager = shell?.querySelector(".codex-skill-group-manager"); if (manager) manager.hidden = true;
    skillOrganizerOpening = false;
    updateSkillsGroupingShortcutState();
    if (restoreFocus) currentComposer()?.focus();
  }

  function openSkillsGrouping(options = {}) {
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("skills");
    let shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell || !shell.querySelector("[data-skill-manage]")) {
      shell?.remove();
      shell = createHostSkillOrganizer();
    }
    if (shell.parentElement !== mount.surface) mount.surface.appendChild(shell);
    skillOrganizerCatalog = hostSkillCatalog.slice();
    skillOrganizerCatalogSignature = skillOrganizerCatalog.map((entry) => `${entry.name}\u0000${entry.description}`).join("\u0001");
    skillOrganizerQuery = typeof options?.query === "string" ? options.query.trim() : "";
    skillOrganizerFilter = "all";
    const input = shell.querySelector("input");
    input.value = skillOrganizerQuery;
    shell.hidden = false;
    skillOrganizerOpening = false;
    renderSkillOrganizer();
    updateSkillsGroupingShortcutState();
    if (skillOrganizerQuery) requestAnimationFrame(() => input.focus());
    return true;
  }

  function setSkillCatalog(value) {
    hostSkillCatalog = (Array.isArray(value) ? value : []).flatMap((entry) => {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      const title = typeof entry?.title === "string" ? entry.title.trim() : name;
      if (!name || !title) return [];
      return [{ id: String(entry.id || name), name, title, description: String(entry.description || "打开查看 Skill 详情"), path: String(entry.path || ""), source: String(entry.source || ""),
        skillFile: String(entry.skillFile || ""), categoryId: String(entry.categoryId || ""), automaticCategoryId: String(entry.automaticCategoryId || ""), classificationSource: String(entry.classificationSource || "") }];
    });
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (shell && !shell.hidden) {
      skillOrganizerCatalog = hostSkillCatalog.slice();
      renderSkillOrganizer();
    }
    if (efficiencyPanel && !efficiencyPanel.hidden) renderEfficiencySkills();
  }

  function resumeSkillsGroupingOpenRequest() {
    if (hostSkillCatalog.length) return;
    if (skillOrganizerOpening || document.getElementById(SKILL_ORGANIZER_ID)) return;
    let requestedAt = 0;
    try { requestedAt = Number(localStorage.getItem(SKILL_OPEN_REQUEST_STORAGE_KEY)); } catch {}
    if (!Number.isFinite(requestedAt) || requestedAt <= 0) return;
    if (Date.now() - requestedAt > SKILL_OPEN_REQUEST_TTL_MS) {
      try { localStorage.removeItem(SKILL_OPEN_REQUEST_STORAGE_KEY); } catch {}
      return;
    }
    openSkillsGrouping();
  }

  function efficiencyTargetKey(value = efficiencySnapshot) {
    return String(value?.targetKey || "");
  }

  function efficiencyScopeAvailable(scope = efficiencyScope) {
    return scope === "global" || efficiencySnapshot?.scopeAvailable?.[scope] === true;
  }

  function efficiencySkillId(entry) {
    return String(entry?.id || entry?.name || "");
  }

  function efficiencyDraft(scope = efficiencyScope) {
    if (!efficiencyDrafts.has(scope)) {
      const source = efficiencySnapshot?.scopes?.[scope] || {};
      efficiencyDrafts.set(scope, {
        mode: Object.hasOwn(EFFICIENCY_MODES, source.mode) ? source.mode : scope === "global" ? "smart" : "inherit",
        defaultSkills: Array.isArray(source.defaultSkills) ? source.defaultSkills.map((entry) =>
          typeof entry === "string" ? entry : efficiencySkillId(entry)).filter(Boolean) : [],
        inheritSkills: scope !== "global" && !Array.isArray(source.defaultSkills),
        dirty: false, revision: 0, version: efficiencySnapshot?.version ?? 0,
      });
    }
    return efficiencyDrafts.get(scope);
  }

  function efficiencyContextDraft() {
    if (!efficiencyTaskDraft) {
      const context = efficiencySnapshot?.context || {};
      efficiencyTaskDraft = { goal: String(context.goal || ""), progress: String(context.progress || ""),
        nextStep: String(context.nextStep || ""),
        agreements: Array.isArray(context.agreements) ? context.agreements.join("\n") : String(context.agreements || ""),
        references: Array.isArray(context.references) ? context.references.slice() : [],
        dirty: false, revision: 0, version: context.version ?? 0,
        summary: null, summaryAttempted: false, summarySourceRevision: null };
    }
    return efficiencyTaskDraft;
  }

  function setEfficiencyText(selector, value) {
    const node = efficiencyPanel?.querySelector(selector);
    const text = String(value || "");
    if (node && node.textContent !== text) node.textContent = text;
  }

  function updateEfficiencyUsage() {
    // Usage belongs to the exact active conversation, independent of preference scope or task-card drafts.
    const actual = efficiencySnapshot?.scopeAvailable?.thread === true ? efficiencySnapshot?.usage : null;
    const available = actual?.available === true;
    const format = (value) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("zh-CN") : "--";
    setEfficiencyText("[data-efficiency-usage-target]", efficiencySnapshot?.targetLabel || "未选择可验证的本地任务");
    for (const scope of ["cumulative", "lastRequest"]) {
      const counters = available ? actual[scope] : null;
      setEfficiencyText(`[data-efficiency-usage-total="${scope}"]`, format(counters?.totalTokens));
      for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
        setEfficiencyText(`[data-efficiency-usage-scope="${scope}"][data-efficiency-usage-field="${field}"]`, format(counters?.[field]));
      }
    }
    const timestamp = available && typeof actual.timestamp === "string" ? new Date(actual.timestamp) : null;
    setEfficiencyText("[data-efficiency-usage]", !available ? "真实用量暂不可用；尚未读取到当前对话的 Token 记录。"
      : timestamp && Number.isFinite(timestamp.getTime())
        ? `最近记录：${timestamp.toLocaleString("zh-CN", { hour12: false })}（本机时间）`
        : "最近记录时间未知；仅展示已记录的 Token。");
  }

  function updateEfficiencyStatus() {
    if (!efficiencyPanel) return;
    const connected = typeof window[EFFICIENCY_BINDING] === "function" && Boolean(efficiencySnapshot);
    const pending = efficiencyRequests.size > 0;
    const source = efficiencySnapshot?.effective || {};
    const mode = EFFICIENCY_MODES[source.mode] || "未知";
    const inheritedSource = ["thread", "project", "global"].find((scope) =>
      efficiencyScopeAvailable(scope) && Object.hasOwn(EFFICIENCY_MODES, efficiencySnapshot?.scopes?.[scope]?.mode));
    const sourceLabel = EFFICIENCY_SCOPES[source.source || source.modeSource || inheritedSource] || "默认规则";
    setEfficiencyText("[data-efficiency-effective]", connected
      ? `配置解析结果：${source.enabled === false ? "策略已停用" : mode} · 来源：${sourceLabel}` : "配置连接不可用；未修改当前对话。");
    const hook = efficiencySnapshot?.hookStatus || {};
    // A saved configuration is never evidence that the current conversation loaded it.
    const loaded = hook.loaded === true && Number.isFinite(Date.parse(String(hook.loadedAt || "")));
    setEfficiencyText("[data-efficiency-hook]", loaded
      ? `当前会话已加载 · ${String(hook.loadedAt)}`
      : hook.trusted === false ? "已保存的规则需先在 Codex 中审阅并信任；当前会话尚未确认加载。"
        : "配置保存不等于会话加载；等待真实加载回执。本轮明确要求优先。");
    updateEfficiencyUsage();
    setEfficiencyText("[data-efficiency-message]", efficiencyMessage);
    setEfficiencyText("[data-efficiency-error]", efficiencyError);
    setEfficiencyText("[data-efficiency-target]", efficiencySnapshot?.targetLabel || "当前选中的 Codex 任务");
    const contextDraft = efficiencyContextDraft();
    setEfficiencyText("[data-efficiency-dirty]", (efficiencyView === "context" ? contextDraft.dirty : efficiencyDraft().dirty) ? "有未保存修改" : "");
    const summary = contextDraft.summary;
    const sourceChanged = contextDraft.summaryAttempted && efficiencySnapshot?.contextSourceRevision != null
      && contextDraft.summarySourceRevision !== efficiencySnapshot.contextSourceRevision;
    setEfficiencyText("[data-efficiency-summary-status]", summary
      ? `${summary.hasContent === false ? "历史中未提取到可用任务信息，已保留原内容。" : contextDraft.dirty ? "已按本地历史提取待确认草稿；尚未保存。" : "任务卡已保存；可按最新历史更新摘要。"}${sourceChanged ? " 对话有新内容，可手动更新摘要。" : ""}`
      : sourceChanged ? "对话有新内容，可手动更新摘要。" : "打开时自动从当前对话历史整理；请核对后保存。未知信息留空。");
    setEfficiencyText("[data-efficiency-summary-sources]", summary
      ? [summary.method ? `整理方式：${String(summary.method)}` : "", ...(Array.isArray(summary.sources) ? summary.sources.map((entry) =>
        typeof entry === "string" ? entry : [({ goal: "目标", progress: "进度 / 阶段", nextStep: "下一步", agreements: "关键约定" })[entry?.field] || "",
          entry?.label || entry?.title || ({ user: "用户消息", assistant: "助手消息" })[entry?.role] || "历史记录",
          entry?.timestamp || "", entry?.excerpt ? `原句：${String(entry.excerpt).slice(0, 700)}` : ""].filter(Boolean).join(" · ")) : []),
        ...(Array.isArray(summary.warnings) ? summary.warnings.map(String) : [])].filter(Boolean).join("\n").slice(0, 5000) : "");
    efficiencyPanel.querySelector("[data-efficiency-summary-replace]").hidden = !efficiencySummaryReplaceRequested;
    const execution = efficiencyPanel.querySelector("[data-efficiency-execution-preview]");
    execution.hidden = efficiencyView !== "context" || !efficiencyExecutionPreview;
    setEfficiencyText("[data-efficiency-execution-prompt]", efficiencyExecutionPreview?.prompt || "");
    efficiencyPanel.querySelector("[data-efficiency-confirm-execution]").disabled = !connected || pending || !efficiencyExecutionPreview;
    efficiencyPanel.querySelector("[data-efficiency-stale]").hidden = !efficiencyTargetChanged;
    efficiencyPanel.querySelector("[data-efficiency-fields]").disabled = !connected || efficiencyTargetChanged || !efficiencyScopeAvailable();
    efficiencyPanel.querySelector("[data-efficiency-context-fields]").disabled = !connected || efficiencyTargetChanged
      || efficiencySnapshot?.scopeAvailable?.thread !== true;
    efficiencyPanel.querySelectorAll("[data-efficiency-request]").forEach((button) => {
      button.disabled = !connected || pending || efficiencyTargetChanged
        || (button.dataset.efficiencyRequest === "refresh" ? false
          : button.dataset.efficiencyRequest.includes("Context") ? efficiencySnapshot?.scopeAvailable?.thread !== true : !efficiencyScopeAvailable());
    });
    efficiencyPanel.querySelector("[data-efficiency-summarize]").disabled = !connected || pending || efficiencySnapshot?.scopeAvailable?.thread !== true;
    efficiencyPanel.querySelector("[data-efficiency-confirm-summary]").disabled = !connected || pending;
    const scope = efficiencyPanel.querySelector("[data-efficiency-scope]");
    scope.disabled = pending || efficiencyTargetChanged;
    efficiencyPanel.querySelectorAll("[data-efficiency-discard]").forEach((button) => { button.disabled = pending || efficiencyTargetChanged; });
    for (const option of scope.options) option.disabled = !efficiencyScopeAvailable(option.value);
  }

  function renderEfficiencySkills() {
    if (!efficiencyPanel) return;
    const draft = efficiencyDraft();
    const query = efficiencyPanel.querySelector("[data-efficiency-skill-query]").value.toLocaleLowerCase().trim();
    const signature = JSON.stringify([draft.defaultSkills, draft.inheritSkills, query, hostSkillCatalog]);
    if (signature === efficiencySkillsSignature) return;
    efficiencySkillsSignature = signature;
    const selected = efficiencyPanel.querySelector("[data-efficiency-selected-skills]");
    selected.replaceChildren(...draft.defaultSkills.map((id) => {
      const entry = hostSkillCatalog.find((candidate) => efficiencySkillId(candidate) === id);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${entry?.title || id} ×`;
      button.title = entry ? `${entry.name} · ${entry.source || "本地"}\n${entry.path || ""}` : "此技能当前不在目录中，已保留原配置";
      button.setAttribute("aria-label", `移除默认 Skill：${entry?.title || id}`);
      button.disabled = draft.inheritSkills;
      button.onclick = () => {
        draft.defaultSkills = draft.defaultSkills.filter((candidate) => candidate !== id);
        markEfficiencyDraftChanged(); renderEfficiencySkills();
      };
      return button;
    }));
    const matches = hostSkillCatalog.filter((entry) => !draft.defaultSkills.includes(efficiencySkillId(entry))
      && `${entry.title} ${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query));
    const results = efficiencyPanel.querySelector("[data-efficiency-skill-results]");
    results.replaceChildren(...matches.slice(0, 30).map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = draft.inheritSkills;
      button.textContent = `＋ ${entry.title}`;
      const identity = document.createElement("small");
      identity.textContent = `${entry.name} · ${entry.source || "本地"} · ${entry.id.slice(-8)}`;
      button.title = `${entry.description}\n${entry.path || ""}`;
      button.appendChild(identity);
      button.onclick = () => {
        const id = efficiencySkillId(entry);
        if (draft.defaultSkills.length >= 8) {
          efficiencyError = "每个范围最多选用 8 个默认 Skills，避免无条件加载过多上下文。";
          updateEfficiencyStatus(); return;
        }
        if (!draft.defaultSkills.includes(id)) draft.defaultSkills.push(id);
        markEfficiencyDraftChanged(); renderEfficiencySkills();
      };
      return button;
    }));
    if (!matches.length) results.textContent = hostSkillCatalog.length ? "没有其他匹配的 Skill" : "技能目录尚未提供，请稍后刷新。";
  }

  function markEfficiencyDraftChanged(context = false) {
    const draft = context ? efficiencyContextDraft() : efficiencyDraft();
    draft.dirty = true;
    draft.revision += 1;
    if (context) { efficiencyExecutionPreview = null; efficiencySummaryReplaceRequested = false; }
    efficiencyMessage = "";
    updateEfficiencyStatus();
  }

  function populateEfficiencyForm() {
    if (!efficiencyPanel) return;
    const isContext = efficiencyView === "context";
    efficiencyPanel.dataset.efficiencyView = efficiencyView;
    efficiencyPanel.setAttribute("aria-label", isContext ? "任务上下文" : "输出偏好");
    setEfficiencyText("[data-efficiency-title]", isContext ? "任务上下文" : "输出偏好");
    efficiencyPanel.querySelectorAll("[data-efficiency-settings-view]").forEach((node) => { node.hidden = isContext; });
    efficiencyPanel.querySelectorAll("[data-efficiency-context-view]").forEach((node) => { node.hidden = !isContext; });
    const draft = efficiencyDraft();
    const scope = efficiencyPanel.querySelector("[data-efficiency-scope]");
    scope.value = efficiencyScope;
    const mode = efficiencyPanel.querySelector('[data-efficiency-field="mode"]');
    mode.querySelector('[value="inherit"]').hidden = efficiencyScope === "global";
    efficiencyPanel.querySelector("[data-efficiency-skill-inherit-wrap]").hidden = efficiencyScope === "global";
    efficiencyPanel.querySelector("[data-efficiency-skill-inherit]").checked = draft.inheritSkills;
    for (const field of ["mode", "goal", "progress", "nextStep", "agreements"]) {
      const input = efficiencyPanel.querySelector(`[data-efficiency-field="${field}"]`);
      const fieldDraft = field === "mode" ? draft : efficiencyContextDraft();
      if (input.value !== fieldDraft[field]) input.value = fieldDraft[field];
    }
    renderEfficiencySkills();
    updateEfficiencyStatus();
  }

  function setEfficiencyData(value) {
    const next = value && typeof value === "object" ? value : null;
    const changedTarget = efficiencySnapshot && efficiencyTargetKey(next) !== efficiencyTargetKey();
    if (changedTarget) { closeWorkspaceFolderMenu(false); workspaceFolderMessage = ""; }
    if (changedTarget) {
      // The opaque key identifies a backend-validated conversation, never a title or folder.
      efficiencyTargetDrafts.set(efficiencyTargetKey(), { taskDraft: efficiencyTaskDraft,
        drafts: new Map(efficiencyDrafts), message: efficiencyMessage, error: efficiencyError });
      const parked = efficiencyTargetDrafts.get(efficiencyTargetKey(next));
      efficiencyDrafts.clear();
      for (const [scope, draft] of parked?.drafts || []) efficiencyDrafts.set(scope, draft);
      efficiencyTaskDraft = parked?.taskDraft || null;
      efficiencyMessage = parked?.message || ""; efficiencyError = parked?.error || "";
      efficiencyExecutionPreview = null; efficiencySummaryReplaceRequested = false; efficiencyTargetChanged = false;
    }
    efficiencySnapshot = next;
    // Polling updates status only while editing: preserve the actual focused input and its selection.
    for (const [scope, draft] of efficiencyDrafts) if (!draft.dirty) efficiencyDrafts.delete(scope);
    if (efficiencyTaskDraft && !efficiencyTaskDraft.dirty) {
      const context = next?.context || {};
      for (const field of ["goal", "progress", "nextStep"]) efficiencyTaskDraft[field] = String(context[field] || "");
      efficiencyTaskDraft.agreements = Array.isArray(context.agreements) ? context.agreements.join("\n") : String(context.agreements || "");
      efficiencyTaskDraft.references = Array.isArray(context.references) ? context.references.slice() : [];
      efficiencyTaskDraft.version = context.version ?? 0;
    }
    populateEfficiencyForm();
    ensureTaskContextButton();
    updateEfficiencyStatus();
    maybeSummarizeTaskContext();
  }

  function maybeSummarizeTaskContext() {
    if (efficiencyView !== "context" || !efficiencyPanel || efficiencyPanel.hidden
      || efficiencySnapshot?.scopeAvailable?.thread !== true || efficiencyRequests.size || efficiencyError) return;
    const draft = efficiencyContextDraft();
    const revision = efficiencySnapshot?.contextSourceRevision;
    if (!draft.dirty && (!draft.summaryAttempted || (revision != null && draft.summarySourceRevision !== revision))) {
      draft.summaryAttempted = true; draft.summarySourceRevision = revision ?? null;
      sendEfficiencyRequest("summarizeContext");
    }
  }

  function efficiencyContextPayload(draft) {
    return { goal: draft.goal, progress: draft.progress, nextStep: draft.nextStep,
      agreements: draft.agreements.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean), references: draft.references.slice() };
  }

  function sendEfficiencyRequest(action, options = {}) {
    if (destroyed || efficiencyRequests.size || efficiencyTargetChanged) return false;
    const binding = window[EFFICIENCY_BINDING];
    if (typeof binding !== "function" || !efficiencySnapshot) {
      efficiencyError = "本地配置连接不可用；没有向对话框插入或发送任何内容。";
      updateEfficiencyStatus(); return false;
    }
    const isContext = action.includes("Context");
    if (action !== "refresh" && (isContext ? efficiencySnapshot.scopeAvailable?.thread !== true : !efficiencyScopeAvailable())) return false;
    const draft = isContext ? efficiencyContextDraft() : efficiencyDraft();
    const payload = { requestId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, action, scope: isContext ? "thread" : efficiencyScope };
    payload.expectedTargetKey = efficiencyTargetKey();
    if (isContext) payload.expectedContextVersion = draft.version;
    else payload.expectedVersion = draft.version;
    if (action === "saveScope") {
      payload.mode = draft.mode === "inherit" ? null : draft.mode;
      payload.defaultSkills = draft.inheritSkills ? null : draft.defaultSkills.slice();
    }
    if (["saveContext", "previewContextExecution", "prepareContextExecution"].includes(action)) payload.context = efficiencyContextPayload(draft);
    if (action === "prepareContextExecution") {
      if (!efficiencyExecutionPreview || efficiencyExecutionPreview.targetKey !== efficiencyTargetKey()
        || efficiencyExecutionPreview.revision !== draft.revision || efficiencyView !== "context" || efficiencyPanel?.hidden) return false;
      payload.expectedPrompt = efficiencyExecutionPreview.prompt;
    }
    if (action === "executeContext") {
      if (!options.token) return false;
      payload.token = options.token;
    }
    if (payload.context && (payload.context.agreements.length > 12 || payload.context.agreements.some((line) => line.length > 300))) {
      efficiencyError = "关键约定最多 12 条，每条不超过 300 个字符；草稿已保留。";
      updateEfficiencyStatus(); return false;
    }
    const executionRequest = action === "prepareContextExecution" || action === "executeContext";
    const uncertainExecution = "保存 / 发送结果未确认；请先核对当前对话和输入框，不要重复发送。";
    const timer = setTimeout(() => resolveEfficiencyRequest({ requestId: payload.requestId, ok: false,
      error: executionRequest ? uncertainExecution : "请求超时，尚未确认保存；保留了草稿，请刷新核对后重试。" }), 15_000);
    efficiencyRequests.set(payload.requestId, { scope: efficiencyScope, revision: draft.revision, action, timer,
      targetKey: efficiencyTargetKey(), sourceRevision: efficiencySnapshot.contextSourceRevision ?? null });
    efficiencyMessage = action === "refresh" ? "正在读取…" : action === "summarizeContext" ? "正在整理当前对话历史…"
      : action === "previewContextExecution" ? "正在生成待确认的完整发送内容…"
        : action === "executeContext" ? "已确认，正在验证当前对话并执行一次发送…" : "正在保存…";
    efficiencyError = ""; updateEfficiencyStatus();
    try { Promise.resolve(binding(JSON.stringify(payload))).catch(() => resolveEfficiencyRequest({ requestId: payload.requestId, ok: false, error: executionRequest ? uncertainExecution : "配置请求失败，草稿已保留。" })); }
    catch { resolveEfficiencyRequest({ requestId: payload.requestId, ok: false, error: executionRequest ? uncertainExecution : "配置请求未发送成功，草稿已保留。" }); }
    return true;
  }

  function resolveEfficiencyRequest(response) {
    if (response?.requestId === workspaceFolderPending?.requestId) return resolveWorkspaceFolderRequest(response);
    const pending = efficiencyRequests.get(String(response?.requestId || ""));
    if (destroyed || !pending) return false;
    clearTimeout(pending.timer); efficiencyRequests.delete(String(response.requestId));
    if (pending.targetKey !== efficiencyTargetKey()) {
      const parked = efficiencyTargetDrafts.get(pending.targetKey);
      if (parked) {
        parked.message = response.ok === true ? "原任务请求已完成，重新打开后请核对保存状态。" : "";
        parked.error = response.ok === true ? "" : String(response.error?.message || response.error || "原任务请求失败，草稿已保留。").slice(0, 800);
      }
      updateEfficiencyStatus(); return true;
    }
    if (response.ok !== true) {
      if (["prepareContextExecution", "executeContext"].includes(pending.action)) efficiencyExecutionPreview = null;
      efficiencyMessage = "";
      efficiencyError = String(response.error?.message || response.error || "保存失败，草稿已保留。").slice(0, 800);
      updateEfficiencyStatus(); return true;
    }
    const isContext = pending.action.includes("Context");
    const draft = isContext ? efficiencyTaskDraft : efficiencyDrafts.get(pending.scope);
    const received = response.data?.snapshot || response.data?.efficiency || response.data;
    if (efficiencyTargetKey(received) !== pending.targetKey) {
      efficiencyExecutionPreview = null;
      efficiencyError = "返回内容不属于当前对话，已拒绝应用；草稿保留，请刷新后核对。";
      efficiencyMessage = ""; updateEfficiencyStatus(); return true;
    }
    const writes = ["saveScope", "resetScope", "saveContext", "resetContext", "prepareContextExecution"].includes(pending.action);
    if (writes && draft && !efficiencyTargetChanged) {
      const version = isContext ? received?.context?.version : received?.version;
      if (Number.isSafeInteger(version)) draft.version = version;
    }
    // A late response must not discard edits entered while the request was in flight.
    if (writes && draft && draft.revision === pending.revision && !efficiencyTargetChanged) {
      draft.dirty = false;
      if (isContext) { draft.summaryAttempted = true; draft.summarySourceRevision = received?.contextSourceRevision ?? null; }
      if (!isContext) efficiencyDrafts.delete(pending.scope);
      else if (pending.action === "resetContext") efficiencyTaskDraft = null;
    }
    // Assign before rendering so snapshot refresh cannot trigger a second summary request.
    if (received && typeof received === "object") efficiencySnapshot = received;
    if (pending.action === "summarizeContext") {
      const summary = response.data?.contextDraft;
      if (draft && draft.revision === pending.revision && summary && typeof summary === "object") {
        draft.summary = summary; draft.summaryAttempted = true;
        draft.summarySourceRevision = summary.sourceRevision ?? pending.sourceRevision;
        if (summary.hasContent !== false && summary.context && typeof summary.context === "object") {
          for (const key of ["goal", "progress", "nextStep"]) draft[key] = String(summary.context[key] || "");
          draft.agreements = Array.isArray(summary.context.agreements) ? summary.context.agreements.map(String).join("\n") : "";
          if (Array.isArray(summary.context.references)) draft.references = summary.context.references.slice();
          draft.dirty = true; draft.revision += 1;
        }
        efficiencyMessage = "摘要已整理，请核对。尚未保存，也没有发送消息。";
      } else efficiencyMessage = "整理期间草稿已变更；未覆盖你的修改。可再次手动更新摘要。";
    } else if (pending.action === "previewContextExecution") {
      const preview = response.data?.executionPreview;
      if (draft?.revision === pending.revision && preview?.targetKey === efficiencyTargetKey()
        && typeof preview.prompt === "string" && preview.prompt.trim() && efficiencyView === "context" && !efficiencyPanel?.hidden) {
        efficiencyExecutionPreview = { prompt: preview.prompt, targetKey: preview.targetKey, revision: draft.revision };
        efficiencyMessage = "请核对下方完整内容，再点击“确认保存并发送”。此时尚未保存或发送。";
      } else efficiencyMessage = "草稿或面板已改变，预览已失效。请重新预览后确认。";
    } else if (pending.action === "prepareContextExecution") {
      const execution = response.data?.execution;
      const authorized = efficiencyExecutionPreview && draft?.revision === pending.revision
        && efficiencyExecutionPreview.revision === pending.revision && execution?.targetKey === efficiencyTargetKey()
        && execution.prompt === efficiencyExecutionPreview.prompt && typeof execution.token === "string"
        && efficiencyView === "context" && !efficiencyPanel?.hidden;
      efficiencyExecutionPreview = null;
      efficiencyMessage = authorized ? "任务卡已保存，正在执行已确认的操作。" : "任务卡已保存，但目标、草稿或完整文本发生变化；未发送，请重新确认。";
      populateEfficiencyForm();
      if (authorized) return sendEfficiencyRequest("executeContext", { token: execution.token });
    } else if (pending.action === "executeContext") {
      efficiencyExecutionPreview = null;
      const result = response.data?.executionResult;
      const labels = { sent: "任务卡已保存；已读回本次发送的消息。", unknown: "发送结果未确认；不会自动重试，请检查当前对话。",
        "prepared-not-sent": result?.prepared === true ? "任务卡已保存；消息已预填，请检查后手动发送。"
          : "任务卡已保存；未发送，输入框可能只填入了部分内容，请先检查。", blocked: "任务卡已保存；发送被安全检查阻止，未自动重试。" };
      efficiencyMessage = `${labels[result?.status] || labels.unknown}${result?.message ? ` ${String(result.message)}` : ""}`;
    } else efficiencyMessage = pending.action === "refresh" ? "状态已刷新，未保存草稿保持不变。"
      : isContext ? "任务卡已保存；没有发送消息。" : "已保存；会话是否加载以真实回执为准。";
    efficiencyError = "";
    populateEfficiencyForm();
    updateEfficiencyStatus(); return true;
  }

  function createEfficiencyPanel() {
    const page = document.createElement("section");
    page.id = EFFICIENCY_PANEL_ID;
    page.hidden = true;
    page.setAttribute("aria-label", "输出偏好");
    page.innerHTML = `<header><h2 data-efficiency-title>输出偏好</h2><button type="button" data-efficiency-close aria-label="关闭面板">×</button></header>
      <div class="aiyou-efficiency-body">
        <section data-efficiency-usage-section aria-label="当前任务用量">
          <div class="aiyou-usage-heading"><h3>当前任务用量</h3><button type="button" data-efficiency-request="refresh">刷新状态</button></div>
          <p data-efficiency-usage-target></p>
          <div class="aiyou-usage-totals">
            <div>本对话累计<strong data-efficiency-usage-total="cumulative">--</strong><small>Token</small></div>
            <div>最近一次请求<strong data-efficiency-usage-total="lastRequest">--</strong><small>Token</small></div>
          </div>
          <p class="aiyou-efficiency-note">仅当前对话，不含同一文件夹其他任务；不是账号总量，也不代表当前上下文占用。</p>
          <details><summary>输入、输出与缓存明细</summary>
            <table aria-label="当前对话 Token 用量明细"><thead><tr><th scope="col">Token 类型</th><th scope="col">本对话累计</th><th scope="col">最近一次请求</th></tr></thead><tbody>
              ${[["inputTokens", "输入"], ["cachedInputTokens", "缓存输入（已计入输入）"], ["outputTokens", "输出"], ["reasoningOutputTokens", "推理输出（已计入输出）"], ["totalTokens", "总计"]].map(([field, label]) =>
                `<tr><th scope="row">${label}</th><td data-efficiency-usage-scope="cumulative" data-efficiency-usage-field="${field}">--</td><td data-efficiency-usage-scope="lastRequest" data-efficiency-usage-field="${field}">--</td></tr>`).join("")}
            </tbody></table>
            <p class="aiyou-efficiency-note">累计包含多次模型请求的重复上下文；最近一次请求不等于完整一轮对话。缓存与推理是子项，不重复相加；缺失字段显示 --，不估算费用或节省比例。</p>
          </details>
          <p data-efficiency-usage class="aiyou-efficiency-note"></p>
        </section>
        <section data-efficiency-settings-view aria-label="配置与加载状态"><strong data-efficiency-effective></strong><p data-efficiency-hook></p>
          <p class="aiyou-efficiency-note">精简的是重复说明，不压缩交付物、风险、失败或验证信息。不自动发送消息。</p></section>
        <p data-efficiency-stale hidden>当前任务已切换，旧草稿已保留且暂停保存。<button type="button" data-efficiency-load-current>放弃旧草稿，载入当前任务</button></p>
        <label data-efficiency-settings-view>设置范围<select data-efficiency-scope><option value="global">全局默认</option><option value="project">当前项目</option><option value="thread">当前对话</option></select></label>
        <fieldset data-efficiency-fields data-efficiency-settings-view><h3>输出模式与默认 Skills</h3>
          <label>输出模式<select data-efficiency-field="mode"><option value="inherit">继承上级</option><option value="smart">智能 · 按任务需要展开</option><option value="concise">精简 · 结果优先</option><option value="detailed">详细 · 完整解释</option></select></label>
          <p class="aiyou-efficiency-note">对话覆盖项目，项目覆盖全局；本轮明确要求优先。默认 Skills 与收藏独立，按需加载，不代表已执行。</p>
          <label data-efficiency-skill-inherit-wrap><input type="checkbox" data-efficiency-skill-inherit>继承上级默认 Skills</label>
          <label>选择默认 Skills<input type="search" data-efficiency-skill-query placeholder="搜索已安装技能"></label>
          <div data-efficiency-selected-skills></div><div data-efficiency-skill-results></div>
          <div class="aiyou-efficiency-actions"><button type="button" data-efficiency-request="saveScope" data-efficiency-save>保存此范围设置</button><button type="button" data-efficiency-request="resetScope">重置已保存设置</button><button type="button" data-efficiency-discard="scope">放弃此范围草稿</button></div>
        </fieldset>
        <fieldset data-efficiency-context-fields data-efficiency-context-view hidden><h3>当前对话任务卡</h3>
          <p data-efficiency-target></p><p class="aiyou-efficiency-note">按当前对话独立保存，不属于全局设置；不会替代完整历史。</p>
          <p data-efficiency-summary-status role="status"></p><details><summary>查看摘要依据与提醒</summary><p data-efficiency-summary-sources class="aiyou-efficiency-note"></p></details>
          <button type="button" data-efficiency-summarize>更新历史摘要</button>
          <div data-efficiency-summary-replace hidden><p>更新会替换当前未保存的任务卡草稿。确定继续？</p><button type="button" data-efficiency-confirm-summary>替换草稿并更新</button><button type="button" data-efficiency-cancel-summary>保留草稿</button></div>
          <label>目标<textarea data-efficiency-field="goal" maxlength="600"></textarea></label>
          <label>进度 / 阶段<textarea data-efficiency-field="progress" maxlength="1200"></textarea></label>
          <label>下一步<textarea data-efficiency-field="nextStep" maxlength="600"></textarea></label>
          <label>关键约定 · 每行一条<textarea data-efficiency-field="agreements" maxlength="2400"></textarea></label>
          <div class="aiyou-efficiency-actions"><button type="button" data-efficiency-request="previewContextExecution" data-efficiency-save>确认保存并执行</button><button type="button" data-efficiency-request="saveContext">仅保存任务卡</button><button type="button" data-efficiency-request="resetContext">清空已保存任务卡</button><button type="button" data-efficiency-discard="context">放弃任务卡草稿</button></div>
        </fieldset>
        <section data-efficiency-execution-preview data-efficiency-context-view hidden aria-label="执行前完整内容确认">
          <h3>确认将发送到当前对话的完整内容</h3><p class="aiyou-efficiency-note">点击下面确认后，先保存任务卡，再执行一次发送；已有输入、任务忙碌或切换对话时会阻止发送。</p>
          <pre data-efficiency-execution-prompt tabindex="0"></pre>
          <div class="aiyou-efficiency-actions"><button type="button" data-efficiency-confirm-execution data-efficiency-save>确认保存并发送</button><button type="button" data-efficiency-cancel-execution>取消，继续编辑</button></div>
        </section>
        <p data-efficiency-dirty class="aiyou-efficiency-note"></p><p data-efficiency-message role="status"></p><p data-efficiency-error role="alert"></p>
      </div>`;
    page.querySelector("[data-efficiency-close]").onclick = () => closeEfficiencyPanel();
    page.querySelector("[data-efficiency-scope]").onchange = (event) => {
      efficiencyScope = event.target.value; populateEfficiencyForm();
    };
    page.querySelectorAll("[data-efficiency-field]").forEach((input) => {
      input.oninput = () => {
        const context = input.dataset.efficiencyField !== "mode";
        (context ? efficiencyContextDraft() : efficiencyDraft())[input.dataset.efficiencyField] = input.value;
        markEfficiencyDraftChanged(context);
      };
    });
    page.querySelector("[data-efficiency-skill-query]").oninput = renderEfficiencySkills;
    page.querySelector("[data-efficiency-skill-inherit]").onchange = (event) => {
      efficiencyDraft().inheritSkills = event.target.checked; markEfficiencyDraftChanged(); renderEfficiencySkills();
    };
    page.querySelectorAll("[data-efficiency-request]").forEach((button) => {
      button.onclick = () => sendEfficiencyRequest(button.dataset.efficiencyRequest);
    });
    page.querySelector("[data-efficiency-summarize]").onclick = () => {
      if (efficiencyContextDraft().dirty) { efficiencySummaryReplaceRequested = true; updateEfficiencyStatus(); }
      else sendEfficiencyRequest("summarizeContext");
    };
    page.querySelector("[data-efficiency-confirm-summary]").onclick = () => {
      efficiencySummaryReplaceRequested = false; efficiencyExecutionPreview = null; sendEfficiencyRequest("summarizeContext");
    };
    page.querySelector("[data-efficiency-cancel-summary]").onclick = () => { efficiencySummaryReplaceRequested = false; updateEfficiencyStatus(); };
    page.querySelector("[data-efficiency-confirm-execution]").onclick = () => sendEfficiencyRequest("prepareContextExecution");
    page.querySelector("[data-efficiency-cancel-execution]").onclick = () => { efficiencyExecutionPreview = null; updateEfficiencyStatus(); };
    page.querySelectorAll("[data-efficiency-discard]").forEach((button) => {
      button.onclick = () => {
        if (efficiencyRequests.size || efficiencyTargetChanged) return;
        if (button.dataset.efficiencyDiscard === "context") { efficiencyTaskDraft = null; efficiencyExecutionPreview = null; }
        else efficiencyDrafts.delete(efficiencyScope);
        efficiencyMessage = "已放弃本地草稿，未修改已保存内容。"; efficiencyError = "";
        populateEfficiencyForm();
      };
    });
    page.querySelector("[data-efficiency-load-current]").onclick = () => {
      efficiencyDrafts.clear(); efficiencyTaskDraft = null; efficiencyTargetChanged = false; efficiencyError = ""; efficiencyMessage = "";
      if (!efficiencyScopeAvailable()) efficiencyScope = "global";
      populateEfficiencyForm();
    };
    return initializeWorkspacePanel(page, "efficiency");
  }

  function scheduleEfficiencyPanelLayout() {
    if (destroyed || !efficiencyPanel || efficiencyPanel.hidden || efficiencyLayoutFrame !== null) return;
    efficiencyLayoutFrame = requestAnimationFrame(() => {
      efficiencyLayoutFrame = null;
      constrainEfficiencyPanelToViewport();
    });
  }

  function constrainEfficiencyPanelToViewport() {
    if (!efficiencyPanel || efficiencyPanel.hidden || !efficiencyPanel.isConnected) return;
    if (!efficiencyMountSurface?.isConnected) {
      efficiencyMountSurface = findEfficiencyPanelMount()?.surface || null;
      watchEfficiencyPanelLayout();
    }
    const host = efficiencyMountSurface;
    if (!host) return;
    const viewport = window.visualViewport;
    const view = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth),
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) };
    const hostRect = host.getBoundingClientRect();
    const visible = { left: Math.max(view.left, hostRect.left), top: Math.max(view.top, hostRect.top),
      right: Math.min(view.right, hostRect.right), bottom: Math.min(view.bottom, hostRect.bottom) };
    // Nested native clips/transforms can differ from the nominal main content
    // width. Use only their visible intersection; never rewrite native flex items.
    for (let ancestor = host.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const rect = ancestor.getBoundingClientRect();
      const style = getComputedStyle(ancestor);
      if (style.display === "contents") continue;
      if (/(hidden|clip|auto|scroll)/u.test(style.overflowX)) {
        visible.left = Math.max(visible.left, rect.left); visible.right = Math.min(visible.right, rect.right);
      }
      if (/(hidden|clip|auto|scroll)/u.test(style.overflowY)) {
        visible.top = Math.max(visible.top, rect.top); visible.bottom = Math.min(visible.bottom, rect.bottom);
      }
    }
    if (visible.right - visible.left < 120) { visible.left = view.left; visible.right = view.right; }
    if (visible.bottom - visible.top < 64) { visible.top = view.top; visible.bottom = view.bottom; }
    const rect = efficiencyPanel.getBoundingClientRect();
    const needsOverlay = host === document.body || efficiencyPanel.dataset.efficiencyViewportOverlay === "true"
      || rect.width < Math.min(320, visible.right - visible.left)
      || rect.right > visible.right + .5 || rect.left < visible.left - .5
      || rect.top < visible.top - .5 || rect.bottom > visible.bottom + .5;
    if (!needsOverlay) return;
    const desired = Number.parseFloat(efficiencyPanel.style.getPropertyValue("--codex-workspace-panel-width")) || 560;
    const width = Math.max(1, Math.min(desired, 840, visible.right - visible.left));
    const properties = { left: visible.right - width, top: visible.top, width, height: visible.bottom - visible.top };
    for (const [key, value] of Object.entries(properties)) {
      const name = `--aiyou-efficiency-${key}`;
      const pixels = `${Math.round(value * 100) / 100}px`;
      if (efficiencyPanel.style.getPropertyValue(name) !== pixels) efficiencyPanel.style.setProperty(name, pixels);
    }
    // Only this new panel may use a viewport portal when a native min-width
    // would clip its close button. Other modules and conversation DOM stay intact.
    if (efficiencyPanel.parentElement !== document.body) {
      const focused = document.activeElement;
      const restoreFocus = focused && efficiencyPanel.contains(focused);
      const selection = restoreFocus && typeof focused.selectionStart === "number"
        ? [focused.selectionStart, focused.selectionEnd] : null;
      setWorkspacePanelHostLayer(efficiencyPanel, false);
      document.body.appendChild(efficiencyPanel);
      if (restoreFocus) {
        focused.focus?.({ preventScroll: true });
        if (selection) focused.setSelectionRange?.(...selection);
      }
    }
    if (efficiencyPanel.dataset.efficiencyViewportOverlay !== "true") efficiencyPanel.dataset.efficiencyViewportOverlay = "true";
  }

  function watchEfficiencyPanelLayout() {
    efficiencyResizeObserver?.disconnect();
    if (typeof ResizeObserver === "function") {
      efficiencyResizeObserver = new ResizeObserver(scheduleEfficiencyPanelLayout);
      for (let node = efficiencyMountSurface, depth = 0; node && node !== document.body && depth < 10; node = node.parentElement, depth += 1) {
        efficiencyResizeObserver.observe(node);
      }
      if (efficiencyPanel) efficiencyResizeObserver.observe(efficiencyPanel);
    }
  }

  function ensureTaskContextButton() {
    let button = document.getElementById(TASK_CONTEXT_BUTTON_ID);
    const available = efficiencySnapshot?.scopeAvailable?.thread === true && Boolean(efficiencyTargetKey());
    const surface = document.querySelector('[data-testid="app-shell-header-context-menu-surface"][aria-hidden="false"]')
      || document.querySelector('[data-testid="app-shell-header-context-menu-surface"]:not([aria-hidden="true"])');
    const obstacle = surface?.querySelector('[data-app-shell-header-obstacle="true"]');
    // Restrict mounting to the native conversation toolbar: never a message's Share button.
    if (!obstacle || !available) {
      if (button) button.hidden = true;
      if (workspaceFolderButton) workspaceFolderButton.hidden = true;
      closeWorkspaceFolderMenu(false);
      return;
    }
    if (!button) {
      button = document.createElement("button"); button.id = TASK_CONTEXT_BUTTON_ID; button.type = "button";
      button.textContent = "任务上下文"; button.title = "查看、整理和确认当前对话的任务上下文";
      button.setAttribute("aria-controls", EFFICIENCY_PANEL_ID);
      button.onclick = (event) => {
        event.stopPropagation();
        if (efficiencyView === "context" && efficiencyPanel && !efficiencyPanel.hidden) closeEfficiencyPanel();
        else openTaskContextPanel();
      };
    }
    if (button.parentElement !== obstacle) obstacle.prepend(button);
    button.hidden = false;
    button.disabled = typeof window[EFFICIENCY_BINDING] !== "function";
    button.setAttribute("aria-expanded", String(efficiencyView === "context" && Boolean(efficiencyPanel && !efficiencyPanel.hidden)));
    ensureWorkspaceFolderButton(obstacle, button);
  }

  function ensureWorkspaceFolderButton(obstacle, contextButton) {
    if (destroyed) return;
    if (!workspaceFolderButton) {
      workspaceFolderButton = document.createElement("button");
      workspaceFolderButton.id = WORKSPACE_FOLDER_BUTTON_ID;
      workspaceFolderButton.type = "button";
      workspaceFolderButton.textContent = "打开文件";
      workspaceFolderButton.title = "打开当前对话所在文件夹，或在上级目录中选中它";
      workspaceFolderButton.setAttribute("aria-haspopup", "menu");
      workspaceFolderButton.setAttribute("aria-controls", WORKSPACE_FOLDER_MENU_ID);
      workspaceFolderButton.onclick = (event) => {
        event.stopPropagation();
        if (workspaceFolderMenu && !workspaceFolderMenu.hidden) closeWorkspaceFolderMenu();
        else openWorkspaceFolderMenu();
      };
      workspaceFolderButton.onkeydown = (event) => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        openWorkspaceFolderMenu(event.key === "ArrowUp" ? -1 : 0);
      };
    }
    // React may clone/replace its toolbar: keep our real event-owning element.
    document.querySelectorAll(`#${WORKSPACE_FOLDER_BUTTON_ID}`).forEach((node) => {
      if (node !== workspaceFolderButton) node.remove();
    });
    if (workspaceFolderButton.parentElement !== obstacle || workspaceFolderButton.nextElementSibling !== contextButton) {
      obstacle.insertBefore(workspaceFolderButton, contextButton);
    }
    workspaceFolderButton.hidden = false;
    workspaceFolderButton.setAttribute("aria-expanded", String(Boolean(workspaceFolderMenu && !workspaceFolderMenu.hidden)));
    if (workspaceFolderMenu && !workspaceFolderMenu.hidden) { renderWorkspaceFolderMenu(); positionWorkspaceFolderMenu(); }
  }

  function renderWorkspaceFolderMenu() {
    if (!workspaceFolderMenu || workspaceFolderMenu.hidden) return;
    const folder = efficiencySnapshot?.workspaceFolder;
    const connected = typeof window[EFFICIENCY_BINDING] === "function";
    workspaceFolderMenu.querySelector("[data-workspace-folder-path]").textContent = folder?.path || "未关联本地目录";
    workspaceFolderMenu.querySelector("[role=status]").textContent = workspaceFolderMessage
      || (!connected ? "本地连接尚未就绪，请稍后重试。" : folder?.reason || "");
    for (const button of workspaceFolderMenu.querySelectorAll("[data-workspace-folder-mode]")) {
      button.disabled = !connected || !folder?.available || Boolean(workspaceFolderPending)
        || (button.dataset.workspaceFolderMode === "parent" && !folder.canRevealParent);
    }
  }

  function positionWorkspaceFolderMenu() {
    if (!workspaceFolderMenu || workspaceFolderMenu.hidden) return;
    if (!workspaceFolderButton?.isConnected || workspaceFolderButton.hidden) { closeWorkspaceFolderMenu(false); return; }
    const rect = workspaceFolderButton.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    workspaceFolderMenu.style.maxWidth = `${Math.max(0, width - 16)}px`;
    workspaceFolderMenu.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const menuRect = workspaceFolderMenu.getBoundingClientRect();
    workspaceFolderMenu.style.left = `${Math.max(left + 8, Math.min(rect.right - menuRect.width, left + width - menuRect.width - 8))}px`;
    workspaceFolderMenu.style.top = `${Math.max(top + 8, Math.min(rect.bottom + 8, top + height - menuRect.height - 8))}px`;
  }

  function openWorkspaceFolderMenu(focusIndex = 0) {
    if (destroyed || !workspaceFolderButton?.isConnected || workspaceFolderButton.hidden) return;
    if (!workspaceFolderMenu) {
      workspaceFolderMenu = document.createElement("div");
      workspaceFolderMenu.id = WORKSPACE_FOLDER_MENU_ID;
      workspaceFolderMenu.setAttribute("role", "menu");
      workspaceFolderMenu.setAttribute("aria-label", "打开文件");
      workspaceFolderMenu.tabIndex = -1;
      workspaceFolderMenu.hidden = true;
      workspaceFolderMenu.innerHTML = `<p data-workspace-folder-path></p>
        <button type="button" role="menuitem" data-workspace-folder-mode="parent">打开母文件夹<small>打开所属项目目录，并选中本对话文件夹</small></button>
        <button type="button" role="menuitem" data-workspace-folder-mode="folder">打开子文件夹<small>直接进入本对话的专属文件夹</small></button>
        <p role="status" aria-live="polite"></p>`;
      workspaceFolderMenu.querySelectorAll("button").forEach((button) => {
        button.onclick = (event) => { event.stopPropagation(); requestWorkspaceFolder(button.dataset.workspaceFolderMode); };
      });
      // The top layer avoids clipping by the native header and overlay panels.
      if (typeof workspaceFolderMenu.showPopover === "function") workspaceFolderMenu.setAttribute("popover", "manual");
      document.body.appendChild(workspaceFolderMenu);
    }
    workspaceFolderMenuTarget = efficiencyTargetKey();
    workspaceFolderMessage = workspaceFolderPending ? "正在请求文件管理器…" : "";
    workspaceFolderMenu.hidden = false;
    try { if (workspaceFolderMenu.hasAttribute("popover") && !workspaceFolderMenu.matches(":popover-open")) workspaceFolderMenu.showPopover(); } catch { workspaceFolderMenu.removeAttribute("popover"); }
    renderWorkspaceFolderMenu(); positionWorkspaceFolderMenu();
    workspaceFolderButton.setAttribute("aria-expanded", "true");
    const items = workspaceFolderMenu.querySelectorAll("button:not(:disabled)");
    (items[focusIndex < 0 ? items.length - 1 : focusIndex] || workspaceFolderMenu).focus();
  }

  function closeWorkspaceFolderMenu(restoreFocus = true) {
    if (!workspaceFolderMenu || workspaceFolderMenu.hidden) return;
    try { if (workspaceFolderMenu.matches(":popover-open")) workspaceFolderMenu.hidePopover(); } catch {}
    workspaceFolderMenu.hidden = true;
    workspaceFolderButton?.setAttribute("aria-expanded", "false");
    if (restoreFocus && workspaceFolderButton?.isConnected && !workspaceFolderButton.hidden) workspaceFolderButton.focus();
  }

  function handleWorkspaceFolderPointer(event) {
    if (workspaceFolderMenu && !workspaceFolderMenu.hidden && !workspaceFolderMenu.contains(event.target)
      && !workspaceFolderButton?.contains(event.target)) closeWorkspaceFolderMenu(false);
  }

  function handleWorkspaceFolderKeydown(event) {
    if (!workspaceFolderMenu || workspaceFolderMenu.hidden) return false;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeWorkspaceFolderMenu(); return true; }
    if (event.key === "Tab") { closeWorkspaceFolderMenu(false); return true; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !workspaceFolderMenu.contains(event.target)) return false;
    const items = [...workspaceFolderMenu.querySelectorAll("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus(); return true;
  }

  function requestWorkspaceFolder(mode) {
    if (destroyed || workspaceFolderPending || workspaceFolderMenuTarget !== efficiencyTargetKey()) return;
    const binding = window[EFFICIENCY_BINDING];
    if (typeof binding !== "function" || !efficiencySnapshot?.workspaceFolder?.available) return;
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const payload = { requestId, action: "openWorkspaceFolder", mode, expectedTargetKey: workspaceFolderMenuTarget };
    const timer = setTimeout(() => resolveWorkspaceFolderRequest({ requestId, ok: false, error: "打开结果尚未确认，请检查文件管理器后重试。" }), 12_000);
    workspaceFolderPending = { requestId, targetKey: workspaceFolderMenuTarget, timer };
    workspaceFolderMessage = "正在请求文件管理器…"; renderWorkspaceFolderMenu();
    const failed = () => resolveWorkspaceFolderRequest({ requestId, ok: false, error: "本地连接不可用，未确认打开。" });
    try { Promise.resolve(binding(JSON.stringify(payload))).catch(failed); } catch { failed(); }
  }

  function resolveWorkspaceFolderRequest(response) {
    const pending = workspaceFolderPending;
    if (!pending || pending.requestId !== response?.requestId) return false;
    clearTimeout(pending.timer); workspaceFolderPending = null;
    if (destroyed || pending.targetKey !== efficiencyTargetKey()) return true;
    workspaceFolderMessage = response.ok && response.data?.targetKey === pending.targetKey
      ? String(response.data.folderResult?.message || "已请求打开文件管理器。")
      : String(response.error || "当前对话已变化，请重新打开菜单。");
    renderWorkspaceFolderMenu(); positionWorkspaceFolderMenu(); return true;
  }

  function openTaskContextPanel() {
    if (efficiencySnapshot?.scopeAvailable?.thread !== true || !efficiencyTargetKey()) return false;
    return openEfficiencyPanel("context");
  }

  function findEfficiencyPanelMount() {
    // Global preferences must remain accessible on home/new native layouts that
    // do not expose a conversation mount. Only this panel uses the body fallback.
    return findCustomShortcutPageMount() || (document.body ? { surface: document.body } : null);
  }

  function openEfficiencyPanel(view = "settings") {
    if (destroyed) return false;
    const nextView = view === "context" ? "context" : "settings";
    if (efficiencyPanel?.isConnected && !efficiencyPanel.hidden) {
      if (efficiencyView !== nextView) { efficiencyExecutionPreview = null; efficiencySummaryReplaceRequested = false; }
      efficiencyView = nextView; populateEfficiencyForm(); ensureTaskContextButton(); maybeSummarizeTaskContext(); return true;
    }
    const mount = findEfficiencyPanelMount();
    if (!mount) return false;
    closeOtherWorkspacePanels("efficiency");
    if (!efficiencyPanel) efficiencyPanel = createEfficiencyPanel();
    efficiencyView = nextView;
    efficiencyMountSurface = mount.surface;
    efficiencyPanel.removeAttribute("data-efficiency-viewport-overlay");
    if (efficiencyPanel.parentElement !== mount.surface) mount.surface.appendChild(efficiencyPanel);
    efficiencyReturnFocus = document.activeElement;
    efficiencyPanel.hidden = false;
    if (mount.surface !== document.body) setWorkspacePanelHostLayer(efficiencyPanel, true);
    populateEfficiencyForm();
    constrainEfficiencyPanelToViewport();
    watchEfficiencyPanelLayout();
    ensureTaskContextButton(); maybeSummarizeTaskContext();
    return true;
  }

  function closeEfficiencyPanel(restoreFocus = true) {
    if (!efficiencyPanel) return;
    setWorkspacePanelHostLayer(efficiencyPanel, false);
    efficiencyPanel.hidden = true;
    efficiencyExecutionPreview = null; efficiencySummaryReplaceRequested = false;
    ensureTaskContextButton();
    efficiencyResizeObserver?.disconnect();
    if (efficiencyLayoutFrame !== null) cancelAnimationFrame(efficiencyLayoutFrame);
    efficiencyLayoutFrame = null;
    if (restoreFocus && efficiencyReturnFocus?.isConnected) efficiencyReturnFocus.focus?.();
    efficiencyReturnFocus = null;
  }

  function restoreEfficiencyPanelMount() {
    if (!efficiencyPanel || efficiencyPanel.hidden) return;
    if (efficiencyPanel.isConnected) { scheduleEfficiencyPanelLayout(); return; }
    const mount = findEfficiencyPanelMount();
    if (!mount) return;
    mount.surface.appendChild(efficiencyPanel);
    efficiencyMountSurface = mount.surface;
    if (mount.surface !== document.body) setWorkspacePanelHostLayer(efficiencyPanel, true);
    constrainEfficiencyPanelToViewport(); watchEfficiencyPanelLayout();
  }

  function getEfficiencyState() {
    return JSON.parse(JSON.stringify({ snapshot: efficiencySnapshot, scope: efficiencyScope, view: efficiencyView,
      open: Boolean(efficiencyPanel && !efficiencyPanel.hidden), targetChanged: efficiencyTargetChanged,
      drafts: Object.fromEntries(efficiencyDrafts), contextDraft: efficiencyTaskDraft, pending: efficiencyRequests.size,
      executionPreview: efficiencyExecutionPreview,
      message: efficiencyMessage, error: efficiencyError }));
  }

  function iconChoiceButton(icon, selected = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codexShortcutIcon = icon;
    button.setAttribute("aria-label", `图标 ${icon}`);
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = presetShortcutSvg(icon);
    button.onclick = () => {
      button.parentElement.querySelectorAll("[data-codex-shortcut-icon]")
        .forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    };
    return button;
  }

  function renderShortcutVisibilityList(dialog) {
    const list = dialog.querySelector("[data-codex-shortcut-visibility-list]");
    const items = shortcutCatalog.filter((item) => item.kind !== "settings");
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement("label");
      row.className = "codex-shortcut-settings-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !shortcutSettings.hidden.includes(shortcutItemKey(item));
      checkbox.dataset.codexShortcutVisible = shortcutItemKey(item);
      checkbox.setAttribute("aria-label", `显示${item.name}`);
      checkbox.onchange = () => {
        const key = shortcutItemKey(item);
        shortcutSettings.hidden = checkbox.checked
          ? shortcutSettings.hidden.filter((value) => value !== key)
          : [...shortcutSettings.hidden.filter((value) => value !== key), key];
        persistShortcutSettings();
        document.getElementById(SHORTCUT_GRID_ID)?.remove();
        scheduleSync();
      };
      const name = document.createElement("span");
      name.textContent = item.name;
      row.append(checkbox, name);
      if (item.custom) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.codexShortcutDelete = item.id;
        remove.setAttribute("aria-label", `删除${item.name}`);
        remove.textContent = "删除";
        remove.onclick = (event) => {
          event.preventDefault();
          shortcutSettings.custom = shortcutSettings.custom.filter((candidate) => candidate.id !== item.id);
          shortcutSettings.hidden = shortcutSettings.hidden.filter((value) => value !== shortcutItemKey(item));
          persistShortcutSettings();
          document.getElementById(SHORTCUT_GRID_ID)?.remove();
          scheduleSync();
          shortcutCatalog = shortcutCatalog.filter((candidate) => candidate.id !== item.id);
          renderShortcutVisibilityList(dialog);
        };
        row.appendChild(remove);
      }
      return row;
    }));
  }

  function createShortcutSettingsDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = SHORTCUT_SETTINGS_ID;
    dialog.innerHTML = `
      <div class="codex-shortcut-settings-shell">
        <header class="codex-shortcut-settings-header">
          <h2>AIYOUcodex 设置</h2>
          <button type="button" data-codex-shortcut-settings-close aria-label="关闭设置">×</button>
        </header>
        <div class="codex-shortcut-settings-body">
          <button type="button" data-aiyou-efficiency-open><span>输出偏好与默认 Skills</span><span aria-hidden="true">→</span></button>
          <p data-efficiency-open-error role="alert"></p>
          <h3>显示与隐藏</h3>
          <div class="codex-shortcut-settings-list" data-codex-shortcut-visibility-list></div>
          <form data-codex-shortcut-custom-form>
            <h3>新建快捷入口</h3>
            <label class="codex-shortcut-field">名称<input type="text" name="name" maxlength="24" required placeholder="例如：知识卡片"></label>
            <label class="codex-shortcut-field">链接<input type="url" name="url" required placeholder="https://example.com"></label>
            <div class="codex-shortcut-field">图标<div class="codex-shortcut-icon-options" data-codex-shortcut-icons></div></div>
            <div class="codex-shortcut-field">打开方式<div class="codex-shortcut-open-modes">
              <label><input type="radio" name="openMode" value="internal" checked>内置打开</label>
              <label><input type="radio" name="openMode" value="browser">浏览器打开</label>
            </div></div>
            <div data-codex-shortcut-error role="alert"></div>
            <button type="submit" data-codex-shortcut-save>新建快捷入口</button>
          </form>
        </div>
      </div>`;
    const icons = dialog.querySelector("[data-codex-shortcut-icons]");
    icons.replaceChildren(...Object.keys(SHORTCUT_ICON_PRESETS).map((icon, index) => iconChoiceButton(icon, index === 0)));
    dialog.querySelector("[data-codex-shortcut-settings-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-aiyou-efficiency-open]").onclick = (event) => {
      event.preventDefault(); event.stopPropagation();
      const error = dialog.querySelector("[data-efficiency-open-error]");
      error.textContent = "";
      let opened = false;
      try { opened = openEfficiencyPanel(); }
      catch { closeEfficiencyPanel(false); }
      if (!opened) {
        error.textContent = "输出偏好暂时无法打开，请重试。当前设置已保留。";
        return;
      }
      dialog.close();
      efficiencyReturnFocus = document.activeElement;
      efficiencyPanel.querySelector("[data-efficiency-close]")?.focus({ preventScroll: true });
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector("[data-codex-shortcut-custom-form]").onsubmit = (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = form.elements.name.value.trim().slice(0, 24);
      const url = validShortcutUrl(form.elements.url.value);
      const error = form.querySelector("[data-codex-shortcut-error]");
      if (!name || !url) {
        error.textContent = "请填写名称和有效的 http(s) 链接";
        return;
      }
      const icon = form.querySelector('[data-codex-shortcut-icon][aria-pressed="true"]')?.dataset.codexShortcutIcon || "link";
      const openMode = form.elements.openMode.value === "browser" ? "browser" : "internal";
      shortcutSettings.custom.push({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        name,
        url,
        icon,
        openMode,
        custom: true,
      });
      persistShortcutSettings();
      form.reset();
      form.querySelector('input[name="openMode"][value="internal"]').checked = true;
      form.querySelectorAll("[data-codex-shortcut-icon]").forEach((button, index) => button.setAttribute("aria-pressed", String(index === 0)));
      error.textContent = "";
      document.getElementById(SHORTCUT_GRID_ID)?.remove();
      dialog.close();
      scheduleSync();
    };
    document.body.appendChild(dialog);
    return dialog;
  }

  function openShortcutSettings() {
    let dialog = document.getElementById(SHORTCUT_SETTINGS_ID);
    if (!dialog) dialog = createShortcutSettingsDialog();
    renderShortcutVisibilityList(dialog);
    if (!dialog.open) dialog.showModal();
  }

  function shortcutLabel(button) {
    const label = button?.querySelector(".text-fade-truncate")?.textContent?.trim()
      || button?.getAttribute("title")
      || button?.getAttribute("aria-label")?.replace(/^打开/u, "")
      || "快捷入口";
    return canonicalShortcutLabel(label);
  }

  function findNativeShortcutButton(name) {
    const canonicalName = canonicalShortcutLabel(name);
    const sidebar = sidebarRoot();
    return Array.from(sidebar?.querySelectorAll("button") || []).find((button) =>
      !button.closest(`#${SHORTCUT_GRID_ID}`) && shortcutLabel(button) === canonicalName,
    );
  }

  function sidebarRoot() {
    return document.getElementById("app-shell-sidebar")
      || document.querySelector('[data-app-action-sidebar-scroll]')?.closest('nav, [role="navigation"]')
      || document.querySelector(ROW_SELECTOR)?.closest('nav, [role="navigation"]')
      || null;
  }

  function shortcutGroupButtons(group) {
    return Array.from(group?.querySelectorAll(":scope > button, :scope > * > button") || [])
      .filter((button) => button instanceof HTMLButtonElement && !button.closest(`#${SHORTCUT_GRID_ID}`));
  }

  function shortcutSiblingGroup(button) {
    let candidate = button?.parentElement;
    while (candidate && !candidate.matches("nav, [data-app-action-sidebar-scroll]")) {
      const buttons = shortcutGroupButtons(candidate);
      if (buttons.includes(button) && buttons.length >= 3) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function nativeShortcutSources() {
    const newConversation = findNativeShortcutButton("新对话");
    const pullRequests = findNativeShortcutButton("拉取请求");
    const overflowButton = findNativeShortcutButton("更多");
    const navigationGroup = shortcutSiblingGroup(pullRequests)
      || shortcutSiblingGroup(findNativeShortcutButton("已安排"))
      || shortcutSiblingGroup(findNativeShortcutButton("插件"));
    // Hide only the actual overflow trigger; its parent can include unrelated
    // navigation groups after a host update. Never remove React-owned nodes.
    const overflowGroup = overflowButton || null;
    let newConversationRow = newConversation?.parentElement;
    while (newConversationRow && !newConversationRow.matches("nav, [data-app-action-sidebar-scroll]")) {
      const rowButtons = Array.from(newConversationRow.querySelectorAll("button"));
      if (rowButtons.includes(newConversation) && rowButtons.length > 1) break;
      newConversationRow = newConversationRow.parentElement;
    }
    if (newConversationRow?.matches("nav, [data-app-action-sidebar-scroll]")) {
      newConversationRow = newConversation?.parentElement;
    }
    const header = newConversationRow?.parentElement;
    if (!newConversation || !header || !sidebarRoot()?.contains(header)) return null;

    const navigationButtons = navigationGroup ? shortcutGroupButtons(navigationGroup)
      : ["拉取请求", "站点", "已安排", "插件", "项目管理"].map(findNativeShortcutButton).filter(Boolean);
    const quickButton = Array.from(newConversationRow.querySelectorAll("button"))
      .find((button) => button !== newConversation) || null;
    const sourceItems = [
      { name: "新对话", button: newConversation, quickButton },
      ...navigationButtons.map((button) => ({ name: shortcutLabel(button), button, quickButton: null })),
    ].filter((item, index, values) => item.name && values.findIndex((candidate) => candidate.name === item.name) === index);
    const builtInItems = sourceItems.filter((item) => !HIDDEN_SHORTCUT_NAMES.has(item.name));
    const enhancementItems = [
      { id: "skills-grouping", name: "Skills 分组", kind: "enhancement", icon: "skills", activate: openSkillsGrouping },
      { id: "asset-console", name: "资产控制台", kind: "enhancement", icon: "assets", activate: openAssetConsolePanel },
    ];
    const managedItems = normalizedManagedShortcuts();
    const catalogItems = [
      ...builtInItems.slice(0, 1),
      ...managedItems,
      ...builtInItems.slice(1),
      ...enhancementItems,
      ...normalizedCustomShortcuts(),
    ];
    const items = catalogItems.filter((item) => !shortcutSettings.hidden.includes(shortcutItemKey(item)));
    return { header, newConversationRow, navigationGroup, overflowGroup, sourceItems, catalogItems, items };
  }

  function shortcutIcon(source, className = SHORTCUT_ICON_CLASS, name = "", icon = "") {
    const host = document.createElement("span");
    host.className = className;
    host.setAttribute("aria-hidden", "true");
    if (name === "设置") {
      host.innerHTML = settingsShortcutSvg();
      return host;
    }
    if (icon) {
      host.innerHTML = presetShortcutSvg(icon);
      return host;
    }
    const image = source?.querySelector("svg, img")?.cloneNode(true);
    if (image) host.appendChild(image);
    return host;
  }

  function createShortcutCard(item) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-codex-sidebar-shortcut-card-wrap", "true");
    const button = document.createElement("button");
    button.type = "button";
    button.className = SHORTCUT_CARD_CLASS;
    button.dataset.codexSidebarShortcutCard = "true";
    button.dataset.codexSidebarShortcutName = item.name;
    if (item.url) button.dataset.codexSidebarShortcutUrl = item.url;
    if (item.kind === "settings") button.dataset.codexSidebarShortcutSettings = "true";
    if (item.custom) button.dataset.codexSidebarShortcutCustom = item.id;
    if (item.managed) button.dataset.codexSidebarShortcutManaged = item.id;
    button.setAttribute("aria-label", item.button?.getAttribute("aria-label") || `打开${item.name}`);
    button.title = item.name;
    const label = document.createElement("span");
    label.className = SHORTCUT_LABEL_CLASS;
    label.textContent = item.name;
    button.append(shortcutIcon(item.button, SHORTCUT_ICON_CLASS, item.name, item.icon), label);
    button.onclick = () => {
      if (item.kind === "settings") openShortcutSettings();
      else if (item.kind === "enhancement") {
        if (shortcutPanelIsOpen(item)) {
          if (item.id === "skills-grouping") closeSkillsGrouping();
          else if (item.id === "asset-console") closeAssetConsolePanel();
        } else item.activate?.();
      }
      else if ((item.custom || item.managed) && item.openMode === "browser") openCustomShortcutInBrowser(item);
      else if (item.managed && item.openMode === "in-app") openNativeBrowserShortcut(item, { toggle: true });
      else if (item.custom || item.managed) {
        if (shortcutPanelIsOpen(item)) closeCustomShortcutPanel();
        else openCustomShortcutPanel(item);
      }
      else findNativeShortcutButton(item.name)?.click();
    };
    wrap.appendChild(button);

    if (item.quickButton) {
      const quick = document.createElement("button");
      quick.type = "button";
      quick.dataset.codexSidebarShortcutQuick = "true";
      quick.setAttribute("aria-label", item.quickButton.getAttribute("aria-label") || "快速聊天");
      quick.title = item.quickButton.getAttribute("aria-label") || "快速聊天";
      const image = item.quickButton.querySelector("svg, img")?.cloneNode(true);
      if (image) quick.appendChild(image);
      quick.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        nativeShortcutSources()?.sourceItems
          .find((candidate) => candidate.name === item.name)?.quickButton?.click();
      };
      wrap.appendChild(quick);
    }
    return wrap;
  }

  // User activation toggles; command/search APIs remain idempotent ensure-open.
  function shortcutPanelIsOpen(item) {
    if (item.custom || item.managed) return customShortcutPageIsVisible()
      && customShortcutPage.dataset.codexCustomShortcutItem === shortcutItemKey(item);
    if (item.id === "asset-console") return Boolean(assetConsolePage && !assetConsolePage.hidden);
    if (item.id === "skills-grouping") {
      const shell = document.getElementById(SKILL_ORGANIZER_ID);
      return skillOrganizerOpening || Boolean(shell && !shell.hidden);
    }
    return false;
  }

  function updateShortcutCard(grid, item) {
    const button = Array.from(grid.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => item.managed
        ? candidate.dataset.codexSidebarShortcutManaged === item.id
        : item.custom
          ? candidate.dataset.codexSidebarShortcutCustom === item.id
          : candidate.dataset.codexSidebarShortcutName === item.name);
    if (!button) return;
    if (!item.button) {
      button.disabled = false;
      const active = shortcutPanelIsOpen(item);
      button.dataset.active = String(active);
      button.setAttribute("aria-current", String(active));
      button.setAttribute("aria-expanded", String(active));
      if (item.id === "skills-grouping" && skillOrganizerOpening) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", item.kind === "settings" ? "管理快捷入口" : `${active ? "收起" : "打开"}${item.name}`);
      button.closest("[data-codex-sidebar-shortcut-card-wrap]")
        ?.querySelector(".codex-sidebar-shortcut-status")?.remove();
      if (item.id === "skills-grouping") updateSkillsGroupingShortcutState();
      return;
    }
    button.disabled = item.button.disabled;
    const state = item.button.getAttribute("data-state");
    const active = item.button.getAttribute("aria-current") === "page"
      || item.button.getAttribute("data-active") === "true"
      || state === "open" || state === "active" || state === "selected";
    button.dataset.active = String(active);
    if (item.name === "项目管理") {
      button.setAttribute("aria-expanded", String(active));
      button.setAttribute("aria-controls", "codex-taskboard-page");
    }
    button.setAttribute("aria-label", item.button.getAttribute("aria-label") || item.name);
    const wrap = button.closest("[data-codex-sidebar-shortcut-card-wrap]");
    const hasStatus = item.button.children.length > 1;
    let status = wrap?.querySelector(".codex-sidebar-shortcut-status");
    if (hasStatus && !status) {
      status = document.createElement("span");
      status.className = "codex-sidebar-shortcut-status";
      status.setAttribute("aria-hidden", "true");
      wrap.appendChild(status);
    } else if (!hasStatus) {
      status?.remove();
    }
  }

  function clearShortcutEnhancement() {
    document.getElementById(SHORTCUT_GRID_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-hidden]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-group-hidden]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-group-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]").forEach((node) => {
      node.removeAttribute("data-codex-sidebar-shortcut-source-name");
    });
    shortcutSources = new Map();
    shortcutCatalog = [];
  }

  function ensureShortcutGrid() {
    const sources = nativeShortcutSources();
    if (!sources || sources.items.length < 2) {
      if (document.getElementById(SHORTCUT_GRID_ID)) {
        shortcutSourcesMissingSince ||= Date.now();
        if (Date.now() - shortcutSourcesMissingSince < NATIVE_ANCHOR_GRACE_MS) {
          scheduleAnchorRetry();
          return;
        }
        clearShortcutEnhancement();
      }
      return;
    }
    shortcutSourcesMissingSince = 0;
    let grid = document.getElementById(SHORTCUT_GRID_ID);
    const needsRebuild = grid?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || grid?.parentElement !== sources.header
      || grid?.children.length !== sources.items.length
      || sources.items.some((item) => shortcutSources.get(shortcutItemKey(item)) !== (item.button || item.id || item.url || item.kind));
    if (needsRebuild) {
      clearShortcutEnhancement();
      grid = document.createElement("div");
      grid.id = SHORTCUT_GRID_ID;
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "快捷入口");
      grid.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      grid.replaceChildren(...sources.items.map(createShortcutCard));
      sources.header.appendChild(grid);
      shortcutSources = new Map(sources.items.map((item) => [shortcutItemKey(item), item.button || item.id || item.url || item.kind]));
    }
    shortcutCatalog = sources.catalogItems;
    sources.newConversationRow.setAttribute("data-codex-sidebar-shortcut-source-hidden", "true");
    sources.navigationGroup?.setAttribute("data-codex-sidebar-shortcut-source-group-hidden", "true");
    sources.overflowGroup?.setAttribute("data-codex-sidebar-shortcut-source-group-hidden", "true");
    for (const item of sources.sourceItems) {
      item.button.dataset.codexSidebarShortcutSourceName = item.name;
      if (item.name !== "新对话") item.button.dataset.codexSidebarShortcutSourceHidden = "true";
    }
    for (const item of sources.items) {
      updateShortcutCard(grid, item);
    }
  }

  function sectionLabel(button) {
    const label = button?.closest("section[data-app-action-sidebar-section-heading]")
      ?.getAttribute("data-app-action-sidebar-section-heading")
      || button?.querySelector("span.min-w-0.truncate")?.textContent?.trim()
      || button?.textContent?.trim()
      || "";
    return canonicalSectionLabel(label);
  }

  function nativeSectionSource(name) {
    const canonicalName = canonicalSectionLabel(name);
    const nativeSection = Array.from(document.querySelectorAll("section[data-app-action-sidebar-section-heading]"))
      .find((candidate) => canonicalSectionLabel(
        candidate.getAttribute("data-app-action-sidebar-section-heading"),
      ) === canonicalName);
    const button = nativeSection?.querySelector("button[data-app-action-sidebar-section-toggle]")
      || Array.from(document.querySelectorAll("button[data-app-action-sidebar-section-toggle]"))
        .find((candidate) => !candidate.closest(`#${SECTION_TABS_ID}`) && sectionLabel(candidate) === canonicalName);
    if (!button) return null;
    const section = nativeSection || button.closest("section");
    let heading = button.parentElement;
    while (heading && heading.parentElement !== section
      && !heading.classList.contains("group/nav-section-title")) heading = heading.parentElement;
    if (!heading || !section) return null;
    return { name: canonicalName, button, heading, section, panelHost: null, actions: null };
  }

  function commonAncestor(nodes) {
    if (!nodes.length) return null;
    let candidate = nodes[0]?.parentElement;
    while (candidate && !nodes.every((node) => candidate.contains(node))) candidate = candidate.parentElement;
    return candidate;
  }

  function topLevelPanelHost(section, common) {
    let host = section;
    while (host?.parentElement && host.parentElement !== common) host = host.parentElement;
    return host?.parentElement === common ? host : section;
  }

  function nativeSectionSources() {
    const items = NATIVE_SECTION_NAMES.map(nativeSectionSource).filter(Boolean);
    if (!items.length) return null;
    const common = commonAncestor(items.map((item) => item.section));
    if (!common) return null;
    for (const item of items) item.panelHost = topLevelPanelHost(item.section, common);
    const project = items.find((item) => item.name === "项目");
    if (project) project.actions = Array.from(project.heading.children).find((child) =>
      !child.contains(project.button) && child.querySelector("button"),
    ) || null;
    return { common, items };
  }

  function nativePrioritySource() {
    const list = Array.from(sidebarRoot()?.querySelectorAll('[role="list"]') || []).find((candidate) => {
      if (!candidate.querySelector(ROW_SELECTOR)) return false;
      return Array.from(candidate.querySelectorAll("div,span,h1,h2,h3,h4")).some((node) =>
        node.childElementCount === 0 && canonicalSectionLabel(node.textContent) === "优先级",
      );
    });
    return list?.parentElement ? { common: list.parentElement, list } : null;
  }

  function nativeActivityViewOpen() {
    return Array.from(document.querySelectorAll("button[aria-label]")).some((button) => {
      const label = normalizedNativeLabel(button.getAttribute("aria-label"));
      return /^(?:关闭活动视图|close activity view)(?:[，,\s]|$)/iu.test(label)
        || (/^(?:查看活动|view activity|通知|notifications?)(?:[，,\s]|$)/iu.test(label)
          && (button.getAttribute("aria-expanded") === "true" || button.getAttribute("aria-pressed") === "true"));
    }) || Array.from(document.querySelectorAll("button[aria-label]")).some((button) =>
      /^(?:活动视图选项|activity view options)$/iu.test(
        normalizedNativeLabel(button.getAttribute("aria-label")),
      ),
    );
  }

  function sectionEnhancementMounted() {
    return Boolean(
      sectionSources.size
      || document.getElementById(SECTION_TABS_ID)
      || document.getElementById(FOLDER_SWITCHER_ID)
      || document.querySelector('[data-codex-sidebar-priority-native-hidden="true"]'),
    );
  }

  function sectionIdPart(name) {
    return name === "置顶" ? "pinned" : name === "项目" ? "projects" : name === "最近" ? "recent" : "interrupted";
  }

  function sectionPanelId(name) {
    return name === "中断" ? INTERRUPTED_PANEL_ID : `codex-sidebar-section-panel-${sectionIdPart(name)}`;
  }

  function setNativeSectionExpanded(item, desired) {
    const expanded = item.button.getAttribute("aria-expanded") === "true";
    if (expanded === desired) {
      sectionTogglePending.delete(item.name);
      return;
    }
    const pending = sectionTogglePending.get(item.name);
    if (pending?.button === item.button && pending.desired === desired && Date.now() - pending.startedAt < 1_200) return;
    sectionTogglePending.set(item.name, { button: item.button, desired, startedAt: Date.now() });
    item.button.click();
    scheduleSync();
  }

  function updateSectionTabState(items, { syncNative = true } = {}) {
    const bar = document.getElementById(SECTION_TABS_ID);
    if (!bar || !activeSectionTab) return;
    for (const item of items) {
      const selected = item.name === activeSectionTab;
      const part = sectionIdPart(item.name);
      const tab = bar.querySelector(`[data-codex-sidebar-section-tab="${item.name}"]`);
      tab?.setAttribute("aria-selected", String(selected));
      if (tab) tab.tabIndex = selected ? 0 : -1;
      item.panelHost.hidden = !selected;
      item.section.hidden = !selected;
      item.section.id = sectionPanelId(item.name);
      item.section.setAttribute("role", "tabpanel");
      item.section.setAttribute("aria-labelledby", `codex-sidebar-section-tab-${part}`);
      item.section.dataset.codexSidebarSectionPanel = item.name;
      if (item.heading) item.heading.dataset.codexSidebarSectionHeadingHidden = "true";
      if (syncNative && !item.virtual) {
        const keepMountedForVirtualTab = activeSectionTab === "中断" && item.name === "最近";
        setNativeSectionExpanded(item, selected || keepMountedForVirtualTab);
      }
    }
    const actions = bar.querySelector("[data-codex-sidebar-project-actions]");
    if (actions) actions.hidden = activeSectionTab !== "项目";
  }

  function selectSectionTab(name, { focus = false } = {}) {
    if (!SECTION_NAMES.includes(name)) return;
    activeSectionTab = name;
    try { localStorage.setItem(SECTION_TAB_STORAGE_KEY, name); } catch {}
    const items = SECTION_NAMES.map((sectionName) => sectionSources.get(sectionName)).filter(Boolean);
    updateSectionTabState(items);
    const tab = document.querySelector(`#${SECTION_TABS_ID} [data-codex-sidebar-section-tab="${name}"]`);
    if (focus) tab?.focus();
    scheduleSync();
  }

  function handleSectionTabKeydown(event) {
    const current = event.currentTarget?.dataset?.codexSidebarSectionTab;
    const index = SECTION_NAMES.indexOf(current);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = SECTION_NAMES[(index + 1) % SECTION_NAMES.length];
    else if (event.key === "ArrowLeft") next = SECTION_NAMES[(index - 1 + SECTION_NAMES.length) % SECTION_NAMES.length];
    else if (event.key === "Home") next = SECTION_NAMES[0];
    else if (event.key === "End") next = SECTION_NAMES.at(-1);
    if (!next) return;
    event.preventDefault();
    selectSectionTab(next, { focus: true });
  }

  function createSectionTabs() {
    const bar = document.createElement("div");
    bar.id = SECTION_TABS_ID;
    bar.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "对话分组");
    for (const name of SECTION_NAMES) {
      const tab = document.createElement("button");
      const part = sectionIdPart(name);
      tab.type = "button";
      tab.id = `codex-sidebar-section-tab-${part}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", sectionPanelId(name));
      tab.dataset.codexSidebarSectionTab = name;
      tab.textContent = name;
      tab.onclick = () => selectSectionTab(name);
      tab.onkeydown = handleSectionTabKeydown;
      tablist.appendChild(tab);
    }
    const actions = document.createElement("div");
    actions.dataset.codexSidebarProjectActions = "true";
    actions.setAttribute("aria-label", "项目操作");
    const currentFolderNewChat = document.createElement("button");
    currentFolderNewChat.type = "button";
    currentFolderNewChat.hidden = true;
    currentFolderNewChat.dataset.codexSidebarCurrentFolderNewChat = "";
    currentFolderNewChat.setAttribute("aria-label", "在当前文件夹中新建对话");
    currentFolderNewChat.title = "在当前文件夹中新建对话";
    currentFolderNewChat.innerHTML = '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M6.33 1.81H4.67A2.86 2.86 0 0 0 1.81 4.67v6.66a2.86 2.86 0 0 0 2.86 2.86h6.66a2.86 2.86 0 0 0 2.86-2.86V9.67" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/><path d="m7.05 9.96.52-2.09 4.38-4.38a1.42 1.42 0 0 1 2 2L9.57 9.87l-2.52.09Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>';
    currentFolderNewChat.onclick = handleCurrentFolderNewChat;
    actions.appendChild(currentFolderNewChat);
    bar.append(tablist, actions);
    return bar;
  }

  function restoreProjectActions() {
    document.querySelector(`#${SECTION_TABS_ID} [data-codex-native-action-proxies]`)?.remove();
  }

  function clearSectionEnhancement() {
    clearFolderEnhancement();
    restoreProjectActions();
    document.getElementById(RECENT_LIST_ID)?.remove();
    document.querySelectorAll(`#${INTERRUPTED_PANEL_ID}, [data-codex-sidebar-virtual-section], [data-codex-sidebar-section-panel="中断"]`).forEach((panel) => {
      panel.remove();
    });
    document.querySelectorAll('[data-codex-sidebar-recent-native-hidden="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-recent-native-hidden");
    });
    document.querySelectorAll('[data-codex-sidebar-priority-native-hidden="true"]').forEach((node) => {
      node.hidden = false;
      node.removeAttribute("data-codex-sidebar-priority-native-hidden");
    });
    document.getElementById(SECTION_TABS_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-section-heading-hidden]").forEach((heading) => {
      heading.removeAttribute("data-codex-sidebar-section-heading-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-section-panel]").forEach((section) => {
      section.removeAttribute("data-codex-sidebar-section-panel");
      section.removeAttribute("role");
      section.removeAttribute("aria-labelledby");
      section.removeAttribute("id");
    });
    for (const item of sectionSources.values()) {
      item.panelHost.hidden = false;
      item.section.hidden = false;
    }
    sectionSources = new Map();
    sectionTogglePending = new Map();
    sectionSourcesMissingSince = 0;
  }

  function ensurePriorityOnlySectionTabs(source) {
    let bar = document.getElementById(SECTION_TABS_ID);
    const needsRebuild = bar?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || bar?.dataset.codexSidebarSectionMode !== "priority"
      || bar?.parentElement !== source.common
      || bar?.dataset.codexSidebarPriorityList !== (source.list.dataset.codexSidebarPriorityList ||= RUNTIME_TOKEN)
      || SECTION_NAMES.some((name) => !sectionSources.get(name)?.section?.isConnected);
    if (needsRebuild) {
      clearSectionEnhancement();
      source.list.dataset.codexSidebarPriorityList = RUNTIME_TOKEN;
      bar = createSectionTabs();
      bar.dataset.codexSidebarSectionMode = "priority";
      bar.dataset.codexSidebarPriorityList = RUNTIME_TOKEN;
      source.common.insertBefore(bar, source.list);
      sectionSources = new Map();
      for (const name of SECTION_NAMES) {
        const panel = document.createElement("section");
        panel.id = sectionPanelId(name);
        panel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
        panel.dataset.codexSidebarVirtualSection = name;
        panel.className = "flex flex-col";
        source.common.insertBefore(panel, source.list);
        sectionSources.set(name, {
          name,
          virtual: true,
          button: null,
          heading: null,
          section: panel,
          panelHost: panel,
          actions: null,
        });
      }
    }
    source.list.hidden = true;
    source.list.dataset.codexSidebarPriorityNativeHidden = "true";
    updateSectionTabState(SECTION_NAMES.map((name) => sectionSources.get(name)).filter(Boolean), { syncNative: false });
  }

  function ensureSectionTabs() {
    if (nativeActivityViewOpen()) {
      if (sectionEnhancementMounted()) clearSectionEnhancement();
      return;
    }
    const sources = nativeSectionSources();
    if (!sources) {
      const prioritySource = nativePrioritySource();
      if (prioritySource) {
        sectionSourcesMissingSince = 0;
        if (!activeSectionTab) activeSectionTab = "项目";
        ensurePriorityOnlySectionTabs(prioritySource);
        return;
      }
      if (document.getElementById(SECTION_TABS_ID)) {
        sectionSourcesMissingSince ||= Date.now();
        if (Date.now() - sectionSourcesMissingSince < NATIVE_ANCHOR_GRACE_MS) {
          scheduleAnchorRetry();
          return;
        }
        clearSectionEnhancement();
      }
      return;
    }
    sectionSourcesMissingSince = 0;
    if (!activeSectionTab) {
      activeSectionTab = sources.items.find((item) => item.button.getAttribute("aria-expanded") === "true")?.name || "项目";
    }
    let bar = document.getElementById(SECTION_TABS_ID);
    const projectActions = sources.items.find((item) => item.name === "项目")?.actions;
    const needsRebuild = bar?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || bar?.parentElement !== sources.common
      || sources.items.some((item) => sectionSources.get(item.name)?.section !== item.section)
      || sectionSources.get("项目")?.actions !== projectActions
      || SECTION_NAMES.some((name) => !sectionSources.get(name)?.section?.isConnected);
    if (needsRebuild) {
      clearSectionEnhancement();
      bar = createSectionTabs();
      sources.common.insertBefore(bar, sources.common.firstChild);
      sectionSources = new Map(sources.items.map((item) => [item.name, item]));
      for (const name of SECTION_NAMES.filter((name) => !sectionSources.has(name))) {
        const interruptedPanel = document.createElement("section");
        interruptedPanel.id = name === "中断" ? INTERRUPTED_PANEL_ID : sectionPanelId(name);
        interruptedPanel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
        interruptedPanel.dataset.codexSidebarVirtualSection = name;
        sources.common.insertBefore(interruptedPanel, bar.nextSibling);
        sectionSources.set(name, {
        name,
        virtual: true,
        button: null,
        heading: null,
        section: interruptedPanel,
        panelHost: interruptedPanel,
        actions: null,
        });
      }
    }
    const project = sources.items.find((item) => item.name === "项目");
    const actionsHost = bar.querySelector("[data-codex-sidebar-project-actions]");
    syncNativeActionProxies(actionsHost, () => nativeSectionSource("项目")?.heading
      ? nativeSectionSources()?.items.find((item) => item.name === "项目")?.actions?.querySelectorAll("button") || []
      : [], "project");
    updateSectionTabState(SECTION_NAMES.map((name) => sectionSources.get(name)).filter(Boolean));
  }

  function ensureGlobalRecentRows() {
    const recent = sectionSources.get("最近");
    const container = recent?.virtual ? recent.section : recent?.heading?.parentElement;
    if (!recent?.section?.isConnected || !container) return;
    const entries = recentCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .slice(0, RECENT_VISIBLE_LIMIT);
    let list = document.getElementById(RECENT_LIST_ID);
    if (!entries.length) {
      list?.remove();
      container.querySelectorAll('[data-codex-sidebar-recent-native-hidden="true"]').forEach((node) => {
        node.removeAttribute("data-codex-sidebar-recent-native-hidden");
      });
      return;
    }
    for (const child of container.children) {
      if (child !== recent.heading && child !== list) child.dataset.codexSidebarRecentNativeHidden = "true";
    }
    if (!list || list.parentElement !== container) {
      list?.remove();
      list = document.createElement("div");
      list.id = RECENT_LIST_ID;
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "全部对话，按最近使用排序");
      list.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      list.className = "flex flex-col";
      container.appendChild(list);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    const currentOrder = Array.from(list.querySelectorAll("[data-codex-sidebar-recent-row]"))
      .map((row) => normalizedThreadId(row.getAttribute("data-app-action-sidebar-thread-id")))
      .join("\n");
    const expectedOrder = entries.map((entry) => normalizedThreadId(entry.threadId)).join("\n");
    if (list.dataset.signature !== signature || currentOrder !== expectedOrder) {
      list.dataset.signature = signature;
      list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "recent")));
    }
  }

  function ensureVirtualPinnedRows() {
    const panel = sectionSources.get("置顶")?.section;
    if (!panel?.isConnected || !sectionSources.get("置顶")?.virtual) return;
    let list = panel.querySelector('[data-codex-sidebar-virtual-pinned-list="true"]');
    if (!list) {
      list = document.createElement("div");
      list.dataset.codexSidebarVirtualPinnedList = "true";
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "置顶对话，最新置顶优先");
      list.className = "flex flex-col";
      panel.appendChild(list);
    }
    const entries = Array.from(pinnedThreadIds, (threadId) => {
      const entry = searchCatalogByThread.get(threadId)
        || recentCatalogByThread.get(threadId)
        || interruptedCatalogByThread.get(threadId);
      return entry ? { ...entry, threadId, pinnedAt: pinnedAtForThread(threadId) } : null;
    }).filter(Boolean).sort((left, right) => right.pinnedAt - left.pinnedAt);
    const signature = entries.map((entry) => `${entry.threadId}:${entry.pinnedAt}:${entry.title}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    if (entries.length) list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "pinned")));
    else {
      const empty = document.createElement("div");
      empty.className = "px-3 py-8 text-center text-sm text-token-text-secondary";
      empty.textContent = "暂无置顶的对话";
      list.replaceChildren(empty);
    }
  }

  function ensureInterruptedRows() {
    const panel = sectionSources.get("中断")?.section;
    if (!panel?.isConnected) return;
    let list = document.getElementById(INTERRUPTED_LIST_ID);
    if (!list) {
      list = document.createElement("div");
      list.id = INTERRUPTED_LIST_ID;
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "已中断对话，按中断时间排序");
      list.className = "flex flex-col";
      panel.appendChild(list);
    }
    const entries = interruptedCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .slice(0, RECENT_VISIBLE_LIMIT);
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.interruptionKind || ""}`).join("\n");
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    if (entries.length) {
      list.replaceChildren(...entries.map((entry) => createCatalogThreadRow(entry, "interrupted")));
    } else {
      const empty = document.createElement("div");
      empty.dataset.codexSidebarInterruptedEmpty = "true";
      empty.className = "px-3 py-8 text-center text-sm text-token-text-secondary";
      empty.textContent = "暂无中断的对话";
      list.replaceChildren(empty);
    }
  }

  function pinnedThreadStorageKey(value) {
    const id = normalizedThreadId(value);
    return id ? `local:${id}` : "";
  }

  function persistPinnedThreadTimes() {
    try { localStorage.setItem(PINNED_THREAD_TIMES_STORAGE_KEY, JSON.stringify(pinnedThreadTimes)); } catch {}
  }

  function pinnedAtForThread(value) {
    const key = pinnedThreadStorageKey(value);
    return Number(pinnedThreadTimes[key] || pinnedThreadTimes[normalizedThreadId(value)] || 0);
  }

  function sortNativePinnedRows() {
    const pinnedSection = sectionSources.get("置顶")?.section;
    if (!pinnedSection?.isConnected) return;
    const rowsByList = new Map();
    for (const row of pinnedSection.querySelectorAll(`${ROW_SELECTOR}:not([data-codex-sidebar-pinned-project-row])`)) {
      const listItem = row.closest('[role="listitem"]');
      const list = listItem?.parentElement;
      if (!listItem || list?.getAttribute("role") !== "list") continue;
      const entries = rowsByList.get(list) || [];
      entries.push({ item: listItem, pinnedAt: pinnedAtForThread(row.getAttribute("data-app-action-sidebar-thread-id")) });
      rowsByList.set(list, entries);
    }
    for (const [list, entries] of rowsByList) {
      const sorted = [...entries].sort((left, right) => right.pinnedAt - left.pinnedAt);
      if (entries.every((entry, index) => entry.item === sorted[index].item)) continue;
      for (const entry of sorted) list.appendChild(entry.item);
    }
  }

  function handlePinDocumentClick(event) {
    const button = event.target?.closest?.("button[aria-label]");
    const actionLabel = button?.getAttribute("aria-label");
    if (!isPinActionLabel(actionLabel)) return;
    const action = canonicalPinActionLabel(actionLabel);
    const row = button.closest(ROW_SELECTOR);
    const id = normalizedThreadId(row?.getAttribute("data-app-action-sidebar-thread-id"));
    if (!id) return;
    const key = pinnedThreadStorageKey(id);
    if (action === "pin") {
      pinnedThreadIds.add(id);
      pinnedThreadTimes[key] = Date.now();
    } else {
      pinnedThreadIds.delete(id);
      delete pinnedThreadTimes[key];
      delete pinnedThreadTimes[id];
    }
    persistPinnedThreadTimes();
    scheduleSync();
  }

  function folderLastUsed(folder) {
    let latest = 0;
    for (const row of folder.querySelectorAll(ROW_SELECTOR)) {
      const time = Date.parse(previews.get(rowKey(row))?.updatedAt || "");
      if (Number.isFinite(time) && time > latest) latest = time;
    }
    return latest;
  }

  function virtualFolderSourceItems(excludedIds = new Set(), sourceIndexOffset = 0) {
    let sourceIndex = sourceIndexOffset;
    return Array.from(searchCatalogByProject, ([id, sourceEntries]) => {
      if (excludedIds.has(id)) return null;
      const { entries: catalogEntries } = dedupeFolderCatalogEntries(sourceEntries
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId))));
      const label = catalogEntries.find((entry) => entry.projectName)?.projectName || id;
      const lastUsed = catalogEntries.reduce((latest, entry) => {
        const time = Date.parse(entry.updatedAt || "");
        return Number.isFinite(time) && time > latest ? time : latest;
      }, 0);
      return {
        id,
        label,
        virtual: true,
        actions: null,
        sourceIndex: sourceIndex++,
        catalogEntries,
        threadTitles: catalogEntries.map((entry) => entry.title),
        searchText: [label, ...catalogEntries.map((entry) => entry.title)].join(" "),
        lastUsed,
        active: false,
      };
    }).filter((item) => item?.id && item?.label);
  }

  function nativeFolderSources() {
    const rows = Array.from(document.querySelectorAll("[data-app-action-sidebar-project-row]"));
    if (!rows.length) return null;
    const items = rows.flatMap((row, sourceIndex) => {
      const id = row.getAttribute("data-app-action-sidebar-project-id") || "";
      const label = row.getAttribute("data-app-action-sidebar-project-label") || row.getAttribute("aria-label") || "";
      const folder = row.closest("[data-sidebar-project-kind]");
      let listRoot = folder?.parentElement;
      while (listRoot && listRoot.getAttribute("role") !== "list") listRoot = listRoot.parentElement;
      if (!id || !label || !folder || !listRoot) return [];
      const panelHost = topLevelPanelHost(folder, listRoot);
      const rowActions = Array.from(row.children).find((child) =>
        Array.from(child.querySelectorAll?.("button") || []).some((button) =>
          isProjectActionsLabel(button.getAttribute("aria-label"), label),
        ),
      );
      const threadTitles = Array.from(folder.querySelectorAll(ROW_SELECTOR))
        .filter((thread) => !pinnedThreadIds.has(normalizedThreadId(
          thread.getAttribute("data-app-action-sidebar-thread-id"),
        )))
        .map((thread) => thread.getAttribute("data-app-action-sidebar-thread-title") || "")
        .filter(Boolean);
      const rawCatalogEntries = (searchCatalogByProject.get(id) || [])
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)));
      const { entries: catalogEntries, suppressedIds: duplicateThreadIds } = dedupeFolderCatalogEntries(rawCatalogEntries);
      const catalogTitles = catalogEntries.map((entry) => entry.title);
      const catalogLastUsed = catalogEntries.reduce((latest, entry) => {
        const time = Date.parse(entry.updatedAt || "");
        return Number.isFinite(time) && time > latest ? time : latest;
      }, 0);
      return [{
        id,
        label,
        row,
        folder,
        listRoot,
        panelHost,
        actions: rowActions || null,
        sourceIndex,
        threadTitles,
        catalogEntries,
        duplicateThreadIds,
        searchText: [label, ...threadTitles, ...catalogTitles].join(" "),
        lastUsed: Math.max(folderLastUsed(folder), catalogLastUsed),
        active: Boolean(folder.querySelector('[aria-current="page"], [data-app-action-sidebar-thread-active="true"]')),
      }];
    });
    if (!items.length || items.some((item) => item.listRoot !== items[0].listRoot)) return null;
    return { listRoot: items[0].listRoot, items };
  }

  function requestCompleteNativeFolderList(sources) {
    const expandButton = Array.from(sources.listRoot.children)
      .map((child) => child.querySelector(":scope > button"))
      .find((button) => isShowMoreLabel(button?.textContent));
    if (!expandButton || expandButton.dataset.codexSidebarFolderListExpansionRequested === "true") return false;
    expandButton.dataset.codexSidebarFolderListExpansionRequested = "true";
    expandButton.click();
    scheduleSync();
    return true;
  }

  function normalizeFolderSearch(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function fuzzyFolderScore(value, query) {
    const text = normalizeFolderSearch(value);
    const needle = normalizeFolderSearch(query);
    if (!needle) return 0;
    if (!text) return Infinity;
    if (text === needle) return 0;
    if (text.startsWith(needle)) return 10 + text.length - needle.length;
    const includedAt = text.indexOf(needle);
    if (includedAt >= 0) return 30 + includedAt + (text.length - needle.length) / 100;
    let cursor = -1;
    let gaps = 0;
    for (const character of needle) {
      const next = text.indexOf(character, cursor + 1);
      if (next < 0) return Infinity;
      if (cursor >= 0) gaps += next - cursor - 1;
      cursor = next;
    }
    return 80 + gaps + (text.length - needle.length) / 100;
  }

  function rankedFolders(items, query = folderSearchQuery) {
    const needle = normalizeFolderSearch(query);
    return items
      .map((item) => ({ ...item, searchScore: needle ? fuzzyFolderScore(item.searchText, needle) : 0 }))
      .filter((item) => Number.isFinite(item.searchScore))
      .sort((left, right) => needle
        ? left.searchScore - right.searchScore || right.lastUsed - left.lastUsed || left.sourceIndex - right.sourceIndex
        : right.lastUsed - left.lastUsed || left.sourceIndex - right.sourceIndex);
  }

  function allProjectEntries() {
    return searchCatalog
      .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
      .map((entry, sourceIndex) => ({
        ...entry,
        sourceIndex,
        time: Date.parse(entry.updatedAt || ""),
      }))
      .sort((left, right) => (Number.isFinite(right.time) ? right.time : 0)
        - (Number.isFinite(left.time) ? left.time : 0)
        || left.sourceIndex - right.sourceIndex);
  }

  function normalizedThreadId(value) {
    return String(value || "").trim().replace(/^(?:local|cloud):/i, "").toLocaleLowerCase();
  }

  function normalizedThreadTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function isTemporaryThreadId(value) {
    return normalizedThreadId(value).startsWith("client-new-thread:");
  }

  function dedupeFolderCatalogEntries(sourceEntries) {
    const entries = [...sourceEntries]
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    const visible = [];
    const suppressedIds = new Set();
    const seenIds = new Set();
    for (const entry of entries) {
      const threadId = normalizedThreadId(entry.threadId);
      // Titles, contents and nearby timestamps are not conversation identities.
      // Duplicate records of one UUID collapse; distinct UUIDs always survive.
      if (threadId && seenIds.has(threadId)) continue;
      visible.push(entry);
      if (threadId) seenIds.add(threadId);
    }
    return { entries: visible, suppressedIds };
  }

  function catalogMatchesForFolder(item, query = folderSearchQuery) {
    const needle = normalizeFolderSearch(query);
    if (!needle) return [];
    return (item?.catalogEntries || [])
      .map((entry) => ({ ...entry, searchScore: fuzzyFolderScore(entry.title, needle) }))
      .filter((entry) => Number.isFinite(entry.searchScore))
      .sort((left, right) => left.searchScore - right.searchScore
        || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  }

  function revealFolderSearchMatch(item) {
    document.querySelectorAll(`${ROW_SELECTOR}[data-codex-sidebar-search-match="true"]`).forEach((row) => {
      row.removeAttribute("data-codex-sidebar-search-match");
    });
    if (!item || item.id !== activeFolderId || !normalizeFolderSearch(folderSearchQuery)) {
      folderSearchExpansionPending = null;
      folderSearchRevealKey = "";
      return;
    }
    if (item.virtual) return;
    const matches = catalogMatchesForFolder(item);
    if (!matches.length) return;
    const matchingIds = new Set(matches.map((entry) => normalizedThreadId(entry.threadId)));
    const matchingTitles = new Set(matches.map((entry) => entry.title));
    const rows = Array.from(item.panelHost.querySelectorAll(ROW_SELECTOR));
    const match = rows.find((row) => matchingIds.has(normalizedThreadId(
      row.getAttribute("data-app-action-sidebar-thread-id"),
    ))) || rows.find((row) => matchingTitles.has(
      row.getAttribute("data-app-action-sidebar-thread-title") || "",
    ));
    if (match) {
      folderSearchExpansionPending = null;
      match.dataset.codexSidebarSearchMatch = "true";
      const revealKey = `${normalizeFolderSearch(folderSearchQuery)}:${rowKey(match)}`;
      if (folderSearchRevealKey !== revealKey) {
        folderSearchRevealKey = revealKey;
        requestAnimationFrame(() => match.scrollIntoView({ block: "nearest" }));
      }
      return;
    }
    const expandButton = Array.from(item.folder.querySelectorAll("button"))
      .find((button) => isShowMoreLabel(button.textContent));
    if (!expandButton) return;
    if (folderSearchExpansionPending?.id === item.id
      && folderSearchExpansionPending?.rowCount === rows.length) return;
    folderSearchExpansionPending = { id: item.id, rowCount: rows.length };
    expandButton.click();
    scheduleSync();
  }

  function setNativeFolderExpanded(item) {
    if (item.row.getAttribute("aria-expanded") === "true") {
      folderTogglePending.delete(item.id);
      return;
    }
    const pending = folderTogglePending.get(item.id);
    // Empty native folders stay collapsed after a click. Remember the request
    // for this DOM node so mutation-driven syncs do not keep clicking it.
    if (pending?.row === item.row) return;
    folderTogglePending.set(item.id, { row: item.row, startedAt: Date.now() });
    item.row.click();
    scheduleSync();
  }

  function restoreFolderActions() {
    document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-native-action-proxies]`)?.remove();
  }

  function syncNativeActionProxies(host, resolveButtons, kind) {
    if (!host) return;
    const sources = Array.from(resolveButtons() || []);
    let group = host.querySelector("[data-codex-native-action-proxies]");
    if (!sources.length) { group?.remove(); return; }
    if (!group) {
      group = document.createElement("div");
      group.dataset.codexNativeActionProxies = kind;
      group.setAttribute(`data-codex-sidebar-${kind}-actions-source`, "proxy");
      host.appendChild(group);
    }
    const signature = JSON.stringify(sources.map((button) => [
      button.getAttribute("aria-label"), button.getAttribute("title"), button.disabled,
      button.querySelector("svg")?.outerHTML || button.textContent,
    ]));
    if (group.dataset.signature === signature) return;
    group.dataset.signature = signature;
    group.replaceChildren(...sources.map((source, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const label = source.getAttribute("aria-label") || source.title || source.textContent.trim() || "项目操作";
      button.setAttribute("aria-label", label);
      button.title = source.title || label;
      button.disabled = source.disabled;
      button.setAttribute(`data-codex-sidebar-${kind}-action-source`, label);
      const icon = source.querySelector("svg")?.cloneNode(true);
      if (icon) button.appendChild(icon);
      else button.textContent = source.textContent || "…";
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = Array.from(resolveButtons() || []);
        const target = current.find((candidate) => (candidate.getAttribute("aria-label") || candidate.title
          || candidate.textContent.trim() || "项目操作") === label) || current[index];
        if (!target?.isConnected || target.disabled) { scheduleSync(); return; }
        target.click();
        // Native menu triggers are intentionally still in their hidden React
        // heading. Move only the portal presentation to the visible proxy.
        if (target.getAttribute("aria-haspopup") === "menu") requestAnimationFrame(() => {
          const menu = document.getElementById(target.getAttribute("aria-controls") || "");
          const wrapper = menu?.closest("[data-radix-popper-content-wrapper]");
          if (!wrapper || !button.isConnected) return;
          const rect = button.getBoundingClientRect();
          const { width, height } = wrapper.getBoundingClientRect();
          const top = rect.bottom + height + 12 <= innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
          wrapper.style.transform = `translate(${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px, ${top}px)`;
        });
        scheduleSync();
      };
      return button;
    }));
  }

  function nativeFolderCreateButton(item) {
    if (!item?.actions) return null;
    return Array.from(item.actions.querySelectorAll("button")).find((button) =>
      isFolderCreateLabel(button.getAttribute("aria-label"), item.label),
    ) || null;
  }

  function syncCurrentFolderNewChatButton(item) {
    const button = document.querySelector(`#${SECTION_TABS_ID} [data-codex-sidebar-current-folder-new-chat]`);
    if (!button) return;
    const source = !item?.virtual && item?.id === activeFolderId
      ? nativeFolderCreateButton(item)
      : null;
    if (!source?.isConnected) {
      button.hidden = true;
      button.dataset.codexSidebarCurrentFolderNewChat = "";
      button.setAttribute("aria-label", "在当前文件夹中新建对话");
      button.title = "在当前文件夹中新建对话";
      return;
    }
    button.hidden = false;
    button.dataset.codexSidebarCurrentFolderNewChat = item.id;
    button.setAttribute("aria-label", `在“${item.label}”中新建对话`);
    button.title = `在“${item.label}”中新建对话`;
  }

  function handleCurrentFolderNewChat(event) {
    event.preventDefault();
    event.stopPropagation();
    const item = folderSources.get(activeFolderId);
    const source = nativeFolderCreateButton(item);
    if (!source?.isConnected) {
      syncCurrentFolderNewChatButton(null);
      scheduleSync();
      return;
    }
    source.click();
  }

  function moveActiveFolderActions(item) {
    const root = document.getElementById(FOLDER_SWITCHER_ID);
    const host = root?.querySelector("[data-codex-sidebar-folder-actions]");
    if (!host) return;
    if (!item?.actions) {
      restoreFolderActions();
      host.hidden = true;
      return;
    }
    syncNativeActionProxies(host, () => nativeFolderSources()?.items.find((candidate) => candidate.id === activeFolderId)
      ?.actions?.querySelectorAll("button") || [], "folder");
    host.hidden = false;
    syncCurrentFolderNewChatButton(item);
  }

  function conversationRoute(rawThreadId) {
    const threadId = String(rawThreadId || "").trim().replace(/^(?:local|cloud):/i, "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)
      ? `/local/${threadId}`
      : null;
  }

  function openAllProject(entry) {
    const route = conversationRoute(entry?.threadId);
    if (route) window.postMessage({ type: "navigate-to-route", path: route }, "*");
  }

  function createCatalogThreadRow(entry, kind = "all") {
    const sourceRow = document.querySelector(`${ROW_SELECTOR}:not([data-codex-sidebar-all-project-row]):not([data-codex-sidebar-pinned-project-row])`);
    const sourceItem = sourceRow?.closest('[role="listitem"]');
    const sourceTitleHost = sourceRow?.querySelector('[data-thread-title-trigger="true"]');
    const sourceTitle = sourceRow?.querySelector('[data-thread-title="true"]');
    const item = document.createElement("div");
    item.setAttribute("role", "listitem");
    item.className = sourceItem?.className || "after:block after:h-px after:content-[''] last:after:hidden";
    const row = document.createElement("div");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.className = sourceRow?.className
      || "group relative cursor-interaction text-sm hover:bg-token-list-hover-background focus-visible:outline-offset-[-2px] sidebar-item";
    row.dataset.appActionSidebarThreadRow = "";
    row.dataset.appActionSidebarThreadId = `local:${entry.threadId}`;
    row.dataset.appActionSidebarThreadTitle = entry.title;
    if (kind === "pinned") {
      row.dataset.codexSidebarPinnedProjectRow = "true";
      row.dataset.codexSidebarPinnedAt = String(entry.pinnedAt || 0);
    } else if (kind === "recent") {
      row.dataset.codexSidebarRecentRow = "true";
      row.dataset.codexSidebarRecentUpdatedAt = entry.updatedAt || "";
    } else if (kind === "interrupted") {
      row.dataset.codexSidebarInterruptedRow = "true";
      row.dataset.codexSidebarInterruptedKind = entry.interruptionKind || "passive";
      row.dataset.codexSidebarInterruptedUpdatedAt = entry.updatedAt || "";
    } else if (kind === "folder") {
      row.dataset.codexSidebarFolderCatalogRow = "true";
      row.dataset.codexSidebarFolderCatalogUpdatedAt = entry.updatedAt || "";
    } else {
      row.dataset.codexSidebarAllProjectRow = "true";
      row.dataset.codexSidebarAllProjectId = entry.projectId;
      row.dataset.codexSidebarAllProjectUpdatedAt = entry.updatedAt || "";
    }
    row.setAttribute("aria-label", entry.projectName ? `${entry.title}，${entry.projectName}` : entry.title);
    row.onclick = () => openAllProject(entry);
    row.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openAllProject(entry);
    };
    const titleHost = document.createElement("div");
    titleHost.dataset.threadTitleTrigger = "true";
    titleHost.className = sourceTitleHost?.className || "flex min-w-0 flex-1 items-center";
    const title = document.createElement("span");
    title.dataset.threadTitle = "true";
    title.className = sourceTitle?.className || "min-w-0 truncate";
    title.textContent = entry.title;
    titleHost.appendChild(title);
    row.appendChild(titleHost);
    item.appendChild(row);
    return item;
  }

  function reconcileNativeFolderCatalog(item) {
    if (!item?.folder || !item?.catalogEntries?.length) return;
    const projectList = item.folder.querySelector(
      `[data-app-action-sidebar-project-list-id="${CSS.escape(item.id)}"]`,
    );
    const list = projectList?.querySelector('[role="list"]');
    if (!list) return;

    const currentItems = Array.from(list.children).filter((child) => child.getAttribute("role") === "listitem");
    const nativeById = new Map();
    const generatedById = new Map();
    const nativeRows = [];
    const nativeControlItems = [];
    const duplicateThreadIds = item.duplicateThreadIds instanceof Set
      ? item.duplicateThreadIds
      : new Set(item.duplicateThreadIds || []);
    for (const listItem of currentItems) {
      const row = listItem.querySelector(ROW_SELECTOR);
      if (!row) {
        nativeControlItems.push(listItem);
        continue;
      }
      const threadId = normalizedThreadId(row?.getAttribute("data-app-action-sidebar-thread-id"));
      if (!threadId) continue;
      if (row.dataset.codexSidebarFolderCatalogRow === "true") generatedById.set(threadId, listItem);
      else {
        nativeById.set(threadId, listItem);
        nativeRows.push({
          listItem,
          row,
          threadId,
          title: normalizedThreadTitle(row.getAttribute("data-app-action-sidebar-thread-title")),
        });
      }
    }

    // A temporary-to-permanent handoff must be explicitly supplied by the host.
    // Even temporary titles are not enough to identify a persisted conversation.
    const catalogEntriesByClientId = new Map();
    for (const entry of item.catalogEntries) {
      const clientId = normalizedThreadId(entry.clientThreadId || entry.temporaryThreadId);
      if (isTemporaryThreadId(clientId)) catalogEntriesByClientId.set(clientId, entry);
    }
    const temporaryNativeCatalogId = new Map();
    const nativeAliasByCatalogId = new Map();
    const claimedCatalogIds = new Set();
    for (const native of nativeRows) {
      if (!isTemporaryThreadId(native.threadId)) continue;
      const candidate = catalogEntriesByClientId.get(native.threadId);
      const catalogId = normalizedThreadId(candidate?.threadId);
      if (!catalogId || claimedCatalogIds.has(catalogId)) continue;
      claimedCatalogIds.add(catalogId);
      temporaryNativeCatalogId.set(native.threadId, catalogId);
      if (!nativeById.has(catalogId)) nativeAliasByCatalogId.set(catalogId, native.listItem);
    }

    const catalogById = new Map();
    const desired = item.catalogEntries.flatMap((entry, sourceIndex) => {
      const threadId = normalizedThreadId(entry.threadId);
      if (!threadId || pinnedThreadIds.has(threadId) || catalogById.has(threadId)) return [];
      catalogById.set(threadId, entry);
      const listItem = nativeById.get(threadId)
        || nativeAliasByCatalogId.get(threadId)
        || generatedById.get(threadId)
        || createCatalogThreadRow(entry, "folder");
      const row = listItem.querySelector(ROW_SELECTOR);
      if (row) row.dataset.codexSidebarFolderCatalogUpdatedAt = entry.updatedAt || "";
      const time = Date.parse(entry.updatedAt || "");
      return [{ listItem, time: Number.isFinite(time) ? time : 0, sourceIndex }];
    });

    for (const [threadId, listItem] of nativeById) {
      if (catalogById.has(threadId)
        || temporaryNativeCatalogId.has(threadId)
        || duplicateThreadIds.has(threadId)) continue;
      const row = listItem.querySelector(ROW_SELECTOR);
      const previewTime = Date.parse(previewForRow(row)?.updatedAt || "");
      desired.push({
        listItem,
        time: Number.isFinite(previewTime) ? previewTime : 0,
        sourceIndex: desired.length,
      });
    }
    desired.sort((left, right) => right.time - left.time || left.sourceIndex - right.sourceIndex);

    // Never move or remove Codex-owned list items. React replaces the temporary
    // new-thread row while the first message is being sent; mutating that native
    // child list can make React remove a node that no longer exists and abort the
    // send. CSS order keeps the visual activity sort without changing ownership.
    list.dataset.codexSidebarFolderCatalogList = "true";
    const desiredItems = new Set();
    desired.forEach(({ listItem }, index) => {
      desiredItems.add(listItem);
      listItem.style.order = String(index);
      if (!listItem.isConnected) list.appendChild(listItem);
    });

    for (const native of nativeRows) {
      const catalogId = temporaryNativeCatalogId.get(native.threadId);
      const aliasIsVisible = catalogId && nativeAliasByCatalogId.get(catalogId) === native.listItem;
      native.listItem.toggleAttribute("data-codex-sidebar-native-alias-hidden", Boolean(catalogId && !aliasIsVisible));
      native.listItem.toggleAttribute(
        "data-codex-sidebar-semantic-duplicate-hidden",
        duplicateThreadIds.has(native.threadId),
      );
    }

    nativeControlItems.forEach((control, index) => {
      control.dataset.codexSidebarFolderControlItem = "true";
      control.style.order = String(desired.length + index);
    });

    for (const listItem of currentItems) {
      const row = listItem.querySelector(ROW_SELECTOR);
      if (row?.dataset.codexSidebarFolderCatalogRow !== "true" || desiredItems.has(listItem)) continue;
      listItem.remove();
    }
  }

  function createAllProjectRow(entry) {
    return createCatalogThreadRow(entry, "all");
  }

  function ensureAllProjectsPanel(root, entries) {
    let panel = document.getElementById(ALL_PROJECTS_PANEL_ID);
    if (panel?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN || panel?.parentElement !== root.parentElement) {
      panel?.remove();
      panel = document.createElement("section");
      panel.id = ALL_PROJECTS_PANEL_ID;
      panel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${ALL_FOLDER_ID}`);
      root.parentElement.insertBefore(panel, root.nextElementSibling);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      const list = document.createElement("div");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "全部项目，按最近请求排序");
      list.dataset.codexSidebarAllProjectList = "true";
      list.className = "flex flex-col";
      list.replaceChildren(...entries.map(createAllProjectRow));
      panel.replaceChildren(list);
    }
    return panel;
  }

  function ensureVirtualFolderPanel(root, item, entries) {
    let panel = root.parentElement.querySelector(`[data-codex-sidebar-virtual-folder-panel="${CSS.escape(item.id)}"]`);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = `codex-sidebar-folder-panel-${item.id}`;
      panel.dataset.codexSidebarVirtualFolderPanel = item.id;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${item.id}`);
      root.parentElement.appendChild(panel);
    }
    const signature = entries.map((entry) => `${entry.threadId}:${entry.updatedAt || ""}:${entry.title}`).join("\n");
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      const list = document.createElement("div");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", `${item.label} 的项目`);
      list.className = "flex flex-col";
      list.replaceChildren(...entries.map(createAllProjectRow));
      panel.replaceChildren(list);
    }
    return panel;
  }

  function selectFolder(id, { focus = false, persist = !normalizeFolderSearch(folderSearchQuery) } = {}) {
    if (id !== ALL_FOLDER_ID && !folderSources.has(id)) return;
    activeFolderId = id;
    if (persist) {
      try { localStorage.setItem(FOLDER_STORAGE_KEY, id); } catch {}
    }
    updateFolderSwitcherState(Array.from(folderSources.values()));
    const tag = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag="${CSS.escape(id)}"]`);
    if (focus) tag?.focus();
    scheduleSync();
  }

  function handleFolderTagKeydown(event) {
    const tags = Array.from(document.querySelectorAll(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]`));
    const index = tags.indexOf(event.currentTarget);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = tags[(index + 1) % tags.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = tags[(index - 1 + tags.length) % tags.length];
    else if (event.key === "Home") next = tags[0];
    else if (event.key === "End") next = tags.at(-1);
    if (!next) return;
    event.preventDefault();
    selectFolder(next.dataset.codexSidebarFolderTag, { focus: true });
  }

  function createFolderTag(item) {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.id = `codex-sidebar-folder-tag-${item.id}`;
    tag.dataset.codexSidebarFolderTag = item.id;
    tag.dataset.codexSidebarFolderId = item.id;
    tag.dataset.codexSidebarFolderLabel = item.label;
    tag.dataset.codexSidebarFolderLastUsed = String(item.lastUsed || 0);
    tag.setAttribute("aria-controls", item.id === ALL_FOLDER_ID
      ? ALL_PROJECTS_PANEL_ID
      : `codex-sidebar-folder-panel-${item.id}`);
    tag.setAttribute("aria-label", item.id === ALL_FOLDER_ID ? "显示全部项目" : `显示文件夹 ${item.label}`);
    tag.title = item.label;
    tag.textContent = item.label;
    tag.onclick = () => selectFolder(item.id);
    tag.onkeydown = handleFolderTagKeydown;
    return tag;
  }

  function clearFolderSearch() {
    const input = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-search]`);
    if (input) input.value = "";
    folderSearchQuery = "";
    folderSearchExpansionPending = null;
    folderSearchRevealKey = "";
    if (folderPreSearchId === ALL_FOLDER_ID || (folderPreSearchId && folderSources.has(folderPreSearchId))) {
      activeFolderId = folderPreSearchId;
    }
    folderPreSearchId = null;
    updateFolderSwitcherState(Array.from(folderSources.values()));
  }

  function handleFolderSearchInput(event) {
    const nextQuery = event.currentTarget.value;
    if (!normalizeFolderSearch(folderSearchQuery) && normalizeFolderSearch(nextQuery)) folderPreSearchId = activeFolderId;
    folderSearchQuery = nextQuery;
    const items = Array.from(folderSources.values());
    const results = rankedFolders(items, folderSearchQuery);
    activeFolderId = results[0]?.id || null;
    updateFolderSwitcherState(items);
  }

  function createFolderSwitcher() {
    const root = document.createElement("div");
    root.id = FOLDER_SWITCHER_ID;
    root.dataset.codexPreviewRuntime = RUNTIME_TOKEN;

    const searchRow = document.createElement("div");
    searchRow.className = "codex-sidebar-folder-search-row";
    const searchShell = document.createElement("div");
    searchShell.className = "codex-sidebar-folder-search-shell";
    const searchIcon = document.createElement("span");
    searchIcon.className = "codex-sidebar-folder-search-icon";
    searchIcon.setAttribute("aria-hidden", "true");
    searchIcon.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    const input = document.createElement("input");
    input.type = "search";
    input.value = folderSearchQuery;
    input.placeholder = "搜索文件夹或项目";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.codexSidebarFolderSearch = "true";
    input.setAttribute("aria-label", "搜索文件夹或项目");
    input.setAttribute("aria-controls", "codex-sidebar-folder-tags");
    input.oninput = handleFolderSearchInput;
    input.onkeydown = (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        clearFolderSearch();
      } else if (event.key === "ArrowDown") {
        const first = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag]`);
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const clear = document.createElement("button");
    clear.type = "button";
    clear.dataset.codexSidebarFolderClear = "true";
    clear.setAttribute("aria-label", "清除项目搜索");
    clear.title = "清除搜索";
    clear.textContent = "×";
    clear.onclick = clearFolderSearch;
    searchShell.append(searchIcon, input, clear);
    const actions = document.createElement("div");
    actions.dataset.codexSidebarFolderActions = "true";
    actions.setAttribute("aria-label", "当前文件夹操作");
    searchRow.append(searchShell, actions);

    const tags = document.createElement("div");
    tags.id = "codex-sidebar-folder-tags";
    tags.dataset.codexSidebarFolderTags = "true";
    tags.setAttribute("role", "group");
    tags.setAttribute("aria-label", "项目文件夹标签");

    const meta = document.createElement("div");
    meta.className = "codex-sidebar-folder-meta";
    const result = document.createElement("span");
    result.dataset.codexSidebarFolderResult = "true";
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    const expand = document.createElement("button");
    expand.type = "button";
    expand.dataset.codexSidebarFolderExpand = "true";
    expand.setAttribute("aria-controls", tags.id);
    expand.onclick = () => {
      folderTagsExpanded = !folderTagsExpanded;
      updateFolderSwitcherState(Array.from(folderSources.values()));
    };
    expand.innerHTML = '<span>展开全部</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    meta.append(result, expand);
    root.append(searchRow, tags, meta);
    return root;
  }

  function updateFolderSwitcherState(items) {
    const root = document.getElementById(FOLDER_SWITCHER_ID);
    if (!root) return;
    const ranked = rankedFolders(items);
    const searching = Boolean(normalizeFolderSearch(folderSearchQuery));
    if (!searching && activeFolderId !== ALL_FOLDER_ID && !items.some((item) => item.id === activeFolderId)) {
      activeFolderId = items.find((item) => item.active)?.id || ranked[0]?.id || null;
    } else if (searching && !ranked.some((item) => item.id === activeFolderId)) {
      activeFolderId = ranked[0]?.id || null;
    }
    const allSelected = !searching && activeFolderId === ALL_FOLDER_ID;

    for (const item of items) {
      const selected = item.id === activeFolderId;
      if (item.virtual) {
        const entries = searching ? catalogMatchesForFolder(item) : item.catalogEntries;
        const panel = ensureVirtualFolderPanel(root, item, entries);
        panel.hidden = allSelected || !selected;
        continue;
      }
      item.panelHost.hidden = allSelected || !selected;
      item.panelHost.dataset.codexSidebarFolderPanel = item.label;
      item.panelHost.dataset.codexSidebarFolderPanelId = item.id;
      item.folder.id = `codex-sidebar-folder-panel-${item.id}`;
      item.folder.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${item.id}`);
      item.row.dataset.codexSidebarFolderHeadingHidden = "true";
      for (const row of item.folder.querySelectorAll(ROW_SELECTOR)) {
        const pinned = pinnedThreadIds.has(normalizedThreadId(
          row.getAttribute("data-app-action-sidebar-thread-id"),
        ));
        const listItem = row.closest('[role="listitem"]') || row;
        if (pinned) listItem.dataset.codexSidebarPinnedOutsideHidden = "true";
        else listItem.removeAttribute("data-codex-sidebar-pinned-outside-hidden");
      }
      // Request every native folder behind the single visible panel. Non-empty
      // folders mount their threads, while empty folders safely remain closed.
      // This completes recent-use sorting and project-title search even when
      // Codex originally rendered a populated folder in its collapsed state.
      setNativeFolderExpanded(item);
      if (selected) reconcileNativeFolderCatalog(item);
    }

    const entries = allProjectEntries();
    if (allSelected) ensureAllProjectsPanel(root, entries);
    else document.getElementById(ALL_PROJECTS_PANEL_ID)?.remove();

    const tags = root.querySelector("[data-codex-sidebar-folder-tags]");
    const tagItems = searching
      ? ranked
      : [{ id: ALL_FOLDER_ID, label: "全部", lastUsed: entries[0]?.time || 0 }, ...ranked];
    const signature = tagItems.map((item) => `${item.id}:${item.lastUsed}`).join("\n");
    if (tags.dataset.signature !== signature) {
      tags.dataset.signature = signature;
      tags.replaceChildren(...tagItems.map(createFolderTag));
    }
    tags.dataset.expanded = String(folderTagsExpanded);
    for (const tag of tags.querySelectorAll("[data-codex-sidebar-folder-tag]")) {
      const selected = tag.dataset.codexSidebarFolderTag === activeFolderId;
      tag.setAttribute("aria-pressed", String(selected));
      tag.tabIndex = selected ? 0 : -1;
    }

    const input = root.querySelector("[data-codex-sidebar-folder-search]");
    if (input.value !== folderSearchQuery) input.value = folderSearchQuery;
    const clear = root.querySelector("[data-codex-sidebar-folder-clear]");
    clear.hidden = !folderSearchQuery;
    const result = root.querySelector("[data-codex-sidebar-folder-result]");
    const matchingConversationCount = ranked.reduce(
      (count, item) => count + catalogMatchesForFolder(item).length,
      0,
    );
    setTextIfChanged(result, allSelected
      ? `全部 ${entries.length} 个对话 · 最近请求优先`
      : !ranked.length
      ? "没有匹配的项目"
      : searching
        ? `找到 ${ranked.length} 个项目 · ${matchingConversationCount} 个对话`
        : `${ranked.length} 个文件夹 · 最近使用优先`);
    const expand = root.querySelector("[data-codex-sidebar-folder-expand]");
    expand.hidden = tagItems.length <= 6;
    expand.setAttribute("aria-expanded", String(folderTagsExpanded));
    setTextIfChanged(expand.querySelector("span"), folderTagsExpanded ? "收起" : "展开全部");
    const activeItem = allSelected ? null : items.find((item) => item.id === activeFolderId);
    moveActiveFolderActions(activeItem);
    syncCurrentFolderNewChatButton(activeItem);
    revealFolderSearchMatch(activeItem);
  }

  function clearFolderEnhancement() {
    restoreFolderActions();
    syncCurrentFolderNewChatButton(null);
    document.getElementById(FOLDER_SWITCHER_ID)?.remove();
    document.getElementById(ALL_PROJECTS_PANEL_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-virtual-folder-panel]").forEach((panel) => panel.remove());
    document.querySelectorAll('[data-codex-sidebar-pinned-outside-hidden="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-pinned-outside-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-folder-heading-hidden]").forEach((row) => {
      row.removeAttribute("data-codex-sidebar-folder-heading-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-folder-panel]").forEach((panel) => {
      panel.hidden = false;
      panel.removeAttribute("data-codex-sidebar-folder-panel");
      panel.removeAttribute("data-codex-sidebar-folder-panel-id");
    });
    for (const item of folderSources.values()) {
      item.folder?.removeAttribute("id");
      item.folder?.removeAttribute("aria-labelledby");
    }
    folderSources = new Map();
    folderTogglePending = new Map();
    folderSourcesMissingSince = 0;
  }

  function ensureFolderSwitcher() {
    const project = sectionSources.get("项目");
    const nativeSources = nativeFolderSources();
    if (nativeSources && requestCompleteNativeFolderList(nativeSources)) return;
    const nativeIds = new Set(nativeSources?.items.map((item) => item.id) || []);
    const virtualItems = virtualFolderSourceItems(nativeIds, nativeSources?.items.length || 0);
    const sources = nativeSources
      ? {
          listRoot: nativeSources.listRoot,
          items: [...nativeSources.items, ...virtualItems],
          sourceMode: virtualItems.length ? "hybrid" : "native",
        }
      : virtualItems.length
        ? { listRoot: project?.section, items: virtualItems, sourceMode: "virtual" }
        : null;
    const host = project?.virtual ? project.section : project?.heading?.parentElement;
    if (!project || !sources || !host) {
      if (document.getElementById(FOLDER_SWITCHER_ID)) {
        folderSourcesMissingSince ||= Date.now();
        if (Date.now() - folderSourcesMissingSince < NATIVE_ANCHOR_GRACE_MS) {
          scheduleAnchorRetry();
          return;
        }
        clearFolderEnhancement();
      }
      return;
    }
    folderSourcesMissingSince = 0;
    let root = document.getElementById(FOLDER_SWITCHER_ID);
    const signature = sources.items.map((item) => item.id).join("\n");
    const needsRebuild = root?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || root?.parentElement !== host
      || root?.dataset.sourceIds !== signature
      || root?.dataset.sourceMode !== sources.sourceMode
      || sources.items.some((item) => item.virtual
        ? !folderSources.get(item.id)?.virtual
        : folderSources.get(item.id)?.row !== item.row);
    if (needsRebuild) {
      clearFolderEnhancement();
      root = createFolderSwitcher();
      root.dataset.sourceIds = signature;
      root.dataset.sourceMode = sources.sourceMode;
      if (project.virtual) host.insertBefore(root, host.firstChild);
      else host.insertBefore(root, project.heading.nextElementSibling);
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
      if (!activeFolderId || (activeFolderId !== ALL_FOLDER_ID && !folderSources.has(activeFolderId))) {
        activeFolderId = sources.sourceMode === "virtual"
          ? ALL_FOLDER_ID
          : sources.items.find((item) => item.active)?.id || rankedFolders(sources.items, "")[0]?.id || null;
      }
    } else {
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
    }
    updateFolderSwitcherState(sources.items);
  }

  function updateUsageState() {
    const status = document.getElementById(USAGE_ID);
    if (!status) return;
    const parts = String(usage.text || "剩余量 --").trim().match(/^(.*)\s+(\S+)$/u);
    const label = parts?.[1] || "剩余量";
    const value = parts?.[2] || "--";
    const remaining = Number(usage.remainingPercent);
    const available = usage.available === true && Number.isFinite(remaining);
    const normalizedRemaining = available ? Math.min(100, Math.max(0, Math.round(remaining))) : null;
    setTextIfChanged(status.querySelector(`.${USAGE_TEXT_CLASS}`), label);
    setTextIfChanged(status.querySelector(`.${USAGE_VALUE_CLASS}`), value);
    status.querySelector(`.${USAGE_FILL_CLASS}`).style.width = `${normalizedRemaining ?? 0}%`;
    status.dataset.tone = ["normal", "warning", "critical", "muted"].includes(usage.tone) ? usage.tone : "muted";
    status.dataset.remainingPercent = normalizedRemaining == null ? "" : String(normalizedRemaining);
    status.setAttribute("aria-label", usage.ariaLabel || "Codex 剩余量暂不可用");
    status.title = usage.ariaLabel || "Codex 剩余量暂不可用";
  }

  function ensureUsageStatus(host, switchButton) {
    let status = document.getElementById(USAGE_ID);
    if (status?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      status?.remove();
      status = null;
    }
    if (!status) {
      status = document.createElement("div");
      status.id = USAGE_ID;
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      status.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      const label = document.createElement("span");
      label.className = USAGE_TEXT_CLASS;
      const value = document.createElement("strong");
      value.className = USAGE_VALUE_CLASS;
      const track = document.createElement("span");
      track.className = "codex-conversation-usage-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = USAGE_FILL_CLASS;
      track.appendChild(fill);
      status.append(label, value, track);
    }
    if (status.parentElement !== host || status.nextElementSibling !== switchButton) host.insertBefore(status, switchButton);
    updateUsageState();
  }

  function protectHeaderControlsFromDrag(host) {
    if (!host.hasAttribute("data-codex-sidebar-header-controls")) {
      host.setAttribute("data-codex-sidebar-header-controls", "true");
      host.dataset.codexSidebarHeaderControlsAppRegion = host.style.getPropertyValue("-webkit-app-region");
    }
    host.style.webkitAppRegion = "no-drag";
  }

  function ensureViewToggle() {
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!search) return;
    const searchSlot = search.parentElement;
    const host = searchSlot?.parentElement;
    if (!host) return;
    protectHeaderControlsFromDrag(host);
    let button = document.getElementById(TOGGLE_ID);
    if (button?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      button?.remove();
      button = null;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = TOGGLE_ID;
      button.type = "button";
      button.className = `${search.className} codex-conversation-view-switch`;
      button.setAttribute("role", "switch");
      button.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
    }
    button.onpointerdown = handleViewTogglePointerDown;
    button.onclick = handleViewToggleClick;
    const settingsButton = document.getElementById(SHORTCUT_SETTINGS_BUTTON_ID);
    const before = settingsButton?.parentElement === host ? settingsButton : searchSlot;
    if (button.parentElement !== host || button.nextElementSibling !== before) host.insertBefore(button, before);
    ensureUsageStatus(host, button);
    updateViewState();
  }

  function ensureShortcutSettingsButton() {
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!search) return;
    const searchSlot = search.parentElement;
    const host = searchSlot?.parentElement;
    if (!host) return;
    protectHeaderControlsFromDrag(host);
    let button = document.getElementById(SHORTCUT_SETTINGS_BUTTON_ID);
    if (button?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN) {
      button?.remove();
      button = null;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = SHORTCUT_SETTINGS_BUTTON_ID;
      button.type = "button";
      button.className = search.className;
      button.dataset.codexSidebarShortcutSettings = "true";
      button.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      button.setAttribute("aria-label", "管理快捷入口");
      button.title = "AIYOUcodex 快捷入口设置";
      button.innerHTML = settingsShortcutSvg();
    }
    button.onpointerdown = handleShortcutSettingsPointerDown;
    button.onclick = handleShortcutSettingsClick;
    if (button.parentElement !== host || button.nextElementSibling !== searchSlot) host.insertBefore(button, searchSlot);
  }

  function handleShortcutSettingsPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    openShortcutSettings();
  }

  function handleShortcutSettingsClick(event) {
    if (event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openShortcutSettings();
  }

  function handleNativeActivityClick(event) {
    const button = event.target?.closest?.("button[aria-label]");
    const label = normalizedNativeLabel(button?.getAttribute("aria-label"));
    if (!/^(?:查看活动|关闭活动视图|view activity|close activity view|通知|notifications?)(?:[，,\s]|$)/iu.test(label)) return;
    window.setTimeout(() => {
      if (destroyed) return;
      if (nativeActivityViewOpen() && sectionEnhancementMounted()) clearSectionEnhancement();
      scheduleSync();
    }, 0);
  }

  function openRow() {
    const rows = visibleRows();
    return (hoveredPreviewRow?.isConnected && rows.includes(hoveredPreviewRow) ? hoveredPreviewRow : null)
      || rows.find((row) => row.matches(":hover"))
      || rows.find((row) => ["open", "delayed-open"].includes(row.getAttribute("data-state")));
  }

  function handlePreviewPointerOver(event) {
    const row = event.target?.closest?.(ROW_SELECTOR);
    if (!row) return;
    hoveredPreviewRow = row;
    scheduleSync();
  }

  function handlePreviewPointerOut(event) {
    const row = event.target?.closest?.(ROW_SELECTOR);
    if (!row || row !== hoveredPreviewRow || row.contains(event.relatedTarget)) return;
    hoveredPreviewRow = null;
    document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
  }

  function appendBlock(container, label, value) {
    const block = document.createElement("div");
    block.className = "codex-conversation-preview-block";
    const labelNode = document.createElement("div");
    labelNode.className = "codex-conversation-preview-label";
    labelNode.textContent = label;
    const textNode = document.createElement("div");
    textNode.className = "codex-conversation-preview-text";
    textNode.textContent = value || "暂无";
    textNode.title = value || "暂无";
    block.append(labelNode, textNode);
    container.appendChild(block);
  }

  function enhanceTooltip() {
    const row = openRow();
    if (!row) {
      document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
      return;
    }
    const preview = previewForRow(row);
    if (!preview) return;
    const title = row.getAttribute("data-app-action-sidebar-thread-title") || "";
    const tooltip = Array.from(document.querySelectorAll('[role="tooltip"]')).find((candidate) =>
      candidate.id !== FALLBACK_TOOLTIP_ID
        && Array.from(candidate.querySelectorAll("button")).some((button) => button.textContent.trim() === title),
    );
    if (tooltip) {
      document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
      if (tooltip.querySelector(`.${DETAILS_CLASS}`)) return;
      const titleButton = Array.from(tooltip.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === title);
      let card = titleButton?.parentElement;
      while (card && card !== tooltip && !card.classList.contains("w-fit")) card = card.parentElement;
      if (!card || card === tooltip) card = tooltip;
      tooltip.setAttribute("data-codex-conversation-preview-tooltip", "true");
      const details = document.createElement("div");
      details.className = DETAILS_CLASS;
      appendBlock(details, "核心总结", preview.summary);
      appendBlock(details, "最近输入", preview.recentInput);
      appendBlock(details, "最近输出", preview.recentOutput);
      card.appendChild(details);
      return;
    }

    let fallback = document.getElementById(FALLBACK_TOOLTIP_ID);
    if (!fallback) {
      fallback = document.createElement("div");
      fallback.id = FALLBACK_TOOLTIP_ID;
      fallback.setAttribute("role", "tooltip");
      fallback.setAttribute("data-codex-conversation-preview-tooltip", "true");
      document.body.appendChild(fallback);
    }
    const signature = `${rowKey(row)}\n${preview.summary}\n${preview.recentInput}\n${preview.recentOutput}`;
    if (fallback.dataset.signature !== signature) {
      fallback.dataset.signature = signature;
      fallback.replaceChildren();
      const titleNode = document.createElement("div");
      titleNode.className = "codex-conversation-preview-tooltip-title";
      titleNode.textContent = title || "未命名对话";
      const details = document.createElement("div");
      details.className = DETAILS_CLASS;
      appendBlock(details, "核心总结", preview.summary);
      appendBlock(details, "最近输入", preview.recentInput);
      appendBlock(details, "最近输出", preview.recentOutput);
      fallback.append(titleNode, details);
    }
    const rect = row.getBoundingClientRect();
    const fallbackRect = fallback.getBoundingClientRect();
    const left = Math.min(rect.right + 8, Math.max(8, innerWidth - fallbackRect.width - 8));
    const top = Math.min(Math.max(8, rect.top), Math.max(8, innerHeight - fallbackRect.height - 8));
    fallback.style.left = `${left}px`;
    fallback.style.top = `${top}px`;
  }

  function syncFeature(name, render) {
    try { render(); delete componentErrors[name]; }
    catch (error) { componentErrors[name] = { code: "component-render-failed", at: Date.now() }; }
  }

  function setTextIfChanged(node, value) {
    const text = String(value ?? "");
    if (node && node.textContent !== text) node.textContent = text;
  }

  function sync() {
    if (destroyed || syncing) return;
    syncing = true;
    // React still owns the native subtrees. Ignore only our synchronous render
    // mutations, then immediately resume observing native asynchronous updates.
    // Native expansion requests explicitly schedule their follow-up pass.
    observer?.disconnect();
    try { renderFeatures(); lastSyncAt = Date.now(); syncCount += 1; }
    finally { syncing = false; observeHost(); }
  }

  function renderFeatures() {
    if (destroyed) return;
    syncFeature("panels", () => { restoreAssetConsoleOpenIntent(); restoreDetachedAssetConsolePanel(); restoreEfficiencyPanelMount(); });
    syncFeature("shortcuts", ensureShortcutGrid);
    syncFeature("skills", () => { ensureSkillOrganizer(); resumeSkillsGroupingOpenRequest(); });
    syncFeature("header", () => { ensureViewToggle(); ensureShortcutSettingsButton(); ensureTaskContextButton(); });
    if (nativeActivityViewOpen()) {
      if (sectionEnhancementMounted()) clearSectionEnhancement();
      syncFeature("history", ensureRecoveredConversationHistory);
      document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
      return;
    }
    syncFeature("sections", ensureSectionTabs);
    syncFeature("folders", ensureFolderSwitcher);
    syncFeature("history", ensureRecoveredConversationHistory);
    const rows = visibleRows();
    const anchor = !layoutAnchored
      ? rows.find((row) => row.getAttribute("aria-current") === "page")
        || rows.find((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
        || rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })
      : null;
    syncFeature("cards", () => {
      for (const row of rows) applySummary(row, previewForRow(row));
      ensureVirtualPinnedRows();
      ensureGlobalRecentRows();
      ensureInterruptedRows();
      sortNativePinnedRows();
    });
    if (anchor) {
      anchor.scrollIntoView({ block: viewMode === "card" ? "center" : "nearest" });
      layoutAnchored = true;
    }
    syncFeature("tooltip", enhanceTooltip);
  }

  function setPreviews(items) {
    for (const preview of Array.isArray(items) ? items : []) {
      if (preview?.key) previews.set(preview.key, preview);
    }
    scheduleSync();
  }

  function setSearchCatalog(items) {
    searchCatalog = (Array.isArray(items) ? items : []).filter((entry) =>
      entry && typeof entry.projectId === "string" && typeof entry.title === "string",
    );
    searchCatalogByProject = new Map();
    searchCatalogByThread = new Map();
    for (const entry of searchCatalog) {
      const entries = searchCatalogByProject.get(entry.projectId) || [];
      entries.push(entry);
      searchCatalogByProject.set(entry.projectId, entries);
      searchCatalogByThread.set(normalizedThreadId(entry.threadId), entry);
    }
    scheduleSync();
  }

  function setRecentCatalog(items) {
    const newestByThread = new Map();
    for (const entry of Array.isArray(items) ? items : []) {
      const threadId = normalizedThreadId(entry?.threadId);
      const time = Date.parse(entry?.updatedAt || "");
      if (!threadId || typeof entry?.title !== "string" || !Number.isFinite(time)) continue;
      const current = newestByThread.get(threadId);
      if (!current || time > current.time) newestByThread.set(threadId, { ...entry, threadId, time });
    }
    recentCatalog = Array.from(newestByThread.values())
      .sort((left, right) => right.time - left.time)
      .map(({ time, ...entry }) => entry);
    recentCatalogByThread = new Map(recentCatalog.map((entry) => [normalizedThreadId(entry.threadId), entry]));
    scheduleSync();
  }

  function setInterruptedCatalog(items) {
    interruptedCatalog = (Array.isArray(items) ? items : [])
      .filter((entry) => normalizedThreadId(entry?.threadId) && typeof entry?.title === "string")
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    interruptedCatalogByThread = new Map(interruptedCatalog.map((entry) => [normalizedThreadId(entry.threadId), entry]));
    scheduleSync();
  }

  function setPinnedThreads(items) {
    const next = new Set((Array.isArray(items) ? items : []).map(normalizedThreadId).filter(Boolean));
    let changed = false;
    let fallback = -1;
    for (const id of next) {
      const key = pinnedThreadStorageKey(id);
      if (!Object.hasOwn(pinnedThreadTimes, key) && !Object.hasOwn(pinnedThreadTimes, id)) {
        pinnedThreadTimes[key] = fallback;
        fallback -= 1;
        changed = true;
      }
    }
    for (const key of Object.keys(pinnedThreadTimes)) {
      if (next.has(normalizedThreadId(key))) continue;
      delete pinnedThreadTimes[key];
      changed = true;
    }
    pinnedThreadIds = next;
    if (changed) persistPinnedThreadTimes();
    scheduleSync();
  }

  function setActiveProjectThreads(items) {
    activeProjectThreadIds = new Set((Array.isArray(items) ? items : []).map(normalizedThreadId).filter(Boolean));
    scheduleSync();
  }

  function setUsage(value) {
    usage = value && typeof value === "object" ? value : {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      ariaLabel: "Codex 剩余量暂不可用",
    };
    scheduleSync();
  }

  function setAssetConsole(value) {
    const source = value && typeof value === "object" ? value : {};
    assetConsole = {
      available: source.available === true,
      label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : "资产控制台",
      mode: source.mode === "embedded" ? "embedded" : "external",
    };
    scheduleSync();
  }

  function setSnapshot(snapshot = {}) {
    const setters = { previews: setPreviews, usage: setUsage, searchCatalog: setSearchCatalog,
      recentCatalog: setRecentCatalog, interruptedCatalog: setInterruptedCatalog,
      pinnedThreads: setPinnedThreads, activeProjectThreads: setActiveProjectThreads,
      skillCatalog: setSkillCatalog, skillOrganization: setSkillOrganization, conversationHistory: setConversationHistory, efficiency: setEfficiencyData };
    for (const [key, setter] of Object.entries(setters)) {
      if (!Object.hasOwn(snapshot, key)) continue;
      const signature = JSON.stringify(snapshot[key]);
      if (snapshotSignatures.get(key) === signature) continue;
      setter(snapshot[key]);
      snapshotSignatures.set(key, signature);
    }
    return { documentEpoch: DOCUMENT_EPOCH, accepted: true };
  }

  function getHealth() {
    const state = (name, mounted, optional = false) => componentErrors[name]
      ? "degraded" : mounted ? "ready" : optional ? "not-mounted" : "unsupported";
    const emptyFolders = searchCatalogByProject.size === 0
      && !sidebarRoot()?.querySelector('[data-app-action-sidebar-project-row]');
    return {
      runtimeVersion: RUNTIME_VERSION, documentEpoch: DOCUMENT_EPOCH,
      ready: !destroyed && Boolean(document.getElementById(STYLE_ID)), disposed: destroyed,
      lastSyncAt, syncCount, errors: { ...componentErrors },
      components: {
        sidebar: state("sidebar", sidebarRoot()),
        header: state("header", document.getElementById(TOGGLE_ID)),
        shortcuts: state("shortcuts", document.getElementById(SHORTCUT_GRID_ID)),
        sections: state("sections", document.getElementById(SECTION_TABS_ID), nativeActivityViewOpen()),
        folders: state("folders", document.getElementById(FOLDER_SWITCHER_ID), activeSectionTab !== "项目" || emptyFolders),
        skills: state("skills", document.getElementById(SKILL_ORGANIZER_ID), true),
        panels: state("panels", document.querySelector(`[${WORKSPACE_PANEL_ATTRIBUTE}]`), true),
      },
    };
  }

  function handleWorkspaceEnhancementKeydown(event) {
    if (event.key === "Escape" && skillDetailsDialog?.open) {
      event.preventDefault(); closeSkillDetails(); return;
    }
    if (event.key === "Escape" && skillContextMenu) {
      event.preventDefault(); closeSkillContextMenu();
      document.getElementById(SKILL_ORGANIZER_ID)?.querySelector(".codex-skill-search input")?.focus(); return;
    }
    const skillManager = document.querySelector(`#${SKILL_ORGANIZER_ID} .codex-skill-group-manager:not([hidden])`);
    if (event.key === "Escape" && skillManager) {
      event.preventDefault(); skillManager.hidden = true;
      document.querySelector(`#${SKILL_ORGANIZER_ID} [data-skill-manage]`)?.focus(); return;
    }
    if (handleWorkspaceFolderKeydown(event)) return;
    if (event.key === "Escape" && efficiencyPanel && !efficiencyPanel.hidden) {
      event.preventDefault(); closeEfficiencyPanel(); return;
    }
    if (event.key === "Escape" && customShortcutPageIsVisible()) {
      event.preventDefault();
      closeCustomShortcutPanel();
      return;
    }
    if (event.key === "Escape" && assetConsolePage && !assetConsolePage.hidden) {
      event.preventDefault();
      closeAssetConsolePanel();
      return;
    }
    if (event.key === "Escape" && document.getElementById(SKILL_ORGANIZER_ID) && !document.getElementById(SKILL_ORGANIZER_ID).hidden) {
      event.preventDefault();
      closeSkillsGrouping();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const composer = event.target?.closest?.('[contenteditable="true"]');
    if (!composer || composer !== currentComposer()) return;
    routeWorkspaceCommand(composer.textContent || "");
  }

  function workspaceCommand(value) {
    const text = String(value || "").replace(/\s+/gu, " ").trim();
    if (!text) return null;
    const slash = text.match(/^\/(项目|项目管理|skills?|技能|资产|资产控制台)\s+(.+)$/iu);
    const target = slash?.[1] || text.match(/(?:^|[，,。；;：:\s])(项目管理|任务面板|项目看板|skills?\s*分组|skills?|技能列表|资产控制台|资产库|素材库)(?:[，,。；;：:\s]|$)/iu)?.[1];
    if (!target) return null;
    const hasAction = Boolean(slash) || /(?:帮我|请|打开|进入|找|查找|搜索|检索|定位)/u.test(text);
    if (!hasAction) return null;
    const panel = /项目|任务/u.test(target) ? "taskboard" : /skill|技能/iu.test(target) ? "skills" : "asset";
    let query = slash?.[2] || text;
    query = query
      .replace(/^(?:请|麻烦)?(?:帮我)?/u, "")
      .replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), "")
      .replace(/(?:帮我|请)?(?:打开|进入|找|查找|搜索|检索|定位)(?:一下|下)?/gu, "")
      .replace(/(?:这个|有关的|相关的)?(?:项目|skills?|技能|资产|素材)?[。！？!?]*$/iu, "")
      .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/gu, "")
      .trim();
    return { panel, query };
  }

  function routeWorkspaceCommand(value) {
    const text = String(value || "").trim();
    const command = workspaceCommand(text);
    if (!command) return false;
    const now = Date.now();
    if (lastWorkspaceCommand.text === text && now - lastWorkspaceCommand.at < 1_500) return true;
    lastWorkspaceCommand = { text, at: now };
    window.setTimeout(() => {
      if (command.panel === "taskboard") {
        const api = window.__codexTaskboardInjection__;
        if (typeof api?.search === "function") void api.search(command.query);
        else api?.open?.();
      } else if (command.panel === "skills") openSkillsGrouping({ query: command.query });
      else openAssetConsolePanel({ query: command.query });
    }, 0);
    return true;
  }

  function handleWorkspaceCommandClick(event) {
    const button = event.target?.closest?.('button[aria-label*="发送"], button[aria-label*="Send"], button[data-testid*="send"]');
    if (!button || !currentComposer()) return;
    routeWorkspaceCommand(currentComposer().textContent || "");
  }

  function handleWorkspacePanelMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== WORKSPACE_PANEL_EVENT) return;
    if (event.data.panel === "taskboard") {
      // postMessage is asynchronous: a previous open may arrive after the user
      // has already closed Taskboard or switched to another shortcut.
      if (!document.documentElement.hasAttribute("data-codex-taskboard-open")) return;
      closeEfficiencyPanel(false);
      closeCustomShortcutPanel(false);
      closeAssetConsolePanel({ notify: false, restoreFocus: false });
      closeSkillsGrouping(false);
    }
  }

  function scheduleSync() {
    if (destroyed || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync();
    }, 80);
  }

  function observeHost() {
    if (!destroyed && observer) observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-state", "aria-expanded", "data-app-action-sidebar-thread-id", "data-app-action-sidebar-thread-title"],
    });
  }

  function handleHostMutations(records) {
    const owned = `#aiyoucodex-skill-details, #${WORKSPACE_FOLDER_BUTTON_ID}, #${WORKSPACE_FOLDER_MENU_ID}, .codex-skill-context-menu, #aiyoucodex-native-shortcut-notice, #${SHORTCUT_GRID_ID}, #${SECTION_TABS_ID}, #${FOLDER_SWITCHER_ID}, #${SHORTCUT_SETTINGS_ID}, #${SKILL_ORGANIZER_ID}, #${CUSTOM_SHORTCUT_PAGE_ID}, #${ASSET_CONSOLE_PAGE_ID}, #${EFFICIENCY_PANEL_ID}, #${TASK_CONTEXT_BUTTON_ID}, #${USAGE_ID}, #${TOGGLE_ID}, #${FALLBACK_TOOLTIP_ID}, .${CARD_CONTENT_CLASS}, .${SUMMARY_CLASS}, .${STATUS_BUTTON_CLASS}`;
    if (records.some((record) => {
      const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
      if (target?.closest?.(owned)) return false;
      if (record.type === "childList") {
        const changed = [...record.addedNodes, ...record.removedNodes];
        if (!record.removedNodes.length && changed.length
          && changed.every((node) => node.nodeType === 1 && node.matches?.(owned))) return false;
      }
      return true;
    })) scheduleSync();
  }

  function scheduleAnchorRetry() {
    if (destroyed || anchorRetryTimer) return;
    anchorRetryTimer = setTimeout(() => {
      anchorRetryTimer = null;
      scheduleSync();
    }, NATIVE_ANCHOR_GRACE_MS + 40);
  }

  function start() {
    installStyles();
    updateViewState();
    observer = new MutationObserver(handleHostMutations);
    observeHost();
    document.addEventListener("pointerover", handlePreviewPointerOver, true);
    document.addEventListener("pointerout", handlePreviewPointerOut, true);
    document.addEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    document.addEventListener("pointerdown", handleWorkspaceFolderPointer, true);
    window.addEventListener("resize", positionWorkspaceFolderMenu);
    window.visualViewport?.addEventListener("resize", positionWorkspaceFolderMenu);
    document.addEventListener("scroll", positionWorkspaceFolderMenu, true);
    document.addEventListener("click", handlePinDocumentClick, true);
    document.addEventListener("click", handleNativeActivityClick, true);
    document.addEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    document.addEventListener("click", handleWorkspaceCommandClick, true);
    window.addEventListener("message", handleAssetConsoleMessage);
    window.addEventListener("message", handleWorkspacePanelMessage);
    window.addEventListener("message", handleNativeShortcutMessage);
    document.addEventListener("securitypolicyviolation", handleCustomShortcutPolicyViolation);
    window.addEventListener("resize", scheduleEfficiencyPanelLayout);
    window.visualViewport?.addEventListener("resize", scheduleEfficiencyPanelLayout);
    window.visualViewport?.addEventListener("scroll", scheduleEfficiencyPanelLayout);
    document.addEventListener("scroll", scheduleEfficiencyPanelLayout, true);
    sync();
  }

  function destroy() {
    destroyed = true;
    for (const cleanup of workspaceResizeCleanups) cleanup();
    skillOrganizerOpenGeneration += 1;
    skillOrganizerOpenObserver?.disconnect();
    skillOrganizerOpenObserver = null;
    clearTimeout(skillOrganizerOpenTimer);
    skillOrganizerOpenTimer = null;
    observer?.disconnect();
    clearTimeout(syncTimer);
    clearTimeout(anchorRetryTimer);
    document.removeEventListener("pointerover", handlePreviewPointerOver, true);
    document.removeEventListener("pointerout", handlePreviewPointerOut, true);
    document.removeEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    document.removeEventListener("pointerdown", handleWorkspaceFolderPointer, true);
    window.removeEventListener("resize", positionWorkspaceFolderMenu);
    window.visualViewport?.removeEventListener("resize", positionWorkspaceFolderMenu);
    document.removeEventListener("scroll", positionWorkspaceFolderMenu, true);
    closeWorkspaceFolderMenu(false);
    workspaceFolderMenu?.remove(); workspaceFolderButton?.remove();
    clearTimeout(workspaceFolderPending?.timer); workspaceFolderPending = null;
    document.removeEventListener("click", handlePinDocumentClick, true);
    document.removeEventListener("click", handleNativeActivityClick, true);
    document.removeEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    document.removeEventListener("click", handleWorkspaceCommandClick, true);
    window.removeEventListener("message", handleAssetConsoleMessage);
    window.removeEventListener("message", handleWorkspacePanelMessage);
    window.removeEventListener("message", handleNativeShortcutMessage);
    document.removeEventListener("securitypolicyviolation", handleCustomShortcutPolicyViolation);
    for (const timer of nativeShortcutTimers) clearTimeout(timer);
    nativeShortcutTimers.clear();
    nativeShortcutNotice?.remove();
    window.removeEventListener("resize", scheduleEfficiencyPanelLayout);
    window.visualViewport?.removeEventListener("resize", scheduleEfficiencyPanelLayout);
    window.visualViewport?.removeEventListener("scroll", scheduleEfficiencyPanelLayout);
    document.removeEventListener("scroll", scheduleEfficiencyPanelLayout, true);
    closeStatusMenu();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(TOGGLE_ID)?.remove();
    document.getElementById(USAGE_ID)?.remove();
    document.getElementById(SHORTCUT_SETTINGS_BUTTON_ID)?.remove();
    document.getElementById(FALLBACK_TOOLTIP_ID)?.remove();
    document.querySelectorAll('[data-codex-sidebar-header-controls="true"]').forEach((host) => {
      const previous = host.dataset.codexSidebarHeaderControlsAppRegion || "";
      if (previous) host.style.setProperty("-webkit-app-region", previous);
      else host.style.removeProperty("-webkit-app-region");
      host.removeAttribute("data-codex-sidebar-header-controls");
      host.removeAttribute("data-codex-sidebar-header-controls-app-region");
    });
    clearShortcutEnhancement();
    closeEfficiencyPanel(false);
    efficiencyPanel?.remove(); efficiencyPanel = null;
    efficiencyMountSurface = null; efficiencyResizeObserver?.disconnect(); efficiencyResizeObserver = null;
    for (const request of efficiencyRequests.values()) clearTimeout(request.timer);
    efficiencyRequests.clear(); efficiencyDrafts.clear(); efficiencyTargetDrafts.clear(); efficiencyTaskDraft = null;
    for (const request of skillOrganizationRequests.values()) { clearTimeout(request.timer); request.resolve(null); }
    skillOrganizationRequests.clear(); closeSkillContextMenu();
    closeSkillDetails(false); skillDetailsDialog?.remove(); skillDetailsDialog = null;
    efficiencyExecutionPreview = null; document.getElementById(TASK_CONTEXT_BUTTON_ID)?.remove();
    document.getElementById(SHORTCUT_SETTINGS_ID)?.remove();
    clearSectionEnhancement();
    closeCustomShortcutPanel(false);
    clearRecoveredConversationHistory();
    closeAssetConsolePanel({ notify: true, restoreFocus: false, preserveIntent: true });
    assetConsolePage?.remove();
    assetConsolePage = null;
    assetConsoleFrame = null;
    clearSkillOrganizer();
    customShortcutPage?.remove();
    customShortcutPage = null;
    customShortcutFrame = null;
    customShortcutFrames.clear();
    document.documentElement.removeAttribute("data-codex-conversation-view");
    document.querySelectorAll(`.${SUMMARY_CLASS}, .${DETAILS_CLASS}, .${CARD_CONTENT_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll('[data-codex-conversation-preview-enhanced="true"]').forEach((row) => {
      row.removeAttribute("data-codex-conversation-preview-enhanced");
      row.removeAttribute("data-codex-project-running");
    });
    document.querySelectorAll('[data-codex-conversation-preview-title="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-preview-title");
    });
    document.querySelectorAll('[data-codex-conversation-card-grid="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-card-grid");
    });
    document.querySelectorAll('[data-codex-conversation-card-item="true"]').forEach((node) => {
      node.removeAttribute("data-codex-conversation-card-item");
    });
    document.querySelectorAll('[data-codex-sidebar-search-match="true"]').forEach((node) => {
      node.removeAttribute("data-codex-sidebar-search-match");
    });
  }

  window[SENTINEL] = {
    runtimeVersion: RUNTIME_VERSION,
    documentEpoch: DOCUMENT_EPOCH,
    getHealth,
    setSnapshot,
    destroy,
    refresh: sync,
    setPreviews,
    setSearchCatalog,
    setRecentCatalog,
    setInterruptedCatalog,
    setPinnedThreads,
    setActiveProjectThreads,
    setConversationHistory,
    setUsage,
    setAssetConsole,
    setAssetConsolePanel,
    setSkillCatalog,
    setSkillOrganization,
    resolveSkillOrganizationRequest,
    ensureManagedShortcut,
    openSkillsGrouping,
    openAssetConsolePanel,
    openEfficiencyPanel,
    openTaskContextPanel,
    closeEfficiencyPanel,
    getEfficiencyState,
    setEfficiencyData,
    resolveEfficiencyRequest,
    routeWorkspaceCommand,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
