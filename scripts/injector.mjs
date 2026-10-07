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
import { readOptionalThemeSource } from "../lib/theme-package.mjs";
import { createLayaSearchController, LAYA_SEARCH_BINDING } from "../lib/laya-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
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
const layaSearchController = createLayaSearchController({ repository });
const readResetNotice = createResetAnnouncementReader();
const conversationFolders = createConversationFolders();
const syncConversationFolders = createConversationFolderSync({ folders: conversationFolders, repository });

let stopped = false;
const sessions = new Map();
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
    const userSource = baseSource + "\n" + claudeSource + "\n" + await readOptionalThemeSource(root);
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
  return new AssetConsoleBridge(assetConsoleOptions);
}

async function disposeRendererSession(session, { destroy = false } = {}) {
  if (!session) return;
  if (destroy) {
    try { await session.client.evaluate("window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  }
  await session.assetConsoleBridge.dispose();
  session.efficiencyBridge?.dispose();
  session.skillOrganizationBridge?.dispose();
  session.resetMonitorBridge?.dispose();
  session.claudeBridge?.dispose();
  session.layaSearchBridge?.dispose();
  session.client.close();
  session.deliveredHistoryKey = "";
}

async function attachTarget(target) {
  const client = await connectCodexTarget(target);
  const assetConsoleBridge = createAssetConsoleBridge();
  const efficiencyController = createEfficiencyController({ repository, conversationFolders,
    readActiveContext: () => readActiveConversationContext({ client }),
    executeContext: (payload) => executeConfirmedContext({ client, ...payload }) });
  const efficiencyBridge = new EfficiencyBridge(efficiencyController);
  const layaSearchBridge = new EfficiencyBridge(layaSearchController, { binding: LAYA_SEARCH_BINDING,
    resolver: "resolveLayaSearchRequest", publicErrorCodes: ["LAYA_SEARCH_ERROR"], fallbackError: "Laya 检索未完成，普通搜索仍可使用。" });
  const skillOrganizationController = createSkillOrganizationController({ store: skillOrganizationStore, trace: skillProvenance.trace, readCatalog: async ({ refresh = false } = {}) => {
    const active = await readActiveConversationContext({ client });
    const record = active?.threadId ? await repository.resolveEfficiencyThread(active.threadId) : null;
    return readCachedSkillCatalog(record?.projectPath || "", { refresh });
  } });
  const skillOrganizationBridge = new SkillOrganizationBridge(skillOrganizationController);
  const resetMonitorBridge = new EfficiencyBridge(resetMonitorController, { binding: RESET_MONITOR_BINDING,
    resolver: "resolveResetMonitorRequest", publicErrorCodes: ["RESET_MONITOR_ERROR"], fallbackError: "监控设置未确认生效，请刷新核对。" });
  const claudeBridge = new EfficiencyBridge(claudeController, { binding: CLAUDE_BINDING,
    resolver: "resolveClaudeRequest", publicErrorCodes: ["CLAUDE_ERROR"], actionPayloadLimits: { "persona-save": 750000 }, fallbackError: "Claude 操作未确认完成；请核对本机连接，输入已保留。" });
  try {
    // New-document registration must be enabled on this exact CDP connection.
    await client.send("Page.enable");
    const oldIdentifier = await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
    if (oldIdentifier) {
      try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
    }
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
    const userSource = baseSource + "\n" + claudeSource + "\n" + await readOptionalThemeSource(root);
    const sourceHash = createHash("sha256").update(userSource).update(JSON.stringify(managedShortcuts)).digest("hex");
    const rendererSource = `if (window.top === window) { window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = ${JSON.stringify(target.id)}; window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__ = ${JSON.stringify(managedShortcuts)}; ${userSource}\n window.__AIYOUCODEX_RUNTIME_SOURCE_HASH__ = ${JSON.stringify(sourceHash)}; }`;
    const snapshot = await client.evaluate(RENDERER_HEALTH_EXPRESSION);
    const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
    // Reconnect to the same document without destroying its mounted/parked pages.
    if (!canReuseRenderer(snapshot, sourceHash)) await client.evaluate(rendererSource);
    await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
    await assetConsoleBridge.install(client);
    await efficiencyBridge.install(client);
    await layaSearchBridge.install(client);
    await skillOrganizationBridge.install(client);
    await resetMonitorBridge.install(client);
    await claudeBridge.install(client);
    await client.evaluate("window.__aiyouClaudeInjection__?.onBridgeReady?.();true");
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
      registeredScriptIdentifier: registered.identifier,
      deliveredHistoryKey: "",
      persistentShortcutIds: managedShortcuts
        .filter((shortcut) => shortcut.openMode === "internal" && shortcut.keepAlive === true)
        .map((shortcut) => shortcut.id),
      persistentShortcutReady: new Set(),
    };
    acceptDocumentHealth(session, await client.evaluate(RENDERER_HEALTH_EXPRESSION));
    session.bridgeDocumentEpoch = session.documentEpoch;
    return session;
  } catch (error) {
    await assetConsoleBridge.dispose().catch(() => {});
    efficiencyBridge.dispose();
    layaSearchBridge.dispose();
    skillOrganizationBridge.dispose();
    resetMonitorBridge.dispose();
    claudeBridge.dispose();
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
      && process.env.CODEX_SIDEBAR_ALLOW_HOST_RESTART === "1") {
    let app = null;
    try { app = await desktopAppRuntime.readProcess(); } catch {}
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
    repository.readRecentCatalog(),
    repository.readPinnedThreadIds(),
    readActiveTaskThreads(),
    repository.readRemoteProjectCatalog?.() || [],
    repository.readLocalProjectCatalog?.() || [],
  ]);
  const remoteCatalog = await readRemoteCatalog(session, remoteProjects);
  const threadExecutionStates = await readNativeExecutionStates(session, remoteProjects.map(project => project.hostId));
  const recentCatalog = [...localRecentCatalog, ...remoteCatalog];
  const authoritative = activeContext?.threadId ? await repository.resolveEfficiencyThread(activeContext.threadId) : null;
  try { await syncConversationFolders(localRecentCatalog, authoritative); }
  catch { /* A folder failure must not tear down sidebar cards or chat. */ }
  const catalogKey = authoritative?.projectPath || "";
  const skillCatalog = await readCachedSkillCatalog(catalogKey);
  let skillOrganization;
  try { skillOrganization = await session.skillOrganizationController.snapshot(skillCatalog); }
  catch { /* A corrupt optional preference must not stop cards or Skills discovery. */ }
  const interruptedCatalog = await repository.readInterruptedCatalog({
    activeThreadIds: taskboardStatus.activeThreadIds,
  });
  const recentRequests = localRecentCatalog.slice(0, 30).map((entry) => ({
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

async function stop() {
  if (stopped) return;
  stopped = true;
  layaSearchController.stop();
  await claudeController.stopAll();
  const closing = [...sessions.values()];
  sessions.clear();
  // A supervisor restart must not take the user's persistent pages down with it.
  await Promise.allSettled(closing.map((session) => disposeRendererSession(session, { destroy: !options.watch })));
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
    try {
      const reconciliation = await reconcileTargets();
      for (const failure of reconciliation.errors) {
        process.stderr.write(`[renderer ${failure.targetId}] ${failure.phase} failed: ${failure.error?.message || failure.error}\n`);
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
