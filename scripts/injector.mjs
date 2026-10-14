#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCodexTarget, readTargets, selectMainCodexTargets } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { readRemoteCatalog, readNativeExecutionStates } from "../lib/remote-thread-catalog.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { createResetAnnouncementReader } from "../lib/reset-announcements.mjs";
import { createResetMonitorController, RESET_MONITOR_BINDING } from "../lib/reset-monitor.mjs";
import {
  DesktopAppRecovery,
  reconcileRendererSessions,
  selectPersistentOwnerTargetId,
} from "../lib/injector-state.mjs";
import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";
import { createAppLifecycleController, APP_LIFECYCLE_BINDING } from "../lib/app-lifecycle.mjs";
import { createDeepSeekSettingsController } from "../lib/deepseek-settings.mjs";
import { readActiveTaskThreads } from "../lib/taskboard-status.mjs";
import { isHostReplyIdle } from "../lib/host-reply-state.mjs";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { createSkillOrganizationStore, createSkillOrganizationController, SkillOrganizationBridge } from "../lib/skill-organization.mjs";
import { createSkillProvenanceIndex } from "../lib/skill-provenance.mjs";
import { readManagedShortcuts } from "../lib/managed-shortcuts.mjs";
import { createEfficiencyController, EfficiencyBridge } from "../lib/efficiency-bridge.mjs";
import { createConversationFolders, createConversationFolderSync } from "../lib/conversation-folders.mjs";
import { executeConfirmedContext } from "../lib/context-execution.mjs";
import { createClaudeController, CLAUDE_BINDING } from "../lib/claude-code.mjs";
import { RENDERER_HEALTH_EXPRESSION, acceptDocumentHealth, canReuseRenderer, recordUpdateFailure, rendererReadiness } from "../lib/renderer-health.mjs";
import { createAgentWorkspace, AGENT_BINDING } from "../lib/agent-workspace.mjs";
import { readOptionalThemeSource } from "../lib/theme-package.mjs";
import { createLayaSearchController, LocalLayaRuntime, LAYA_SEARCH_BINDING } from "../lib/laya-search.mjs";
import { createLayaDocumentSearch } from "../lib/laya-document-search.mjs";
import { createSkillSearchController } from "../lib/skill-search.mjs";
import { createOpenChatCutController } from "../lib/openchatcut-controller.mjs";
import { createOpenChatCutInstaller } from "../lib/openchatcut-install.mjs";
import { registerRendererSource, evaluateRendererSource, removeRendererScripts } from "../lib/renderer-source.mjs";
import { isEnhancementEnabled, createEnhancementController, guardEnhancementSource, ENHANCEMENT_TEARDOWN_EXPRESSION, ENHANCEMENT_RESUME_EXPRESSION } from "../lib/enhancement-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
const agentSourcePath = path.join(root, "inject", "agent-workspace.user.js");
const openChatCutSourcePath = path.join(root, "inject", "openchatcut.user.js");
const claudeSourcePath = path.join(root, "inject", "claude-code.user.js");
const SCRIPT_ID_GLOBAL = "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__";

function parseArgs(argv) {
  const options = { port: 9231, watch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("Invalid port");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const repository = new PreviewRepository();
const agentWorkspace = createAgentWorkspace();
const deepSeekSettingsController = createDeepSeekSettingsController();
const localLayaRuntime = new LocalLayaRuntime();
const layaSearchController = createLayaSearchController({ repository, runtime: localLayaRuntime });
const layaLibrarySearch = createLayaDocumentSearch({ runtime: localLayaRuntime });
const readResetNotice = createResetAnnouncementReader();
const conversationFolders = createConversationFolders();
const syncConversationFolders = createConversationFolderSync({ folders: conversationFolders, repository });

let stopped = false;
let enhancementClosing = false;
const enhancementController = createEnhancementController({ onDisabled: async () => { enhancementClosing = true; } });
const sessions = new Map();
const openChatCutController = createOpenChatCutController({ installer: createOpenChatCutInstaller() });
let openChatCutOwnerTargetId = "";
const openChatCutReady = openChatCutController.start().catch(error => {
  process.stderr.write(`[openchatcut] local bridge unavailable: ${error.message}\n`);
});
let openChatCutEvents = Promise.resolve();
openChatCutController.subscribe(value => {
  openChatCutEvents = openChatCutEvents.then(async () => {
    if (!sessions.size) return;
    const editorEvent = Boolean(value.editorUrl || value.session?.editorUrl);
    if (editorEvent && !sessions.has(openChatCutOwnerTargetId)) {
      const candidates = [...sessions.values()];
      const matches = await Promise.all(candidates.map(async session => {
        const context = await readActiveConversationContext(session).catch(() => null);
        return context?.threadId === value.threadId;
      }));
      openChatCutOwnerTargetId = candidates[matches.indexOf(true)]?.targetId
        || persistentShortcutOwnerTargetId || candidates[0].targetId;
    }
    const targets = [...sessions.values()];
    const dispatched = await Promise.allSettled(targets.map(async session => {
      const event = { ...value };
      if (editorEvent && session.targetId === openChatCutOwnerTargetId) {
        event.editorUrl = await session.assetConsoleBridge.embedOpenChatCut(value.editorUrl || value.session?.editorUrl, value);
        if (event.session) event.session = { ...event.session, editorUrl: event.editorUrl };
      } else if (editorEvent) {
        delete event.editorUrl;
        event.session = event.session ? { ...event.session, editorUrl: undefined } : undefined;
        event.autoOpen = false;
      }
      return session.client.evaluate(`window.__aiyouOpenChatCut__?.update?.(${JSON.stringify(event)})`);
    }));
    dispatched.forEach((result, index) => {
      if (result.status === 'rejected') process.stderr.write(`[openchatcut] renderer ${targets[index].targetId} panel sync failed: ${result.reason?.message || 'unavailable'}\n`);
    });
  }).catch(error => process.stderr.write(`[openchatcut] panel sync failed: ${error.message}\n`));
});
const resetMonitorController = createResetMonitorController();
const claudeController = createClaudeController({ repository,
  readSkills: (cwd) => readCachedSkillCatalog(cwd),
  readActiveContext: () => {
    const session = sessions.get(persistentShortcutOwnerTargetId) || sessions.values().next().value;
    return session ? readActiveConversationContext(session) : null;
  },
});
let persistentShortcutOwnerTargetId = "";
const skillCatalogCache = new Map();
let rendererSourceHashCheckedAt = 0;
let cachedRendererSourceHash = null;

async function expectedRendererSourceHash() {
  const now = Date.now();
  if (now - rendererSourceHashCheckedAt < 5_000) return cachedRendererSourceHash;
  rendererSourceHashCheckedAt = now;
  try {
    const [baseSource, claudeSource, managedShortcuts] = await Promise.all([
      readFile(sourcePath, "utf8"), readFile(claudeSourcePath, "utf8"), readManagedShortcuts(),
    ]);
    const userSource = baseSource + "\n" + claudeSource + "\n" + await readFile(agentSourcePath, "utf8") + "\n" + await readFile(openChatCutSourcePath, "utf8") + "\n" + await readOptionalThemeSource(root);
    // A partial edit must not replace a healthy renderer with invalid source.
    new Function(userSource);
    cachedRendererSourceHash = createHash("sha256").update(userSource)
      .update(JSON.stringify(managedShortcuts)).digest("hex");
  } catch {
    cachedRendererSourceHash = null;
  }
  return cachedRendererSourceHash;
}
const skillOrganizationStore = createSkillOrganizationStore();
const skillProvenance = createSkillProvenanceIndex({ listSessions: async () => {
  await repository.refreshEfficiencyIndex();
  return [...repository.filesById].map(([threadId, filePath]) => ({ threadId, filePath,
    title: repository.metadataById.get(threadId)?.title || "未命名对话" }));
} });
let discoveryFailures = 0;
const desktopAppRecovery = new DesktopAppRecovery();
const desktopAppRuntime = createDesktopAppRuntime();
const appLifecycleController = createAppLifecycleController({ desktopRuntime: desktopAppRuntime, port: options.port });
let recoveryWaitSignature = '';
let recoveryHost = null;
const assetConsoleOptions = {
  staticRoot: process.env.CODEX_ASSET_CONSOLE_STATIC_ROOT
    || path.join(root, "vendor", "codex-workspace-enhancer", "asset-console", "public"),
  tokenPath: process.env.CODEX_ASSET_CONSOLE_TOKEN_FILE,
  port: Number(process.env.CODEX_ASSET_CONSOLE_PORT || 5177),
  logger: (message) => process.stdout.write(`[asset-console] ${message}\n`),
};

function createAssetConsoleBridge() {
  return new AssetConsoleBridge({ ...assetConsoleOptions, openChatCutStatus: context => openChatCutController.status(context) });
}

async function disposeRendererSession(session, { destroy = false, disable = false } = {}) {
  if (!session) return;
  if (disable) {
    const identifiers = await session.client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`).catch(() => null);
    await removeRendererScripts(session.client, identifiers);
    try { await session.client.evaluate(ENHANCEMENT_TEARDOWN_EXPRESSION) } catch {}
  } else if (destroy) {
    try { await session.client.evaluate("window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  }
  await session.assetConsoleBridge.dispose();
  session.efficiencyBridge?.dispose();
  session.skillOrganizationBridge?.dispose();
  session.resetMonitorBridge?.dispose();
  session.claudeBridge?.dispose();
  session.agentBridge?.dispose();
  session.layaSearchBridge?.dispose();
  session.openChatCutBridge?.dispose();
  session.appLifecycleBridge?.dispose();
  session.enhancementBridge?.dispose();
  session.deepSeekSettingsBridge?.dispose();
  session.client.close();
  session.deliveredHistoryKey = "";
}

async function attachTarget(target) {
  if (enhancementClosing || !await isEnhancementEnabled()) throw new Error('AIYOUcodex enhancement is disabled');
  const client = await connectCodexTarget(target).catch(error => { error.rendererPhase = "connect"; throw error; });
  let rendererPhase = "prepare";
  const assetConsoleBridge = createAssetConsoleBridge();
  const efficiencyController = createEfficiencyController({ repository, conversationFolders,
    readActiveContext: () => readActiveConversationContext({ client }),
    executeContext: (payload) => executeConfirmedContext({ client, ...payload }) });
  const efficiencyBridge = new EfficiencyBridge(efficiencyController);
  const appLifecycleBridge = new EfficiencyBridge(appLifecycleController, {
    binding: APP_LIFECYCLE_BINDING, resolver: "resolveAppLifecycleRequest",
    publicErrorCodes: ["APP_EXIT_ERROR"], fallbackError: "退出未完成，请稍后重试。",
  });
  const enhancementBridge = new EfficiencyBridge(enhancementController, {
    binding: "__AIYOUCODEX_ENHANCEMENT_REQUEST__", resolver: "resolveEnhancementRequest",
    publicErrorCodes: ["ENHANCEMENT_ERROR"], fallbackError: "关闭插件未完成，请重试。",
  });
  const deepSeekSettingsBridge = new EfficiencyBridge(deepSeekSettingsController, {
    binding: "__AIYOUCODEX_DEEPSEEK_SETTINGS_REQUEST__", resolver: "resolveDeepSeekSettingsRequest",
    publicErrorCodes: ["DEEPSEEK_SETTINGS_ERROR"], fallbackError: "DeepSeek 设置尚未确认保存，请刷新状态后核对。",
  });
  const skillSearchController = createSkillSearchController({ runtime: localLayaRuntime, search: layaLibrarySearch,
    readCatalog: async () => {
      const active = await readActiveConversationContext({ client });
      const record = active?.threadId ? await repository.resolveEfficiencyThread(active.threadId) : null;
      return readCachedSkillCatalog(record?.projectPath || "");
    } });
  const layaSearchBridge = new EfficiencyBridge({ request: payload => payload.action === "search-skills"
    ? skillSearchController.request(payload) : layaSearchController.request(payload) }, { binding: LAYA_SEARCH_BINDING,
    resolver: "resolveLayaSearchRequest", publicErrorCodes: ["LAYA_SEARCH_ERROR"], actionPayloadLimits: { "search-skills": 750000 }, fallbackError: "Laya 检索未完成，普通搜索仍可使用。" });
  const skillOrganizationController = createSkillOrganizationController({ store: skillOrganizationStore, trace: skillProvenance.trace, readCatalog: async ({ refresh = false } = {}) => {
    const active = await readActiveConversationContext({ client });
    const record = active?.threadId ? await repository.resolveEfficiencyThread(active.threadId) : null;
    return readCachedSkillCatalog(record?.projectPath || "", { refresh });
  } });
  const skillOrganizationBridge = new SkillOrganizationBridge(skillOrganizationController);
  const agentBridge = new EfficiencyBridge(agentWorkspace, { binding: AGENT_BINDING, resolver: "resolveAgentRequest", publicErrorCodes: ["AGENT_ERROR"], actionPayloadLimits: { handoff: 250000, preview: 40000 }, fallbackError: "本机迁移未确认完成，请查看迁移记录并核对目录。" });
  const resetMonitorBridge = new EfficiencyBridge(resetMonitorController, { binding: RESET_MONITOR_BINDING,
    resolver: "resolveResetMonitorRequest", publicErrorCodes: ["RESET_MONITOR_ERROR"], fallbackError: "监控设置未确认生效，请刷新核对。" });
  const claudeBridge = new EfficiencyBridge(claudeController, { binding: CLAUDE_BINDING,
    resolver: "resolveClaudeRequest", publicErrorCodes: ["CLAUDE_ERROR"], actionPayloadLimits: { "persona-save": 750000 }, fallbackError: "Claude 操作未确认完成；请核对本机连接，输入已保留。" });
  const openChatCutBridge = new EfficiencyBridge({ request: async payload => {
    await openChatCutReady;
    const active = await readActiveConversationContext({ client });
    if (["open", "start-editing"].includes(payload.action)) {
      if (!active?.threadId || payload.threadId !== active.threadId) throw Object.assign(new Error("当前对话已变化，请重新打开剪辑工具。"), { code: "OPENCHATCUT_ERROR" });
      openChatCutOwnerTargetId = target.id;
    }
    const result = await openChatCutController.handle(payload, active);
    if (result?.editorUrl || result?.session?.editorUrl) {
      const editorUrl = await assetConsoleBridge.embedOpenChatCut(result.editorUrl || result.session?.editorUrl, result);
      return { ...result, editorUrl, ...(result.session ? { session: { ...result.session, editorUrl } } : {}) };
    }
    return result;
  } }, { binding: "__AIYOUCODEX_OPENCHATCUT_REQUEST__", resolver: "resolveOpenChatCutRequest",
    publicErrorCodes: ["OPENCHATCUT_ERROR", "OPENCHATCUT_INSTALL_REQUIRED", "OPENCHATCUT_INSTALL_UNSUPPORTED", "OPENCHATCUT_THREAD_REQUIRED", "OPENCHATCUT_TARGET_CHANGED", "OPENCHATCUT_EDITOR_NOT_READY", "OPENCHATCUT_BINDING_ERROR", "OPENCHATCUT_PROJECT_ERROR", "OPENCHATCUT_PROJECT_MISMATCH", "OPENCHATCUT_REVIEW_PENDING", "OPENCHATCUT_RECOVERY_REQUIRED", "OPENCHATCUT_STOPPING", "OPENCHATCUT_STOPPED", "OPENCHATCUT_STOP_FAILED", "OPENCHATCUT_BACKGROUND_RUNTIME_FAILED", "OPENCHATCUT_APP_EXITED", "OPENCHATCUT_LAUNCH_FAILED", "OPENCHATCUT_STARTUP_TIMEOUT"], fallbackError: "OpenChatCut 尚未确认连接，请刷新安装与连接状态。" });
  try {
    // New-document registration must be enabled on this exact CDP connection.
    rendererPhase = "page-enable";
    await client.send("Page.enable");
    rendererPhase = "script-identity";
    const oldIdentifier = await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
    const [baseSource, claudeSource, managedShortcuts] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(claudeSourcePath, "utf8"),
      readManagedShortcuts().catch((error) => {
        // A malformed/unreadable private profile is not an intentionally empty
        // configuration. Do not replace a working page with an empty shortcut set.
        process.stderr.write(`[managed-shortcuts] profile unavailable (${error.name || "Error"}); keeping existing page\n`);
        throw new Error("Managed shortcut profile could not be read");
      }),
    ]);
    const userSource = baseSource + "\n" + claudeSource + "\n" + await readFile(agentSourcePath, "utf8") + "\n" + await readFile(openChatCutSourcePath, "utf8") + "\n" + await readOptionalThemeSource(root);
    const sourceHash = createHash("sha256").update(userSource).update(JSON.stringify(managedShortcuts)).digest("hex");
    const rendererSource = guardEnhancementSource(`if (window.top === window) { window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = ${JSON.stringify(target.id)}; window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__ = ${JSON.stringify(managedShortcuts)}; ${userSource}\n window.__AIYOUCODEX_RUNTIME_SOURCE_HASH__ = ${JSON.stringify(sourceHash)}; }`);
    if (enhancementClosing || !await isEnhancementEnabled()) throw new Error('AIYOUcodex enhancement is disabled');
    await client.evaluate(ENHANCEMENT_RESUME_EXPRESSION);
    rendererPhase = "renderer-health";
    const snapshot = await client.evaluate(RENDERER_HEALTH_EXPRESSION);
    rendererPhase = "new-document-register";
    const registered = await registerRendererSource(client, rendererSource);
    // Reconnect to the same document without destroying its mounted/parked pages.
    rendererPhase = "source-evaluate";
    if (!canReuseRenderer(snapshot, sourceHash)) await evaluateRendererSource(client, rendererSource);
    if (enhancementClosing || !await isEnhancementEnabled()) {
      await removeRendererScripts(client, registered);
      await client.evaluate(ENHANCEMENT_TEARDOWN_EXPRESSION);
      throw new Error('AIYOUcodex enhancement is disabled');
    }
    // Keep the previous preload intact until the replacement registered and
    // executed successfully. Both legacy single IDs and new batches are valid.
    // Preload IDs are scoped to the CDP connection and can be reused after
    // reconnecting. Never remove a newly registered script with a reused ID.
    await removeRendererScripts(client, oldIdentifier, { except: registered });
    rendererPhase = "script-identity";
    await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered)}`);
    rendererPhase = "assetConsoleBridge";
    await assetConsoleBridge.install(client);
    rendererPhase = "efficiencyBridge";
    await efficiencyBridge.install(client);
    rendererPhase = "layaSearchBridge";
    await layaSearchBridge.install(client);
    rendererPhase = "skillOrganizationBridge";
    await skillOrganizationBridge.install(client);
    rendererPhase = "resetMonitorBridge";
    await resetMonitorBridge.install(client);
    rendererPhase = "claudeBridge";
    await claudeBridge.install(client);
    rendererPhase = "agentBridge";
    await agentBridge.install(client);
    rendererPhase = "openChatCutBridge";
    await openChatCutBridge.install(client);
    rendererPhase = "appLifecycleBridge";
    await appLifecycleBridge.install(client);
    await enhancementBridge.install(client);
    rendererPhase = "deepSeekSettingsBridge";
    await deepSeekSettingsBridge.install(client);
    rendererPhase = "bridge-ready";
    await client.evaluate("window.__aiyouClaudeInjection__?.onBridgeReady?.();true");
    rendererPhase = "bridge-ready";
    await client.evaluate("window.__aiyouAgentWorkspace__?.onBridgeReady?.();true");
    rendererPhase = "bridge-ready";
    await client.evaluate("window.__aiyouOpenChatCut__?.onBridgeReady?.();true");
    process.stdout.write(`[${new Date().toISOString()}] Codex conversation preview attached to renderer ${target.id}\n`);
    const session = {
      targetId: target.id,
      client,
      assetConsoleBridge,
      efficiencyController,
      efficiencyBridge,
      layaSearchBridge,
      skillOrganizationController,
      skillOrganizationBridge,
      resetMonitorBridge,
      claudeBridge,
      agentBridge,
      openChatCutBridge,
      appLifecycleBridge,
      enhancementBridge,
      deepSeekSettingsBridge,
      registeredScriptIdentifier: registered,
      deliveredHistoryKey: "",
      persistentShortcutIds: managedShortcuts
        .filter((shortcut) => shortcut.openMode === "internal" && shortcut.keepAlive === true)
        .map((shortcut) => shortcut.id),
      persistentShortcutReady: new Set(),
    };
    rendererPhase = "renderer-health";
    acceptDocumentHealth(session, await client.evaluate(RENDERER_HEALTH_EXPRESSION));
    session.bridgeDocumentEpoch = session.documentEpoch;
    return session;
  } catch (error) {
    error.rendererPhase ||= rendererPhase;
    await assetConsoleBridge.dispose().catch(() => {});
    efficiencyBridge.dispose();
    appLifecycleBridge.dispose();
    enhancementBridge.dispose();
    deepSeekSettingsBridge.dispose();
    layaSearchBridge.dispose();
    skillOrganizationBridge.dispose();
    resetMonitorBridge.dispose();
    claudeBridge.dispose();
    agentBridge.dispose();
    openChatCutBridge.dispose();
    client.close();
    throw error;
  }
}

async function persistentShortcutOwnerSession() {
  let focusedTargetIds = [];
  if (!sessions.has(persistentShortcutOwnerTargetId) && sessions.size > 1) {
    const focusStates = await Promise.all([...sessions].map(async ([targetId, session]) => {
      try {
        const focused = await session.client.evaluate("document.hasFocus() && document.visibilityState === 'visible'");
        return focused ? targetId : "";
      } catch {
        return "";
      }
    }));
    focusedTargetIds = focusStates.filter(Boolean);
  }
  persistentShortcutOwnerTargetId = selectPersistentOwnerTargetId({
    sessions,
    currentOwnerTargetId: persistentShortcutOwnerTargetId,
    focusedTargetIds,
  });
  return sessions.get(persistentShortcutOwnerTargetId) || null;
}

async function ensurePersistentManagedShortcuts(session) {
  for (const shortcutId of session?.persistentShortcutIds || []) {
    if (session.persistentShortcutReady?.has(shortcutId)) continue;
    const result = await session.client.evaluate(`window.__codexConversationPreviewInjection__?.ensureManagedShortcut?.(${JSON.stringify(shortcutId)}, { visible: false }) || null`);
    if (result?.ok === true) {
      session.persistentShortcutReady?.add(shortcutId);
    } else if (result && result.reason !== "panel-mount-unavailable") {
      process.stderr.write(`[managed-shortcuts] persistent shortcut ${shortcutId} was not mounted: ${result?.reason || "runtime unavailable"}\n`);
    }
  }
}

async function reconcileTargets() {
  let targets = [];
  let discoveryAvailable = false;
  try {
    targets = selectMainCodexTargets(await readTargets(options.port));
    discoveryAvailable = true;
    discoveryFailures = 0;
  } catch {
    discoveryFailures += 1;
    if ([1, 5, 10, 30, 60].includes(discoveryFailures)) {
      process.stderr.write(`[${new Date().toISOString()}] renderer discovery unavailable (${discoveryFailures}); preserving live sessions\n`);
    }
  }
  if (!discoveryAvailable && discoveryFailures >= 10) {
    for (const [id, session] of sessions) {
      if (session.client.socket?.readyState === 1) continue;
      sessions.delete(id);
      await disposeRendererSession(session).catch(() => {});
    }
  }
  if (targets.length) await appLifecycleController.observeRunningHost().catch(() => {});
  const reconciliation = await reconcileRendererSessions({
    targets,
    discoveryAvailable,
    sessions,
    attach: attachTarget,
    dispose: (session) => disposeRendererSession(session),
    isHealthy: async (session) => {
      try {
        const snapshot = await session.client.evaluate(RENDERER_HEALTH_EXPRESSION);
        const alive = acceptDocumentHealth(session, snapshot);
        const expectedHash = alive ? await expectedRendererSourceHash() : null;
        if (expectedHash && snapshot.sourceHash !== expectedHash) {
          process.stdout.write(`[${new Date().toISOString()}] renderer ${session.targetId} source changed; reattaching without restarting Codex\n`);
          return false;
        }
        if (alive && session.bridgeDocumentEpoch !== session.documentEpoch) {
          await session.assetConsoleBridge.install(session.client);
          await session.layaSearchBridge.install(session.client);
          await session.appLifecycleBridge.install(session.client);
          await session.enhancementBridge.install(session.client);
          await session.deepSeekSettingsBridge.install(session.client);
          session.bridgeDocumentEpoch = session.documentEpoch;
        }
        if (alive) {
          const signature = rendererReadiness(snapshot).failures.join(',');
          if (signature && session.lastHealthFailureSignature !== signature) {
            process.stderr.write(`[${new Date().toISOString()}] renderer ${session.targetId} degraded: ${signature}\n`);
          }
          session.lastHealthFailureSignature = signature;
        }
        return alive;
      } catch {
        // A live connection with a transient evaluation error is not a reason
        // to reinstall UI. Closed transports will reattach idempotently.
        return session.client.socket?.readyState === 1;
      }
    },
  });
  // A reachable endpoint with no recognized page is starting/unsupported, not
  // permission to terminate the host. Only recover an ordinary undebugged app
  // after repeated connection failures and never while a known session exists.
  if (!discoveryAvailable && discoveryFailures >= 5 && !sessions.size && options.watch
      && !enhancementClosing && await isEnhancementEnabled()
      && process.env.CODEX_SIDEBAR_ALLOW_HOST_RESTART === "1") {
    let app = null;
    try { app = await desktopAppRuntime.readProcess(); } catch {}
    if (!appLifecycleController.shouldRecover(app)) {
      desktopAppRecovery.next({ targetAvailable: true, app: null });
      return reconciliation;
    }
    if (app && recoveryHost?.pid !== app.pid) {
      recoveryHost = {pid: app.pid, startedAt: await desktopAppRuntime.readStartedAt(app)};
    }
    // Preserve the same activity boundary between quit and launch.
    const hostStartedAt = recoveryHost?.startedAt;
    const taskStatus = await readActiveTaskThreads({
      isThreadIdle: (id) => isHostReplyIdle(repository, id, hostStartedAt),
    });
    const waitSignature = !taskStatus.available ? 'task-state-unavailable'
      : taskStatus.activeThreadIds.length ? `pending-replies:${taskStatus.activeThreadIds.length}` : '';
    if (waitSignature && waitSignature !== recoveryWaitSignature) {
      process.stdout.write(`[${new Date().toISOString()}] automatic recovery waiting: ${waitSignature}\n`);
    }
    recoveryWaitSignature = waitSignature;
    const action = desktopAppRecovery.next({ targetAvailable: false, app,
      recoveryAllowed: process.env.CODEX_SIDEBAR_ALLOW_HOST_RESTART === "1"
        && taskStatus.available && taskStatus.activeThreadIds.length === 0 });
    if (enhancementClosing || !await isEnhancementEnabled()) return reconciliation;
    if (action?.type === "quit") {
      try {
        await desktopAppRuntime.quit(action.app);
        process.stdout.write(`Restarting ${action.app.appPath} to enable sidebar enhancement\n`);
      } catch {}
    } else if (action?.type === "launch") {
      desktopAppRuntime.launch(action.appPath, options.port, {
        codexHome: process.env.CODEX_HOME,
        userDataDir: process.env.AIYOUCODEX_USER_DATA_DIR,
      });
      desktopAppRecovery.markLaunched();
      process.stdout.write(`Launching ${action.appPath} with sidebar enhancement enabled\n`);
    }
    return reconciliation;
  }
  desktopAppRecovery.next({ targetAvailable: targets.length > 0, app: null });
  return reconciliation;
}

async function readActiveConversationContext(session) {
  if (!session?.client) return { threadId: "", title: "" };
  return session.client.evaluate(`(() => {
    const route = window.__codexConversationPreviewInjection__?.getActiveTaskContext?.();
    if (route) return { threadId: route.threadId, title: route.threadTitle };
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    return {
      threadId: active?.getAttribute('data-app-action-sidebar-thread-id') || '',
      title: active?.getAttribute('data-app-action-sidebar-thread-title') || '',
    };
  })()`);
}

async function pushConversationHistory(session, activeContext = null) {
  if (!session?.client) return;
  const context = activeContext || await readActiveConversationContext(session);
  let conversationHistory = null;
  try {
    if (context?.threadId) {
      conversationHistory = await repository.readConversationHistory(context.threadId, context.title);
    }
  } catch { return; } // Preserve the last delivered history on transient file errors.
  const lastMessage = conversationHistory?.messages?.at(-1);
  const historyKey = conversationHistory
    ? `${session.targetId}:${conversationHistory.threadId}:${conversationHistory.totalCount}:${lastMessage?.id || lastMessage?.timestamp || ""}`
    : `${session.targetId}:none`;
  if (historyKey === session.deliveredHistoryKey) return;
  await session.client.evaluate(`window.__codexConversationPreviewInjection__?.setConversationHistory?.(${JSON.stringify(conversationHistory)})`);
  session.deliveredHistoryKey = historyKey;
}

async function readCachedSkillCatalog(catalogKey, { refresh = false } = {}) {
  let entry = skillCatalogCache.get(catalogKey);
  if (entry?.pending) return entry.pending;
  if (!refresh && entry && Date.now() < entry.expiresAt) return entry.skills;
  entry = { pending: readInstalledSkillCatalog({ cwd: catalogKey || undefined }) };
  skillCatalogCache.set(catalogKey, entry);
  try {
    entry.skills = await entry.pending;
    entry.expiresAt = Date.now() + 5 * 60_000;
    return entry.skills;
  } catch (error) { skillCatalogCache.delete(catalogKey); throw error; }
  finally {
    delete entry.pending;
    if (skillCatalogCache.size > 12) skillCatalogCache.delete(skillCatalogCache.keys().next().value);
  }
}

async function pushPreviews(session) {
  if (!session?.client) return;
  const [requests, activeContext, localRecentCatalog, pinnedThreadIds, taskboardStatus, remoteProjects, localProjects] = await Promise.all([
    session.client.evaluate(`(() => {
      const seen = new Set();
      const allPanel = document.getElementById('codex-sidebar-all-projects');
      const rows = allPanel
        ? Array.from(allPanel.querySelectorAll('[data-codex-sidebar-all-project-row]'))
        : Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]:not([data-codex-sidebar-all-project-row])'));
      const pending = rows.filter((row) => row.getAttribute('data-codex-conversation-preview-loaded') !== 'true');
      const loaded = rows.filter((row) => row.getAttribute('data-codex-conversation-preview-loaded') === 'true');
      return [...pending, ...loaded].flatMap((row) => {
        const id = row.getAttribute('data-app-action-sidebar-thread-id') || '';
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || '';
        const key = id + '\\n' + title;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, id, title }];
      });
    })()`),
    readActiveConversationContext(session),
    repository.readRecentCatalog({ includeExcluded: true }),
    repository.readPinnedThreadIds(),
    readActiveTaskThreads(),
    repository.readRemoteProjectCatalog?.() || [],
    repository.readLocalProjectCatalog?.() || [],
  ]);
  const remoteCatalog = await readRemoteCatalog(session, remoteProjects);
  const threadExecutionStates = await readNativeExecutionStates(session, remoteProjects.map(project => project.hostId));
  const recentCatalog = [...localRecentCatalog, ...remoteCatalog];
  const authoritative = activeContext?.threadId ? await repository.resolveEfficiencyThread(activeContext.threadId) : null;
  const visibleLocalCatalog = localRecentCatalog.filter(entry => !entry.isSubagent);
  try { await syncConversationFolders(visibleLocalCatalog, authoritative); }
  catch { /* A folder failure must not tear down sidebar cards or chat. */ }
  const catalogKey = authoritative?.projectPath || "";
  const skillCatalog = await readCachedSkillCatalog(catalogKey);
  let skillOrganization;
  try { skillOrganization = await session.skillOrganizationController.snapshot(skillCatalog); }
  catch { /* A corrupt optional preference must not stop cards or Skills discovery. */ }
  const interruptedCatalog = await repository.readInterruptedCatalog({
    activeThreadIds: taskboardStatus.activeThreadIds,
  });
  const recentRequests = visibleLocalCatalog.slice(0, 30).map((entry) => ({
    key: `local:${entry.threadId}\n${entry.title}`,
    id: `local:${entry.threadId}`,
    title: entry.title,
  }));
  const interruptedRequests = interruptedCatalog.slice(0, 30).map((entry) => ({
    key: `local:${entry.threadId}\n${entry.title}`,
    id: `local:${entry.threadId}`,
    title: entry.title,
  }));
  const previewRequests = Array.from(new Map(
    [...recentRequests, ...interruptedRequests, ...(Array.isArray(requests) ? requests : [])]
      .filter(request => !request.id?.startsWith("remote:"))
      .map((request) => [request.key, request]),
  ).values());
  const searchCatalog = recentCatalog.filter((entry) => entry.projectId && entry.projectName);
  const [rawPreviews, rawUsage] = await Promise.all([
    repository.readMany(previewRequests),
    repository.readUsage(),
  ]);
  const previews = [...rawPreviews, ...remoteCatalog.map(entry => ({
    key: `${entry.threadId}\n${entry.title}`, threadId: entry.threadId, title: entry.title,
    updatedAt: entry.updatedAt, projectName: entry.projectName, remote: true,
  }))].map((preview) => presentCardPreview(preview));
  const usage = presentRateLimit(rawUsage, { timeZone: "Asia/Shanghai" });
  usage.resetNotice = await readResetNotice({ accountReset: usage.resetAccount || null });
  usage.resetNotice.monitor = await resetMonitorController.snapshot();
  usage.resetNotice.intervalHours = usage.resetNotice.monitor.intervalHours ?? 0.25;
  usage.resetNotice.intervalMinutes = usage.resetNotice.monitor.intervalMinutes;
  // A malformed optional policy must never stop native cards/history delivery.
  let efficiency;
  try { efficiency = await session.efficiencyController.snapshot(); }
  catch { /* Keep the previous efficiency panel state; saves still fail closed. */ }
  const snapshot = { previews, usage, localProjects, searchCatalog, layaSearch: layaSearchController.snapshot(), remoteProjects, recentCatalog, interruptedCatalog, ...(efficiency ? { efficiency } : {}),
    pinnedThreads: pinnedThreadIds, activeProjectThreads: taskboardStatus.activeThreadIds,
    ...(threadExecutionStates ? { threadExecutionStates } : {}),
    ...(skillOrganization ? { skillOrganization } : { skillCatalog }) };
  const serialized = JSON.stringify(snapshot);
  const snapshotHash = createHash("sha256").update(serialized).digest("hex");
  if (session.deliveredSnapshotHash !== snapshotHash) await session.client.evaluate(`(() => {
    const api = window.__codexConversationPreviewInjection__;
    if (typeof api?.setSnapshot !== 'function') throw new Error('Renderer snapshot contract unavailable');
    api.setSnapshot(${serialized});
  })()`);
  session.deliveredSnapshotHash = snapshotHash;
  await pushConversationHistory(session, activeContext);
}

let stopPromise;
function stop() {
  if (stopPromise) return stopPromise;
  stopped = true;
  stopPromise = (async () => {
  const disabled = enhancementClosing || !await isEnhancementEnabled();
  const closing = [...sessions.values()];
  sessions.clear();
  // Stop injected UI before waiting for background requests to settle. A pause
  // must remove preloads; an ordinary supervisor reconnect preserves them.
  await Promise.allSettled(closing.map((session) => disposeRendererSession(session, { destroy: !options.watch, disable: disabled })));
  layaSearchController.stop();
  await claudeController.stopAll();
  await openChatCutController.dispose();
  })();
  return stopPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}

let nextFullRefreshAt = 0;
try {
  while (!stopped) {
    if (enhancementClosing || !await isEnhancementEnabled()) { await stop(); break; }
    try {
      const reconciliation = await reconcileTargets();
      for (const failure of reconciliation.errors) {
        process.stderr.write(`[renderer ${failure.targetId}] ${failure.phase} failed${failure.error?.rendererPhase ? ` at ${failure.error.rendererPhase}` : ""}: ${failure.error?.message || failure.error}\n`);
      }
      const persistentOwner = await persistentShortcutOwnerSession();
      if (persistentOwner) {
        try {
          await ensurePersistentManagedShortcuts(persistentOwner);
        } catch (error) {
          process.stderr.write(`[renderer ${persistentOwner.targetId}] persistent shortcut preload failed: ${error.message}\n`);
        }
      }
      const fullRefresh = reconciliation.attachedTargetIds.length > 0 || Date.now() >= nextFullRefreshAt;
      for (const [targetId, session] of [...sessions]) {
        if (Date.now() < (session.retryUpdateAt || 0)) continue;
        try {
          if (fullRefresh || session.needsFullRefresh) await pushPreviews(session);
          else await pushConversationHistory(session);
          session.needsFullRefresh = false;
          session.updateFailures = 0;
          session.retryUpdateAt = 0;
        } catch (error) {
          recordUpdateFailure(session);
          process.stderr.write(`[${new Date().toISOString()}] [renderer ${targetId}] update failed (retry ${session.updateFailures}): ${error.message}\n`);
          if (!options.watch) throw error;
        }
      }
      if (fullRefresh) {
        nextFullRefreshAt = Date.now() + 5_000;
      }
    } catch (error) {
      if (!options.watch) throw error;
    }
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
} finally {
  if (!options.watch) await stop();
}
