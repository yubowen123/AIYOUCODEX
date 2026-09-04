#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCodexTarget, readTargets, selectMainCodexTargets } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import {
  DesktopAppRecovery,
  needsPreviewAttachment,
  reconcileRendererSessions,
} from "../lib/injector-state.mjs";
import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";
import { readActiveTaskThreads } from "../lib/taskboard-status.mjs";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { readManagedShortcuts } from "../lib/managed-shortcuts.mjs";

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
let skillCatalog = [];
let nextSkillCatalogRefreshAt = 0;
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
    const oldIdentifier = await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
    if (oldIdentifier) {
      try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
    }
    const [userSource, managedShortcuts] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readManagedShortcuts().catch((error) => {
        process.stderr.write(`[managed-shortcuts] ${error.message}\n`);
        return [];
      }),
    ]);
    const rendererSource = `if (window.top === window) { window.__CODEX_SIDEBAR_MANAGED_SHORTCUTS__ = ${JSON.stringify(managedShortcuts)}; ${userSource}\n}`;
    const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
    await client.evaluate(rendererSource);
    await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
    await assetConsoleBridge.install(client);
    process.stdout.write(`Codex conversation preview attached to renderer ${target.id}\n`);
    return {
      targetId: target.id,
      client,
      assetConsoleBridge,
      registeredScriptIdentifier: registered.identifier,
      deliveredHistoryKey: "",
    };
  } catch (error) {
    await assetConsoleBridge.dispose().catch(() => {});
    client.close();
    throw error;
  }
}

async function reconcileTargets() {
  let targets = [];
  try {
    targets = selectMainCodexTargets(await readTargets(options.port));
  } catch {}
  const reconciliation = await reconcileRendererSessions({
    targets,
    sessions,
    attach: attachTarget,
    dispose: (session) => disposeRendererSession(session),
    isHealthy: async (session, target) => !await needsPreviewAttachment({
      client: session.client,
      attachedTargetId: session.targetId,
      nextTargetId: target.id,
    }),
  });
  if (!targets.length && options.watch) {
    let app = null;
    try { app = await desktopAppRuntime.readProcess(); } catch {}
    const action = desktopAppRecovery.next({ targetAvailable: false, app });
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
  } catch {}
  const lastMessage = conversationHistory?.messages?.at(-1);
  const historyKey = conversationHistory
    ? `${session.targetId}:${conversationHistory.threadId}:${conversationHistory.totalCount}:${lastMessage?.id || lastMessage?.timestamp || ""}`
    : `${session.targetId}:none`;
  if (historyKey === session.deliveredHistoryKey) return;
  session.deliveredHistoryKey = historyKey;
  await session.client.evaluate(`window.__codexConversationPreviewInjection__?.setConversationHistory?.(${JSON.stringify(conversationHistory)})`);
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
  await session.client.evaluate(`(() => {
    const api = window.__codexConversationPreviewInjection__;
    api?.setPreviews?.(${JSON.stringify(previews)});
    api?.setUsage?.(${JSON.stringify(usage)});
    api?.setSearchCatalog?.(${JSON.stringify(searchCatalog)});
    api?.setRecentCatalog?.(${JSON.stringify(recentCatalog)});
    api?.setInterruptedCatalog?.(${JSON.stringify(interruptedCatalog)});
    api?.setPinnedThreads?.(${JSON.stringify(pinnedThreadIds)});
    api?.setActiveProjectThreads?.(${JSON.stringify(taskboardStatus.activeThreadIds)});
    api?.setSkillCatalog?.(${JSON.stringify(skillCatalog)});
  })()`);
  await pushConversationHistory(session, activeContext);
}

async function stop() {
  if (stopped) return;
  stopped = true;
  const closing = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(closing.map((session) => disposeRendererSession(session, { destroy: true })));
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
      const fullRefresh = reconciliation.attachedTargetIds.length > 0 || Date.now() >= nextFullRefreshAt;
      for (const [targetId, session] of [...sessions]) {
        try {
          if (fullRefresh) await pushPreviews(session);
          else await pushConversationHistory(session);
        } catch (error) {
          sessions.delete(targetId);
          await disposeRendererSession(session).catch(() => {});
          process.stderr.write(`[renderer ${targetId}] update failed: ${error.message}\n`);
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
