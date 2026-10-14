import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('authorized asset HTTP retrieval falls back without a model, keeps filters/counts and rejects stale search snapshots', { timeout: 30000 }, async t => {
  const outputRoot = process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir();
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(path.join(outputRoot, 'asset-laya-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'project-a'), b = path.join(root, 'project-b'), home = path.join(root, 'empty-home');
  await Promise.all([mkdir(a), mkdir(b), mkdir(home)]);
  const voice = path.join(a, 'voice.md'), scene = path.join(a, 'scene.md'), draft = path.join(a, 'draft.md'), foreign = path.join(b, 'private.md');
  await Promise.all([writeFile(voice, 'voice transcript production notes'), writeFile(scene, 'castle scene planning'), writeFile(draft, 'voice rejected reference'), writeFile(foreign, 'voice transcript another project')]);
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ projects: [{ id: 'a', name: 'A', folders: [a] }, { id: 'b', name: 'B', folders: [b] }],
    assetMetadata: { [voice]: { smartGroup: 'asset', category: '文档', tags: ['voice'] }, [scene]: { smartGroup: 'asset', category: '剧本', tags: ['castle'] },
      [draft]: { smartGroup: 'review', category: '文档', tags: ['voice'] }, [foreign]: { smartGroup: 'asset', category: '文档', tags: ['voice'] } },
    deduplication: { automaticSweep: false }, automation: { enabled: false } }));
  const token = 'fixture-asset-library-search-token-00000000001', tokenPath = path.join(root, 'token');
  await writeFile(tokenPath, token);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, CODEX_HOME: path.join(home, '.codex'),
    PORT: String(port), ASSET_BROWSER_TOKEN_FILE: tokenPath, ASSET_BROWSER_CONFIG: configPath };
  for (const name of ['ASSET_BROWSER_LEDGER', 'GENERATION_TICKETS', 'GENERATION_THREAD_BINDINGS', 'CODEX_PROMPT_ASSOCIATIONS', 'ASSET_LIBRARY_INDEX',
    'DUPLICATE_CLEANUP_LEDGER', 'RHYTHM_CONTROL_REGISTRY', 'THREE_D_TASKS', 'CODEX_GLOBAL_STATE', 'CODEX_SESSION_INDEX']) env[name] = path.join(root, `${name}.json`);
  for (const name of ['CODEX_SESSIONS_ROOT', 'CODEX_GENERATED_IMAGES_ROOT', 'DUPLICATE_QUARANTINE', 'PROMPT_LIBRARY_ROOT', 'ASSET_ACTION_TRASH']) env[name] = path.join(root, name);
  const serverPath = fileURLToPath(new URL('../vendor/codex-workspace-enhancer/asset-browser/server.js', import.meta.url));
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', chunk => { logs = `${logs}${chunk}`.slice(-4000); }); child.stderr.on('data', chunk => { logs = `${logs}${chunk}`.slice(-4000); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } });
  const origin = `http://127.0.0.1:${port}`;
  const get = async route => {
    const response = await fetch(`${origin}${route}`, { headers: { 'x-asset-console-token': token } });
    return { status: response.status, data: await response.json() };
  };
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`Fixture server exited: ${logs}`);
    try { if ((await get('/api/projects')).status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(ready, true, logs);
  assert.equal((await fetch(`${origin}/api/library?project=a&searchMode=laya&query=voice&limit=1`)).status, 403);
  const first = await get('/api/library?project=a&searchMode=laya&query=voice&smartGroup=asset&kind=text&limit=1&sort=relevance');
  assert.equal(first.status, 200); assert.deepEqual(first.data.assets.map(asset => asset.name), ['voice.md']);
  assert.equal(first.data.search.engine, 'keyword'); assert.equal(first.data.search.fallback, true);
  assert.match(first.data.assets[0].searchSnippet, /voice/); assert.ok(Array.from(first.data.assets[0].searchSnippet).length <= 300);
  assert.equal(first.data.search.source, 'indexed-asset-text'); assert.equal(first.data.search.coverage.total, 2);
  assert.equal(first.data.total, 3); assert.equal(first.data.filteredTotal, 1); assert.equal(first.data.counts.all, 2);
  assert.deepEqual(first.data.smartCounts, { asset: 2, review: 1, noise: 0 });
  assert.equal(first.data.categoryCounts['剧本'], 1); assert.equal(first.data.categoryCounts['文档'], 1);
  const pageQuery = new URLSearchParams({ project: 'a', searchMode: 'laya', query: 'voice', smartGroup: 'asset', kind: 'text', limit: '1', offset: '1',
    revision: first.data.index.revision, searchRevision: first.data.search.revision });
  const next = await get(`/api/library?${pageQuery}`); assert.equal(next.status, 200); assert.deepEqual(next.data.assets, []);
  assert.equal(next.data.search.revision, first.data.search.revision);
  const full = await get('/api/library?project=a&searchMode=laya&query=voice&smartGroup=asset');
  assert.deepEqual(full.data.assets.map(asset => asset.name), ['voice.md']); assert.equal(full.data.page, undefined);
  const category = await get('/api/library?project=a&searchMode=laya&query=voice&smartGroup=asset&category=剧本&limit=1');
  assert.equal(category.status, 200); assert.equal(category.data.assets.length, 0);
  const review = await get('/api/library?project=a&searchMode=laya&query=voice&smartGroup=review&limit=1');
  assert.deepEqual(review.data.assets.map(asset => asset.name), ['draft.md']);
  const keyword = await get('/api/library?project=a&searchMode=keyword&query=castle&limit=1');
  assert.deepEqual(keyword.data.assets.map(asset => asset.name), ['scene.md']); assert.equal(keyword.data.search, undefined);
  const cleared = await get('/api/library?project=a&searchMode=laya&query=&smartGroup=asset&limit=120');
  assert.equal(cleared.status, 200); assert.equal(cleared.data.search, undefined);
  assert.ok(cleared.data.assets.every(asset => !Object.hasOwn(asset, 'searchSnippet')));
  pageQuery.set('project', 'b'); pageQuery.delete('revision'); pageQuery.set('offset', '0');
  assert.equal((await get(`/api/library?${pageQuery}`)).status, 409, 'A search snapshot cannot be used by B');
  pageQuery.set('project', 'a'); pageQuery.set('revision', 'old-revision');
  assert.equal((await get(`/api/library?${pageQuery}`)).status, 409);
  const html = await fetch(`${origin}/`).then(response => response.text());
  assert.match(html, /id="librarySearchMode"/); assert.match(html, /id="librarySearchStatus"/);
});
