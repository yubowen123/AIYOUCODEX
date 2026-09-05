export async function needsPreviewAttachment({ client, attachedTargetId, nextTargetId }) {
  if (!nextTargetId) return false;
  if (!client || nextTargetId !== attachedTargetId) return true;
  const runtimeAlive = await client.evaluate(
    "Boolean(window.__codexConversationPreviewInjection__)",
  );
  return !runtimeAlive;
}

export async function reconcileRendererSessions({
  targets,
  discoveryAvailable = true,
  sessions,
  attach,
  dispose,
  isHealthy,
}) {
  // A failed /json probe is not evidence that the user's windows closed.
  if (!discoveryAvailable) return { attachedTargetIds: [], removedTargetIds: [], errors: [] };
  const nextTargets = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    if (target?.id && !nextTargets.has(target.id)) nextTargets.set(target.id, target);
  }

  const attachedTargetIds = [];
  const removedTargetIds = [];
  const errors = [];

  for (const [targetId, session] of [...sessions]) {
    if (nextTargets.has(targetId)) continue;
    sessions.delete(targetId);
    removedTargetIds.push(targetId);
    try {
      await dispose(session, { targetId, reason: "closed" });
    } catch (error) {
      errors.push({ targetId, phase: "dispose", error });
    }
  }

  for (const [targetId, target] of nextTargets) {
    const existing = sessions.get(targetId);
    let healthy = false;
    if (existing) {
      try { healthy = await isHealthy(existing, target); } catch {}
    }
    if (healthy) continue;

    if (existing) {
      sessions.delete(targetId);
      try {
        await dispose(existing, { targetId, reason: "unhealthy" });
      } catch (error) {
        errors.push({ targetId, phase: "dispose", error });
      }
    }

    try {
      const session = await attach(target);
      if (!session) throw new Error("Renderer attachment returned no session");
      sessions.set(targetId, session);
      attachedTargetIds.push(targetId);
    } catch (error) {
      errors.push({ targetId, phase: "attach", error });
    }
  }

  return { attachedTargetIds, removedTargetIds, errors };
}

export function selectPersistentOwnerTargetId({
  sessions,
  currentOwnerTargetId = "",
  focusedTargetIds = [],
}) {
  const targetIds = [...(sessions?.keys?.() || [])];
  if (currentOwnerTargetId && targetIds.includes(currentOwnerTargetId)) {
    return currentOwnerTargetId;
  }
  if (targetIds.length === 1) return targetIds[0];
  const available = new Set(targetIds);
  const focused = [...new Set(focusedTargetIds)].filter((targetId) => available.has(targetId));
  return focused.length === 1 ? focused[0] : "";
}

const DESKTOP_APP_PROCESSES = [
  {
    executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    appPath: "/Applications/ChatGPT.app",
    bundleId: "com.openai.codex",
  },
  {
    executable: "/Applications/Codex.app/Contents/MacOS/Codex",
    appPath: "/Applications/Codex.app",
    bundleId: "com.openai.codex",
  },
];

export function parseDesktopAppProcess(processList) {
  for (const line of String(processList || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const candidate = DESKTOP_APP_PROCESSES.find((item) => match[2] === item.executable || match[2].startsWith(`${item.executable} `));
    if (!candidate) continue;
    if (/(?:^|\s)--type=/.test(match[2])) continue;
    const debuggingPort = Number(match[2].match(/--remote-debugging-port=(\d+)/)?.[1] || 0);
    return { pid: Number(match[1]), appPath: candidate.appPath, bundleId: candidate.bundleId,
      ...(debuggingPort ? { debuggingPort } : {}) };
  }
  return null;
}

export function desktopAppLaunchArgs(appPath, port, userDataDir = null) {
  const args = [
    "-na",
    appPath,
    "--args",
  ];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  args.push(
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  );
  return args;
}

export function windowsDesktopAppLaunchArgs(port) {
  return [
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ];
}

export function parseWindowsDesktopAppProcess(processList) {
  let items;
  try {
    const parsed = JSON.parse(String(processList || "[]"));
    items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return null;
  }
  for (const item of items) {
    const name = String(item?.Name || "");
    const executablePath = String(item?.ExecutablePath || "");
    const commandLine = String(item?.CommandLine || "");
    if (!/^(?:ChatGPT|Codex)\.exe$/i.test(name)) continue;
    if (!executablePath || /(?:^|\s)--type=/i.test(commandLine)) continue;
    const pid = Number(item?.ProcessId);
    if (!Number.isInteger(pid) || pid < 1) continue;
    const debuggingPort = Number(commandLine.match(/--remote-debugging-port=(\d+)/)?.[1] || 0);
    return { pid, appPath: executablePath, appName: name, ...(debuggingPort ? { debuggingPort } : {}) };
  }
  return null;
}

export class DesktopAppRecovery {
  constructor({ quitRetryMs = 5_000, launchRetryMs = 15_000, maxAttempts = 2 } = {}) {
    this.quitRetryMs = quitRetryMs;
    this.launchRetryMs = launchRetryMs;
    this.pending = null;
    this.attempts = 0;
    this.maxAttempts = maxAttempts;
  }

  next({ targetAvailable, app, recoveryAllowed = true, now = Date.now() }) {
    if (targetAvailable) {
      this.pending = null;
      this.attempts = 0;
      return null;
    }
    if (!recoveryAllowed || app?.debuggingPort) return null;
    if (this.pending?.phase === "launched") {
      if (!app || now - this.pending.launchedAt < this.launchRetryMs) return null;
    }
    if (!app) {
      if (this.pending?.phase !== "quitting") return null;
      const appPath = this.pending.app.appPath;
      this.pending = { phase: "launching", appPath };
      return { type: "launch", appPath };
    }
    if (this.pending?.phase === "quitting" && this.pending.app.pid === app.pid) {
      if (now - this.pending.requestedAt < this.quitRetryMs) return null;
    }
    if (this.attempts >= this.maxAttempts) return null;
    this.attempts += 1;
    this.pending = { phase: "quitting", app, requestedAt: now };
    return { type: "quit", app };
  }

  markLaunched(now = Date.now()) {
    if (this.pending?.phase !== "launching") return;
    this.pending = { ...this.pending, phase: "launched", launchedAt: now };
  }
}
