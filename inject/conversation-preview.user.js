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
  const SECTION_TABS_ID = "codex-sidebar-section-tabs";
  const SECTION_TAB_STORAGE_KEY = "codex-conversation-preview:section-tab";
  const SECTION_NAMES = ["置顶", "项目", "最近"];
  const FOLDER_SWITCHER_ID = "codex-sidebar-folder-switcher";
  const FOLDER_STORAGE_KEY = "codex-conversation-preview:folder-id";
  const VIEW_STORAGE_KEY = "codex-conversation-preview:view-mode";
  const HOME_PROJECT_SHELF_ID = "codex-home-project-shelf";
  const HOME_PROJECT_STATE_KEY = "codex-conversation-preview:home-projects-state";
  const THREAD_STATUS_STORAGE_KEY = "codex-conversation-preview:thread-statuses";
  const STATUS_BUTTON_CLASS = "codex-conversation-status-button";
  const STATUS_MENU_ID = "codex-conversation-status-menu";
  const SUMMARY_CLASS = "codex-conversation-core-summary";
  const DETAILS_CLASS = "codex-conversation-hover-details";
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
  let previews = new Map();
  let shortcutSources = new Map();
  let sectionSources = new Map();
  let sectionTogglePending = new Map();
  let folderSources = new Map();
  let folderTogglePending = new Map();
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
  let folderSearchExpansionPending = null;
  let folderSearchRevealKey = "";
  let threadStatuses = {};
  let openStatusButton = null;
  let homeProjects = {
    available: true,
    cards: [],
    message: "",
  };
  let homeProjectsState = null;
  try { viewMode = localStorage.getItem(VIEW_STORAGE_KEY) === "card" ? "card" : "list"; } catch {}
  try {
    const savedSectionTab = localStorage.getItem(SECTION_TAB_STORAGE_KEY);
    if (SECTION_NAMES.includes(savedSectionTab)) activeSectionTab = savedSectionTab;
  } catch {}
  try { activeFolderId = localStorage.getItem(FOLDER_STORAGE_KEY) || null; } catch {}
  try {
    const savedHomeProjectsState = JSON.parse(localStorage.getItem(HOME_PROJECT_STATE_KEY) || "null");
    if (savedHomeProjectsState && typeof savedHomeProjectsState === "object") homeProjectsState = savedHomeProjectsState;
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
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"],
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > *,
      html[data-codex-conversation-view="card"] [data-codex-conversation-card-grid="true"] > [data-codex-conversation-card-item="true"] > * > * {
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
        background: #ef4755;
        box-shadow: 0 0 0 2px color-mix(in srgb, #ef4755 22%, transparent);
        content: "";
      }
      .${STATUS_BUTTON_CLASS}[data-status="urgent-or-important"]::before {
        background: #f28a16;
        box-shadow: 0 0 0 2px color-mix(in srgb, #f28a16 22%, transparent);
      }
      .${STATUS_BUTTON_CLASS}[data-status="not-urgent"]::before {
        background: #2fa56b;
        box-shadow: 0 0 0 2px color-mix(in srgb, #2fa56b 22%, transparent);
      }
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
      [data-codex-sidebar-section-heading-hidden="true"] {
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        gap: 3px;
      }
      #${SECTION_TABS_ID} [role="tab"] {
        display: inline-flex;
        min-width: 0;
        height: 32px;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0 8px;
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
      [data-codex-home-suggestions-hidden="true"] {
        display: none !important;
      }
      #${HOME_PROJECT_SHELF_ID} {
        display: flex;
        width: 100%;
        min-width: 0;
        flex-direction: column;
        gap: 8px;
        box-sizing: border-box;
        color: var(--color-token-text-primary, var(--color-token-foreground, currentColor));
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-header {
        display: flex;
        min-width: 0;
        height: 24px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-heading {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 7px;
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        line-height: 20px;
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-heading::before {
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 50%;
        background: var(--vscode-textLink-foreground, #2f95ff);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--vscode-textLink-foreground, #2f95ff) 10%, transparent);
        content: "";
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-count {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 56%, transparent));
        font-size: 11px;
        line-height: 18px;
        white-space: nowrap;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-grid] {
        display: grid;
        min-width: 0;
        max-height: 174px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: stretch;
        gap: 8px;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 1px;
        scrollbar-gutter: stable;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-card] {
        position: relative;
        min-width: 0;
        height: 82px;
        overflow: hidden;
        border: 0.5px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 13px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 72%, transparent);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent), 0 4px 13px color-mix(in srgb, black 5%, transparent);
        backdrop-filter: blur(14px) saturate(112%);
        -webkit-backdrop-filter: blur(14px) saturate(112%);
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-open] {
        display: grid;
        width: 100%;
        height: 100%;
        min-width: 0;
        grid-template-columns: 34px minmax(0, 1fr);
        grid-template-rows: 20px 18px 18px;
        align-content: center;
        column-gap: 9px;
        box-sizing: border-box;
        padding: 9px 34px 9px 10px;
        overflow: hidden;
        border: 0;
        border-radius: inherit;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background-color 150ms ease, transform 150ms ease;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-open]:hover {
        background: color-mix(in srgb, var(--color-token-list-hover-background, Canvas) 82%, transparent);
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-open]:active {
        transform: scale(0.995);
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-open]:focus-visible,
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin]:focus-visible {
        outline: 2px solid var(--color-token-accent-foreground, Highlight);
        outline-offset: -3px;
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-avatar {
        display: inline-flex;
        grid-row: 1 / 4;
        width: 34px;
        height: 34px;
        align-self: center;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 10px;
        background: color-mix(in srgb, currentColor 88%, Canvas);
        color: var(--color-token-main-surface-primary, Canvas);
        font-size: 13px;
        font-weight: 680;
        line-height: 1;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-name],
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-task] {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-name] {
        padding-right: 4px;
        font-size: 13px;
        font-weight: 640;
        line-height: 20px;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-task] {
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 63%, transparent));
        font-size: 11px;
        line-height: 18px;
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-meta {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        font-size: 10px;
        line-height: 18px;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-status] {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 4px;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 62%, transparent));
        white-space: nowrap;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-status]::before {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        content: "";
      }
      #${HOME_PROJECT_SHELF_ID} [data-phase="active"] [data-codex-home-project-status] {
        color: var(--vscode-textLink-foreground, #2f95ff);
      }
      #${HOME_PROJECT_SHELF_ID} [data-phase="completed"] [data-codex-home-project-status] {
        color: #b7791f;
      }
      #${HOME_PROJECT_SHELF_ID} [data-phase="pinned"] [data-codex-home-project-status] {
        color: #7c5ce0;
      }
      #${HOME_PROJECT_SHELF_ID} .codex-home-project-active-count {
        min-width: 0;
        overflow: hidden;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 52%, transparent));
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin] {
        display: inline-flex;
        position: absolute;
        z-index: 2;
        top: 7px;
        right: 7px;
        width: 25px;
        height: 25px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 55%, transparent));
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease, transform 150ms ease;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin]:hover {
        background: color-mix(in srgb, currentColor 7%, transparent);
        color: var(--color-token-text-primary, currentColor);
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin][aria-pressed="true"] {
        background: color-mix(in srgb, #7c5ce0 13%, transparent);
        color: #7c5ce0;
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin]:active {
        transform: scale(0.94);
      }
      #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin] svg {
        width: 15px;
        height: 15px;
      }
      #${HOME_PROJECT_SHELF_ID}[data-available="false"] {
        width: fit-content;
        max-width: 100%;
        padding: 7px 10px;
        border: 0.5px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--color-token-main-surface-secondary, Canvas) 62%, transparent);
        color: var(--color-token-description-foreground, color-mix(in srgb, currentColor 58%, transparent));
        font-size: 11px;
        line-height: 18px;
      }
      @media (max-width: 1050px) {
        #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-grid] {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #${TOGGLE_ID},
        #${TOGGLE_ID} .${SWITCH_THUMB_CLASS},
        #${USAGE_ID} .${USAGE_FILL_CLASS},
        #${SHORTCUT_GRID_ID} .${SHORTCUT_CARD_CLASS},
        #${SECTION_TABS_ID} [role="tab"],
        #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-tag],
        #${FOLDER_SWITCHER_ID} [data-codex-sidebar-folder-expand] svg,
        #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-open],
        #${HOME_PROJECT_SHELF_ID} [data-codex-home-project-pin] {
          transition-duration: 0.01ms !important;
        }
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] {
        width: min(30rem, calc(100vw - 16px)) !important;
        max-width: min(30rem, calc(100vw - 16px)) !important;
      }
      [role="tooltip"][data-codex-conversation-preview-tooltip="true"] [class*="max-w-"] {
        max-width: none !important;
        width: 100% !important;
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

  function visibleRows() {
    return Array.from(document.querySelectorAll(ROW_SELECTOR)).filter((row) => row.isConnected);
  }

  const STATUS_OPTIONS = [
    { value: "urgent-important", label: "紧急且重要", color: "#ef4755" },
    { value: "urgent-or-important", label: "紧急或重要", color: "#f28a16" },
    { value: "not-urgent", label: "不紧急", color: "#2fa56b" },
    { value: "clear", label: "清除标注", color: "#b5b7ba" },
  ];

  function threadStatusKey(row) {
    return row.getAttribute("data-app-action-sidebar-thread-id") || rowKey(row);
  }

  function threadStatus(key) {
    return STATUS_OPTIONS.some((option) => option.value === threadStatuses[key])
      ? threadStatuses[key]
      : "urgent-important";
  }

  function statusOption(value) {
    return STATUS_OPTIONS.find((option) => option.value === value) || STATUS_OPTIONS[0];
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
    threadStatuses[key] = statusOption(value).value;
    persistThreadStatuses();
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((button) => {
      if (button.dataset.threadStatusKey === key) updateStatusButton(button, threadStatuses[key]);
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
    requestAnimationFrame(() => menu.querySelector('[aria-checked="true"]')?.focus());
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

  function nativeShortcutSources() {
    const newConversation = findNativeShortcutButton("新对话");
    const pullRequests = findNativeShortcutButton("拉取请求");
    const navigationGroup = pullRequests?.parentElement;
    const newConversationRow = newConversation?.parentElement;
    const header = newConversationRow?.parentElement?.parentElement?.parentElement;
    if (!newConversation || !navigationGroup || !header) return null;

    const navigationButtons = Array.from(navigationGroup.children)
      .filter((node) => node instanceof HTMLButtonElement && !node.closest(`#${SHORTCUT_GRID_ID}`));
    const quickButton = Array.from(newConversationRow.children)
      .flatMap((node) => node === newConversation ? [] : Array.from(node.querySelectorAll?.("button") || []))[0] || null;
    const items = [
      { name: "新对话", button: newConversation, quickButton },
      ...navigationButtons.map((button) => ({ name: shortcutLabel(button), button, quickButton: null })),
    ].filter((item, index, values) => item.name && values.findIndex((candidate) => candidate.name === item.name) === index);
    return { header, newConversationRow, navigationGroup, items };
  }

  function shortcutIcon(source, className = SHORTCUT_ICON_CLASS) {
    const host = document.createElement("span");
    host.className = className;
    host.setAttribute("aria-hidden", "true");
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
    button.setAttribute("aria-label", item.button.getAttribute("aria-label") || item.name);
    button.title = item.name;
    const label = document.createElement("span");
    label.className = SHORTCUT_LABEL_CLASS;
    label.textContent = item.name;
    button.append(shortcutIcon(item.button), label);
    button.onclick = () => item.button.click();
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
        item.quickButton.click();
      };
      wrap.appendChild(quick);
    }
    return wrap;
  }

  function updateShortcutCard(grid, item) {
    const button = Array.from(grid.querySelectorAll("[data-codex-sidebar-shortcut-card]"))
      .find((candidate) => candidate.dataset.codexSidebarShortcutName === item.name);
    if (!button) return;
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
  }

  function ensureShortcutGrid() {
    const sources = nativeShortcutSources();
    if (!sources || sources.items.length < 2) return;
    let grid = document.getElementById(SHORTCUT_GRID_ID);
    const needsRebuild = grid?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || grid?.parentElement !== sources.header
      || grid?.children.length !== sources.items.length
      || sources.items.some((item) => shortcutSources.get(item.name) !== item.button);
    if (needsRebuild) {
      clearShortcutEnhancement();
      grid = document.createElement("div");
      grid.id = SHORTCUT_GRID_ID;
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "快捷入口");
      grid.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      grid.replaceChildren(...sources.items.map(createShortcutCard));
      sources.header.appendChild(grid);
      shortcutSources = new Map(sources.items.map((item) => [item.name, item.button]));
    }
    sources.newConversationRow.setAttribute("data-codex-sidebar-shortcut-source-hidden", "true");
    sources.navigationGroup.setAttribute("data-codex-sidebar-shortcut-source-group-hidden", "true");
    for (const item of sources.items) {
      item.button.dataset.codexSidebarShortcutSourceName = item.name;
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
    const items = SECTION_NAMES.map(nativeSectionSource);
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

  function sectionIdPart(name) {
    return name === "置顶" ? "pinned" : name === "项目" ? "projects" : "recent";
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
      item.section.id = `codex-sidebar-section-panel-${part}`;
      item.section.setAttribute("role", "tabpanel");
      item.section.setAttribute("aria-labelledby", `codex-sidebar-section-tab-${part}`);
      item.section.dataset.codexSidebarSectionPanel = item.name;
      item.heading.dataset.codexSidebarSectionHeadingHidden = "true";
      if (syncNative) setNativeSectionExpanded(item, selected);
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
      tab.setAttribute("aria-controls", `codex-sidebar-section-panel-${part}`);
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
  }

  function ensureSectionTabs() {
    const sources = nativeSectionSources();
    if (!sources) return;
    if (!activeSectionTab) {
      activeSectionTab = sources.items.find((item) => item.button.getAttribute("aria-expanded") === "true")?.name || "项目";
    }
    let bar = document.getElementById(SECTION_TABS_ID);
    const projectActions = sources.items.find((item) => item.name === "项目")?.actions;
    const needsRebuild = bar?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || bar?.parentElement !== sources.common
      || sources.items.some((item) => sectionSources.get(item.name)?.section !== item.section)
      || sectionSources.get("项目")?.actions !== projectActions;
    if (needsRebuild) {
      clearSectionEnhancement();
      bar = createSectionTabs();
      sources.common.insertBefore(bar, sources.common.firstChild);
      sectionSources = new Map(sources.items.map((item) => [item.name, item]));
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
    updateSectionTabState(sources.items);
  }

  function folderLastUsed(folder) {
    let latest = 0;
    for (const row of folder.querySelectorAll(ROW_SELECTOR)) {
      const time = Date.parse(previews.get(rowKey(row))?.updatedAt || "");
      if (Number.isFinite(time) && time > latest) latest = time;
    }
    return latest;
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
        .map((thread) => thread.getAttribute("data-app-action-sidebar-thread-title") || "")
        .filter(Boolean);
      const catalogEntries = searchCatalogByProject.get(id) || [];
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

  function normalizedThreadId(value) {
    return String(value || "").trim().replace(/^(?:local|cloud):/i, "").toLocaleLowerCase();
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
    const matches = catalogMatchesForFolder(item);
    if (!matches.length) return;
    const matchingIds = new Set(matches.map((entry) => normalizedThreadId(entry.threadId)));
    const matchingTitles = new Set(matches.map((entry) => entry.title));
    const rows = Array.from(item.folder.querySelectorAll(ROW_SELECTOR));
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
    if (row?.isConnected && source.parentElement !== row) {
      const selectProject = Array.from(row.children).find((child) => child.matches?.("button[data-app-action-sidebar-select-project]"));
      row.insertBefore(source, selectProject || null);
    }
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
    if (item.actions.parentElement !== host) host.appendChild(item.actions);
    host.hidden = false;
  }

  function selectFolder(id, { focus = false, persist = !normalizeFolderSearch(folderSearchQuery) } = {}) {
    if (!folderSources.has(id)) return;
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
    tag.setAttribute("aria-controls", `codex-sidebar-folder-panel-${item.id}`);
    tag.setAttribute("aria-label", `显示文件夹 ${item.label}`);
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
    if (folderPreSearchId && folderSources.has(folderPreSearchId)) activeFolderId = folderPreSearchId;
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
    if (!normalizeFolderSearch(folderSearchQuery) && !items.some((item) => item.id === activeFolderId)) {
      activeFolderId = items.find((item) => item.active)?.id || ranked[0]?.id || null;
    } else if (normalizeFolderSearch(folderSearchQuery) && !ranked.some((item) => item.id === activeFolderId)) {
      activeFolderId = ranked[0]?.id || null;
    }

    for (const item of items) {
      const selected = item.id === activeFolderId;
      item.panelHost.hidden = !selected;
      item.panelHost.dataset.codexSidebarFolderPanel = item.label;
      item.panelHost.dataset.codexSidebarFolderPanelId = item.id;
      item.folder.id = `codex-sidebar-folder-panel-${item.id}`;
      item.folder.setAttribute("aria-labelledby", `codex-sidebar-folder-tag-${item.id}`);
      item.row.dataset.codexSidebarFolderHeadingHidden = "true";
      // Request every native folder behind the single visible panel. Non-empty
      // folders mount their threads, while empty folders safely remain closed.
      // This completes recent-use sorting and project-title search even when
      // Codex originally rendered a populated folder in its collapsed state.
      setNativeFolderExpanded(item);
    }

    const tags = root.querySelector("[data-codex-sidebar-folder-tags]");
    const signature = ranked.map((item) => `${item.id}:${item.lastUsed}`).join("\n");
    if (tags.dataset.signature !== signature) {
      tags.dataset.signature = signature;
      tags.replaceChildren(...ranked.map(createFolderTag));
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
    result.textContent = !ranked.length
      ? "没有匹配的项目"
      : normalizeFolderSearch(folderSearchQuery)
        ? `找到 ${ranked.length} 个项目 · ${matchingConversationCount} 个对话`
        : `${ranked.length} 个文件夹 · 最近使用优先`;
    const expand = root.querySelector("[data-codex-sidebar-folder-expand]");
    expand.hidden = ranked.length <= 6;
    expand.setAttribute("aria-expanded", String(folderTagsExpanded));
    expand.querySelector("span").textContent = folderTagsExpanded ? "收起" : "展开全部";
    moveActiveFolderActions(items.find((item) => item.id === activeFolderId));
    revealFolderSearchMatch(items.find((item) => item.id === activeFolderId));
  }

  function clearFolderEnhancement() {
    restoreFolderActions();
    document.getElementById(FOLDER_SWITCHER_ID)?.remove();
    document.querySelectorAll("[data-codex-sidebar-folder-heading-hidden]").forEach((row) => {
      row.removeAttribute("data-codex-sidebar-folder-heading-hidden");
    });
    document.querySelectorAll("[data-codex-sidebar-folder-panel]").forEach((panel) => {
      panel.hidden = false;
      panel.removeAttribute("data-codex-sidebar-folder-panel");
      panel.removeAttribute("data-codex-sidebar-folder-panel-id");
    });
    for (const item of folderSources.values()) {
      item.folder.removeAttribute("id");
      item.folder.removeAttribute("aria-labelledby");
    }
    folderSources = new Map();
    folderTogglePending = new Map();
  }

  function ensureFolderSwitcher() {
    const project = sectionSources.get("项目");
    const sources = nativeFolderSources();
    const host = project?.heading?.parentElement;
    if (!project || !sources || !host) return;
    if (requestCompleteNativeFolderList(sources)) return;
    let root = document.getElementById(FOLDER_SWITCHER_ID);
    const signature = sources.items.map((item) => item.id).join("\n");
    const needsRebuild = root?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN
      || root?.parentElement !== host
      || root?.dataset.sourceIds !== signature
      || sources.items.some((item) => folderSources.get(item.id)?.row !== item.row);
    if (needsRebuild) {
      clearFolderEnhancement();
      root = createFolderSwitcher();
      root.dataset.sourceIds = signature;
      host.insertBefore(root, project.heading.nextElementSibling);
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
      if (!activeFolderId || !folderSources.has(activeFolderId)) {
        activeFolderId = sources.items.find((item) => item.active)?.id || rankedFolders(sources.items, "")[0]?.id || null;
      }
    } else {
      folderSources = new Map(sources.items.map((item) => [item.id, item]));
    }
    updateFolderSwitcherState(sources.items);
  }

  function persistHomeProjectsState() {
    try {
      if (homeProjectsState && typeof homeProjectsState === "object") {
        localStorage.setItem(HOME_PROJECT_STATE_KEY, JSON.stringify(homeProjectsState));
      }
    } catch {}
  }

  function homeProjectRoute(rawThreadId) {
    const threadId = String(rawThreadId || "").trim().replace(/^(?:local|cloud):/i, "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)
      ? `/local/${threadId}`
      : null;
  }

  function updateViewedCompletion(card) {
    if (!card?.projectId || !card?.completionToken) return;
    if (!homeProjectsState || typeof homeProjectsState !== "object") homeProjectsState = {};
    if (!homeProjectsState.seenCompletionByProject || typeof homeProjectsState.seenCompletionByProject !== "object") {
      homeProjectsState.seenCompletionByProject = {};
    }
    homeProjectsState.seenCompletionByProject[card.projectId] = card.completionToken;
    persistHomeProjectsState();
  }

  function openHomeProject(card) {
    const route = homeProjectRoute(card?.threadId);
    if (!route) return;
    updateViewedCompletion(card);
    window.postMessage({ type: "navigate-to-route", path: route }, "*");
  }

  function togglePinnedHomeProject(projectId) {
    if (!projectId) return;
    if (!homeProjectsState || typeof homeProjectsState !== "object") homeProjectsState = {};
    const pinned = new Set(Array.isArray(homeProjectsState.pinnedProjectIds)
      ? homeProjectsState.pinnedProjectIds.filter((id) => typeof id === "string")
      : []);
    const willPin = !pinned.has(projectId);
    if (willPin) pinned.add(projectId);
    else pinned.delete(projectId);
    homeProjectsState.pinnedProjectIds = [...pinned].sort();
    persistHomeProjectsState();

    homeProjects.cards = homeProjects.cards.flatMap((card) => {
      if (card.projectId !== projectId) return [card];
      if (willPin) {
        return [{
          ...card,
          pinned: true,
          phase: card.phase === "active" ? "active" : "pinned",
          statusLabel: card.phase === "active" ? "执行中" : "已钉住",
        }];
      }
      if (card.phase === "active") return [{ ...card, pinned: false }];
      if (card.completionToken) {
        return [{ ...card, pinned: false, phase: "completed", statusLabel: "待查看" }];
      }
      return [];
    });
    document.getElementById(HOME_PROJECT_SHELF_ID)?.removeAttribute("data-signature");
    sync();
  }

  function createHomeProjectCard(card) {
    const root = document.createElement("div");
    root.dataset.codexHomeProjectCard = "true";
    root.dataset.codexHomeProjectId = card.projectId;
    root.dataset.phase = card.phase;

    const open = document.createElement("button");
    open.type = "button";
    open.dataset.codexHomeProjectOpen = "true";
    open.setAttribute("aria-label", `打开“${card.projectName}”项目的关联对话`);
    open.title = card.taskTitle;
    open.onclick = () => openHomeProject(card);

    const avatar = document.createElement("span");
    avatar.className = "codex-home-project-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = Array.from(String(card.projectName || "项目").trim())[0] || "项";

    const name = document.createElement("span");
    name.dataset.codexHomeProjectName = "true";
    name.textContent = card.projectName;

    const task = document.createElement("span");
    task.dataset.codexHomeProjectTask = "true";
    task.textContent = card.taskTitle;

    const meta = document.createElement("span");
    meta.className = "codex-home-project-meta";
    const status = document.createElement("span");
    status.dataset.codexHomeProjectStatus = "true";
    status.textContent = card.statusLabel;
    const count = document.createElement("span");
    count.className = "codex-home-project-active-count";
    count.textContent = card.activeTaskCount > 1
      ? `${card.activeTaskCount} 个任务正在执行`
      : card.phase === "completed"
        ? "完成后待查看"
        : card.phase === "pinned"
          ? "固定显示"
          : card.taskIdentifier || "打开关联对话";
    meta.append(status, count);
    open.append(avatar, name, task, meta);

    const pin = document.createElement("button");
    pin.type = "button";
    pin.dataset.codexHomeProjectPin = "true";
    pin.setAttribute("aria-pressed", String(card.pinned));
    const pinLabel = card.pinned ? `取消钉住“${card.projectName}”项目` : `钉住“${card.projectName}”项目`;
    pin.setAttribute("aria-label", pinLabel);
    pin.title = pinLabel;
    pin.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.1 3.5h5.8l-.7 4.1 2.3 2.3v1.2H5.5V9.9l2.3-2.3-.7-4.1Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M10 11.1v5.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>';
    pin.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePinnedHomeProject(card.projectId);
    };

    root.append(open, pin);
    return root;
  }

  function clearHomeProjectShelf() {
    document.getElementById(HOME_PROJECT_SHELF_ID)?.remove();
    document.querySelectorAll("[data-codex-home-suggestions-hidden]").forEach((node) => {
      node.removeAttribute("data-codex-home-suggestions-hidden");
    });
  }

  function ensureHomeProjectShelf() {
    const composer = document.querySelector('[data-composer-placement="home"]');
    const homeIcon = document.querySelector('[data-testid="home-icon"]');
    const suggestions = document.querySelector('[class*="group/home-suggestions"]');
    const host = suggestions?.parentElement;
    if (!composer || !homeIcon || !suggestions || !host) {
      clearHomeProjectShelf();
      return;
    }

    const cards = Array.isArray(homeProjects.cards) ? homeProjects.cards : [];
    if (homeProjects.available !== false && !cards.length) {
      clearHomeProjectShelf();
      return;
    }

    let shelf = document.getElementById(HOME_PROJECT_SHELF_ID);
    if (shelf?.dataset.codexPreviewRuntime !== RUNTIME_TOKEN || shelf?.parentElement !== host) {
      shelf?.remove();
      shelf = document.createElement("section");
      shelf.id = HOME_PROJECT_SHELF_ID;
      shelf.dataset.codexPreviewRuntime = RUNTIME_TOKEN;
      host.insertBefore(shelf, suggestions);
    } else if (shelf.nextElementSibling !== suggestions) {
      host.insertBefore(shelf, suggestions);
    }

    if (homeProjects.available === false) {
      suggestions.removeAttribute("data-codex-home-suggestions-hidden");
      shelf.dataset.available = "false";
      shelf.setAttribute("role", "status");
      shelf.setAttribute("aria-live", "polite");
      shelf.removeAttribute("aria-label");
      const signature = `unavailable:${homeProjects.message || ""}`;
      if (shelf.dataset.signature !== signature) {
        shelf.dataset.signature = signature;
        shelf.textContent = homeProjects.message || "项目动态暂不可用";
      }
      return;
    }

    suggestions.dataset.codexHomeSuggestionsHidden = "true";
    shelf.dataset.available = "true";
    shelf.setAttribute("role", "region");
    shelf.setAttribute("aria-label", "当前项目");
    shelf.removeAttribute("aria-live");
    const signature = JSON.stringify(cards.map((card) => [
      card.projectId,
      card.taskId,
      card.taskTitle,
      card.phase,
      card.statusLabel,
      card.activeTaskCount,
      card.pinned,
      card.completionToken,
    ]));
    if (shelf.dataset.signature === signature) return;
    shelf.dataset.signature = signature;

    const header = document.createElement("div");
    header.className = "codex-home-project-header";
    const heading = document.createElement("h2");
    heading.className = "codex-home-project-heading";
    heading.textContent = "当前项目";
    const count = document.createElement("span");
    count.className = "codex-home-project-count";
    count.textContent = `${cards.length} 个项目`;
    header.append(heading, count);
    const grid = document.createElement("div");
    grid.dataset.codexHomeProjectGrid = "true";
    grid.append(...cards.map(createHomeProjectCard));
    shelf.replaceChildren(header, grid);
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

  function ensureViewToggle() {
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!search) return;
    const searchSlot = search.parentElement;
    const host = searchSlot?.parentElement;
    if (!host) return;
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
    button.onclick = handleViewToggle;
    if (button.parentElement !== host || button.nextElementSibling !== searchSlot) host.insertBefore(button, searchSlot);
    ensureUsageStatus(host, button);
    updateViewState();
  }

  function openRow() {
    const rows = visibleRows();
    return rows.find((row) => row.matches(":hover"))
      || rows.find((row) => ["open", "delayed-open"].includes(row.getAttribute("data-state")));
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
    if (!row) return;
    const preview = previews.get(rowKey(row));
    if (!preview) return;
    const title = row.getAttribute("data-app-action-sidebar-thread-title") || "";
    const tooltip = Array.from(document.querySelectorAll('[role="tooltip"]')).find((candidate) =>
      !candidate.querySelector(`.${DETAILS_CLASS}`)
        && Array.from(candidate.querySelectorAll("button")).some((button) => button.textContent.trim() === title),
    );
    if (!tooltip) return;
    const titleButton = Array.from(tooltip.querySelectorAll("button"))
      .find((button) => button.textContent.trim() === title);
    let card = titleButton?.parentElement;
    while (card && card !== tooltip && !card.classList.contains("w-fit")) card = card.parentElement;
    if (!card || card === tooltip) return;

    tooltip.setAttribute("data-codex-conversation-preview-tooltip", "true");
    const details = document.createElement("div");
    details.className = DETAILS_CLASS;
    appendBlock(details, "核心总结", preview.summary);
    appendBlock(details, "最近输入", preview.recentInput);
    appendBlock(details, "最近输出", preview.recentOutput);
    card.appendChild(details);
  }

  function sync() {
    if (destroyed) return;
    ensureShortcutGrid();
    ensureViewToggle();
    ensureSectionTabs();
    ensureFolderSwitcher();
    ensureHomeProjectShelf();
    const rows = visibleRows();
    const anchor = !layoutAnchored
      ? rows.find((row) => row.getAttribute("aria-current") === "page")
        || rows.find((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
        || rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })
      : null;
    for (const row of rows) applySummary(row, previews.get(rowKey(row)));
    if (anchor) {
      anchor.scrollIntoView({ block: viewMode === "card" ? "center" : "nearest" });
      layoutAnchored = true;
    }
    enhanceTooltip();
  }

  function setPreviews(items) {
    previews = new Map((Array.isArray(items) ? items : []).map((preview) => [preview.key, preview]));
    sync();
  }

  function setSearchCatalog(items) {
    searchCatalog = (Array.isArray(items) ? items : []).filter((entry) =>
      entry && typeof entry.projectId === "string" && typeof entry.title === "string",
    );
    searchCatalogByProject = new Map();
    for (const entry of searchCatalog) {
      const entries = searchCatalogByProject.get(entry.projectId) || [];
      entries.push(entry);
      searchCatalogByProject.set(entry.projectId, entries);
    }
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

  function setHomeProjects(value) {
    const source = value && typeof value === "object" ? value : {};
    homeProjects = {
      available: source.available !== false,
      cards: Array.isArray(source.cards) ? source.cards : [],
      message: typeof source.message === "string" ? source.message : "",
    };
    if (source.state && typeof source.state === "object") {
      homeProjectsState = source.state;
      persistHomeProjectsState();
    }
    sync();
  }

  function getHomeProjectsState() {
    return homeProjectsState;
  }

  function scheduleSync() {
    if (destroyed || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      sync();
    }, 80);
  }

  function start() {
    installStyles();
    updateViewState();
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-expanded"] });
    document.addEventListener("pointerover", scheduleSync, true);
    document.addEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    sync();
  }

  function destroy() {
    destroyed = true;
    observer?.disconnect();
    clearTimeout(syncTimer);
    document.removeEventListener("pointerover", scheduleSync, true);
    document.removeEventListener("pointerdown", handleStatusDocumentPointerDown, true);
    closeStatusMenu();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(TOGGLE_ID)?.remove();
    document.getElementById(USAGE_ID)?.remove();
    clearHomeProjectShelf();
    clearShortcutEnhancement();
    clearSectionEnhancement();
    document.documentElement.removeAttribute("data-codex-conversation-view");
    document.querySelectorAll(`.${SUMMARY_CLASS}, .${DETAILS_CLASS}, .${CARD_CONTENT_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`.${STATUS_BUTTON_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll('[data-codex-conversation-preview-enhanced="true"]').forEach((row) => {
      row.removeAttribute("data-codex-conversation-preview-enhanced");
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
    setUsage,
    setHomeProjects,
    getHomeProjectsState,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
