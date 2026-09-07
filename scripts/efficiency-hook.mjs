#!/usr/bin/env node
import { runEfficiencyHook } from "../lib/efficiency-hook.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export function resolveNativeDefaultSkills(selections, { cwd, homeDir, timeoutMs = 1400 } = {}) {
  if (!selections.length) return Promise.resolve([]);
  // Isolate metadata discovery so even an unavailable network-mounted directory
  // cannot retain the native hook process beyond its small budget.
  return new Promise((resolve) => {
    let result = "", settled = false, timer;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--skill-metadata"], { stdio: ["pipe", "pipe", "ignore"] });
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    child.on("error", () => finish([]));
    child.stdin.on("error", () => finish([]));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      result += chunk;
      if (Buffer.byteLength(result) > 32 * 1024) { child.kill(); finish([]); }
    });
    child.on("close", (code) => {
      try { finish(code === 0 ? JSON.parse(result) : []); } catch { finish([]); }
    });
    timer = setTimeout(() => { child.kill(); finish([]); }, Math.min(timeoutMs, 1400));
    child.stdin.end(JSON.stringify({ cwd, homeDir, selections }));
  });
}
async function readInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("Hook input exceeds limit");
  }
  return JSON.parse(input);
}

async function main() {
  const event = await readInput();
  if (process.argv[2] === "--skill-metadata") {
    const { readInstalledSkillCatalog } = await import("../lib/skill-catalog.mjs");
    const ids = new Set(event.selections.slice(0, 8).map((selection) => selection.id));
    const catalog = await readInstalledSkillCatalog({ cwd: event.cwd, ...(event.homeDir ? { homeDir: event.homeDir } : {}), limits: {
      maxDurationMs: 1000, maxDirectories: 2500, maxEntries: 12000, maxSkills: 1500, maxMetadataBytes: 4096,
    } });
    const resolved = catalog.filter((skill) => ids.has(skill.id)).map(({ id, name, title, skillFile }) => ({ id, name, title, skillFile }));
    process.stdout.write(`${JSON.stringify(resolved)}\n`);
    return;
  }
  const result = await runEfficiencyHook(event, {
    resolveThread: async (threadId) => threadId === event.session_id ? { projectPath: event.cwd || null } : null,
    resolveSkills: (selections, options) => resolveNativeDefaultSkills(selections, { ...options, cwd: event.cwd }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// Only native Codex invokes this CLI. Its session cwd is authoritative for this
// invocation; the UI uses an independent backend resolver and cannot supply it.
// No transcript, prompt body or credential file is opened. Skill resolution
// returns installed metadata only, never the contents/instructions of a Skill.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    // Fail open without putting paths, local state, or raw input into model context.
    process.stderr.write("AIYOUCODEX efficiency hook unavailable; native conversation continues.\n");
    process.stdout.write("{}\n");
  });
}
