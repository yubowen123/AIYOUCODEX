#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import {
  DesktopAppRecovery,
  desktopAppLaunchArgs,
  needsPreviewAttachment,
  parseDesktopAppProcess,
} from "../lib/injector-state.mjs";
import { buildHomeProjectShelf, readTaskboardSnapshot } from "../lib/home-projects.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
const SCRIPT_ID_GLOBAL = "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__";
const TV_HOST_BINDING_NAME = "__codexTvHostV1";
const TV_HOST_TOKEN_GLOBAL = "__CODEX_TV_HOST_TOKEN__";
const TV_URL = "https://dz-ailab.dzkjm.cn/canvas/projects?category=personal";
const execFileAsync = promisify(execFile);

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
let tvHostToken = null;
let tvHostUnsubscribers = [];
let tvHostOperations = Promise.resolve();
const desktopAppRecovery = new DesktopAppRecovery();

async function disableTvCsp(targetClient = client) {
  try { await targetClient?.send("Page.setBypassCSP", { enabled: false }); } catch {}
}

async function closeClient() {
  const closingClient = client;
  const pendingTvOperations = tvHostOperations;
  tvHostUnsubscribers.forEach((unsubscribe) => unsubscribe());
  tvHostUnsubscribers = [];
  tvHostToken = null;
  tvHostOperations = Promise.resolve();
  try { await pendingTvOperations; } catch {}
  await disableTvCsp(closingClient);
  closingClient?.close();
  if (client === closingClient) client = null;
}

function reportTvHostError(targetClient, id, error) {
  const message = error?.message || "TV 加载失败";
  return targetClient.evaluate(`window.__codexConversationPreviewInjection__?.showTvError?.(${JSON.stringify(id)}, ${JSON.stringify(message)})`)
    .catch(() => {});
}

async function handleTvHostBinding(targetClient, expectedToken, params) {
  if (targetClient !== client || params?.name !== TV_HOST_BINDING_NAME) return;
  let request;
  try { request = JSON.parse(params.payload); } catch { return; }
  if (request?.token !== expectedToken || typeof request?.id !== "string") return;

  if (request.action === "close") {
    await disableTvCsp(targetClient);
    return;
  }
  if (request.action !== "open" || request.url !== TV_URL) return;

  try {
    await targetClient.send("Page.setBypassCSP", { enabled: true });
    const loaded = await targetClient.evaluate(`window.__codexConversationPreviewInjection__?.loadTvFrame?.(${JSON.stringify(request.id)}) === true`);
    if (!loaded) throw new Error("TV 面板未能挂载到 Codex 主工作区");
  } catch (error) {
    await disableTvCsp(targetClient);
    await reportTvHostError(targetClient, request.id, error);
  }
}

async function setupTvHost(targetClient) {
  tvHostToken = randomUUID();
  const expectedToken = tvHostToken;
  tvHostUnsubscribers.push(targetClient.on("Runtime.bindingCalled", (params) => {
    tvHostOperations = tvHostOperations
      .then(() => handleTvHostBinding(targetClient, expectedToken, params))
      .catch(() => {});
  }));
  tvHostUnsubscribers.push(targetClient.on("Runtime.executionContextCreated", (params) => {
    const executionContextId = params?.context?.id;
    if (!Number.isInteger(executionContextId)) return;
    void targetClient.send("Runtime.addBinding", {
      name: TV_HOST_BINDING_NAME,
      executionContextId,
    }).catch(() => {});
  }));
  await targetClient.send("Runtime.enable");
}

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!nextTargetId && options.watch) {
    let app = null;
    try {
      const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="]);
      app = parseDesktopAppProcess(stdout);
    } catch {}
    const action = desktopAppRecovery.next({ targetAvailable: false, app });
    if (action?.type === "quit") {
      try {
        await execFileAsync("/usr/bin/osascript", [
          "-e",
          `tell application id ${JSON.stringify(action.app.bundleId)} to quit`,
        ]);
        process.stdout.write(`Restarting ${action.app.appPath} to enable sidebar enhancement\n`);
      } catch {}
    } else if (action?.type === "launch") {
      const child = spawn("/usr/bin/open", desktopAppLaunchArgs(action.appPath, options.port), {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
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
    await setupTvHost(client);
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const userSource = await readFile(sourcePath, "utf8");
  const rendererSource = `if (window.top === window) { window[${JSON.stringify(TV_HOST_TOKEN_GLOBAL)}] = ${JSON.stringify(tvHostToken)}; ${userSource}\n}`;
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
        activeThreadIds: [],
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
