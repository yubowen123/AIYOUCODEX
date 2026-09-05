const kinds = ["text", "image", "audio", "video"];
const groups = ["asset", "review", "noise"];
const nameCollator = new Intl.Collator("zh-CN", { numeric: true });

export function normalizeLibraryPage(filters = {}) {
  const requestedOffset = Math.floor(Number(filters.offset));
  return {
    limit: Math.min(240, Math.max(1, Math.floor(Number(filters.limit)) || 120)),
    offset: Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    kind: kinds.includes(filters.kind) ? filters.kind : "",
    smartGroup: groups.includes(filters.smartGroup) ? filters.smartGroup : "",
    category: String(filters.category || ""),
    query: String(filters.query || "").trim().toLocaleLowerCase("zh-CN"),
    sort: ["oldest", "name", "size", "largest"].includes(filters.sort) ? filters.sort : "newest",
  };
}

function compareAssets(sort) {
  return (a, b) => {
    let value = 0;
    if (sort === "name") value = nameCollator.compare(a.name || "", b.name || "");
    else if (sort === "oldest") value = (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0);
    else if (sort === "size" || sort === "largest") value = (Number(b.size) || 0) - (Number(a.size) || 0);
    else value = (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0);
    return value || nameCollator.compare(a.name || "", b.name || "") || String(a.id).localeCompare(String(b.id));
  };
}

export class AssetLibraryPager {
  constructor({ maxEntries = 4 } = {}) { this.cache = new Map(); this.maxEntries = maxEntries; }

  page({ projectId, assets, revision, filters = {}, projectAsset = (asset) => asset }) {
    const options = normalizeLibraryPage(filters);
    const { offset, limit, ...selection } = options;
    const key = JSON.stringify([projectId, revision, selection]);
    for (const [oldKey, old] of this.cache) {
      if (old.projectId === projectId && old.revision !== revision) this.cache.delete(oldKey);
    }
    let selected = this.cache.get(key);
    if (!selected) {
      const counts = { all: 0, text: 0, image: 0, audio: 0, video: 0 };
      const smartCounts = { asset: 0, review: 0, noise: 0 };
      const categoryCounts = Object.create(null);
      const matching = [];
      for (const asset of assets) {
        if (Object.hasOwn(smartCounts, asset.smartGroup)) smartCounts[asset.smartGroup] += 1;
        if (options.smartGroup && asset.smartGroup !== options.smartGroup) continue;
        counts.all += 1;
        if (Object.hasOwn(counts, asset.kind) && asset.kind !== "all") counts[asset.kind] += 1;
        if (options.kind && asset.kind !== options.kind) continue;
        if (asset.category) categoryCounts[asset.category] = (categoryCounts[asset.category] || 0) + 1;
        if (options.category && asset.category !== options.category) continue;
        if (options.query && ![asset.name, asset.title, asset.preview, asset.category, ...(asset.tags || []), ...(asset.autoTags || [])].join(" ").toLocaleLowerCase("zh-CN").includes(options.query)) continue;
        matching.push(asset);
      }
      matching.sort(compareAssets(options.sort));
      selected = { projectId, revision, total: assets.length, matching, counts, smartCounts, categoryCounts };
      this.cache.set(key, selected);
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    } else {
      this.cache.delete(key);
      this.cache.set(key, selected);
    }
    const filteredTotal = selected.matching.length;
    const pageAssets = selected.matching.slice(offset, offset + limit).map(projectAsset);
    return {
      assets: pageAssets,
      total: selected.total,
      filteredTotal,
      counts: { ...selected.counts },
      smartCounts: { ...selected.smartCounts },
      categoryCounts: { ...selected.categoryCounts },
      page: { offset, limit, hasMore: offset + pageAssets.length < filteredTotal, nextOffset: offset + pageAssets.length < filteredTotal ? offset + pageAssets.length : null },
    };
  }
}
