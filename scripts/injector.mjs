#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import {
  DesktopAppRecovery,
  needsPreviewAttachment,
} from "../lib/injector-state.mjs";
import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";

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

async function targetId(port) {
  try {
    return selectMainCodexTarget(await readTargets(port))?.id || null;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const repository = new PreviewRepository();

let stopped = false;
let attachedTargetId = null;
let client = null;
let registeredScriptIdentifier = null;
const desktopAppRecovery = new DesktopAppRecovery();
const desktopAppRuntime = createDesktopAppRuntime();

async function closeClient() {
  const closingClient = client;
  closingClient?.close();
  if (client === closingClient) client = null;
}

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!nextTargetId && options.watch) {
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
    return false;
  }
  desktopAppRecovery.next({ targetAvailable: Boolean(nextTargetId), app: null });
  if (!await needsPreviewAttachment({ client, attachedTargetId, nextTargetId })) return false;

  if (!client || nextTargetId !== attachedTargetId) {
    await closeClient();
    client = await connectMainCodex(options.port);
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const userSource = await readFile(sourcePath, "utf8");
  const rendererSource = `if (window.top === window) { ${userSource}\n}`;
  const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
  registeredScriptIdentifier = registered.identifier;
  await client.evaluate(rendererSource);
  await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
  attachedTargetId = nextTargetId;
  process.stdout.write(`Codex conversation preview attached to renderer ${nextTargetId}\n`);
  return true;
}

async function pushPreviews() {
  if (!client || !attachedTargetId) return;
  const [requests, recentCatalog, pinnedThreadIds] = await Promise.all([
    client.evaluate(`(() => {
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
    repository.readRecentCatalog(),
    repository.readPinnedThreadIds(),
  ]);
  const interruptedCatalog = await repository.readInterruptedCatalog({
    activeThreadIds: [],
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
  await client.evaluate(`(() => {
    const api = window.__codexConversationPreviewInjection__;
    api?.setPreviews?.(${JSON.stringify(previews)});
    api?.setUsage?.(${JSON.stringify(usage)});
    api?.setSearchCatalog?.(${JSON.stringify(searchCatalog)});
    api?.setRecentCatalog?.(${JSON.stringify(recentCatalog)});
    api?.setInterruptedCatalog?.(${JSON.stringify(interruptedCatalog)});
    api?.setPinnedThreads?.(${JSON.stringify(pinnedThreadIds)});
  })()`);
}

async function stop() {
  if (stopped) return;
  stopped = true;
  try { await client?.evaluate("window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  await closeClient();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}

try {
  while (!stopped) {
    try {
      await attach();
      await pushPreviews();
    } catch (error) {
      attachedTargetId = null;
      registeredScriptIdentifier = null;
      await closeClient();
      if (!options.watch) throw error;
    }
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  if (!options.watch) await stop();
}
