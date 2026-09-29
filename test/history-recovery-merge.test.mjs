import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mergeProjection } from '../scripts/merge-recovered-history.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec("ATTACH DATABASE ':memory:' AS recovered");
  for (const schema of ['main', 'recovered']) {
    db.exec(`CREATE TABLE ${schema}.thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER,next_rollout_ordinal INTEGER);`);
    for (const table of ['thread_items', 'thread_turns', 'thread_realtime_items']) {
      db.exec(`CREATE TABLE ${schema}.${table}(thread_id TEXT,item_id TEXT,value TEXT,PRIMARY KEY(thread_id,item_id));
        INSERT INTO ${schema}.${table} VALUES('target','old','preserved'),('other','foreign','untouched');`);
      if (schema === 'recovered') db.exec(`INSERT INTO ${schema}.${table} VALUES('target','new','restored');`);
    }
  }
  db.exec("INSERT INTO main.thread_history_projection_state VALUES('target',100,10),('other',9,9); INSERT INTO recovered.thread_history_projection_state VALUES('target',500,50)");
  return { db, expected: { thread_id: 'target', next_rollout_byte_offset: 100, next_rollout_ordinal: 10 },
    recovered: { thread_id: 'target', next_rollout_byte_offset: 500, next_rollout_ordinal: 50 } };
}
test('imports missing native records without modifying originals or other threads', () => {
  const { db, expected, recovered } = fixture();
  try {
    assert.deepEqual(mergeProjection(db, 'target', expected, recovered), { thread_items: 1, thread_turns: 1, thread_realtime_items: 1 });
    assert.equal(db.prepare("SELECT value FROM thread_items WHERE item_id='old'").get().value, 'preserved');
    assert.equal(db.prepare("SELECT next_rollout_ordinal n FROM thread_history_projection_state WHERE thread_id='other'").get().n, 9);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM thread_items WHERE thread_id='other'").get().n, 1);
    assert.throws(() => mergeProjection(db, 'target', expected, recovered), /changed/);
  } finally { db.close(); }
});
test('rolls back all additions when a recovered table would alter existing records', () => {
  const { db, expected, recovered } = fixture();
  try {
    db.exec("UPDATE recovered.thread_turns SET value='changed' WHERE item_id='old'");
    assert.throws(() => mergeProjection(db, 'target', expected, recovered), /change or omit/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM thread_items WHERE item_id='new'").get().n, 0);
    assert.equal(db.prepare("SELECT next_rollout_ordinal n FROM thread_history_projection_state WHERE thread_id='target'").get().n, 10);
  } finally { db.close(); }
});
