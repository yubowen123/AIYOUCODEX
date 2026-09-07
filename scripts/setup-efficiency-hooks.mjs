#!/usr/bin/env node
import { copyFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { EFFICIENCY_HOOK_CONTEXT_LIMIT } from "../lib/efficiency-hook.mjs";
import { readEfficiencyJson, withEfficiencyFileLock, writeEfficiencyJson } from "../lib/efficiency-store.mjs";

const MANAGED_STATUS = "AIYOUCODEX: bounded output preferences";
export function quoteEfficiencyCommandArgument(value, platform = process.platform, windowsShell = "cmd") {
  if (typeof value !== "string" || /[\r\n\u0000]/u.test(value)) throw new TypeError("Invalid hook command path");
  if (platform === "win32") {
    if (windowsShell === "powershell") return `'${value.replaceAll("'", "''")}'`;
    // cmd.exe expands percent and delayed-expansion variables even in quotes.
    if (/["%!^]/u.test(value)) throw new TypeError("Hook paths containing Windows shell expansion characters are not supported");
    return `"${value}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function isOwnHandler(handler) {
  return handler?.type === "command" && handler.statusMessage === MANAGED_STATUS
    && typeof handler.command === "string" && /[/\\]efficiency-hook\.mjs['"](?:\s|$)/u.test(handler.command);
}
export function mergeEfficiencyHooks(config, { nodePath = process.execPath, hookPath, platform = process.platform, windowsShell = "cmd", remove = false } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("hooks.json must contain an object");
  const next = structuredClone(config);
  if (next.hooks !== undefined && (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks))) throw new TypeError("hooks must be an object");
  next.hooks ||= {};
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!["cmd", "powershell"].includes(windowsShell)) throw new TypeError("Unknown Windows hook shell");
  if (!remove && (!pathApi.isAbsolute(nodePath) || !pathApi.isAbsolute(hookPath || ""))) throw new TypeError("Hook and Node paths must be absolute");
  // Codex's native default is COMSPEC/cmd.exe /C, not the interactive terminal.
  // An explicitly configured PowerShell command shell needs its call operator.
  const command = remove ? "" : `${platform === "win32" && windowsShell === "powershell" ? "& " : ""}${quoteEfficiencyCommandArgument(nodePath, platform, windowsShell)} ${quoteEfficiencyCommandArgument(hookPath, platform, windowsShell)}`;
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const existing = next.hooks[event] || [];
    if (!Array.isArray(existing)) throw new TypeError(`${event} hooks must be an array`);
    next.hooks[event] = existing.flatMap((group) => {
      if (!group || !Array.isArray(group.hooks)) throw new TypeError(`${event} matcher group is invalid`);
      const handlers = group.hooks.filter((handler) => !isOwnHandler(handler));
      return handlers.length ? [{ ...group, hooks: handlers }] : [];
    });
    if (!remove) next.hooks[event].push({
      ...(event === "SessionStart" ? { matcher: "^(startup|resume|compact|clear)$" } : {}),
      hooks: [{ type: "command", command, timeout: 5, statusMessage: MANAGED_STATUS, additionalContextLimit: EFFICIENCY_HOOK_CONTEXT_LIMIT }],
    });
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  return next;
}
export async function setupEfficiencyHooks({ configPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json"),
  nodePath = process.execPath, hookPath = fileURLToPath(new URL("./efficiency-hook.mjs", import.meta.url)), platform = process.platform,
  windowsShell = "cmd", apply = false, remove = false } = {}) {
  if (!remove) {
    for (const required of [nodePath, hookPath]) if (!(await stat(required)).isFile()) throw new TypeError("Hook runtime paths must point to files");
  }
  const execute = async () => {
    const previous = await readEfficiencyJson(configPath, {});
    const next = mergeEfficiencyHooks(previous, { nodePath, hookPath, platform, windowsShell, remove });
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    let backupPath = null;
    if (apply && changed) {
      try {
        backupPath = `${configPath}.aiyou-backup-${Date.now()}-${randomUUID()}`;
        await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
      } catch (error) { if (error.code === "ENOENT") backupPath = null; else throw error; }
      await writeEfficiencyJson(configPath, next);
    }
    return { changed, applied: apply && changed, configPath, backupPath, mode: remove ? "remove" : "install",
      trust: "not-modified", runtimeStatus: "unverified", additionalContextLimit: EFFICIENCY_HOOK_CONTEXT_LIMIT,
      note: "Review and trust hooks through Codex. No trust database, config.toml, AGENTS.md or conversation was modified." };
  };
  return apply ? withEfficiencyFileLock(configPath, execute) : execute();
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const options = {};
  try {
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (flag === "--apply") options.apply = true;
      else if (flag === "--remove") options.remove = true;
      else if (flag === "--config") options.configPath = path.resolve(args[++i]);
      else if (flag === "--node") options.nodePath = path.resolve(args[++i]);
      else if (flag === "--hook") options.hookPath = path.resolve(args[++i]);
      else if (flag === "--windows-shell") options.windowsShell = args[++i];
      else throw new Error(`Unknown option: ${flag}`);
    }
    process.stdout.write(`${JSON.stringify(await setupEfficiencyHooks(options), null, 2)}\n`);
  } catch (error) { process.stderr.write(`Efficiency hook setup failed: ${error.message}\n`); process.exitCode = 1; }
}
