import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { browseOpenChatCutLocalMedia, importOpenChatCutLocalMedia, localOpenChatCutUploadSlot, openChatCutImportSettings } from '../lib/openchatcut-import.mjs';
import { createOpenChatCutController } from '../lib/openchatcut-controller.mjs';

async function fixture(t, { cloud = false, mutate = false, probeDuration = 2 } = {}) {
  const directory = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'openchatcut-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, '素材.mp4'), bytes = Buffer.from([0, 1, 3, 7, 255, 13, 10, 0, 23]);
  await writeFile(filename, bytes);
  const calls = [], uploads = [], receipts = new Map(); let slotCount = 0;
  const handoffSecret = 'opaque-upload-handoff-test-32-characters', receiptSecret = 'opaque-upload-receipt-test-32-characters';
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.origin, baseUrl);
    if (!['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'invalid request origin' })); return;
    }
    if (req.url === '/api/keys') { res.end(JSON.stringify({ caps: { storage: cloud }, models: { AGENT_IMPORT_ROOTS: directory } })); return; }
    const url = new URL(req.url, baseUrl); assert.equal(url.pathname, '/upload');
    assert.equal(req.method, 'POST'); assert.equal(req.headers['content-length'], String(bytes.length)); assert.equal(req.headers['content-type'], 'video/mp4');
    assert.equal(url.searchParams.get('projectId'), 'project-a'); assert.equal(url.searchParams.get('handoff'), handoffSecret);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const uploaded = Buffer.concat(chunks); uploads.push(uploaded);
    const stored = path.join(directory, `readback-${uploads.length}.mp4`); await writeFile(stored, uploaded);
    if (mutate) await writeFile(filename, Buffer.concat([bytes, Buffer.from([5])]));
    const assetId = url.searchParams.get('assetId'), sessionId = url.searchParams.get('sessionId');
    const fileKey = `uploads/${assetId}.${sessionId}.mp4`;
    receipts.set(receiptSecret, fileKey);
    res.end(JSON.stringify({ path: `/media/${fileKey}`, bytes: uploaded.length, contentHash: createHash('sha256').update(uploaded).digest('hex'),
      fileKey, sessionId, state: 'uploaded', assetId, assetType: 'video', filename: url.searchParams.get('name'), cloud: false, created: true, receipt: receiptSecret }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const makeSlot = args => {
    const assetId = `asset-${++slotCount}`, sessionId = `sess_slot-${slotCount}`;
    const upload = new URL('/upload', 'https://opaque-aiyoucodex-editor.invalid');
    for (const [key, value] of Object.entries({ assetId, sessionId, assetType: args.assetType, name: args.filename, projectId: 'project-a', handoff: handoffSecret })) upload.searchParams.set(key, value);
    const fileKey = `uploads/${assetId}.${sessionId}.mp4`;
    return { ok: true, projectId: 'project-a', sessionId, slots: [{ assetId, fileKey, readUrl: `/media/${fileKey}`, uploadUrl: upload.href,
      method: 'POST', allowedMethods: ['POST'], expiresAt: Date.now() + 60000, filename: args.filename, assetType: args.assetType,
      size: args.size, contentType: args.contentType, headers: { 'Content-Type': args.contentType, 'Content-Length': String(args.size) } }] };
  };
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === 'read_project') return { assets: [] };
    if (name === 'import_media') return makeSlot(args);
    if (name === 'probe_media') return { ok: true, durationSeconds: probeDuration, width: 320, height: 180, fps: 30, hasAudioTrack: false };
    if (name === 'finalize_uploaded_asset') {
      assert.equal(args.receipt, receiptSecret); assert.equal(args.durationInSeconds, 2); assert.equal(args.hasAudioTrack, false);
      const fileKey = receipts.get(args.receipt); return { ok: true, assetId: fileKey.split('/')[1].split('.')[0], src: `/media/${fileKey}`, name: '素材.mp4', transcription: 'not_started' };
    }
    throw new Error(name);
  };
  return { directory, filename, bytes, baseUrl, invoke, calls, uploads, makeSlot, handoffSecret, receiptSecret };
}

test('verified local import streams exact bytes through HTTP, measures media, finalizes current project and deduplicates', async t => {
  const f = await fixture(t), duplicate = path.join(f.directory, '相同素材.mp4'); await writeFile(duplicate, f.bytes);
  const result = await importOpenChatCutLocalMedia('import_assets', { paths: [f.filename, duplicate] }, { baseUrl: f.baseUrl, projectId: 'project-a', invoke: f.invoke });
  assert.equal(result.imported.length, 1); assert.equal(result.duplicateCount, 1); assert.equal(result.transcription, 'not_started');
  assert.deepEqual(await readFile(path.join(f.directory, 'readback-1.mp4')), f.bytes);
  assert.deepEqual(f.calls.map(call => call.name), ['read_project', 'import_media', 'probe_media', 'finalize_uploaded_asset']);
  assert.equal(f.calls.at(-1).args.durationInSeconds, 2); assert.equal(f.calls.at(-1).args.fps, 30);
  assert.ok(!JSON.stringify(result).includes(f.receiptSecret)); assert.ok(!JSON.stringify(result).includes(f.handoffSecret));
});

test('upload handoff checks exact project, media scope, allowed query and expiry before rebasing to local origin', async t => {
  const f = await fixture(t), expected = { baseUrl: f.baseUrl, projectId: 'project-a', filename: '素材.mp4', assetType: 'video', contentType: 'video/mp4', size: f.bytes.length };
  const valid = f.makeSlot({ filename: expected.filename, assetType: expected.assetType, contentType: expected.contentType, size: expected.size });
  assert.equal(new URL(localOpenChatCutUploadSlot(valid, expected).uploadUrl).origin, f.baseUrl);
  for (const query of ['projectId=project-b', 'ifAbsent=1', 'assetType=audio']) {
    const forged = structuredClone(valid); const url = new URL(forged.slots[0].uploadUrl);
    const [key, value] = query.split('='); url.searchParams.set(key, value); forged.slots[0].uploadUrl = url.href;
    assert.throws(() => localOpenChatCutUploadSlot(forged, expected));
  }
  const expired = structuredClone(valid); expired.slots[0].expiresAt = 1;
  assert.throws(() => localOpenChatCutUploadSlot(expired, expected)); assert.equal(f.uploads.length, 0);
});

test('cloud storage cannot upload a local file and source changes cannot commit an uploaded receipt', async t => {
  const cloud = await fixture(t, { cloud: true });
  await assert.rejects(importOpenChatCutLocalMedia('import_asset', { path: '/does-not-exist.mp4' }, { baseUrl: cloud.baseUrl, projectId: 'project-a', invoke: cloud.invoke }), { code: 'OPENCHATCUT_LOCAL_STORAGE_REQUIRED' });
  assert.equal(cloud.uploads.length, 0); assert.equal(cloud.calls.length, 0);
  const changed = await fixture(t, { mutate: true });
  await assert.rejects(importOpenChatCutLocalMedia('import_asset', { path: changed.filename }, { baseUrl: changed.baseUrl, projectId: 'project-a', invoke: changed.invoke }), { code: 'OPENCHATCUT_SOURCE_CHANGED' });
  assert.equal(changed.uploads.length, 1); assert.ok(!changed.calls.some(call => call.name === 'finalize_uploaded_asset'));
});

test('invalid probe cannot finalize a video with a guessed duration', async t => {
  const f = await fixture(t, { probeDuration: undefined });
  await assert.rejects(importOpenChatCutLocalMedia('import_asset', { path: f.filename }, { baseUrl: f.baseUrl, projectId: 'project-a', invoke: async (name, args) => name === 'probe_media' ? { ok: true } : f.invoke(name, args) }), { code: 'OPENCHATCUT_PROBE_FAILED' });
  assert.ok(!f.calls.some(call => call.name === 'finalize_uploaded_asset'));
});

test('local browse preserves configured roots, media filtering, paging and symlink exclusion', async t => {
  const f = await fixture(t); await mkdir(path.join(f.directory, '子目录')); await writeFile(path.join(f.directory, '附件.txt'), 'not media');
  await symlink(f.filename, path.join(f.directory, 'symlink.mp4'));
  const missingFetchMetadata = await fetch(`${f.baseUrl}/api/keys`, { headers: { Origin: f.baseUrl } });
  assert.equal(missingFetchMetadata.status, 403, 'Project-store reads also require Fetch Metadata');
  const settings = await openChatCutImportSettings(f.baseUrl, { requireLocalStorage: false });
  const result = await browseOpenChatCutLocalMedia({ path: f.directory, limit: 1 }, settings);
  assert.equal(result.entries.length, 1); assert.equal(result.nextOffset, 1);
  const media = await browseOpenChatCutLocalMedia({ path: f.directory, kind: 'video' }, settings);
  assert.deepEqual(media.entries.map(entry => entry.name), ['素材.mp4']);
  await assert.rejects(browseOpenChatCutLocalMedia({ path: path.dirname(f.directory) }, settings), { code: 'PATH_OUTSIDE_IMPORT_ROOTS' });
});

test('controller adapts preload-only path tools through the same bound editor and closes stale empty drafts', async t => {
  const f = await fixture(t), events = [], upstream = [], drafts = new Map(); let activeProject, currentDraft, sequence = 0, revision = 0, boundRevision = 0;
  const controller = createOpenChatCutController({ stateRoot: path.join(f.directory, 'state'), connectionPath: path.join(f.directory, 'state/controller.json'),
    installer: { status: async () => ({ installed: true }), launch: async () => ({ baseUrl: f.baseUrl }) },
    fetchImpl: async (url, options) => url.endsWith('/bootstrap') ? new Response(JSON.stringify({ mcpToken: 'private-test-token-for-bootstrap' })) : fetch(url, options),
    onEvent: event => { events.push(event); if (event.type === 'editing') activeProject = event.session.projectId; },
    createClient: () => ({ initialize: async () => {}, close: async () => {}, listTools: async () => ['import_asset', 'import_media', 'probe_media', 'finalize_uploaded_asset', 'read_project'].map(name => ({ name })),
      callTool: async (name, args = {}) => {
        upstream.push({ name, args });
        if (name === 'create_project') return { id: 'project-a', name: 'Live imported project' };
        if (name === 'openchatcut_status') return { connectedProjectIds: activeProject ? [activeProject] : [] };
        if (name === 'target_project') { boundRevision = revision; for (const draft of drafts.values()) if (draft.revision !== revision && draft.status === 'drafting') draft.orphaned = true; return { bindingMode: 'browser', binding: { projectId: args.projectId, baseRevision: String(revision) } }; }
        assert.equal(args.editorProjectId, 'project-a');
        if (name === 'begin_edit_session') { currentDraft = `draft-${++sequence}`; drafts.set(currentDraft, { status: 'drafting', operationCount: 0, approvalMode: 'auto', revision }); return { editSessionId: currentDraft, ...drafts.get(currentDraft) }; }
        if (name === 'get_edit_session') { assert.equal(boundRevision, revision, 'Old revision binding cannot read an active draft after a live mutation'); assert.equal(drafts.get(args.editSessionId).orphaned, undefined); return { editSessionId: args.editSessionId, ...drafts.get(args.editSessionId) }; }
        if (name === 'list_edit_sessions') { assert.equal(boundRevision, revision); return [...drafts.entries()].map(([editSessionId, draft]) => ({ editSessionId, ...draft })); }
        if (name === 'recover_edit_session') { assert.equal(args.action, 'discard'); assert.equal(drafts.get(args.editSessionId).orphaned, true); drafts.get(args.editSessionId).status = 'cancelled'; return { editSessionId: args.editSessionId, status: 'cancelled' }; }
        if (name === 'discard_edit_session') { drafts.get(args.editSessionId).status = 'cancelled'; return { status: 'cancelled' }; }
        if (name === 'finalize_uploaded_asset') { const result = await f.invoke(name, args); revision++; drafts.get(currentDraft).stale = true; return result; }
        return f.invoke(name, args);
      } }) });
  t.after(() => controller.dispose());
  const imported = await controller.handle({ action: 'call-tool', threadId: 'conversation-a', name: 'import_asset', arguments: { path: f.filename } });
  assert.equal(imported.result.imported[0].id, 'asset-1'); assert.equal(imported.session.editSessionId, null);
  assert.ok(!upstream.some(call => call.name === 'import_asset' || call.name === 'review_edit_session'));
  assert.equal(upstream.filter(call => call.name === 'create_project').length, 1);
  assert.ok(upstream.some(call => call.name === 'recover_edit_session' && call.args.action === 'discard'));
  const saved = await readFile(path.join(f.directory, 'state/sessions.json'), 'utf8');
  for (const secret of [f.handoffSecret, f.receiptSecret]) { assert.ok(!saved.includes(secret)); assert.ok(!JSON.stringify(events).includes(secret)); }
  assert.ok(events.some(event => event.state === 'importing'));
});
