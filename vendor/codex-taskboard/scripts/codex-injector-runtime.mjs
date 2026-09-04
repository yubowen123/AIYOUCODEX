const HOST_REQUEST_ERROR = "自动认领配置暂时无法应用，请刷新后重试";
const AUTOMATION_SCHEMA_DIAGNOSTIC = "AUTOMATION_SCHEMA_MISMATCH";

export function taskboardServiceAction({ reachable, attachExisting }) {
  if (reachable) return "ready";
  return attachExisting ? "wait-for-external" : "start-local";
}

export function codexStartupAction({
  cdpReachable,
  codexRunning,
  launch,
  waitForCodex,
}) {
  if (cdpReachable) return "attach";
  if (waitForCodex) return codexRunning ? "relaunch" : "wait";
  if (!launch) return "error";
  return codexRunning ? "error-running-without-cdp" : "launch";
}

export async function stopCodexForManagedRelaunch({
  requestQuit,
  waitUntilStopped,
  terminate,
}) {
  let gracefulQuitRequested = false;
  try {
    requestQuit();
    gracefulQuitRequested = true;
  } catch {}
  if (gracefulQuitRequested) {
    try {
      await waitUntilStopped(3_000);
      return "quit";
    } catch {}
  }
  terminate();
  await waitUntilStopped(5_000);
  return "terminated";
}

export async function reconcileManagedCodexRuntime({
  cdpReachable,
  codexRunning,
  enabled,
  stop,
  launch,
  waitUntilReachable,
}) {
  if (!enabled || cdpReachable) return { action: "attach", process: null };
  if (!codexRunning) return { action: "wait", process: null };
  await stop();
  const launchedProcess = launch();
  await waitUntilReachable();
  return { action: "relaunch", process: launchedProcess };
}

export async function waitForAvailableCodexTargets(
  readTargets,
  { timeoutMs, intervalMs },
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const targets = await readTargets();
      if (targets.length > 0) return targets;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for the main Codex renderer target");
}

export function selectCodexTargets(targets) {
  return targets.filter(
    (target) =>
      target.type === "page"
      && target.webSocketDebuggerUrl
      && !target.url?.includes("initialRoute=%2Fglobal-dictation")
      && !target.url?.includes("initialRoute=%2Favatar-overlay")
      && (target.url?.startsWith("app://") || target.title === "Codex"),
  );
}

export function injectionRuntimeNeedsRefresh(currentStatus, expectedSourceHash) {
  return !currentStatus
    || currentStatus.sourceHash !== expectedSourceHash
    || currentStatus.entryMounted !== true;
}

export class CdpConnection {
  constructor(url, { connectTimeoutMs = 3_000, requestTimeoutMs = 15_000 } = {}) {
    this.url = url;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.eventHandlers = new Map();
    this.closed = false;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  rejectEventWaiters(error) {
    for (const waiters of this.eventWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.eventWaiters.clear();
  }

  markClosed(error = new Error("CDP WebSocket closed")) {
    this.closed = true;
    this.rejectPending(error);
    this.rejectEventWaiters(error);
    this.eventHandlers.clear();
  }

  async open() {
    if (typeof globalThis.WebSocket !== "function") {
      throw new Error("This installer requires Node.js 22 or newer with native WebSocket support");
    }
    if (this.socket) throw new Error("CDP WebSocket connection already initialized");

    const socket = new globalThis.WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id) {
        const waiters = this.eventWaiters.get(message.method) || [];
        this.eventWaiters.delete(message.method);
        waiters.forEach((waiter) => {
          clearTimeout(waiter.timer);
          waiter.resolve(message.params);
        });
        const handlers = this.eventHandlers.get(message.method) || [];
        handlers.forEach((handler) => {
          try {
            Promise.resolve(handler(message.params)).catch((error) => {
              console.error(`CDP ${message.method} handler failed: ${error.message}`);
            });
          } catch (error) {
            console.error(`CDP ${message.method} handler failed: ${error.message}`);
          }
        });
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });

    let connectSettled = false;
    let rejectConnect = null;
    socket.addEventListener("close", () => {
      const error = new Error("CDP WebSocket closed");
      if (!connectSettled) {
        connectSettled = true;
        rejectConnect?.(error);
      }
      this.markClosed(error);
    });
    socket.addEventListener("error", (event) => {
      const detail = event?.error?.message || event?.message || "WebSocket error";
      const error = new Error(`CDP WebSocket connection failed: ${detail}`);
      if (!connectSettled) {
        connectSettled = true;
        rejectConnect?.(error);
      }
      this.markClosed(error);
    });

    await new Promise((resolve, reject) => {
      rejectConnect = reject;
      const timer = setTimeout(() => {
        if (connectSettled) return;
        connectSettled = true;
        reject(new Error(`CDP WebSocket connection timed out after ${this.connectTimeoutMs}ms`));
        this.markClosed();
        try { socket.close(); } catch {}
      }, this.connectTimeoutMs);
      socket.addEventListener("open", () => {
        if (connectSettled) return;
        connectSettled = true;
        clearTimeout(timer);
        this.closed = false;
        resolve();
      }, { once: true });
      socket.addEventListener("close", () => clearTimeout(timer), { once: true });
      socket.addEventListener("error", () => clearTimeout(timer), { once: true });
    });
  }

  send(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.socket || this.socket.readyState !== 1 || this.closed) {
      return Promise.reject(new Error("CDP WebSocket is not open"));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        try { this.socket?.close(); } catch {}
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP ${method} send failed: ${error.message}`));
      }
    });
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiters = this.eventWaiters.get(method) || [];
      const waiter = { resolve: null, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.eventWaiters.set(
          method,
          (this.eventWaiters.get(method) || []).filter((candidate) => candidate !== waiter),
        );
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      waiter.resolve = (value) => {
        clearTimeout(waiter.timer);
        resolve(value);
      };
      waiters.push(waiter);
      this.eventWaiters.set(method, waiters);
    });
  }

  on(method, handler) {
    const handlers = this.eventHandlers.get(method) || [];
    handlers.push(handler);
    this.eventHandlers.set(method, handlers);
    return () => {
      this.eventHandlers.set(
        method,
        (this.eventHandlers.get(method) || []).filter((candidate) => candidate !== handler),
      );
    };
  }

  close() {
    this.markClosed();
    try { this.socket?.close(); } catch {}
  }
}

function parseHostRequest(payload, parseAutomationRequest) {
  if (typeof payload !== "string" || payload.length > 24_000) {
    return { id: null, request: null, error: HOST_REQUEST_ERROR };
  }

  let request;
  try {
    request = JSON.parse(payload);
  } catch {
    return { id: null, request: null, error: HOST_REQUEST_ERROR };
  }

  const id = (
    request
    && typeof request.id === "string"
    && /^[a-z0-9-]{1,80}$/i.test(request.id)
  ) ? request.id : null;
  if (!id) return { id: null, request: null, error: HOST_REQUEST_ERROR };
  if (request.action === "ensure") return { id, request, error: null };
  if (request.action === "automation") {
    const parsed = parseAutomationRequest(request);
    return parsed
      ? { id, request: parsed, error: null }
      : {
          id,
          request: null,
          error: HOST_REQUEST_ERROR,
          diagnosticCode: AUTOMATION_SCHEMA_DIAGNOSTIC,
        };
  }
  if (
    request.action === "prefill-task-composer"
    && typeof request.instruction === "string"
    && request.instruction.length > 0
    && request.instruction.length <= 16_000
    && typeof request.skillName === "string"
    && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(request.skillName)
    && typeof request.skillDisplayName === "string"
    && request.skillDisplayName.length > 0
    && request.skillDisplayName.length <= 120
    && typeof request.skillPath === "string"
    && request.skillPath.length > 0
    && request.skillPath.length <= 1_024
    && (request.autoSubmit === undefined || typeof request.autoSubmit === "boolean")
  ) {
    return { id, request, error: null };
  }
  return { id, request: null, error: HOST_REQUEST_ERROR };
}

export async function handleHostBindingPayload(params, handlers) {
  const parsed = parseHostRequest(params.payload, handlers.parseAutomationRequest);
  if (!parsed.request) {
    if (!parsed.id) return { responded: false, accepted: false };
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.id,
      ok: false,
      error: parsed.error,
      ...(parsed.diagnosticCode ? { diagnosticCode: parsed.diagnosticCode } : {}),
    });
    return { responded: true, accepted: false };
  }

  try {
    let result;
    if (parsed.request.action === "ensure") {
      result = await handlers.ensure();
    } else if (parsed.request.action === "automation") {
      result = await handlers.runAutomation(parsed.request, params.executionContextId);
    } else {
      result = await handlers.prefill(parsed.request, params.executionContextId);
    }
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.request.id,
      ok: true,
      ...result,
    });
  } catch (error) {
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.request.id,
      ok: false,
      error: error.message,
    });
  }
  return { responded: true, accepted: true };
}

export async function reconcileInjectionRuntime({
  currentStatus,
  source,
  sourceHash,
  openRequested = false,
  removeRegisteredSource,
  registerCurrentSource,
  evaluateCurrentSource,
  publishRegistration,
  reopen,
}) {
  if (currentStatus.scriptIdentifier) {
    try {
      await removeRegisteredSource(currentStatus.scriptIdentifier);
    } catch {}
  }
  const scriptIdentifier = await registerCurrentSource(source);
  await evaluateCurrentSource(source);
  await publishRegistration(scriptIdentifier);
  const replaced = currentStatus.sourceHash !== sourceHash;
  const shouldRemainOpen = openRequested || currentStatus.pageVisible === true;
  if (shouldRemainOpen && (replaced || currentStatus.pageVisible !== true)) await reopen();
  return { replaced, scriptIdentifier, shouldRemainOpen };
}

export function findResidentInjectorPids({
  processList,
  currentPid,
  injectorPath,
  projectRoot,
  port,
  defaultPort,
  cwdForPid,
}) {
  const absoluteScript = new RegExp(
    `(?:^|\\s)${escapeRegExp(injectorPath)}(?=\\s|$)`,
  );
  const relativeScript = /(?:^|\s)(?:\.\/)?scripts\/codex-injector\.mjs(?=\s|$)/;
  const residents = [];

  for (const line of processList.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (pid === currentPid || !/(?:^|\s)--watch(?=\s|$)/.test(command)) continue;
    const scriptMatches = absoluteScript.test(command)
      || (relativeScript.test(command) && cwdForPid(pid) === projectRoot);
    if (!scriptMatches || commandPort(command, defaultPort) !== port) continue;
    residents.push(pid);
  }
  return residents;
}

export async function restartResidentInjector(port, handlers) {
  const previousPids = handlers.findResidents(port);
  if (previousPids.length === 0) return { previousPids: [], pid: null, restarted: false };

  for (const pid of previousPids) await handlers.stopResident(pid);
  const startupToken = handlers.createStartupToken();
  const started = handlers.startResident(port, startupToken);
  await handlers.waitUntilReady(port, started.pid, startupToken);
  return {
    previousPids,
    pid: started.pid,
    restarted: true,
  };
}

function commandPort(command, defaultPort) {
  const match = command.match(/(?:^|\s)--port(?:=(\d+)|\s+(\d+))(?=\s|$)/);
  return match ? Number(match[1] ?? match[2]) : defaultPort;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
