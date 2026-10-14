import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntimeSupervisor } from '../lib/runtime-supervisor.mjs';

test('pausing stops only owned children, cancels recovery and resumes once', async () => {
  const created = [];
  const supervisor = createRuntimeSupervisor({ definitions: [{ name: 'fixture', command: 'fixture', args: [] }], retryBaseMs: 20,
    spawnProcess: () => {
      const child = new EventEmitter(); Object.assign(child, { pid: created.length + 1, exitCode: null, signalCode: null, signals: [] });
      child.kill = signal => { child.signals.push(signal); child.signalCode = signal; child.emit('exit', null, signal); child.emit('close', null, signal); };
      created.push(child); return child;
    } });
  await supervisor.setEnabled(true); await supervisor.setEnabled(true);
  assert.equal(created.length, 1);
  created[0].exitCode = 1; created[0].emit('exit', 1); created[0].emit('close', 1);
  assert.equal(supervisor.snapshot().pendingRestarts, 1);
  await supervisor.setEnabled(false); await delay(50);
  assert.equal(created.length, 1, 'A scheduled recovery cannot revive a paused runtime');
  await supervisor.setEnabled(true); assert.equal(created.length, 2);
  await supervisor.setEnabled(false); await delay(50);
  assert.deepEqual(created[1].signals, ['SIGTERM']);
  assert.deepEqual(supervisor.snapshot(), { enabled: false, children: [], pendingRestarts: 0 });
  assert.equal(created.length, 2);
});
