// Runs the installed native history reader against an isolated, backed-up copy.
// No generation request, live rollout change or live database write.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

const directory = path.resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const probeHome = path.join(directory, 'isolated-reader');
const mode = process.argv[4] || 'read';
assert.ok(['read', 'resume', 'verify'].includes(mode));
const rollout = path.join(probeHome, 'sessions', path.basename(manifest.rollout));
if (mode === 'read') {
await mkdir(probeHome, { mode: 0o700 });
await mkdir(path.join(probeHome, 'sessions'), { mode: 0o700 });
await copyFile(manifest.rolloutBackup, rollout, constants.COPYFILE_FICLONE);
const markers = JSON.parse(process.argv[3]);
const handle = await open(rollout, 'r+');
try {
  for (const marker of markers) {
    const bytes = Buffer.alloc(marker.bytes);
    assert.equal((await handle.read(bytes, 0, bytes.length, marker.offset)).bytesRead, bytes.length);
    const record = JSON.parse(bytes.toString());
    assert.equal(record.ordinal, marker.ordinal);
    assert.equal(record.payload?.type, 'thread_settings_applied');
    assert.equal(record.payload?.thread_id, manifest.threadId);
    // Offset-preserving whitespace is confined to the disposable read copy.
    const blank = Buffer.alloc(bytes.length, 32); blank[blank.length - 1] = 10;
    await handle.write(blank, 0, blank.length, marker.offset);
  }
} finally { await handle.close(); }
await writeFile(path.join(probeHome, 'config.toml'), '[analytics]\nenabled = false\n[features]\nshell_snapshot = false\n', { mode: 0o600 });
const sourceState = new DatabaseSync(path.join(path.dirname(manifest.dbPath), 'state_5.sqlite'), { readOnly: true });
await backup(sourceState, path.join(probeHome, 'state_5.sqlite')); sourceState.close();
const state = new DatabaseSync(path.join(probeHome, 'state_5.sqlite'));
state.exec('PRAGMA foreign_keys=OFF');
state.prepare('DELETE FROM threads WHERE id <> ?').run(manifest.threadId);
state.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(rollout, manifest.threadId);
state.close();
await copyFile(manifest.dbBackup, path.join(probeHome, 'thread_history_1.sqlite'), constants.COPYFILE_FICLONE);
const history = new DatabaseSync(path.join(probeHome, 'thread_history_1.sqlite'));
for (const table of ['thread_turns', 'thread_items', 'thread_realtime_items', 'thread_history_projection_state']) {
  history.prepare(`DELETE FROM ${table} WHERE thread_id <> ?`).run(manifest.threadId);
}
history.close();
} else {
  const state = new DatabaseSync(path.join(probeHome, 'state_5.sqlite'), { readOnly: true });
  assert.equal(state.prepare('SELECT rollout_path FROM threads WHERE id=?').get(manifest.threadId).rollout_path, rollout);
  state.close();
}
const child = spawn('/Applications/ChatGPT.app/Contents/Resources/codex', ['app-server', '--listen', 'stdio://'], {
  env: { ...process.env, CODEX_HOME: probeHome }, stdio: ['pipe', 'pipe', 'pipe']
});
let id = 0, stderr = '';
const pending = new Map();
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
const lines = readline.createInterface({ input: child.stdout });
lines.on('line', line => {
  let value; try { value = JSON.parse(line); } catch { return; }
  if (!pending.has(value.id)) return;
  const { resolve, reject, timer } = pending.get(value.id); pending.delete(value.id); clearTimeout(timer);
  if (value.error) reject(new Error(JSON.stringify(value.error))); else resolve(value.result);
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method} timed out`)); }, 55000);
    pending.set(n, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: n, method, params }) + '\n');
  });
}
try {
  const initialized = await request('initialize', { clientInfo: { name: 'aiyou_history_repair_probe', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  console.log(JSON.stringify({ step: 'initialize', userAgent: initialized.userAgent }));
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  for (const [method, params] of [
    ['thread/read', { threadId: manifest.threadId, includeTurns: false }],
    ...(mode === 'resume' ? [['thread/resume', { threadId: manifest.threadId, excludeTurns: true }]] : []),
    ['thread/turns/list', { threadId: manifest.threadId, limit: 2, itemsView: 'summary', sortDirection: 'desc' }]
  ]) {
    try {
      const result = await request(method, params);
      console.log(JSON.stringify({ step: method, keys: Object.keys(result),
        turns: (result.data || []).map(t => ({ id: t.id, status: t.status, startedAt: t.startedAt })),
        nextCursor: result.nextCursor, historyMode: result.thread?.historyMode }));
    } catch (error) { console.log(JSON.stringify({ step: method, error: error.message })); }
  }
  if (mode === 'verify') {
    const db = new DatabaseSync(path.join(probeHome, 'thread_history_1.sqlite'), { readOnly: true });
    try {
      for (const anchor of JSON.parse(process.argv[5] || '[]')) {
        const row = db.prepare(`SELECT turn_id FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND item_json LIKE ? LIMIT 1`)
          .get(manifest.threadId, `%${anchor}%`);
        assert.ok(row, 'Requested history anchor missing');
        const result = await request('thread/items/list', { threadId: manifest.threadId, turnId: row.turn_id, limit: 10, sortDirection: 'asc' });
        const found = (result.data || []).some(({ item }) => item.type === 'userMessage' && JSON.stringify(item).includes(anchor));
        assert.ok(found, 'Native body read failed for anchor');
        console.log(JSON.stringify({ step: 'native-body-verification', anchor, turnId: row.turn_id, found }));
      }
    } finally { db.close(); }
  }
} finally {
  child.stdin.end(); child.kill('SIGTERM'); lines.close();
  for (const p of pending.values()) clearTimeout(p.timer);
  await writeFile(path.join(probeHome, 'native-stderr.log'), stderr, { mode: 0o600 });
  const db = new DatabaseSync(path.join(probeHome, 'thread_history_1.sqlite'), { readOnly: true });
  console.log(JSON.stringify({ probeHome, state: db.prepare('SELECT * FROM thread_history_projection_state WHERE thread_id=?').get(manifest.threadId),
    items: db.prepare('SELECT COUNT(*) count,MAX(rollout_ordinal) last FROM thread_items WHERE thread_id=?').get(manifest.threadId) }));
  db.close();
}
