import { createHash } from 'node:crypto';
import { cleanAssetSearchSnippet, normalizeLibraryPage } from './asset-library-pagination.js';

const text = value => typeof value === 'string' ? value.slice(0, 4000) : '';
const tags = value => Array.isArray(value) ? value.slice(0, 100).map(text).filter(Boolean) : [];
const stale = () => Object.assign(new Error('检索资料已更新，请从第一页重新搜索，避免混用不同结果。'), { statusCode: 409 });

// Only existing index fields enter the model. Never resolve a path or inspect
// image/audio/video contents as part of this text retrieval adapter.
export function assetSearchDocument(asset) {
  const character = asset.character || asset.characterMeta || {};
  const association = asset.promptAssociation || {};
  return { id: String(asset.id), title: text(asset.title || asset.name), text: [
    text(asset.name), text(asset.title), text(asset.kind), text(asset.category),
    ...tags(asset.tags), ...tags(asset.autoTags), text(asset.preview),
    text(character.name), text(character.state), text(character.style),
    text(asset.characterEvidence?.prompt), text(association.promptPreview), text(association.prompt),
    text(association.characterName), text(association.generator), text(association.model),
  ].filter(Boolean).join('\n').slice(0, 8000) };
}

function keywordResult(query, documents, message) {
  return { engine: 'keyword', fallback: true, message, elapsedMs: 0,
    results: documents.filter(document => `${document.title}\n${document.text}`.toLocaleLowerCase('zh-CN').includes(query))
      .map(document => ({ id: document.id, score: 0, snippet: document.text.slice(0, 300) })),
    coverage: { total: documents.length, indexed: documents.length, candidates: 0 } };
}

export class AssetLibrarySearch {
  constructor({ search, maxEntries = 8, fallbackCacheMs = 5000, now = Date.now } = {}) {
    if (typeof search !== 'function') throw new TypeError('Asset document search is required');
    this.search = search; this.maxEntries = maxEntries; this.fallbackCacheMs = fallbackCacheMs; this.now = now;
    this.cache = new Map(); this.revisions = new Map();
  }

  async select({ projectId, assets, revision, filters = {} }) {
    const options = normalizeLibraryPage(filters);
    if (options.searchMode !== 'laya' || !options.query) return null;
    if (options.query.length > 200) throw Object.assign(new Error('Laya 搜索词请控制在 200 个字符内。'), { statusCode: 400 });
    this.revisions.set(projectId, revision);
    for (const [key, entry] of this.cache) if (entry.projectId === projectId && entry.revision !== revision) this.cache.delete(key);
    // Page size, offsets and display sorting do not trigger more inference.
    const key = JSON.stringify([projectId, revision, options.query, options.kind, options.category, options.smartGroup, options.characterId]);
    let entry = this.cache.get(key);
    // Keep a failed inference snapshot stable while paging it, but a new
    // first-page search can recover the local worker after a short cooldown.
    if (entry?.expiresAt <= this.now() && options.offset === 0 && !filters.searchRevision) { this.cache.delete(key); entry = null; }
    if (!entry) {
      if (filters.searchRevision) throw stale();
      const documents = assets.filter(asset => (!options.kind || asset.kind === options.kind)
        && (!options.category || asset.category === options.category)
        && (!options.smartGroup || asset.smartGroup === options.smartGroup)
        && (!options.characterId || asset.character?.groupId === options.characterId)).map(assetSearchDocument);
      entry = { projectId, revision, promise: (async () => {
        let outcome;
        try {
          outcome = documents.length ? await this.search({ query: options.query, documents, scope: 'assets', limit: documents.length, revision })
            : { engine: 'keyword', fallback: false, results: [], coverage: { total: 0, indexed: 0, candidates: 0 }, message: '当前筛选范围没有可检索资料。' };
          if (!Array.isArray(outcome?.results) || !['laya', 'keyword'].includes(outcome?.engine)) throw new Error('Invalid search result');
        } catch { outcome = keywordResult(options.query, documents, 'Laya 暂不可用，已使用普通资料文本搜索。'); }
        const permitted = new Set(documents.map(document => document.id)), seen = new Set(), results = [];
        for (const result of outcome.results) {
          const id = String(result?.id || '');
          if (!permitted.has(id) || seen.has(id)) continue;
          seen.add(id); results.push({ id, score: Number.isFinite(result.score) ? result.score : 0,
            snippet: cleanAssetSearchSnippet(text(result.snippet)), decision: text(result.decision).slice(0, 40) });
        }
        const snapshot = createHash('sha256').update(JSON.stringify([key, outcome.engine, results])).digest('hex');
        const bounded = value => Math.min(documents.length, Math.max(0, Math.floor(Number(value)) || 0));
        return { results, key: snapshot, info: { mode: 'laya', engine: outcome.engine, fallback: outcome.fallback === true,
          message: text(outcome.message).slice(0, 500), query: options.query, revision: snapshot, source: 'indexed-asset-text',
          elapsedMs: Math.max(0, Number(outcome.elapsedMs) || 0),
          coverage: { total: documents.length, indexed: bounded(outcome.coverage?.indexed), candidates: bounded(outcome.coverage?.candidates) } } };
      })() };
      this.cache.set(key, entry);
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    } else { this.cache.delete(key); this.cache.set(key, entry); }
    const selected = await entry.promise;
    entry.expiresAt ??= selected.info.fallback ? this.now() + this.fallbackCacheMs : Infinity;
    if (this.revisions.get(projectId) !== revision || filters.searchRevision && filters.searchRevision !== selected.key) throw stale();
    return selected;
  }
}
