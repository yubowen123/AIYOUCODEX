// Read-only: never confuse a live transport with a healthy, current document.
export const RENDERER_HEALTH_EXPRESSION = `(() => {
  const api = window.__codexConversationPreviewInjection__;
  const health = typeof api?.getHealth === 'function' ? api.getHealth() : null;
  return {
    alive: Boolean(api) && health?.disposed !== true,
    documentEpoch: health?.documentEpoch || String(performance.timeOrigin),
    sourceHash: window.__AIYOUCODEX_RUNTIME_SOURCE_HASH__ || '',
    health,
  };
})()`;

export function acceptDocumentHealth(session, snapshot) {
  if (!snapshot?.alive) return false;
  const epoch = String(snapshot.documentEpoch || '');
  if (!epoch) return false;
  if (session.documentEpoch !== epoch) {
    session.documentEpoch = epoch;
    session.deliveredHistoryKey = '';
    session.deliveredSnapshotHash = '';
    session.persistentShortcutReady?.clear();
    session.needsFullRefresh = true;
    session.updateFailures = 0;
    session.retryUpdateAt = 0;
  }
  session.health = snapshot.health;
  return true;
}

export function recordUpdateFailure(session, now = Date.now()) {
  session.updateFailures = (session.updateFailures || 0) + 1;
  session.retryUpdateAt = now + Math.min(30_000, 1_000 * 2 ** Math.min(5, session.updateFailures - 1));
  session.needsFullRefresh = true;
}

export function canReuseRenderer(snapshot, sourceHash) {
  return snapshot?.alive === true && snapshot.sourceHash === sourceHash;
}

export function rendererReadiness(snapshot) {
  const health = snapshot?.health;
  const failures = [];
  if (!snapshot?.alive || health?.disposed || !health?.ready) failures.push('renderer-not-ready');
  if (!health?.documentEpoch || !health?.runtimeVersion) failures.push('health-contract-missing');
  for (const name of ['sidebar', 'header', 'shortcuts']) {
    if (health?.components?.[name] !== 'ready') failures.push(`${name}-not-ready`);
  }
  // Skills and panels are legitimately absent when closed. Activity mode also
  // replaces the sections/folders. A mounted component reporting errors is not OK.
  for (const [name, state] of Object.entries(health?.components || {})) {
    if (state === 'degraded' || state === 'unsupported') failures.push(`${name}-${state}`);
  }
  for (const name of Object.keys(health?.errors || {})) failures.push(`${name}-render-failed`);
  return { ready: failures.length === 0, failures: [...new Set(failures)] };
}
