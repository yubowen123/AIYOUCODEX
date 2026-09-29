#!/usr/bin/env node
// Read-only audit and consistent backup for native history recovery.
// Cursor-only adjustment is intentionally not exposed: later replay conflicts
// can roll back the entire native projection transaction.
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAP = 256 * 1024;
const stateQuery = 'SELECT * FROM thread_history_projection_state WHERE thread_id = ?';

export function assessMarker(state, entry, next, threadId) {
  assert.ok(state && state.thread_id === threadId, 'Missing exact-thread projection');
  assert.ok(Number.isSafeInteger(state.next_rollout_ordinal) && state.next_rollout_ordinal > 0);
  assert.ok(Number.isSafeInteger(state.next_rollout_byte_offset) && state.next_rollout_byte_offset >= 0);
  assert.equal(entry.type, 'event_msg', 'Refusing to bypass a message or unknown record');
  assert.equal(entry.payload?.type, 'thread_settings_applied', 'Only settings replay markers are supported');
  assert.equal(entry.payload.thread_id, threadId, 'Foreign thread');
  assert.equal(entry.ordinal, state.next_rollout_ordinal - 1, 'Not a single replayed ordinal');
  assert.equal(next.ordinal, state.next_rollout_ordinal, 'Next record is not contiguous');
  assert.equal(next.type, 'event_msg');
  assert.equal(next.payload?.type, 'task_started', 'Expected the next turn boundary');
  return { threadId, byteOffset: state.next_rollout_byte_offset,
    expectedOrdinal: state.next_rollout_ordinal, correctedOrdinal: entry.ordinal,
    markerTimestamp: entry.timestamp, nextTurnId: next.payload.turn_id };
}

async function markerAt(file, offset) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(CAP);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const first = buffer.indexOf(10, 0), second = first < 0 ? -1 : buffer.indexOf(10, first + 1);
    assert.ok(first > 0 && second > first && second < bytesRead, 'Incomplete or oversized marker');
    const bytes = buffer.subarray(0, second + 1);
    return { entry: JSON.parse(buffer.subarray(0, first)), next: JSON.parse(buffer.subarray(first + 1, second)),
      hash: createHash('sha256').update(bytes).digest('hex') };
  } finally { await handle.close(); }
}

async function prefixHash(file, size) {
  const hash = createHash('sha256');
  if (size) for await (const chunk of createReadStream(file, { end: size - 1 })) hash.update(chunk);
  return hash.digest('hex');
}

export async function run({ home, threadId, backupDir, action = 'audit' }) {
  assert.ok(uuid.test(threadId), 'A full local thread UUID is required');
  assert.ok(['audit', 'backup'].includes(action), 'Only read-only audit and backup are supported');
  const root = await realpath(home);
  const stateDb = new DatabaseSync(path.join(root, 'state_5.sqlite'), { readOnly: true });
  let row;
  try { row = stateDb.prepare('SELECT id, rollout_path, history_mode FROM threads WHERE id = ?').get(threadId); }
  finally { stateDb.close(); }
  assert.ok(row && row.history_mode === 'paginated', 'Expected an existing paginated local thread');
  const rollout = await realpath(row.rollout_path);
  assert.ok(rollout.startsWith(path.join(root, 'sessions') + path.sep), 'Rollout outside local sessions');
  const dbPath = path.join(root, 'thread_history_1.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    const state = db.prepare(stateQuery).get(threadId);
    assert.ok(state, 'Missing exact-thread projection');
    const marker = await markerAt(rollout, state.next_rollout_byte_offset);
    const plan = { ...assessMarker(state, marker.entry, marker.next, threadId), markerHash: marker.hash };
    if (action === 'audit') return { action, plan };
    assert.ok(backupDir && path.isAbsolute(backupDir), 'An absolute private backup directory is required');
    const directory = path.resolve(backupDir);
    assert.ok(directory.startsWith(path.join(root, 'repair-backups') + path.sep), 'Backups must stay in the private repair-backups folder');
    const manifestPath = path.join(directory, 'manifest.json');
    if (action === 'backup') {
      await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
      await mkdir(directory, { mode: 0o700 }); // Refuse reuse or overwrite.
      const before = await stat(rollout), hash = createHash('sha256');
      const rolloutBackup = path.join(directory, 'rollout-prefix.jsonl');
      const meter = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } });
      await pipeline(createReadStream(rollout, { end: before.size - 1 }), meter,
        createWriteStream(rolloutBackup, { flags: 'wx', mode: 0o600 }));
      const digest = hash.digest('hex');
      assert.equal((await stat(rolloutBackup)).size, before.size);
      assert.equal(await prefixHash(rollout, before.size), digest, 'Source prefix changed during backup');
      const dbBackup = path.join(directory, 'thread_history.sqlite');
      await backup(db, dbBackup);
      await chmod(dbBackup, 0o600);
      const copied = new DatabaseSync(dbBackup, { readOnly: true });
      try {
        assert.equal(copied.prepare('PRAGMA quick_check').get().quick_check, 'ok');
        assert.deepEqual(copied.prepare(stateQuery).get(threadId), state, 'Cursor changed during backup');
      } finally { copied.close(); }
      const manifest = { version: 1, threadId, createdAt: new Date().toISOString(), rollout, dbPath,
        rolloutSize: before.size, rolloutSha256: digest, rolloutBackup, dbBackup, initialState: state, plan };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return { action, manifestPath, rolloutSize: before.size, verified: true };
    }
  } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, home, threadId, backupDir] = process.argv.slice(2);
  run({ action, home, threadId, backupDir }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
