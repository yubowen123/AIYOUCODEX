import assert from 'node:assert/strict';
import test from 'node:test';
import {isHostReplyIdle} from '../lib/host-reply-state.mjs';
import {createDesktopAppRuntime} from '../lib/desktop-runtime.mjs';

test('old and non-local board cards do not indefinitely block a new desktop process', async () => {
  const repository = {resolveExactEfficiencyRecord: async id => id === 'missing' ? null : {filePath: '/rollout'},
    isConversationIdle: async () => false};
  assert.equal(await isHostReplyIdle(repository, 'missing', 200), true);
  assert.equal(await isHostReplyIdle(repository, 'old', 200, {statFile: async () => ({mtimeMs: 100})}), true);
  assert.equal(await isHostReplyIdle(repository, 'running', 200, {statFile: async () => ({mtimeMs: 300})}), false);
});

test('fresh unknown and active replies remain protected; completed replies allow recovery', async () => {
  const repository = {resolveExactEfficiencyRecord: async () => ({filePath: '/rollout'}),
    isConversationIdle: async id => id === 'complete'};
  const options = {statFile: async () => ({mtimeMs: 300})};
  assert.equal(await isHostReplyIdle(repository, 'complete', 200, options), true);
  assert.equal(await isHostReplyIdle(repository, 'unknown', 200, options), false);
  assert.equal(await isHostReplyIdle(repository, 'unknown', null, options), false);
  await assert.rejects(isHostReplyIdle(repository, 'unknown', 200, {statFile: async () => {throw Error('read failed');}}));
});

test('desktop birth time is read for the exact host PID; unreadable time fails closed', async () => {
  const runtime = createDesktopAppRuntime({platform: 'darwin', execFileAsync: async (_, args) => {
    assert.deepEqual(args, ['-p', '123', '-o', 'lstart=']);
    return {stdout: 'Wed Oct  7 00:58:30 2026\n'};
  }});
  assert.ok(await runtime.readStartedAt({pid: 123}));
  const unavailable = createDesktopAppRuntime({platform: 'darwin', execFileAsync: async () => ({stdout: 'invalid'})});
  assert.equal(await unavailable.readStartedAt({pid: 123}), null);
});
