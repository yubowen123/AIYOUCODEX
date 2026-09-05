// A cancelled transport may still settle (including an error), so every state
// commit must also check the ticket. Cancellation alone is not a race guard.
export function createLatestRequestGate() {
  let active = null;
  return {
    begin(key) {
      active?.controller.abort();
      const controller = new AbortController();
      const ticket = { key, controller, signal: controller.signal, isCurrent: () => active === ticket };
      active = ticket;
      return ticket;
    },
    cancel() {
      active?.controller.abort();
      active = null;
    },
  };
}

export function assetMediaRevision(asset) {
  return JSON.stringify([asset.kind, asset.mediaUrl, asset.mtimeMs, asset.size]);
}

// CDP Fetch.fulfillRequest cannot stream SSE. Embedded clients probe only a
// cheap revision token and fetch the library when it actually changed.
export function createRevisionPoller({
  fetchRevision, getProjectId, getRevision, isBusy = () => false,
  onLibraryChanged, onConfigChanged, onError = () => {},
  isVisible = () => true, schedule = setTimeout, cancelSchedule = clearTimeout,
}) {
  let stopped = true, timer = null, request = null, configRevision = null, failures = 0;
  async function tick() {
    if (stopped) return;
    const projectId = getProjectId();
    const controller = new AbortController();
    request = controller;
    try {
      const data = await fetchRevision(projectId, controller.signal);
      if (stopped || request !== controller || projectId !== getProjectId()) return;
      const configurationChanged = configRevision !== null && data.configRevision != null && data.configRevision !== configRevision;
      if (configurationChanged || (projectId && data.projectExists === false)) {
        if (await onConfigChanged() === false) throw new Error("Asset configuration refresh failed");
      } else if (projectId && data.revision && data.revision !== getRevision() && !isBusy()) {
        await onLibraryChanged();
      }
      if (stopped || request !== controller) return;
      configRevision = data.configRevision ?? configRevision;
      failures = 0;
    } catch (error) {
      if (stopped || request !== controller || error.name === "AbortError") return;
      failures++;
      if (failures === 1) onError(error);
    } finally {
      if (!stopped && request === controller) {
        request = null;
        const delay = Math.max(isVisible() ? 3000 : 15000, Math.min(30000, failures ? 3000 * 2 ** Math.min(failures, 4) : 0));
        timer = schedule(tick, delay);
      }
    }
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = schedule(tick, 1000);
    },
    stop() {
      stopped = true;
      cancelSchedule(timer);
      request?.abort();
      request = null;
    },
  };
}

// Only this reconciler owns card nodes. Unchanged snapshots perform zero node
// insertions/removals, preserving media playback, text scroll and open menus.
export function createAssetCardReconciler({ container, createCard, updateCard, disposeCard = () => {} }) {
  const entries = new Map();
  let projectKey = null;
  function remove(entry) {
    disposeCard(entry.node);
    entry.node.remove();
  }
  return function reconcile(assets, projectId) {
    if (projectId !== projectKey) {
      for (const entry of entries.values()) remove(entry);
      entries.clear();
      projectKey = projectId;
    }
    const wanted = new Set(assets.map((asset) => asset.id));
    for (const [id, entry] of entries) {
      if (!wanted.has(id)) { remove(entry); entries.delete(id); }
    }
    let cursor = container.firstElementChild;
    for (const asset of assets) {
      const fingerprint = JSON.stringify(asset);
      let entry = entries.get(asset.id);
      if (!entry) {
        const node = createCard(asset);
        if (!node) continue;
        entry = { node, fingerprint, asset };
        entries.set(asset.id, entry);
      } else if (entry.fingerprint !== fingerprint) {
        const replacement = updateCard(entry.node, asset, entry.asset) || entry.node;
        if (replacement !== entry.node) {
          const wasCursor = cursor === entry.node;
          container.insertBefore(replacement, entry.node);
          remove(entry);
          if (wasCursor) cursor = replacement;
          entry.node = replacement;
        }
        entry.fingerprint = fingerprint;
        entry.asset = asset;
      }
      if (entry.node !== cursor) {
        // moveBefore preserves active media/focus on supported Chromium builds.
        if (entry.node.parentNode === container && typeof container.moveBefore === "function") {
          container.moveBefore(entry.node, cursor);
        } else {
          container.insertBefore(entry.node, cursor);
        }
      }
      cursor = entry.node.nextElementSibling;
    }
  };
}
