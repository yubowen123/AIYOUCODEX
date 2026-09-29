#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { acquireMonitorLock, readResetMonitorStatus, resetMonitorPath, writeMonitorJson } from "../lib/reset-monitor-store.mjs";
import { tickResetMonitor } from "../lib/reset-monitor-worker.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--once")) throw new Error("Usage: reset-monitor-worker.mjs [--once]");
const filePath = resetMonitorPath();
const release = await acquireMonitorLock(`${filePath}.worker.lock`);
if (!release) {
  console.log("[reset-monitor] another worker owns the schedule");
  process.exit(0);
}
let stopped = false;
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopped = true; controller.abort(); });
try {
  do {
    try {
      const result = await tickResetMonitor({ filePath, force: args.includes("--once") });
      if (result.checked) console.log(`[reset-monitor] ${result.lastStatus}; new events=${result.lastEventCount}; next=${result.nextRunAt == null ? "paused" : new Date(result.nextRunAt).toISOString()}`);
    } catch (error) {
      console.error(`[reset-monitor] ${error.message}`);
      if (args.includes("--once")) process.exitCode = 1;
    }
    if (args.includes("--once") || stopped) break;
    await delay(15_000, undefined, { signal: controller.signal }).catch(() => {});
  } while (!stopped);
} finally {
  const status = await readResetMonitorStatus(filePath);
  if (status?.pid === process.pid) await writeMonitorJson(`${filePath}.status`, { ...status, running: false, heartbeatAt: Date.now() });
  await release();
}
