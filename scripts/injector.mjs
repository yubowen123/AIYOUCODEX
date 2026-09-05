#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCodexTarget, readTargets, selectMainCodexTargets } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import {
  DesktopAppRecovery,
  reconcileRendererSessions,
  selectPersistentOwnerTargetId,
} from "../lib/injector-state.mjs";
import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";
import { readActiveTaskThreads } from "../lib/taskboard-status.mjs";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { readManagedShortcuts } from "../lib/managed-shortcuts.mjs";
import { RENDERER_HEALTH_EXPRESSION, acceptDocumentHealth, canReuseRenderer, recordUpdateFailure, rendererReadiness } from "../lib/renderer-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
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

let stopped = false;
const sessions = new Map();
let persistentShortcutOwnerTargetId = "";
let skillCatalog = [];
let nextSkillCatalogRefreshAt = 0;
let discoveryFailures = 0;
const desktopAppRecovery = new DesktopAppRecovery();
const desktopAppRuntime = createDesktopAppRuntime();
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
  session.client.close();
  session.deliveredHistoryKey = "";
}

async function attachTarget(target) {
  const client = await connectCodexTarget(target);
  const assetConsoleBridge = createAssetConsoleBridge();
  try {
    // New-document registration must be enabled on this exact CDP connection.
    await client.send("Page.enable");
    const oldIdentifier = await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
    if (oldIdentifier) {
      try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
    }
    const [userSource, managedShortcuts] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readManagedShortcuts().catch((error) => {
        // A malformed/unreadable private profile is not an intentionally empty
        // configuration. Do not replace a working page with an empty shortcut set.
        process.stderr.write(`[managed-shortcuts] profile unavailable (${error.name || "Error"}); keeping existing page\n`);
        throw new Error("Managed shortcut profile could not be read");
      }),
    ]);
    const sourceHash = createHash("sha256").update(userSource).update(JSON.stringify(managedShortcuts)).digest("hex");
    const rendererSource = `if (window.top === window) { window.__CODEX_SIDEBAR_RENDERER_TARGET_ID__ = ${JSON.stringify(target.id)}; window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__ = ${JSON.stringify(managedShortcuts)}; ${userSource}\n window.__AIYOUCODEX_RUNTIME_SOURCE_HASH__ = ${JSON.stringify(sourceHash)}; }`;
    const snapshot = await client.evaluate(RENDERER_HEALTH_EXPRESSION);
    const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
    // Reconnect to the same document without destroying its mounted/parked pages.
    if (!canReuseRenderer(snapshot, sourceHash)) await client.evaluate(rendererSource);
    await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
    await assetConsoleBridge.install(client);
    process.stdout.write(`[${new Date().toISOString()}] Codex conversation preview attached to renderer ${target.id}\n`);
    const session = {
      targetId: target.id,
      client,
      assetConsoleBridge,
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
        if (alive && session.bridgeDocumentEpoch !== session.documentEpoch) {
          await session.assetConsoleBridge.install(session.client);
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
    const taskStatus = await readActiveTaskThreads();
    const action = desktopAppRecovery.next({ targetAvailable: false, app,
      recoveryAllowed: process.env.CODEX_SIDEBAR_ALLOW_HOST_RESTART === "1"
        && taskStatus.available && taskStatus.activeThreadIds.length === 0 });
    if (action?.type === "quit") {
      try {
        await desktopAppRuntime.quit(action.app);
        process.stdout.write(`Restarting ${action.app.appPath} to enable sidebar enhancement\n`);
      } catch {}
    } else if (action?.type === "launch") {
      desktopAppRuntime.launch(action.appPath, options.port);
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

async function pushPreviews(session) {
  if (!session?.client) return;
  if (!skillCatalog.length || Date.now() >= nextSkillCatalogRefreshAt) {
    skillCatalog = await readInstalledSkillCatalog();
    nextSkillCatalogRefreshAt = Date.now() + 5 * 60_000;
  }
  const [requests, activeContext, recentCatalog, pinnedThreadIds, taskboardStatus] = await Promise.all([
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
  ]);
  const interruptedCatalog = await repository.readInterruptedCatalog({
    activeThreadIds: taskboardStatus.activeThreadIds,
  });
  const recentRequests = recentCatalog.slice(0, 30).map((entry) => ({
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
    [...recentRequests, ...interruptedRequests, ...(Array.isArray(requests) ? requests : [])].map((request) => [request.key, request]),
  ).values());
  const searchCatalog = recentCatalog.filter((entry) => entry.projectId && entry.projectName);
  const [rawPreviews, rawUsage] = await Promise.all([
    repository.readMany(previewRequests),
    repository.readUsage(),
  ]);
  const previews = rawPreviews.map((preview) => presentCardPreview(preview));
  const usage = presentRateLimit(rawUsage, { timeZone: "Asia/Shanghai" });
  const snapshot = { previews, usage, searchCatalog, recentCatalog, interruptedCatalog,
    pinnedThreads: pinnedThreadIds, activeProjectThreads: taskboardStatus.activeThreadIds, skillCatalog };
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
