// Explicit recovery from a native-reader projection; never edits live rollouts.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { open, readFile, stat, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tables = ['thread_items', 'thread_turns', 'thread_realtime_items'];
const cursorSql = 'SELECT * FROM thread_history_projection_state WHERE thread_id=?';
const count = (db, schema, table, id) => db.prepare(`SELECT COUNT(*) n FROM ${schema}.${table} WHERE thread_id=?`).get(id).n;

export function mergeProjection(db, threadId, expected, recoveredState) {
  db.exec('BEGIN IMMEDIATE');
  try {
    assert.deepEqual({ ...db.prepare(cursorSql).get(threadId) }, { ...expected }, 'Live projection changed; re-audit');
    assert.deepEqual({ ...db.prepare(`SELECT * FROM recovered.thread_history_projection_state WHERE thread_id=?`).get(threadId) },
      { ...recoveredState }, 'Recovery projection changed');
    assert.equal(recoveredState.thread_id, threadId);
    assert.ok(recoveredState.next_rollout_byte_offset > expected.next_rollout_byte_offset, 'No forward recovery');
    assert.ok(recoveredState.next_rollout_ordinal > expected.next_rollout_ordinal, 'No ordinal progress');
    const changes = {};
    for (const table of tables) {
      const difference = db.prepare(`SELECT COUNT(*) n FROM (
        SELECT * FROM main.${table} WHERE thread_id=? EXCEPT SELECT * FROM recovered.${table} WHERE thread_id=?)`).get(threadId, threadId).n;
      assert.equal(difference, 0, `Recovery would change or omit existing ${table}`);
      const before = count(db, 'main', table, threadId);
      // Existing records have just been proven byte-for-byte identical. Any
      // unrelated unique-key collision is caught by the full equality check.
      db.prepare(`INSERT OR IGNORE INTO main.${table} SELECT * FROM recovered.${table} WHERE thread_id=?`).run(threadId);
      const missing = db.prepare(`SELECT COUNT(*) n FROM (
        SELECT * FROM recovered.${table} WHERE thread_id=? EXCEPT SELECT * FROM main.${table} WHERE thread_id=?)`).get(threadId, threadId).n;
      assert.equal(missing, 0, `Incomplete ${table} merge`);
      changes[table] = count(db, 'main', table, threadId) - before;
    }
    assert.equal(db.prepare(`UPDATE thread_history_projection_state SET next_rollout_byte_offset=?,next_rollout_ordinal=?
      WHERE thread_id=? AND next_rollout_byte_offset=? AND next_rollout_ordinal=?`)
      .run(recoveredState.next_rollout_byte_offset, recoveredState.next_rollout_ordinal, threadId,
        expected.next_rollout_byte_offset, expected.next_rollout_ordinal).changes, 1);
    db.exec('COMMIT');
    return changes;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function hashPrefix(file, size, restorations = []) {
  const hash = createHash('sha256'); let position = 0;
  for await (const chunk of createReadStream(file, { end: size - 1 })) {
    for (const { offset, original } of restorations) {
      const from = Math.max(position, offset), to = Math.min(position + chunk.length, offset + original.length);
      if (from < to) original.copy(chunk, from - position, from - offset, to - offset);
    }
    hash.update(chunk); position += chunk.length;
  }
  assert.equal(position, size, 'Incomplete prefix');
  return hash.digest('hex');
}

async function main() {
  const [action, directoryArg, markersJson] = process.argv.slice(2);
  assert.ok(['plan', 'apply'].includes(action));
  const directory = await realpath(directoryArg);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.ok(directory.startsWith(path.join(path.dirname(manifest.dbPath), 'repair-backups') + path.sep));
  assert.ok(/^[0-9a-f-]{36}$/.test(manifest.threadId));
  const isolated = path.join(directory, 'isolated-reader');
  const copy = path.join(isolated, 'sessions', path.basename(manifest.rollout));
  const markers = JSON.parse(markersJson), restorations = [];
  const originalHandle = await open(manifest.rolloutBackup, 'r'), copyHandle = await open(copy, 'r');
  try {
    for (const marker of markers) {
      assert.ok(marker.bytes > 0 && marker.bytes < 262144);
      const original = Buffer.alloc(marker.bytes), modified = Buffer.alloc(marker.bytes);
      assert.equal((await originalHandle.read(original, 0, original.length, marker.offset)).bytesRead, original.length);
      assert.equal((await copyHandle.read(modified, 0, modified.length, marker.offset)).bytesRead, modified.length);
      const record = JSON.parse(original.toString());
      assert.equal(record.type, 'event_msg'); assert.equal(record.payload?.type, 'thread_settings_applied');
      assert.equal(record.payload.thread_id, manifest.threadId); assert.equal(record.ordinal, marker.ordinal);
      assert.ok(/^ +\n$/.test(modified.toString()), 'Unexpected change in the isolated marker');
      restorations.push({ offset: marker.offset, original });
    }
  } finally { await originalHandle.close(); await copyHandle.close(); }
  assert.equal((await stat(copy)).size, manifest.rolloutSize, 'Isolated reader appended records; do not import blindly');
  for (const [file, restored] of [[manifest.rolloutBackup, []], [manifest.rollout, []], [copy, restorations]]) {
    assert.equal(await hashPrefix(file, manifest.rolloutSize, restored), manifest.rolloutSha256,
      'The recovery does not preserve the original message prefix');
  }
  const db = new DatabaseSync(manifest.dbPath, { readOnly: action === 'plan' });
  db.exec('PRAGMA busy_timeout=5000');
  try {
    db.prepare('ATTACH DATABASE ? AS recovered').run(path.join(isolated, 'thread_history_1.sqlite'));
    assert.equal(db.prepare('PRAGMA recovered.quick_check').get().quick_check, 'ok');
    const expected = db.prepare(cursorSql).get(manifest.threadId);
    const recoveredState = db.prepare(`SELECT * FROM recovered.thread_history_projection_state WHERE thread_id=?`).get(manifest.threadId);
    assert.equal(recoveredState.next_rollout_byte_offset, manifest.rolloutSize, 'Native replay did not reach the snapshot end');
    const plan = { threadId: manifest.threadId, expected, recoveredState, rawMessagesPreserved: true,
      ignoredSettingsMarkersInReadCopy: markers.length, counts: {} };
    for (const table of tables) plan.counts[table] = { before: count(db, 'main', table, manifest.threadId), recovered: count(db, 'recovered', table, manifest.threadId) };
    if (action === 'plan') return console.log(JSON.stringify(plan));
    const journal = path.join(directory, 'projection-merge-prepared.json');
    await writeFile(journal, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const changes = mergeProjection(db, manifest.threadId, expected, recoveredState);
    const result = { appliedAt: new Date().toISOString(), threadId: manifest.threadId, changes,
      rawRolloutModified: false, indexedMessagesDeleted: 0, journal };
    await writeFile(path.join(directory, 'projection-merge-applied.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result));
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
