import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { AssetLibrarySearch, assetSearchDocument } from '../vendor/codex-workspace-enhancer/asset-browser/asset-library-search.js';
import { AssetLibraryPager, cleanAssetSearchSnippet } from '../vendor/codex-workspace-enhancer/asset-browser/asset-library-pagination.js';
import { createLatestRequestGate } from '../vendor/codex-workspace-enhancer/asset-browser/public/asset-library-state.js';

const asset = (id, overrides = {}) => ({ id, name: `${id}.md`, title: id, kind: 'text', category: '剧本', smartGroup: 'asset', tags: ['故事'], preview: 'indexed story text', mtimeMs: Number(id.slice(1)) || 0, ...overrides });
const outcome = (documents, extra = {}) => ({ engine: 'laya', fallback: false, results: documents.map((document, index) => ({ id: document.id, score: documents.length - index, snippet: document.text })),
  coverage: { total: documents.length, indexed: documents.length, candidates: Math.min(24, documents.length) }, ...extra });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('asset retrieval only supplies filtered indexed text and rejects foreign or duplicated model IDs', async () => {
  let input;
  const assets = [asset('a1', { kind: 'image', character: { name: '小林', groupId: 'lin', state: '雨衣' }, sourcePath: '/never/read.png', mediaUrl: '/media/private' }),
    asset('a2', { kind: 'image', character: { groupId: 'other' } }), asset('a3'), asset('a4', { kind: 'image', smartGroup: 'review' })];
  const search = new AssetLibrarySearch({ search: async request => { input = request; return outcome(request.documents, { results: [{ id: 'foreign', score: 99 }, { id: 'a1', score: 2 }, { id: 'a1', score: 1 }] }); } });
  const filters = { searchMode: 'laya', query: '雨衣人物', kind: 'image', smartGroup: 'asset', characterId: 'lin', related: false, sort: 'relevance' };
  const selected = await search.select({ projectId: 'p', revision: 'r1', assets, filters });
  assert.deepEqual(input.documents.map(document => document.id), ['a1']);
  assert.equal(input.scope, 'assets'); assert.equal(input.limit, 1);
  assert.match(input.documents[0].text, /小林\n雨衣/);
  assert.equal(JSON.stringify(input.documents).includes('/never/read.png'), false);
  assert.equal(JSON.stringify(input.documents).includes('/media/private'), false);
  assert.deepEqual(selected.results.map(result => result.id), ['a1']);
  const page = new AssetLibraryPager().page({ projectId: 'p', revision: 'r1', assets, filters, searchResult: selected });
  assert.deepEqual(page.assets.map(item => item.id), ['a1']);
  assert.equal(page.total, 4); assert.equal(page.counts.all, 3); assert.equal(page.categoryCounts['剧本'], 2);
  assert.equal(page.search.source, 'indexed-asset-text');
});

test('all semantic hits paginate without repeated inference; explicit sort and counts remain intact', async () => {
  const assets = Array.from({ length: 261 }, (_, index) => asset(`a${index}`)); let calls = 0;
  const search = new AssetLibrarySearch({ search: async request => { calls++; return outcome(request.documents.slice().reverse()); } });
  const filters = { searchMode: 'laya', query: '资料意图', related: false, sort: 'relevance', limit: 120 };
  const request = { projectId: 'p', revision: 'r1', assets, filters };
  const selected = await search.select(request), pager = new AssetLibraryPager();
  const first = pager.page({ ...request, searchResult: selected });
  const secondSelection = await search.select({ ...request, filters: { ...filters, offset: 120, searchRevision: selected.key } });
  const second = pager.page({ ...request, filters: { ...filters, offset: 120 }, searchResult: secondSelection });
  assert.equal(calls, 1); assert.equal(first.filteredTotal, 261); assert.equal(first.assets[0].id, 'a260');
  assert.equal(second.assets[0].id, 'a140'); assert.equal(second.page.nextOffset, 240);
  assert.equal(first.assets.some(item => second.assets.some(other => item.id === other.id)), false);
  const oldestSelection = await search.select({ ...request, filters: { ...filters, sort: 'oldest' } });
  assert.equal(calls, 1, 'display sorting reuses the same model result');
  assert.equal(pager.page({ ...request, filters: { ...filters, sort: 'oldest' }, searchResult: oldestSelection }).assets[0].id, 'a0');
});

test('concurrent pages share inference while late revisions and cross-project snapshots are isolated', async () => {
  const older = deferred(); let calls = 0;
  const search = new AssetLibrarySearch({ search: async request => { calls++; if (request.revision === 'r1') return older.promise; return outcome(request.documents); } });
  const request = { projectId: 'p', assets: [asset('a1')], revision: 'r1', filters: { searchMode: 'laya', query: 'story' } };
  const first = search.select(request), otherPage = search.select({ ...request, filters: { ...request.filters, offset: 1 } });
  assert.equal(calls, 1);
  const current = await search.select({ ...request, revision: 'r2', assets: [asset('a2')] });
  older.resolve(outcome([{ id: 'a1', text: 'old' }]));
  await assert.rejects(first, { statusCode: 409 }); await assert.rejects(otherPage, { statusCode: 409 });
  assert.deepEqual(current.results.map(row => row.id), ['a2']);
  const other = await search.select({ ...request, projectId: 'other', revision: 'r2', assets: [asset('b1')] });
  assert.deepEqual(other.results.map(row => row.id), ['b1']);
  await assert.rejects(search.select({ ...request, projectId: 'other', revision: 'r2', assets: [asset('b1')], filters: { ...request.filters, searchRevision: current.key } }), { statusCode: 409 });
});

test('model failure falls back to indexed keywords, preserves its paging snapshot and later recovers', async () => {
  let clock = 0, calls = 0;
  const search = new AssetLibrarySearch({ now: () => clock, fallbackCacheMs: 10, search: async request => { if (++calls === 1) throw new Error('model unavailable'); return outcome(request.documents); } });
  const request = { projectId: 'p', revision: 'r1', assets: [asset('a1')], filters: { searchMode: 'laya', query: 'story' } };
  const first = await search.select(request);
  assert.equal(first.info.engine, 'keyword'); assert.equal(first.info.fallback, true); assert.deepEqual(first.results.map(row => row.id), ['a1']);
  clock = 20;
  assert.equal((await search.select({ ...request, filters: { ...request.filters, offset: 1, searchRevision: first.key } })).key, first.key);
  assert.equal(calls, 1);
  const recovered = await search.select(request); assert.equal(calls, 2); assert.equal(recovered.info.engine, 'laya');
});

test('an evicted paging snapshot fails before new inference rather than reshuffling an old page', async () => {
  let calls = 0;
  const search = new AssetLibrarySearch({ maxEntries: 1, search: async request => { calls++; return outcome(request.documents); } });
  const request = { projectId: 'p', revision: 'r1', assets: [asset('a1')], filters: { searchMode: 'laya', query: 'story' } };
  const first = await search.select(request);
  await search.select({ ...request, projectId: 'other' });
  await assert.rejects(search.select({ ...request, filters: { ...request.filters, offset: 1, searchRevision: first.key } }), { statusCode: 409 });
  assert.equal(calls, 2);
  await assert.rejects(search.select({ ...request, filters: { searchMode: 'laya', query: 'x'.repeat(201) } }), { statusCode: 400 });
  assert.equal(await search.select({ ...request, filters: { searchMode: 'keyword', query: 'story' } }), null);
});

test('document text uses existing previews and prompt metadata without source paths or arbitrary objects', () => {
  const document = assetSearchDocument(asset('a1', { preview: '已索引片段', characterMeta: { name: '名字' },
    promptAssociation: { generator: 'fixture-generator', characterName: '小周', references: ['/secret/reference.png'] },
    tags: ['可搜标签', { secret: 'not serialized' }] }));
  assert.match(document.text, /已索引片段/); assert.match(document.text, /小周/); assert.match(document.text, /fixture-generator/);
  assert.equal(document.text.includes('/secret'), false); assert.equal(document.text.includes('not serialized'), false);
});

test('hit summaries map to their authorized IDs, clean controls and disappear when the query is cleared', async () => {
  const assets = [asset('a1'), asset('a2'), asset('a3')];
  const search = new AssetLibrarySearch({ search: async request => outcome(request.documents, { results: [
    { id: 'foreign-project-id', score: 99, snippet: 'FOREIGN SUMMARY' },
    { id: 'a2', score: 2, snippet: '  second\u0000\n\t asset\u202e ' },
    { id: 'a1', score: 1, snippet: '<img src=x onerror=alert(1)> ' + '资料'.repeat(200) },
  ] }) });
  const filters = { searchMode: 'laya', query: 'story', sort: 'relevance', related: false, limit: 1 };
  const request = { projectId: 'p', revision: 'r1', assets, filters };
  const selected = await search.select(request), pager = new AssetLibraryPager();
  const first = pager.page({ ...request, searchResult: selected });
  assert.equal(first.assets[0].id, 'a2'); assert.equal(first.assets[0].searchSnippet, 'second asset');
  const next = pager.page({ ...request, searchResult: selected, filters: { ...filters, offset: 1 } });
  assert.equal(next.assets[0].id, 'a1'); assert.ok(next.assets[0].searchSnippet.startsWith('<img'));
  assert.equal(Array.from(next.assets[0].searchSnippet).length, 300);
  assert.equal(JSON.stringify(first).includes('FOREIGN SUMMARY'), false);
  assert.equal(Object.hasOwn(assets[0], 'searchSnippet'), false, 'response annotation must not mutate the persistent index');
  const cleared = pager.page({ ...request, searchResult: selected, assets: [{ ...assets[0], searchSnippet: 'stale' }, ...assets.slice(1)],
    filters: { ...filters, query: '', limit: 120 } });
  assert.equal(cleared.assets.length, 3); assert.equal(cleared.search, undefined);
  assert.ok(cleared.assets.every(item => !Object.hasOwn(item, 'searchSnippet')));
  assert.equal(cleanAssetSearchSnippet(' \u0000\t\n '), '');
  assert.equal(Array.from(cleanAssetSearchSnippet('😀'.repeat(301))).length, 300);
});

const source = readFileSync(new URL('../vendor/codex-workspace-enhancer/asset-browser/public/app.js', import.meta.url), 'utf8');

test('actual card markup escapes HTML in summaries and hides the summary with an empty query', () => {
  const state = { query: 'story' };
  const context = vm.createContext({ state, formatBytes: () => '10B', formatDate: () => 'now' });
  vm.runInContext(source.slice(source.indexOf('function escapeHtml('), source.indexOf('function loadingMarkup(')), context);
  vm.runInContext(source.slice(source.indexOf('function assetSearchSnippetMarkup('), source.indexOf('function renderTextCard(')), context);
  const item = asset('a1', { searchSnippet: '\u0000\n <script>alert(1)</script>   <img src=x onerror=alert(1)> ' });
  const markup = context.commonCardMarkup(item, 'TEXT');
  assert.match(markup, /命中资料/); assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(markup.includes('<script>'), false); assert.equal(markup.includes('<img'), false); assert.equal(markup.includes('\u0000'), false);
  state.query = '';
  assert.equal(context.assetSearchSnippetMarkup(item), '');
  assert.equal(context.commonCardMarkup(item, 'TEXT').includes('asset-search-match'), false);
});
function uiHarness() {
  const requests = [], state = { selectedProject: 'p', assetsProjectId: '', assets: [], query: 'story', searchMode: 'laya', sort: 'relevance', related: false,
    projects: [{ id: 'p', name: 'Project' }], settings: {}, visibleLimit: 120 };
  const els = { workspaceTitle: {}, librarySearchStatus: { dataset: {} }, scanState: { classList: { add() {}, remove() {} } } };
  const context = vm.createContext({ state, els, URLSearchParams, document: { scrollingElement: { scrollTop: 0 } }, libraryRequests: createLatestRequestGate(),
    ASSET_PAGE_SIZE: 120, MAX_ASSET_WINDOW: 240, selectedProject: () => state.projects.find(project => project.id === state.selectedProject),
    api: (url, options) => { const pending = deferred(); requests.push({ ...pending, url, signal: options.signal }); return pending.promise; },
    renderSmartGroupTabs() {}, renderCategoryChips() {}, updateKindCounts() {}, renderAssets() {}, setColumns() {},
    setLibraryLoading: phase => { state.libraryLoading = phase; }, showToast() {}, formatDate: () => 'now' });
  vm.runInContext(source.slice(source.indexOf('function libraryQueryKey('), source.indexOf('function createAssetCard(')), context);
  vm.runInContext(source.slice(source.indexOf('async function loadLibrary('), source.indexOf('async function loadBootstrap(')), context);
  return { state, els, requests, load: context.loadLibrary, key: context.libraryQueryKey, status: context.renderLibrarySearchStatus };
}

test('actual UI keeps late Laya responses out of ordinary search and accurately labels text-only fallback', async () => {
  const h = uiHarness(), old = h.load();
  assert.equal(new URL(h.requests[0].url, 'http://fixture').searchParams.get('searchMode'), 'laya');
  h.state.searchMode = 'keyword'; const current = h.load();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[1].resolve({ assets: [asset('new')], index: { revision: 'r1' }, page: { hasMore: false } }); await current;
  h.requests[0].resolve({ assets: [asset('old')], search: { engine: 'laya' }, page: { hasMore: false } }); await old;
  assert.equal(h.state.assets[0].id, 'new'); assert.match(h.els.librarySearchStatus.textContent, /普通搜索/);
  h.state.searchMeta = { engine: 'keyword', fallback: true, message: 'Laya 暂不可用，已使用普通搜索。' }; h.status();
  assert.match(h.els.librarySearchStatus.textContent, /Laya 暂不可用/); assert.match(h.els.librarySearchStatus.textContent, /资料文本/);
});

test('actual loader propagates both index and search revisions between pages', async () => {
  const h = uiHarness();
  h.state.assets = Array.from({ length: 240 }, (_, index) => asset(`a${index}`));
  h.state.assetsProjectId = 'p'; h.state.assetsQueryKey = h.key();
  const pending = h.load();
  h.requests[0].resolve({ assets: Array.from({ length: 120 }, (_, index) => asset(`a${index}`)), index: { revision: 'r1' },
    search: { revision: 'search-r1', engine: 'laya', coverage: { indexed: 180, candidates: 24 } }, page: { hasMore: true } });
  await new Promise(resolve => setImmediate(resolve));
  const page = new URL(h.requests[1].url, 'http://fixture');
  assert.equal(page.searchParams.get('revision'), 'r1'); assert.equal(page.searchParams.get('searchRevision'), 'search-r1');
  h.requests[1].resolve({ assets: [asset('a121')], index: { revision: 'r1' }, search: { revision: 'search-r1', engine: 'laya', coverage: { indexed: 180, candidates: 24 } }, page: { hasMore: false } });
  await pending; assert.equal(h.state.assets.length, 121);
  assert.equal(h.els.librarySearchStatus.textContent, 'Laya · 检索名称、标签和已有资料文本');
  assert.equal(h.state.searchMeta.coverage.candidates, 24, 'coverage remains available as API evidence');
});
