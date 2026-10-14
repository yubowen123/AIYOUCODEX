import { spawn } from 'node:child_process';

export function createRuntimeSupervisor({ definitions, spawnProcess = spawn, log = () => {}, retryBaseMs = 1000, killAfterMs = 3000 } = {}) {
  const children = new Map(), timers = new Map(), attempts = new Map();
  let enabled = false, transition = Promise.resolve();
  function start(definition) {
    if (!enabled || children.has(definition.name)) return;
    const startedAt = Date.now();
    const child = spawnProcess(definition.command, definition.args, { cwd: definition.cwd, env: definition.env, stdio: 'inherit' });
    children.set(definition.name, child);
    log(`${definition.name} started (${child.pid})`);
    child.once('error', error => log(`${definition.name} error: ${error.message}`));
    child.once('close', (code, signal) => {
      if (children.get(definition.name) === child) children.delete(definition.name);
      if (!enabled) return;
      const count = Date.now() - startedAt >= 60000 ? 1 : (attempts.get(definition.name) || 0) + 1;
      attempts.set(definition.name, count);
      const retryMs = Math.min(30000, retryBaseMs * 2 ** Math.min(5, count - 1));
      log(`${definition.name} exited (${signal || code}); retry in ${retryMs}ms`);
      timers.set(definition.name, setTimeout(() => { timers.delete(definition.name); start(definition); }, retryMs));
    });
  }
  async function stopChildren() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    await Promise.allSettled([...children.values()].map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, killAfterMs);
      timer.unref?.();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    })));
    children.clear(); attempts.clear();
  }
  function setEnabled(value) {
    // Lower the restart gate immediately, before asynchronous child shutdown.
    if (!value) enabled = false;
    transition = transition.then(async () => {
      if (!value) { await stopChildren(); return; }
      enabled = true;
      for (const definition of definitions) start(definition);
    });
    return transition;
  }
  return { setEnabled, stop: () => setEnabled(false), snapshot: () => ({ enabled, children: [...children.keys()], pendingRestarts: timers.size }) };
}
