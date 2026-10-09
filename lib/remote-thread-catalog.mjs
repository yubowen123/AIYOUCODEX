// Read the native app's host-scoped, already loaded thread catalog. Remote
// paths are identifiers here; they are never opened by the local repository.
export async function readNativeRemoteThreads(hostIds) {
  const isSubagent = thread => [thread?.source,thread?.threadSource].some(value => {
    if (typeof value === "string") {
      if (/^sub_?agent$/i.test(value)) return true;
      try { value = JSON.parse(value); } catch { return false; }
    }
    return value && typeof value === "object" && Object.keys(value).some(key => /^sub_?agent$/i.test(key));
  });
  const allowedHosts = new Set(hostIds.filter(id => typeof id === "string" && id !== "durable"));
  if (!allowedHosts.size) return { hosts: [] };
  const cacheKey = "__aiyouNativeRemoteCatalogAdapter__";
  let adapter = window[cacheKey];
  if (!adapter) {
    const url = [...document.querySelectorAll('link[rel="modulepreload"]')].map(link => link.href)
      .concat(performance.getEntriesByType("resource").map(entry => entry.name))
      .find(name => /^app:\/\/-\/assets\/app-shared-[a-f0-9]+\.js$/.test(name));
    if (!url) throw new Error("Native host catalog module unavailable");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Native host catalog module unreadable");
    const source = await response.text();
    // Discover the export from its narrow native registry contract, so app
    // updates can rename minified symbols without hardcoded module hashes.
    const symbol = source.match(/getAll\(\)\{return this\.scope\.get\(([\w$]+)\)\}getDefault\(/)?.[1];
    const escapedSymbol = symbol?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alias = escapedSymbol && source.match(new RegExp(`(?:^|[,;{}])${escapedSymbol} as ([\\w$]+)`))?.[1];
    if (!alias) throw new Error("Native host catalog contract unavailable");
    const module = await import(url);
    const atom = module[alias];
    if (typeof atom?.resolve !== "function" || !atom.scope?.id) throw new Error("Invalid native host catalog atom");
    adapter = { atom };
    window[cacheKey] = adapter;
  }
  const root = document.getElementById("root");
  const containerKey = root && Object.keys(root).find(key => key.startsWith("__reactContainer"));
  const queue = containerKey ? [root[containerKey]] : [];
  for (let count = 0; queue.length && count < 256; count += 1) {
    const fiber = queue.shift();
    const scopes = fiber?.memoizedProps?.value;
    const node = scopes instanceof Map && scopes.get(adapter.atom.scope.id);
    if (node?.store) {
      const managers = node.store.get(adapter.atom.resolve(node, scopes));
      if (!Array.isArray(managers)) throw new Error("Invalid native host catalog");
      const hosts = [];
      for (const manager of managers) {
        const hostId = manager.getHostId?.();
        if (!allowedHosts.has(hostId) || typeof manager.getThreadSummaries !== "function") continue;
        const summaries = manager.getThreadSummaries();
        if (!Array.isArray(summaries)) continue;
        hosts.push({ hostId, threads: summaries.filter(thread => !isSubagent(thread)).slice(0, 512).map(thread => {
          const conversation = manager.getConversation?.(thread.conversationId);
          const turns = Object.values(conversation?.turnHistory?.history?.entitiesByKey || {})
            .concat(conversation?.turns || []).filter(turn => turn?.status);
          const turn = turns.sort((a, b) => (b.turnStartedAtMs || 0) - (a.turnStartedAtMs || 0))[0];
          return {
          nativeThreadId: thread.conversationId,
          title: thread.title,
          cwd: thread.cwd,
          updatedAt: thread.updatedAt,
          status: thread.threadRuntimeStatus?.type,
          hasUnreadTurn: thread.hasUnreadTurn,
          turnStatus: turn?.status,
          turnId: turn?.turnId,
          turnError: Boolean(turn?.error),
        }; }) });
      }
      return { hosts };
    }
    if (fiber?.child) queue.push(fiber.child);
    if (fiber?.sibling) queue.push(fiber.sibling);
  }
  throw new Error("Native host catalog scope unavailable");
}

export function remoteThreadCatalogExpression(hostIds) {
  return `(${readNativeRemoteThreads.toString()})(${JSON.stringify(hostIds)})`;
}

export function projectRemoteThreads(hosts, projects) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const normalize = value => typeof value === "string" ? value.replace(/\/+$/, "") || "/" : "";
  const entries = new Map();
  for (const host of Array.isArray(hosts) ? hosts : []) {
    if (!host?.hostId || host.hostId === "local" || host.hostId === "durable") continue;
    const candidates = projects.filter(project => project.hostId === host.hostId && project.remotePath)
      .sort((a, b) => normalize(b.remotePath).length - normalize(a.remotePath).length);
    for (const thread of Array.isArray(host.threads) ? host.threads : []) {
      if (!uuid.test(thread?.nativeThreadId || "")) continue;
      const cwd = normalize(thread.cwd);
      if (!cwd) continue;
      const project = candidates.find(item => {
        const root = normalize(item.remotePath);
        return cwd === root || cwd.startsWith(root === "/" ? root : `${root}/`);
      });
      if (!project) continue;
      const date = new Date(thread.updatedAt ?? NaN);
      const updatedAt = Number.isFinite(date.getTime()) ? date.toISOString() : "";
      const threadId = `remote:${host.hostId}:${thread.nativeThreadId}`;
      const title = String(thread.title || "未命名对话").trim() || "未命名对话";
      entries.set(threadId, {
        threadId, nativeThreadId: thread.nativeThreadId, hostId: host.hostId, remote: true,
        title, updatedAt, projectId: project.id, nativeProjectId: project.nativeProjectId,
        projectName: project.label,
      });
    }
  }
  return [...entries.values()].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export async function readRemoteCatalog(session, projects) {
  // Keep last known metadata during a transient native connection failure.
  // A successful empty host catalog still removes deleted threads.
  session.remoteHostCatalogs ||= new Map();
  const hostIds = [...new Set(projects.map(project => project.hostId))];
  for (const id of session.remoteHostCatalogs.keys()) if (!hostIds.includes(id)) session.remoteHostCatalogs.delete(id);
  if (hostIds.length) {
    try {
      const snapshot = await session.client.evaluate(remoteThreadCatalogExpression(hostIds));
      for (const host of snapshot?.hosts || []) {
        if (hostIds.includes(host.hostId) && Array.isArray(host.threads)) session.remoteHostCatalogs.set(host.hostId, host);
      }
    } catch { /* Native connection startup must not break local list delivery. */ }
  }
  return projectRemoteThreads([...session.remoteHostCatalogs.values()], projects);
}

// Read-only native lifecycle metadata; never resume a thread or fetch its body.
export async function readNativeExecutionStates(session, hostIds = []) {
  try {
    const snapshot = await session.client.evaluate(remoteThreadCatalogExpression(["local", ...hostIds]));
    return (snapshot?.hosts || []).flatMap(host => (host.threads || []).map(thread => ({
      threadId: host.hostId === "local" ? thread.nativeThreadId : `remote:${host.hostId}:${thread.nativeThreadId}`,
      runtimeStatus: thread.status,
      turnStatus: thread.turnStatus,
      turnId: thread.turnId,
      turnError: thread.turnError === true,
      unread: typeof thread.hasUnreadTurn === "boolean" ? thread.hasUnreadTurn : undefined,
      revision: String(thread.updatedAt || ""),
    })));
  } catch { return null; }
}
