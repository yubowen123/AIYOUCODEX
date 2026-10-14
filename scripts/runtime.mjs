#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimePlan } from "../lib/runtime-plan.mjs";
import { resolveLoopbackPort } from "../lib/runtime-port.mjs";
import { provisionAssetConsoleState } from "../lib/workspace-enhancements.mjs";
import { isEnhancementEnabled } from "../lib/enhancement-state.mjs";
import { createRuntimeSupervisor } from "../lib/runtime-supervisor.mjs";

function parseArgs(argv) {
  const options = { port: 9231 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") continue;
    if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("Invalid port");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let runtimeEnvironment = process.env;
if (!process.env.CODEX_SIDEBAR_TASKBOARD_DATA_DIR) {
  const legacyDataDir = path.join(os.homedir(), ".codex", "taskboard-data");
  try {
    await access(path.join(legacyDataDir, "taskboard.sqlite"));
    runtimeEnvironment = { ...process.env, CODEX_SIDEBAR_TASKBOARD_DATA_DIR: legacyDataDir };
  } catch {}
}
const preferredTaskboardPort = Number(process.env.CODEX_TASKBOARD_PORT || 47823);
const taskboardPort = await resolveLoopbackPort(preferredTaskboardPort);
const preferredAssetConsolePort = Number(process.env.CODEX_ASSET_CONSOLE_PORT || 5177);
const assetConsolePort = await resolveLoopbackPort(preferredAssetConsolePort);
runtimeEnvironment = { ...runtimeEnvironment, CODEX_ASSET_CONSOLE_PORT: String(assetConsolePort) };
const plan = createRuntimePlan({ root, port: options.port, taskboardPort, environment: runtimeEnvironment });
let stopping = false;

for (const child of plan.children) await access(child.args[0]);
await access(path.join(plan.taskboardRoot, "dist", "web", "index.html"));
await access(plan.assetConsole.staticRoot);
await provisionAssetConsoleState(plan.assetConsole);
await mkdir(plan.taskboardDataDir, { recursive: true });
await writeFile(plan.taskboardRuntimeFile, `${JSON.stringify({
  managedBy: "codex-sidebar-enhancer",
  version: plan.children[1].env.CODEX_TASKBOARD_VERSION,
  url: `http://127.0.0.1:${taskboardPort}/`,
  pid: process.pid,
  assetConsolePort,
  startedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });

const supervisor = createRuntimeSupervisor({ definitions: plan.children,
  log: message => process.stdout.write(`[${new Date().toISOString()}] [runtime] ${message}\n`) });
async function stop() { stopping = true; await supervisor.stop(); }

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop();
    process.exit(0);
  });
}

process.stdout.write(`[runtime] Taskboard loopback port ${taskboardPort}\n`);
process.stdout.write(`[runtime] Asset Console loopback port ${assetConsolePort}\n`);

let active = null;
while (!stopping) {
  const enabled = await isEnhancementEnabled();
  if (enabled !== active) {
    active = enabled;
    await supervisor.setEnabled(enabled);
    process.stdout.write(`[runtime] enhancement ${enabled ? 'enabled' : 'paused'}\n`);
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
