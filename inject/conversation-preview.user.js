(() => {
  "use strict";

  const SENTINEL = "__codexConversationPreviewInjection__";
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
  const CUSTOM_SHORTCUT_PAGE_ID = "codex-custom-shortcut-page";
  const CUSTOM_SHORTCUT_FRAME_ID = "codex-custom-shortcut-frame";
  const CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE = "data-codex-custom-shortcut-hidden";
  const CUSTOM_SHORTCUT_HOST_ATTRIBUTE = "data-codex-custom-shortcut-host";
  const ASSET_CONSOLE_PAGE_ID = "codex-asset-console-page";
  const ASSET_CONSOLE_FRAME_ID = "codex-asset-console-frame";
  const SKILL_ORGANIZER_ID = "codex-skill-organizer";
  const SKILL_FAVORITES_KEY = "codex-workspace-enhancer:skill-favorites-v1";
  const SKILL_OPEN_REQUEST_STORAGE_KEY = "codex-workspace-enhancer:skill-open-request-v1";
  const SKILL_OPEN_REQUEST_TTL_MS = 15_000;
  const SKILL_NATIVE_SECTION_ATTR = "data-codex-skill-native-section";
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
  let observer = null;
  let syncTimer = null;
  let anchorRetryTimer = null;
  let previews = new Map();
  let shortcutSources = new Map();
  let shortcutCatalog = [];
  let shortcutSettings = {
    schemaVersion: 4,
    hidden: Array.from(HIDDEN_SHORTCUT_NAMES, (name) => `native:${name}`),
    custom: [],
  };
  let customShortcutPage = null;
  let customShortcutFrame = null;
  let customShortcutLastFocusedElement = null;
  let assetConsole = { available: false, label: "资产控制台", mode: "embedded" };
  let assetConsolePage = null;
  let assetConsoleFrame = null;
  let assetConsoleReturnFocus = null;
  let skillOrganizerSource = null;
  let skillOrganizerCatalog = [];
  let skillOrganizerCatalogSignature = "";
  let skillOrganizerFilter = "常用";
  let skillOrganizerQuery = "";
  let skillOrganizerNativeVisible = false;
  let skillOrganizerFavorites = null;
  let skillOrganizerRenderFrame = null;
  let skillOrganizerRenderGeneration = 0;
  let skillOrganizerOpening = false;
  let skillOrganizerOpenGeneration = 0;
  let skillOrganizerOpenObserver = null;
  let skillOrganizerOpenTimer = null;
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
      [data-codex-sidebar-native-alias-hidden="true"] {
        display: none !important;
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
      #${SHORTCUT_SETTINGS_ID} [data-codex-shortcut-save] {
        height: 36px;
        border: 0;
        border-radius: 10px;
        background: var(--vscode-textLink-foreground, #2f95ff);
        color: white;
        font-weight: 650;
        cursor: pointer;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: grid;
        grid-template-rows: 44px minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: Canvas;
        color: CanvasText;
        pointer-events: auto;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID}[hidden] { display: none !important; }
      #${CUSTOM_SHORTCUT_PAGE_ID} .codex-custom-shortcut-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px 0 16px;
        border-bottom: 0.5px solid color-mix(in srgb, currentColor 12%, transparent);
        font-size: 13px;
        font-weight: 620;
      }
      #${CUSTOM_SHORTCUT_PAGE_ID} [data-codex-custom-shortcut-close] {
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
      #${CUSTOM_SHORTCUT_FRAME_ID} {
        width: 100%;
        height: 100%;
        border: 0;
        background: Canvas;
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
        grid-template-columns: minmax(0, 1fr) 58px;
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
        width: 58px;
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
      #${ASSET_CONSOLE_PAGE_ID} {
        position: absolute;
        inset: 0;
        z-index: 30;
        display: grid;
        grid-template-rows: 50px minmax(0, 1fr);
        overflow: hidden;
        background: var(--color-token-bg-primary, #fff);
        pointer-events: auto;
      }
      #${ASSET_CONSOLE_PAGE_ID}[hidden] { display: none !important; }
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 16px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
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
      #${ASSET_CONSOLE_PAGE_ID} .codex-asset-console-close { width: 32px; height: 32px; font-size: 20px; }
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
        gap: 14px;
        margin: 0 0 18px;
        padding: 18px;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 18px;
        background: color-mix(in srgb, var(--color-token-bg-primary, #fff) 92%, transparent);
        box-shadow: 0 12px 30px color-mix(in srgb, #24364b 8%, transparent);
      }
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
      #${SKILL_ORGANIZER_ID} .codex-skill-filter-list { display: flex; flex-wrap: wrap; gap: 7px; }
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
      }
      #${SKILL_ORGANIZER_ID} .codex-skill-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 32px;
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
    return item?.custom ? `custom:${item.id}` : `native:${item?.name || ""}`;
  }

  function validShortcutUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
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

  function restoreCustomShortcutNativeContent() {
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE));
    document.querySelectorAll(`[${CUSTOM_SHORTCUT_HOST_ATTRIBUTE}="true"]`)
      .forEach((node) => node.removeAttribute(CUSTOM_SHORTCUT_HOST_ATTRIBUTE));
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
    page.appendChild(header);
    return page;
  }

  function openCustomShortcutPanel(item) {
    const url = validShortcutUrl(item?.url);
    if (!url) return false;
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    if (!customShortcutPage) customShortcutPage = createCustomShortcutPage();
    customShortcutLastFocusedElement = document.activeElement;
    if (customShortcutPage.parentElement !== mount.surface) {
      restoreCustomShortcutNativeContent();
      mount.surface.appendChild(customShortcutPage);
    }
    mount.surface.setAttribute(CUSTOM_SHORTCUT_HOST_ATTRIBUTE, "true");
    Array.from(mount.surface.children).forEach((child) => {
      if (child !== customShortcutPage) child.setAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE, "true");
    });
    document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]')
      .forEach((header) => Array.from(header.children).forEach((child) => {
        child.setAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE, "true");
      }));
    customShortcutPage.querySelector("[data-codex-custom-shortcut-title]").textContent = item.name;
    customShortcutFrame?.remove();
    const frame = document.createElement("iframe");
    frame.id = CUSTOM_SHORTCUT_FRAME_ID;
    frame.title = item.name;
    frame.src = url;
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation");
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    customShortcutFrame = frame;
    customShortcutPage.appendChild(frame);
    customShortcutPage.hidden = false;
    document.documentElement.setAttribute("data-codex-custom-shortcut-open", "true");
    return true;
  }

  function closeCustomShortcutPanel(restoreFocus = true) {
    if (customShortcutPage) customShortcutPage.hidden = true;
    customShortcutFrame?.remove();
    customShortcutFrame = null;
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-custom-shortcut-open");
    if (restoreFocus) customShortcutLastFocusedElement?.focus?.();
    customShortcutLastFocusedElement = null;
  }

  function currentCodexTaskContext() {
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    return {
      threadId: normalizedThreadId(active?.getAttribute("data-app-action-sidebar-thread-id") || ""),
      threadTitle: active?.getAttribute("data-app-action-sidebar-thread-title") || "",
    };
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
    return page;
  }

  function openAssetConsolePanel() {
    closeCustomShortcutPanel(false);
    const mount = findCustomShortcutPageMount();
    if (!mount) return false;
    if (!assetConsolePage) assetConsolePage = createAssetConsolePage();
    assetConsoleReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (assetConsolePage.parentElement !== mount.surface) {
      restoreCustomShortcutNativeContent();
      mount.surface.appendChild(assetConsolePage);
    }
    mount.surface.setAttribute(CUSTOM_SHORTCUT_HOST_ATTRIBUTE, "true");
    Array.from(mount.surface.children).forEach((child) => {
      if (child !== assetConsolePage) child.setAttribute(CUSTOM_SHORTCUT_HIDDEN_ATTRIBUTE, "true");
    });
    assetConsolePage.hidden = false;
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

  function closeAssetConsolePanel({ notify = true, restoreFocus = true } = {}) {
    if (assetConsolePage) assetConsolePage.hidden = true;
    assetConsoleFrame?.remove();
    assetConsoleFrame = null;
    restoreCustomShortcutNativeContent();
    document.documentElement.removeAttribute("data-codex-asset-console-open");
    if (notify) notifyAssetConsole("close");
    if (restoreFocus) assetConsoleReturnFocus?.focus?.();
    assetConsoleReturnFocus = null;
    scheduleSync();
  }

  function setAssetConsolePanel(value) {
    const state = value && typeof value === "object" ? value : {};
    if (!assetConsolePage || assetConsolePage.hidden) return;
    if (state.state !== "ready" || typeof state.url !== "string" || !state.url) {
      assetConsoleFrame?.remove();
      assetConsoleFrame = null;
      assetConsolePage.dataset.state = "error";
      assetConsolePage.querySelector(".codex-asset-console-message").textContent = state.message || "资产控制台暂时无法加载";
      return;
    }
    const body = assetConsolePage.querySelector(".codex-asset-console-body");
    assetConsoleFrame?.remove();
    const frame = document.createElement("iframe");
    frame.id = ASSET_CONSOLE_FRAME_ID;
    frame.title = "资产控制台";
    frame.src = state.url;
    frame.setAttribute("allow", "clipboard-read; clipboard-write; autoplay");
    frame.onload = () => { if (assetConsolePage) assetConsolePage.dataset.state = "ready"; };
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

  const SKILL_FILTERS = ["常用", "视频创作", "导演镜头", "画面风格", "资产工作台", "写作研究", "工具管理", "全部"];

  function loadSkillFavorites(catalog) {
    if (skillOrganizerFavorites) return skillOrganizerFavorites;
    try {
      const parsed = JSON.parse(localStorage.getItem(SKILL_FAVORITES_KEY) || "null");
      if (Array.isArray(parsed)) return (skillOrganizerFavorites = new Set(parsed.filter((name) => typeof name === "string")));
    } catch {}
    const preferred = catalog.filter((entry) => /视频|导演|镜头|资产|工作台|提示词|知识|写作|skill/i.test(`${entry.title} ${entry.description}`));
    skillOrganizerFavorites = new Set((preferred.length ? preferred : catalog).slice(0, 10).map((entry) => entry.title));
    try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
    return skillOrganizerFavorites;
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
    const text = `${entry.title} ${entry.description}`;
    if (category === "全部") return true;
    if (category === "常用") return skillOrganizerFavorites?.has(entry.title) === true;
    if (category === "视频创作") return /视频|影像|seedance|即梦|minimax|剪辑|节奏|音乐|音效|mv|生成/i.test(text);
    if (category === "导演镜头") return /导演|镜头|分镜|动作|摄影|表演|角色|转场|vfx|特效/i.test(text);
    if (category === "画面风格") return /风格|美学|视觉|画面|图像|灯光|材质|构图|色彩|写实/i.test(text);
    if (category === "资产工作台") return /资产|素材|工作台|归档|账本|管线|codex|知识卡|下载|清理/i.test(text);
    if (category === "写作研究") return /写作|研究|知识|文章|公众号|小红书|脚本|语义|阅读|剧本/i.test(text);
    return /工具|管理|浏览器|网页|数据|表格|文档|安装|审计|测试|调试|skill|codex|plugin/i.test(text);
  }

  function clearSkillOrganizer() {
    skillOrganizerRenderGeneration += 1;
    if (skillOrganizerRenderFrame !== null) cancelAnimationFrame(skillOrganizerRenderFrame);
    skillOrganizerRenderFrame = null;
    document.getElementById(SKILL_ORGANIZER_ID)?.remove();
    document.querySelectorAll(`[${SKILL_NATIVE_SECTION_ATTR}]`).forEach((node) => node.removeAttribute(SKILL_NATIVE_SECTION_ATTR));
    skillOrganizerSource = null;
    skillOrganizerCatalog = [];
    skillOrganizerCatalogSignature = "";
    skillOrganizerFilter = "常用";
    skillOrganizerQuery = "";
    skillOrganizerNativeVisible = false;
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
      skillOrganizerRenderFrame = requestAnimationFrame(() => {
        skillOrganizerRenderFrame = null;
        if (generation !== skillOrganizerRenderGeneration) return;
        renderSkillOrganizer();
      });
    });
  }

  function selectSkillOrganizerFilter(label) {
    if (!SKILL_FILTERS.includes(label) || skillOrganizerFilter === label) return;
    skillOrganizerFilter = label;
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell) return;
    syncSkillOrganizerFilterSelection(shell, label);
    shell.setAttribute("aria-busy", "true");
    scheduleSkillOrganizerRender();
  }

  function renderSkillOrganizer() {
    const shell = document.getElementById(SKILL_ORGANIZER_ID);
    if (!shell || !skillOrganizerSource?.isConnected) return;
    loadSkillFavorites(skillOrganizerCatalog);
    skillOrganizerSource.setAttribute(SKILL_NATIVE_SECTION_ATTR, skillOrganizerNativeVisible ? "visible" : "hidden");
    shell.querySelector(".codex-skill-native-toggle").textContent = skillOrganizerNativeVisible ? "返回分组" : "完整列表";
    const filters = shell.querySelector(".codex-skill-filter-list");
    if (!filters.childElementCount) {
      filters.append(...SKILL_FILTERS.map((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "codex-skill-filter";
        button.dataset.codexSkillFilter = label;
        button.textContent = label;
        button.onpointerdown = (event) => {
          if (event.button === 0) selectSkillOrganizerFilter(label);
        };
        button.onclick = () => selectSkillOrganizerFilter(label);
        return button;
      }));
    }
    syncSkillOrganizerFilterSelection(shell);
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
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const copy = document.createElement("span");
      copy.innerHTML = '<span class="codex-skill-name"></span><span class="codex-skill-description"></span>';
      copy.querySelector(".codex-skill-name").textContent = entry.title;
      copy.querySelector(".codex-skill-description").textContent = entry.description;
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "codex-skill-favorite";
      favorite.setAttribute("aria-pressed", String(skillOrganizerFavorites.has(entry.title)));
      favorite.setAttribute("aria-label", `${skillOrganizerFavorites.has(entry.title) ? "取消常用" : "加入常用"}：${entry.title}`);
      favorite.textContent = "★";
      favorite.onclick = (event) => {
        event.stopPropagation();
        if (skillOrganizerFavorites.has(entry.title)) skillOrganizerFavorites.delete(entry.title);
        else skillOrganizerFavorites.add(entry.title);
        try { localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify([...skillOrganizerFavorites])); } catch {}
        renderSkillOrganizer();
      };
      const open = () => entry.card?.isConnected && entry.card.click();
      row.onclick = open;
      row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
      row.append(copy, favorite);
      return row;
    }));
    shell.removeAttribute("aria-busy");
  }

  function ensureSkillOrganizer() {
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
    const active = skillOrganizerOpening || Boolean(document.getElementById(SKILL_ORGANIZER_ID));
    button.dataset.active = String(active);
    button.setAttribute("aria-current", String(active));
    const label = button.querySelector(`.${SHORTCUT_LABEL_CLASS}`);
    if (skillOrganizerOpening) {
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "正在打开 Skills 分组");
      if (label) label.textContent = "正在打开…";
    } else {
      button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", "打开Skills 分组");
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

  function openSkillsGrouping() {
    closeAssetConsolePanel({ notify: true, restoreFocus: false });
    try {
      const requestedAt = Number(localStorage.getItem(SKILL_OPEN_REQUEST_STORAGE_KEY));
      if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > SKILL_OPEN_REQUEST_TTL_MS) {
        localStorage.setItem(SKILL_OPEN_REQUEST_STORAGE_KEY, String(Date.now()));
      }
    } catch {}
    const generation = ++skillOrganizerOpenGeneration;
    skillOrganizerOpening = true;
    updateSkillsGroupingShortcutState();
    const startedAt = Date.now();
    let lastClickedPlugins = null;
    let lastPluginsClickAt = 0;
    let lastClickedSkills = null;
    let lastSkillsClickAt = 0;
    const activateSkills = () => {
      if (generation !== skillOrganizerOpenGeneration) return true;
      if (document.getElementById(SKILL_ORGANIZER_ID)) {
        finishSkillsGroupingOpen();
        return true;
      }
      const tabs = Array.from(document.querySelectorAll('button[aria-pressed]')).filter((button) =>
        !button.closest(`#${SHORTCUT_GRID_ID}`) && button.getClientRects().length > 0,
      );
      const skills = tabs.find((button) => button.textContent?.trim() === "技能");
      if (!skills) {
        const currentPlugins = findNativeShortcutButton("插件");
        if (currentPlugins
          && (currentPlugins !== lastClickedPlugins || Date.now() - lastPluginsClickAt >= 160)) {
          currentPlugins.click();
          lastClickedPlugins = currentPlugins;
          lastPluginsClickAt = Date.now();
        }
        return false;
      }
      if (skills.getAttribute("aria-pressed") !== "true"
        && (skills !== lastClickedSkills || Date.now() - lastSkillsClickAt >= 160)) {
        skills.click();
        lastClickedSkills = skills;
        lastSkillsClickAt = Date.now();
      }
      scheduleSync();
      return skills.getAttribute("aria-pressed") === "true";
    };
    activateSkills();
    skillOrganizerOpenObserver?.disconnect();
    skillOrganizerOpenObserver = new MutationObserver(activateSkills);
    skillOrganizerOpenObserver.observe(document.documentElement, { childList: true, subtree: true });
    const retryActivation = () => {
      if (generation !== skillOrganizerOpenGeneration || document.getElementById(SKILL_ORGANIZER_ID)) return;
      activateSkills();
      if (Date.now() - startedAt < 12_000) {
        skillOrganizerOpenTimer = setTimeout(retryActivation, 40);
      } else {
        finishSkillsGroupingOpen();
      }
    };
    if (skillOrganizerOpenTimer !== null) clearTimeout(skillOrganizerOpenTimer);
    skillOrganizerOpenTimer = setTimeout(retryActivation, 0);
  }

  function resumeSkillsGroupingOpenRequest() {
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
          <h2>快捷入口设置</h2>
          <button type="button" data-codex-shortcut-settings-close aria-label="关闭设置">×</button>
        </header>
        <div class="codex-shortcut-settings-body">
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
    return button?.querySelector(".text-fade-truncate")?.textContent?.trim()
      || button?.getAttribute("title")
      || button?.getAttribute("aria-label")?.replace(/^打开/u, "")
      || "快捷入口";
  }

  function findNativeShortcutButton(name) {
    return Array.from(document.querySelectorAll("button")).find((button) =>
      !button.closest(`#${SHORTCUT_GRID_ID}`) && shortcutLabel(button) === name,
    );
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
    const navigationGroup = shortcutSiblingGroup(pullRequests);
    const newConversationRow = newConversation?.parentElement;
    const header = newConversationRow?.parentElement?.parentElement?.parentElement;
    if (!newConversation || !navigationGroup || !header) return null;

    const navigationButtons = shortcutGroupButtons(navigationGroup);
    const quickButton = Array.from(newConversationRow.children)
      .flatMap((node) => node === newConversation ? [] : Array.from(node.querySelectorAll?.("button") || []))[0] || null;
    const sourceItems = [
      { name: "新对话", button: newConversation, quickButton },
      ...navigationButtons.map((button) => ({ name: shortcutLabel(button), button, quickButton: null })),
    ].filter((item, index, values) => item.name && values.findIndex((candidate) => candidate.name === item.name) === index);
    const builtInItems = sourceItems.filter((item) => !HIDDEN_SHORTCUT_NAMES.has(item.name));
    const enhancementItems = [
      { id: "skills-grouping", name: "Skills 分组", kind: "enhancement", icon: "skills", activate: openSkillsGrouping },
      { id: "asset-console", name: "资产控制台", kind: "enhancement", icon: "assets", activate: openAssetConsolePanel },
    ];
    const catalogItems = [...builtInItems, ...enhancementItems, ...normalizedCustomShortcuts()];
    const items = catalogItems.filter((item) => !shortcutSettings.hidden.includes(shortcutItemKey(item)));
    return { header, newConversationRow, navigationGroup, sourceItems, catalogItems, items };
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
    button.setAttribute("aria-label", item.button?.getAttribute("aria-label") || `打开${item.name}`);
    button.title = item.name;
    const label = document.createElement("span");
    label.className = SHORTCUT_LABEL_CLASS;
    label.textContent = item.name;
    button.append(shortcutIcon(item.button, SHORTCUT_ICON_CLASS, item.name, item.icon), label);
    button.onclick = () => {
      if (item.kind === "settings") openShortcutSettings();
      else if (item.kind === "enhancement") item.activate?.();
      else if (item.custom && item.openMode === "browser") openCustomShortcutInBrowser(item);
      else if (item.custom) openCustomShortcutPanel(item);
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

  function updateShortcutCard(grid, item) {
    const button = Array.from(grid.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => item.custom
        ? candidate.dataset.codexSidebarShortcutCustom === item.id
        : candidate.dataset.codexSidebarShortcutName === item.name);
    if (!button) return;
    if (!item.button) {
      button.disabled = false;
      const active = item.id === "asset-console"
        ? Boolean(assetConsolePage && !assetConsolePage.hidden)
        : item.id === "skills-grouping"
          ? skillOrganizerOpening || Boolean(document.getElementById(SKILL_ORGANIZER_ID))
          : false;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", String(active));
      if (item.id === "skills-grouping" && skillOrganizerOpening) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", item.kind === "settings" ? "管理快捷入口" : `打开${item.name}`);
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
      if (document.getElementById(SHORTCUT_GRID_ID)) clearShortcutEnhancement();
      return;
    }
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
    sources.navigationGroup.setAttribute("data-codex-sidebar-shortcut-source-group-hidden", "true");
    for (const item of sources.sourceItems) {
      item.button.dataset.codexSidebarShortcutSourceName = item.name;
    }
    for (const item of sources.items) {
      updateShortcutCard(grid, item);
    }
  }

  function sectionLabel(button) {
    return button?.querySelector("span.min-w-0.truncate")?.textContent?.trim()
      || button?.textContent?.trim()
      || "";
  }

  function nativeSectionSource(name) {
    const button = Array.from(document.querySelectorAll("button[data-app-action-sidebar-section-toggle]"))
      .find((candidate) => !candidate.closest(`#${SECTION_TABS_ID}`) && sectionLabel(candidate) === name);
    if (!button) return null;
    let heading = button.parentElement;
    while (heading && !heading.classList.contains("group/nav-section-title")) heading = heading.parentElement;
    const section = heading?.closest("section");
    if (!heading || !section) return null;
    return { name, button, heading, section, panelHost: null, actions: null };
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
    const items = NATIVE_SECTION_NAMES.map(nativeSectionSource);
    if (items.some((item) => !item)) return null;
    const common = commonAncestor(items.map((item) => item.section));
    if (!common) return null;
    for (const item of items) item.panelHost = topLevelPanelHost(item.section, common);
    const existingActions = document.querySelector(`#${SECTION_TABS_ID} [data-codex-sidebar-project-actions-source]`);
    items.find((item) => item.name === "项目").actions = items.find((item) => item.name === "项目").heading.children[1]
      || existingActions
      || null;
    return { common, items };
  }

  function nativePrioritySource() {
    const list = Array.from(document.querySelectorAll('[role="list"]')).find((candidate) => {
      if (!candidate.querySelector(ROW_SELECTOR)) return false;
      return Array.from(candidate.querySelectorAll("div,span,h1,h2,h3,h4")).some((node) =>
        node.childElementCount === 0 && node.textContent?.trim() === "优先级",
      );
    });
    return list?.parentElement ? { common: list.parentElement, list } : null;
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
    bar.append(tablist, actions);
    return bar;
  }

  function restoreProjectActions() {
    const project = sectionSources.get("项目");
    const actions = project?.actions;
    if (!actions) return;
    actions.removeAttribute("data-codex-sidebar-project-actions-source");
    actions.querySelectorAll("button[data-codex-sidebar-project-action-source]").forEach((button) => {
      button.removeAttribute("data-codex-sidebar-project-action-source");
    });
    if (project.heading?.isConnected && actions.parentElement !== project.heading && project.heading.children.length < 2) {
      project.heading.appendChild(actions);
    }
  }

  function clearSectionEnhancement() {
    clearFolderEnhancement();
    restoreProjectActions();
    document.getElementById(RECENT_LIST_ID)?.remove();
    document.querySelectorAll(`#${INTERRUPTED_PANEL_ID}, [data-codex-sidebar-section-panel="中断"]`).forEach((panel) => {
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
      || !sectionSources.get("中断")?.section?.isConnected;
    if (needsRebuild) {
      clearSectionEnhancement();
      bar = createSectionTabs();
      sources.common.insertBefore(bar, sources.common.firstChild);
      sectionSources = new Map(sources.items.map((item) => [item.name, item]));
      const interruptedPanel = document.createElement("section");
      interruptedPanel.id = INTERRUPTED_PANEL_ID;
      interruptedPanel.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      sources.common.insertBefore(interruptedPanel, bar.nextSibling);
      sectionSources.set("中断", {
        name: "中断",
        virtual: true,
        button: null,
        heading: null,
        section: interruptedPanel,
        panelHost: interruptedPanel,
        actions: null,
      });
    }
    const project = sources.items.find((item) => item.name === "项目");
    const actionsHost = bar.querySelector("[data-codex-sidebar-project-actions]");
    if (project?.actions && project.actions.parentElement !== actionsHost) {
      project.actions.dataset.codexSidebarProjectActionsSource = "true";
      project.actions.querySelectorAll("button").forEach((button) => {
        const label = button.getAttribute("aria-label") || "项目操作";
        button.dataset.codexSidebarProjectActionSource = label;
      });
      actionsHost.appendChild(project.actions);
    }
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
    const action = button?.getAttribute("aria-label");
    if (action !== "置顶聊天" && action !== "取消置顶聊天") return;
    const row = button.closest(ROW_SELECTOR);
    const id = normalizedThreadId(row?.getAttribute("data-app-action-sidebar-thread-id"));
    if (!id) return;
    const key = pinnedThreadStorageKey(id);
    if (action === "置顶聊天") {
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
      const catalogEntries = sourceEntries
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
        .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
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
      const existingActions = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source="${CSS.escape(id)}"]`);
      const rowActions = Array.from(row.children).find((child) =>
        Array.from(child.querySelectorAll?.("button") || []).some((button) =>
          button.getAttribute("aria-label") === `${label} 的项目操作`,
        ),
      );
      const threadTitles = Array.from(folder.querySelectorAll(ROW_SELECTOR))
        .filter((thread) => !pinnedThreadIds.has(normalizedThreadId(
          thread.getAttribute("data-app-action-sidebar-thread-id"),
        )))
        .map((thread) => thread.getAttribute("data-app-action-sidebar-thread-title") || "")
        .filter(Boolean);
      const catalogEntries = (searchCatalogByProject.get(id) || [])
        .filter((entry) => !pinnedThreadIds.has(normalizedThreadId(entry.threadId)))
        .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
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
        actions: rowActions || existingActions || null,
        sourceIndex,
        threadTitles,
        catalogEntries,
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
      .find((button) => button?.textContent?.trim() === "展开显示");
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
      .find((button) => button.textContent?.trim() === "展开显示");
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
  }

  function restoreFolderActions() {
    const source = document.querySelector(`#${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-actions-source]`);
    if (!source) return;
    const id = source.getAttribute("data-codex-sidebar-folder-actions-source");
    const item = folderSources.get(id);
    const row = item?.row || document.querySelector(`[data-app-action-sidebar-project-id="${CSS.escape(id)}"]`);
    source.removeAttribute("data-codex-sidebar-folder-actions-source");
    source.querySelectorAll("[data-codex-sidebar-folder-action-source]").forEach((button) => {
      button.removeAttribute("data-codex-sidebar-folder-action-source");
    });
    source.querySelectorAll("[data-codex-sidebar-folder-create]").forEach((button) => {
      const originalTitle = button.getAttribute("data-codex-sidebar-folder-create-original-title");
      if (originalTitle) button.title = originalTitle;
      else button.removeAttribute("title");
      button.removeAttribute("data-codex-sidebar-folder-create");
      button.removeAttribute("data-codex-sidebar-folder-create-original-title");
    });
    if (row?.isConnected && source.parentElement !== row) {
      const selectProject = Array.from(row.children).find((child) => child.matches?.("button[data-app-action-sidebar-select-project]"));
      row.insertBefore(source, selectProject || null);
    }
  }

  function nativeFolderCreateButton(item) {
    if (!item?.actions) return null;
    const expectedLabel = `在 ${item.label} 中开始新聊天`;
    return Array.from(item.actions.querySelectorAll("button")).find((button) =>
      button.getAttribute("aria-label") === expectedLabel,
    ) || null;
  }

  function moveActiveFolderActions(item) {
    const root = document.getElementById(FOLDER_SWITCHER_ID);
    const host = root?.querySelector("[data-codex-sidebar-folder-actions]");
    if (!host) return;
    const current = host.querySelector("[data-codex-sidebar-folder-actions-source]");
    if (current && current !== item?.actions) restoreFolderActions();
    if (!item?.actions) {
      host.hidden = true;
      return;
    }
    item.actions.dataset.codexSidebarFolderActionsSource = item.id;
    item.actions.querySelectorAll("button").forEach((button) => {
      button.dataset.codexSidebarFolderActionSource = button.getAttribute("aria-label") || item.label;
    });
    const create = nativeFolderCreateButton(item);
    if (create) {
      if (!create.hasAttribute("data-codex-sidebar-folder-create-original-title")) {
        create.dataset.codexSidebarFolderCreateOriginalTitle = create.getAttribute("title") || "";
      }
      create.dataset.codexSidebarFolderCreate = item.id;
      create.title = `在“${item.label}”文件夹下创建项目`;
    }
    if (item.actions.parentElement !== host) host.appendChild(item.actions);
    host.hidden = false;
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
    for (const listItem of currentItems) {
      const row = listItem.querySelector(ROW_SELECTOR);
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

    // Codex initially renders a newly created conversation with a client-new-thread id,
    // then persists it under a UUID. The catalog can see that UUID before React replaces
    // the temporary row, so compare the exact title only for temporary ids during this
    // hand-off. Permanent conversations continue to be matched strictly by id.
    const catalogEntriesByTitle = new Map();
    for (const entry of item.catalogEntries) {
      const title = normalizedThreadTitle(entry.title);
      if (!title) continue;
      const entries = catalogEntriesByTitle.get(title) || [];
      entries.push(entry);
      catalogEntriesByTitle.set(title, entries);
    }
    for (const entries of catalogEntriesByTitle.values()) {
      entries.sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    }
    const temporaryNativeCatalogId = new Map();
    const nativeAliasByCatalogId = new Map();
    const claimedCatalogIds = new Set();
    for (const native of nativeRows) {
      if (!isTemporaryThreadId(native.threadId) || !native.title) continue;
      const candidate = (catalogEntriesByTitle.get(native.title) || []).find((entry) => {
        const catalogId = normalizedThreadId(entry.threadId);
        return catalogId && !claimedCatalogIds.has(catalogId);
      });
      const catalogId = normalizedThreadId(candidate?.threadId);
      if (!catalogId) continue;
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
      if (catalogById.has(threadId) || temporaryNativeCatalogId.has(threadId)) continue;
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
    }

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
    result.textContent = allSelected
      ? `全部 ${entries.length} 个对话 · 最近请求优先`
      : !ranked.length
      ? "没有匹配的项目"
      : searching
        ? `找到 ${ranked.length} 个项目 · ${matchingConversationCount} 个对话`
        : `${ranked.length} 个文件夹 · 最近使用优先`;
    const expand = root.querySelector("[data-codex-sidebar-folder-expand]");
    expand.hidden = tagItems.length <= 6;
    expand.setAttribute("aria-expanded", String(folderTagsExpanded));
    expand.querySelector("span").textContent = folderTagsExpanded ? "收起" : "展开全部";
    moveActiveFolderActions(allSelected ? null : items.find((item) => item.id === activeFolderId));
    revealFolderSearchMatch(allSelected ? null : items.find((item) => item.id === activeFolderId));
  }

  function clearFolderEnhancement() {
    restoreFolderActions();
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
    status.querySelector(`.${USAGE_TEXT_CLASS}`).textContent = label;
    status.querySelector(`.${USAGE_VALUE_CLASS}`).textContent = value;
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
    if (button.parentElement !== host || button.nextElementSibling !== searchSlot) host.insertBefore(button, searchSlot);
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
      button.title = "快捷入口设置";
      button.innerHTML = settingsShortcutSvg();
    }
    button.onclick = openShortcutSettings;
    const notification = document.querySelector('button[aria-label^="查看活动"], button[aria-label^="View activity"], button[aria-label*="通知"], button[aria-label*="Notification"]');
    let notificationSlot = notification;
    while (notificationSlot?.parentElement && notificationSlot.parentElement !== host) {
      notificationSlot = notificationSlot.parentElement;
    }
    const before = notificationSlot?.parentElement === host ? notificationSlot : searchSlot;
    if (button.parentElement !== host || button.nextElementSibling !== before) host.insertBefore(button, before);
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

  function sync() {
    if (destroyed) return;
    ensureShortcutGrid();
    ensureSkillOrganizer();
    resumeSkillsGroupingOpenRequest();
    ensureViewToggle();
    ensureShortcutSettingsButton();
    ensureSectionTabs();
    ensureFolderSwitcher();
    const rows = visibleRows();
    const anchor = !layoutAnchored
      ? rows.find((row) => row.getAttribute("aria-current") === "page")
        || rows.find((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
        || rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })
      : null;
    for (const row of rows) {
      applySummary(row, previewForRow(row));
    }
    ensureVirtualPinnedRows();
    ensureGlobalRecentRows();
    ensureInterruptedRows();
    sortNativePinnedRows();
    if (anchor) {
      anchor.scrollIntoView({ block: viewMode === "card" ? "center" : "nearest" });
      layoutAnchored = true;
    }
    enhanceTooltip();
  }

  function setPreviews(items) {
    for (const preview of Array.isArray(items) ? items : []) {
      if (preview?.key) previews.set(preview.key, preview);
    }
    sync();
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
    sync();
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
    sync();
  }

  function setInterruptedCatalog(items) {
    interruptedCatalog = (Array.isArray(items) ? items : [])
      .filter((entry) => normalizedThreadId(entry?.threadId) && typeof entry?.title === "string")
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    interruptedCatalogByThread = new Map(interruptedCatalog.map((entry) => [normalizedThreadId(entry.threadId), entry]));
    sync();
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
    sync();
  }

  function setActiveProjectThreads(items) {
    activeProjectThreadIds = new Set((Array.isArray(items) ? items : []).map(normalizedThreadId).filter(Boolean));
    sync();
  }

  function setUsage(value) {
    usage = value && typeof value === "object" ? value : {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      ariaLabel: "Codex 剩余量暂不可用",
    };
    sync();
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

  function handleWorkspaceEnhancementKeydown(event) {
    if (event.key === "Escape" && assetConsolePage && !assetConsolePage.hidden) {
      event.preventDefault();
      closeAssetConsolePanel();
    }
  }

  function scheduleSync() {
    if (destroyed || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync();
    }, 80);
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
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-expanded"] });
    document.addEventListener("pointerover", handlePreviewPointerOver, true);
    document.addEventListener("pointerout", handlePreviewPointerOut, true);
    document.addEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    document.addEventListener("click", handlePinDocumentClick, true);
    document.addEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    window.addEventListener("message", handleAssetConsoleMessage);
    sync();
  }

  function destroy() {
    destroyed = true;
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
    document.removeEventListener("click", handlePinDocumentClick, true);
    document.removeEventListener("keydown", handleWorkspaceEnhancementKeydown, true);
    window.removeEventListener("message", handleAssetConsoleMessage);
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
    document.getElementById(SHORTCUT_SETTINGS_ID)?.remove();
    clearSectionEnhancement();
    closeCustomShortcutPanel(false);
    closeAssetConsolePanel({ notify: true, restoreFocus: false });
    assetConsolePage?.remove();
    assetConsolePage = null;
    assetConsoleFrame = null;
    clearSkillOrganizer();
    customShortcutPage?.remove();
    customShortcutPage = null;
    customShortcutFrame = null;
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
    destroy,
    refresh: sync,
    setPreviews,
    setSearchCatalog,
    setRecentCatalog,
    setInterruptedCatalog,
    setPinnedThreads,
    setActiveProjectThreads,
    setUsage,
    setAssetConsole,
    setAssetConsolePanel,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
