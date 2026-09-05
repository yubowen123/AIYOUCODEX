import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createAssetCardReconciler, createLatestRequestGate, createRevisionPoller } from "../vendor/codex-workspace-enhancer/asset-browser/public/asset-library-state.js";

const source = readFileSync(new URL("../vendor/codex-workspace-enhancer/asset-browser/public/app.js", import.meta.url), "utf8");
const loadLibrarySource = source.slice(source.indexOf("async function loadLibrary("), source.indexOf("async function loadBootstrap("));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function libraryHarness() {
  const requests = [], toasts = [], renders = [];
  const state = { selectedProject: "A", assetsProjectId: "", assets: [], projects: [{ id: "A", name: "Project A" }, { id: "B", name: "Project B" }], settings: {}, visibleLimit: 120 };
  const busyClasses = new Set();
  const els = { workspaceTitle: {}, scanState: { classList: { add: (value) => busyClasses.add(value), remove: (value) => busyClasses.delete(value) } } };
  const context = vm.createContext({
    state, els, URLSearchParams, document: { scrollingElement: { scrollTop: 0 } }, libraryRequests: createLatestRequestGate(),
    ASSET_PAGE_SIZE: 120, MAX_ASSET_WINDOW: 240,
    libraryQueryKey: () => JSON.stringify([state.selectedProject, state.smartGroup, state.kind, state.category, state.query, state.sort]),
    selectedProject: () => state.projects.find((item) => item.id === state.selectedProject),
    api: (url, options) => { const pending = deferred(); requests.push({ ...pending, url, signal: options.signal }); return pending.promise; },
    renderSmartGroupTabs() {}, renderCategoryChips() {}, updateKindCounts() {}, setColumns() {},
    renderAssets: () => renders.push(state.assets.map((asset) => asset.id)), resetAssetWindow() {}, formatDate: () => "now",
    showToast: (...args) => toasts.push(args),
  });
  vm.runInContext(loadLibrarySource, context);
  return { state, els, requests, toasts, renders, busyClasses, load: context.loadLibrary };
}
const snapshot = (id) => ({ assets: [{ id }], smartCounts: { asset: 1 }, settings: { columns: 4 } });

test("actual library loader commits the newest project even when an aborted request completes last", async () => {
  const h = libraryHarness();
  const a = h.load();
  h.state.selectedProject = "B";
  const b = h.load();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.els.workspaceTitle.textContent, "Project B");
  assert.equal(h.state.assets.length, 0, "old actionable cards must disappear immediately on selection");
  h.requests[1].resolve(snapshot("asset-B"));
  await b;
  h.requests[0].resolve(snapshot("asset-A"));
  await a;
  assert.equal(h.state.assets[0].id, "asset-B");
  assert.equal(h.els.workspaceTitle.textContent, "Project B");
  assert.equal(h.toasts.length, 1);
});

test("stale catch and finally cannot clear the current loading state or show an old error", async () => {
  const h = libraryHarness();
  const a = h.load();
  h.state.selectedProject = "B";
  const b = h.load();
  h.requests[0].reject(new Error("old request failed"));
  await a;
  assert.equal(h.state.busy, true);
  assert.equal(h.busyClasses.has("busy"), true);
  assert.equal(h.toasts.length, 0);
  h.requests[1].resolve(snapshot("asset-B"));
  await b;
  assert.equal(h.state.busy, false);
});

test("same-project event refresh preserves pagination and keeps the last good snapshot on failure", async () => {
  const h = libraryHarness();
  const first = h.load({ quiet: true });
  h.requests[0].resolve(snapshot("asset-A"));
  await first;
  h.state.visibleLimit = 360;
  const second = h.load({ quiet: true });
  h.requests[1].resolve(snapshot("asset-A"));
  await second;
  assert.equal(h.state.visibleLimit, 360);
  const failed = h.load({ quiet: true });
  h.requests[2].reject(new Error("service unavailable"));
  await failed;
  assert.equal(h.state.visibleLimit, 360);
  assert.equal(h.state.assets[0].id, "asset-A");
  assert.equal(h.state.busy, false);
  assert.equal(h.els.scanState.textContent, "索引读取失败");
});

test("clearing project selection invalidates all previous requests", async () => {
  const h = libraryHarness();
  const pending = h.load();
  h.state.selectedProject = "";
  await h.load();
  h.requests[0].resolve(snapshot("asset-A"));
  await pending;
  assert.equal(h.state.assets.length, 0);
  assert.equal(h.els.workspaceTitle.textContent, "选择一个项目");
  assert.equal(h.state.busy, false);
});

function pageSnapshot(offset, count = 120, revision = "r1") {
  return { assets: Array.from({ length: count }, (_, index) => ({ id: `asset-${offset + index}`, kind: "image", smartGroup: "asset" })),
    total: 85000, filteredTotal: 35000, counts: { all: 35000, image: 35000 }, smartCounts: { asset: 35000 }, categoryCounts: { "角色": 25000 },
    settings: {}, index: { revision }, page: { offset, limit: 120, hasMore: offset + count < 35000 } };
}
const settleTurn = () => new Promise((resolve) => setImmediate(resolve));

test("large-library client requests bounded pages and append fetches only the next page", async () => {
  const h = libraryHarness();
  const first = h.load({ quiet: true });
  assert.equal(new URL(h.requests[0].url, "http://test").searchParams.get("limit"), "120");
  h.requests[0].resolve(pageSnapshot(0));
  await first;
  assert.equal(h.state.totalAssets, 85000);
  assert.equal(h.state.filteredTotal, 35000);
  assert.equal(h.state.assets.length, 120);
  const original = h.state.assets[0];
  const more = h.load({ quiet: true, append: true });
  assert.equal(new URL(h.requests[1].url, "http://test").searchParams.get("offset"), "120");
  h.requests[1].resolve(pageSnapshot(120));
  await more;
  assert.equal(h.state.assets.length, 240);
  assert.equal(h.state.assets[0], original);
  assert.equal(h.state.visibleLimit, 240);
  const refresh = h.load({ quiet: true });
  h.requests[2].resolve(pageSnapshot(0));
  await settleTurn();
  assert.equal(new URL(h.requests[3].url, "http://test").searchParams.get("offset"), "120");
  h.requests[3].resolve(pageSnapshot(120));
  await refresh;
  assert.equal(h.state.assets.length, 240, "refresh keeps the displayed window, not all 35,000 assets");
});

test("search, categories and ordering are sent to the service, not applied only to loaded assets", async () => {
  const h = libraryHarness();
  Object.assign(h.state, { query: "outside-first-page", smartGroup: "review", kind: "video", category: "预告", sort: "size" });
  const pending = h.load({ quiet: true, reset: true });
  const query = new URL(h.requests[0].url, "http://test").searchParams;
  for (const key of ["query", "smartGroup", "kind", "category", "sort"]) assert.equal(query.get(key), h.state[key]);
  h.requests[0].resolve({ ...pageSnapshot(35001, 1), filteredTotal: 1, page: { offset: 0, limit: 120, hasMore: false } });
  await pending;
  assert.equal(h.state.assets[0].id, "asset-35001");
});

test("appending after a revision change re-reads a consistent displayed window instead of mixing offsets", async () => {
  const h = libraryHarness();
  const first = h.load({ quiet: true });
  h.requests[0].resolve(pageSnapshot(0));
  await first;
  const more = h.load({ quiet: true, append: true });
  h.requests[1].resolve(pageSnapshot(120, 120, "r2"));
  await settleTurn();
  assert.equal(new URL(h.requests[2].url, "http://test").searchParams.get("offset"), "0");
  h.requests[2].resolve(pageSnapshot(0, 120, "r2"));
  await settleTurn();
  h.requests[3].resolve(pageSnapshot(120, 120, "r2"));
  await more;
  assert.equal(h.state.libraryRevision, "r2");
  assert.equal(h.state.assets.length, 240);
  assert.equal(new Set(h.state.assets.map((item) => item.id)).size, 240);
});

test("next-window navigation releases previous cards and remains bounded", async () => {
  const h = libraryHarness();
  const first = h.load({ quiet: true });
  h.requests[0].resolve(pageSnapshot(0));
  await first;
  const next = h.load({ quiet: true, reset: true, offset: 600 });
  assert.equal(h.state.assets.length, 0);
  assert.equal(new URL(h.requests[1].url, "http://test").searchParams.get("offset"), "600");
  h.requests[1].resolve(pageSnapshot(600));
  await next;
  assert.equal(h.state.assets[0].id, "asset-600");
  assert.equal(h.state.pageStart, 600);
  assert.equal(h.state.assets.length, 120);
});

class Node {
  constructor(id) { this.id = id; this.parentNode = null; this.children = []; this.media = { currentTime: 23, paused: false }; this.scrollTop = 91; this.mutations = 0; }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  insertBefore(node, before) {
    if (node === before) return;
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    assert.notEqual(index, -1);
    this.children.splice(index, 0, node); node.parentNode = this; this.mutations++;
  }
  remove() { if (!this.parentNode) return; const owner = this.parentNode; owner.children.splice(owner.children.indexOf(this), 1); owner.mutations++; this.parentNode = null; }
}

test("keyed reconciliation performs zero DOM operations for unchanged media snapshots", () => {
  const container = new Node("grid");
  let created = 0, updated = 0, disposed = 0;
  const reconcile = createAssetCardReconciler({
    container, createCard: (asset) => { created++; return new Node(asset.id); },
    updateCard: (card) => { updated++; return card; }, disposeCard: () => { disposed++; },
  });
  const assets = [{ id: "video-A", kind: "video" }, { id: "text-B", kind: "text" }];
  reconcile(assets, "project-A");
  const [video, text] = container.children;
  const mutations = container.mutations;
  reconcile(structuredClone(assets), "project-A");
  assert.equal(container.mutations, mutations);
  assert.equal(created, 2);
  assert.equal(updated, 0);
  assert.equal(disposed, 0);
  assert.equal(container.children[0], video);
  assert.equal(video.media.currentTime, 23);
  assert.equal(video.media.paused, false);
  assert.equal(text.scrollTop, 91);
  reconcile([{ id: "new" }, ...assets], "project-A");
  assert.equal(container.children[1], video);
  assert.equal(created, 3);
  reconcile([{ id: "new" }, { ...assets[0], title: "renamed" }], "project-A");
  assert.equal(updated, 1);
  assert.equal(disposed, 1, "only removed text card is disposed");
  assert.equal(container.children[1], video);
});

test("card identity is scoped to project and changed media replaces just that card", () => {
  const container = new Node("grid");
  let disposed = 0;
  const reconcile = createAssetCardReconciler({ container, createCard: (asset) => new Node(asset.id), updateCard: (_, asset) => new Node(asset.id), disposeCard: () => { disposed++; } });
  reconcile([{ id: "A", rev: 1 }, { id: "B", rev: 1 }], "one");
  const [a, b] = container.children;
  reconcile([{ id: "A", rev: 2 }, { id: "B", rev: 1 }], "one");
  assert.notEqual(container.children[0], a);
  assert.equal(container.children[1], b);
  assert.equal(disposed, 1);
  reconcile([{ id: "B", rev: 1 }], "two");
  assert.notEqual(container.children[0], b, "same asset id in another project is a new view");
  assert.equal(disposed, 3);
});

test("request gate cancellation invalidates callbacks even without a successor", () => {
  const gate = createLatestRequestGate();
  const ticket = gate.begin("text");
  assert.equal(ticket.isCurrent(), true);
  gate.cancel();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(ticket.isCurrent(), false);
});

function textHarness() {
  const requests = [], toasts = [];
  const state = { textAsset: null };
  const els = Object.fromEntries(["textViewerTitle", "textViewerFormat", "textViewerPreview", "textViewerEditor", "saveTextButton", "toggleTextEditButton", "textSaveState"].map((id) => [id, { focus() {} }]));
  els.textViewerDialog = { open: false, showModal() { this.open = true; } };
  const context = vm.createContext({
    state, els, textRequests: createLatestRequestGate(), markdownToSafeHtml: (text) => text,
    api: (url, options) => { const pending = deferred(); requests.push({ ...pending, url, options }); return pending.promise; },
    showToast: (...args) => toasts.push(args), loadLibrary: async () => {},
  });
  vm.runInContext(source.slice(source.indexOf("async function openTextAsset("), source.indexOf("function assetById(")), context);
  return { state, els, requests, toasts, open: context.openTextAsset, toggle: context.toggleTextEditor, save: context.saveTextAsset };
}

test("text preview shows the readonly reason and cannot enter an unsupported document editor", async () => {
  const h = textHarness();
  const pending = h.open({ id: "docx", name: "report.docx", extension: "DOCX", editable: true });
  h.requests[0].resolve({ content: "Preview", editable: false, editableReason: "请使用 Word 保留表格、图片和格式", revision: "" });
  await pending;
  assert.equal(h.els.toggleTextEditButton.hidden, true);
  assert.equal(h.els.textViewerFormat.textContent, "DOCX · 只读");
  assert.match(h.els.textSaveState.textContent, /Word/);
  h.toggle();
  await h.save();
  assert.equal(h.els.textViewerEditor.hidden, true);
  assert.equal(h.requests.length, 1);
});

test("text save includes the read revision and advances it for a second safe save", async () => {
  const h = textHarness();
  const read = h.open({ id: "md", name: "note.md", extension: "MD" });
  h.requests[0].resolve({ content: "first", editable: true, revision: "r1" });
  await read;
  h.toggle();
  h.els.textViewerEditor.value = "second";
  const save = h.save();
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { assetId: "md", content: "second", expectedRevision: "r1" });
  h.requests[1].resolve({ saved: true, revision: "r2" });
  await save;
  h.els.textViewerEditor.value = "third";
  const next = h.save();
  assert.equal(JSON.parse(h.requests[2].options.body).expectedRevision, "r2");
  h.requests[2].reject(new Error("文件已被其他程序修改"));
  await next;
  assert.equal(h.els.textViewerEditor.value, "third", "conflicts preserve the user's unsaved edits");
  assert.match(h.els.textSaveState.textContent, /其他程序/);
});

test("outdated text preview and save callbacks cannot replace a newer asset dialog", async () => {
  const h = textHarness();
  const a = h.open({ id: "A", name: "A.md" });
  const b = h.open({ id: "B", name: "B.md" });
  h.requests[1].resolve({ content: "B", editable: true, revision: "b1" });
  await b;
  h.requests[0].reject(new Error("A failed late"));
  await a;
  assert.equal(h.els.textViewerPreview.innerHTML, "B");
  assert.equal(h.els.textViewerPreview.textContent, undefined);
  h.els.textViewerEditor.value = "B edit";
  const save = h.save();
  const c = h.open({ id: "C", name: "C.md" });
  h.requests[3].resolve({ content: "C", editable: false, editableReason: "只读" });
  await c;
  h.requests[2].resolve({ saved: true, revision: "b2" });
  await save;
  assert.equal(h.state.textAsset.id, "C");
  assert.equal(h.els.textSaveState.textContent, "只读");
  assert.equal(h.toasts.length, 0);
});

function pollHarness() {
  const queued = [], errors = [];
  const values = { project: "A", revision: "epoch1:A:1", remote: { revision: "epoch1:A:1", configRevision: "config1", projectExists: true }, visible: true, busy: false, fullReads: 0, configReads: 0, configSuccess: true };
  const poller = createRevisionPoller({
    getProjectId: () => values.project, getRevision: () => values.revision,
    fetchRevision: async () => { if (values.error) throw values.error; return values.remote; },
    isBusy: () => values.busy, isVisible: () => values.visible,
    onLibraryChanged: async () => { values.fullReads++; values.revision = values.remote.revision; },
    onConfigChanged: async () => { values.configReads++; return values.configSuccess; },
    onError: (error) => errors.push(error),
    schedule: (fn, delay) => { const task = { fn, delay }; queued.push(task); return task; },
    cancelSchedule: (task) => { const index = queued.indexOf(task); if (index >= 0) queued.splice(index, 1); },
  });
  poller.start();
  return { values, queued, errors, poller, tick: async () => { const task = queued.shift(); assert.ok(task); await task.fn(); } };
}

test("embedded revision polling skips unchanged libraries and resyncs after service epoch changes", async () => {
  const h = pollHarness();
  await h.tick();
  await h.tick();
  assert.equal(h.values.fullReads, 0);
  assert.equal(h.queued[0].delay, 3000);
  h.values.remote.revision = "epoch2:A:1";
  await h.tick();
  assert.equal(h.values.fullReads, 1);
  await h.tick();
  assert.equal(h.values.fullReads, 1);
  h.values.remote.configRevision = "config2";
  await h.tick();
  assert.equal(h.values.configReads, 1);
  assert.equal(h.values.fullReads, 1);
  h.values.visible = false;
  await h.tick();
  assert.equal(h.queued[0].delay, 15000);
  h.poller.stop();
  assert.equal(h.queued.length, 0);
});

test("revision polling retries failed config refresh and backs off outages without toast spam", async () => {
  const h = pollHarness();
  await h.tick();
  h.values.configSuccess = false;
  h.values.remote.configRevision = "config2";
  await h.tick();
  await h.tick();
  assert.equal(h.values.configReads, 2);
  assert.equal(h.errors.length, 1);
  assert.equal(h.queued[0].delay, 12000);
  h.values.configSuccess = true;
  await h.tick();
  assert.equal(h.values.configReads, 3);
  assert.equal(h.queued[0].delay, 3000);
  h.values.error = new Error("offline");
  for (let i = 0; i < 8; i++) await h.tick();
  assert.equal(h.queued[0].delay, 30000);
  assert.equal(h.errors.length, 2);
  h.poller.stop();
});

test("revision polling does not supersede an in-progress forced scan", async () => {
  const h = pollHarness();
  h.values.busy = true;
  h.values.remote.revision = "epoch1:A:2";
  await h.tick();
  assert.equal(h.values.fullReads, 0);
  h.values.busy = false;
  await h.tick();
  assert.equal(h.values.fullReads, 1);
  h.poller.stop();
});
