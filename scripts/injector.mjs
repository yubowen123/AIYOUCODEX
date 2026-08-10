#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { needsPreviewAttachment } from "../lib/injector-state.mjs";
import { buildHomeProjectShelf, readTaskboardSnapshot } from "../lib/home-projects.mjs";

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

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!await needsPreviewAttachment({ client, attachedTargetId, nextTargetId })) return false;

  if (!client || nextTargetId !== attachedTargetId) {
    client?.close();
    client = await connectMainCodex(options.port);
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const userSource = await readFile(sourcePath, "utf8");
  const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: userSource });
  registeredScriptIdentifier = registered.identifier;
  await client.evaluate(userSource);
  await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
  attachedTargetId = nextTargetId;
  process.stdout.write(`Codex conversation preview attached to renderer ${nextTargetId}\n`);
  return true;
}

async function pushPreviews() {
  if (!client || !attachedTargetId) return;
  const [requests, homeProjectState] = await Promise.all([
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
    client.evaluate("window.__codexConversationPreviewInjection__?.getHomeProjectsState?.() || null"),
  ]);
  const [rawPreviews, rawUsage, taskboard, searchCatalog] = await Promise.all([
    repository.readMany(Array.isArray(requests) ? requests : []),
    repository.readUsage(),
    readTaskboardSnapshot(),
    repository.readSearchCatalog(),
  ]);
  const previews = rawPreviews.map((preview) => presentCardPreview(preview));
  const usage = presentRateLimit(rawUsage, { timeZone: "Asia/Shanghai" });
  const homeProjects = taskboard.available
    ? {
        available: true,
        message: "",
        ...buildHomeProjectShelf({
          projects: taskboard.projects,
          tasks: taskboard.tasks,
          state: homeProjectState,
          syncedAt: new Date().toISOString(),
        }),
      }
    : {
        available: false,
        message: taskboard.message,
        cards: [],
        state: homeProjectState,
      };
  await client.evaluate(`(() => {
    const api = window.__codexConversationPreviewInjection__;
    api?.setPreviews?.(${JSON.stringify(previews)});
    api?.setUsage?.(${JSON.stringify(usage)});
    api?.setHomeProjects?.(${JSON.stringify(homeProjects)});
    api?.setSearchCatalog?.(${JSON.stringify(searchCatalog)});
  })()`);
}

async function stop() {
  if (stopped) return;
  stopped = true;
  try { await client?.evaluate("window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  client?.close();
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
      client?.close();
      client = null;
      if (!options.watch) throw error;
    }
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  if (!options.watch) await stop();
}
