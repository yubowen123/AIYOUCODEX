import assert from "node:assert/strict";
import test from "node:test";
import { AssetLibraryPager, normalizeLibraryPage } from "../vendor/codex-workspace-enhancer/asset-browser/asset-library-pagination.js";

test("40k asset pagination searches the complete library and bounds materialized rows", () => {
  const assets = Array.from({ length: 40000 }, (_, index) => ({
    id: `asset-${index}`, name: `fixture-${index}.png`, kind: index % 10 === 0 ? "video" : "image", category: index % 2 === 0 ? "角色" : "场景",
    smartGroup: index % 4 === 0 ? "review" : "asset", mtimeMs: index, size: index, preview: index === 39999 ? "unique final-row query" : "fixture content",
  }));
  const pager = new AssetLibraryPager();
  let projections = 0;
  const request = { projectId: "large", assets, revision: "r1", projectAsset: (asset) => { projections += 1; return { ...asset }; } };
  const first = pager.page({ ...request, filters: { limit: 120, smartGroup: "asset", kind: "all" } });
  assert.equal(first.assets.length, 120);
  assert.equal(projections, 120, "only page rows are copied to transport objects");
  assert.equal(first.total, 40000);
  assert.equal(first.filteredTotal, 30000);
  assert.deepEqual(first.smartCounts, { asset: 30000, review: 10000, noise: 0 });
  assert.equal(first.counts.all, 30000);
  assert.equal(first.counts.video, 2000);
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.nextOffset, 120);
  const second = pager.page({ ...request, filters: { limit: 120, offset: 120, smartGroup: "asset" } });
  assert.equal(second.assets.some((asset) => first.assets.some((item) => item.id === asset.id)), false);
  const query = pager.page({ ...request, filters: { limit: 120, smartGroup: "asset", kind: "image", query: "unique final-row query", sort: "oldest" } });
  assert.deepEqual(query.assets.map((asset) => asset.id), ["asset-39999"]);
  assert.equal(query.filteredTotal, 1);
  assert.equal(query.counts.all, 30000, "tabs must not shrink to the current query results");
  assert.equal(query.categoryCounts["场景"], 20000, "categories count the entire current group/kind, not just the page/query");
  assert.equal(query.categoryCounts["角色"], 8000);
  assert.equal(query.page.hasMore, false);
  const capped = pager.page({ ...request, filters: { limit: 40000 } });
  assert.equal(capped.assets.length, 240);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < Buffer.byteLength(JSON.stringify(assets)) / 100);
  assert.deepEqual(assets[0].id, "asset-0", "sorting must not mutate the persistent array");
});

test("page selection caches bounded reference views and invalidates prior project revisions", () => {
  const pager = new AssetLibraryPager({ maxEntries: 2 });
  const assets = [{ id: "a", kind: "image", smartGroup: "asset", category: "角色", name: "z", size: 2 }, { id: "b", kind: "video", smartGroup: "review", category: "预告", name: "a", size: 1 }];
  pager.page({ projectId: "p", assets, revision: "r1", filters: { limit: 1 } });
  pager.page({ projectId: "p", assets, revision: "r1", filters: { limit: 1, sort: "name" } });
  assert.equal(pager.cache.size, 2);
  const updated = pager.page({ projectId: "p", assets: assets.slice(0, 1), revision: "r2", filters: { limit: 1 } });
  assert.equal(pager.cache.size, 1);
  assert.equal(updated.total, 1);
  assert.equal(normalizeLibraryPage({ offset: Infinity, limit: 0 }).offset, 0);
  assert.equal(normalizeLibraryPage({ limit: "bad" }).limit, 120);
});
