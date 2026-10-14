import { createHash } from "node:crypto";
import { LocalLayaRuntime, cleanSearchText, searchTerms } from "./laya-search.mjs";

const aliases = [
  ["声音", "语音", "音频", "配音", "audio", "voice", "speech"],
  ["转写", "转录", "听写", "声音转成文字", "transcription", "transcribe", "subtitle", "字幕"],
  ["剧本", "故事", "编剧", "screenplay", "script", "story"],
  ["分镜", "镜头", "storyboard", "shot"],
  ["剪辑", "裁剪", "时间线", "editing", "edit", "cut", "timeline"],
  ["图片", "图像", "照片", "image", "photo", "visual"],
  ["音乐", "配乐", "music", "bgm", "soundtrack"],
  ["人物", "角色", "character", "portrait"],
  ["场景", "环境", "scene", "environment", "location"],
  ["表格", "电子表格", "spreadsheet", "excel", "sheet"],
  ["演示", "幻灯片", "ppt", "slides", "presentation"],
  ["知识卡片", "信息图", "infographic", "knowledge", "card"],
  ["钉钉", "dingtalk"], ["飞书", "feishu", "lark"],
];
const normalize = text => String(text || "").normalize("NFKC").toLocaleLowerCase("zh-CN");

function queryTerms(query) {
  const terms = new Set(searchTerms(query, true));
  const value = normalize(query);
  for (const group of aliases) if (group.some(term => value.includes(term))) {
    for (const term of group) for (const token of searchTerms(term)) terms.add(token);
  }
  return [...terms];
}

function documentsIndex(documents, scope, revision, cache) {
  const hash = createHash("sha256").update(JSON.stringify([scope, revision]));
  for (const input of documents) hash.update(JSON.stringify([input?.id, input?.title, input?.name, String(input?.text || "").slice(0, 65536)]));
  const key = hash.digest("hex");
  if (cache.has(key)) return cache.get(key);
  const rows = [], records = new Map(), postings = new Map();
  for (const input of documents) {
    if (!input || typeof input.id !== "string" || !input.id || input.id.length > 4096 || records.has(input.id)) continue;
    const title = cleanSearchText(String(input.title || input.name || "").slice(0, 300));
    const text = String(input.text || "").slice(0, 65536);
    const chunks = [];
    for (let start = 0; start < text.length; start += 420) {
      const snippet = cleanSearchText(text.slice(start, start + 600));
      if (snippet) chunks.push(snippet);
    }
    if (!chunks.length && title) chunks.push(title);
    if (!chunks.length) continue;
    const record = { id: input.id, title, chunks };
    records.set(record.id, record);
    for (const snippet of chunks) {
      const row = { record, snippet };
      const id = rows.push(row) - 1;
      for (const term of searchTerms(`${title} ${snippet}`)) {
        let posting = postings.get(term);
        if (!posting) postings.set(term, posting = []);
        posting.push(id);
      }
    }
  }
  const index = { key, rows, records, postings, total: documents.length };
  cache.set(key, index);
  while (cache.size > 3) cache.delete(cache.keys().next().value);
  return index;
}

function recall(index, query) {
  const terms = queryTerms(query), scores = new Map();
  const primary = new Set(searchTerms(query));
  for (const term of terms) {
    const posting = index.postings.get(term) || [];
    const weight = Math.log(1 + index.rows.length / (1 + posting.length)) * (primary.has(term) ? 1 : 0.5);
    for (const id of posting) scores.set(id, (scores.get(id) || 0) + weight);
  }
  const hits = new Map();
  for (const [rowId, score] of scores) {
    const { record, snippet } = index.rows[rowId];
    const title = normalize(record.title);
    const weighted = score + terms.reduce((sum, term) => sum + (title.includes(term) ? primary.has(term) ? 2 : 0.7 : 0), 0);
    const previous = hits.get(record.id);
    if (!previous || weighted > previous.score) hits.set(record.id, { id: record.id, title: record.title, snippet, score: weighted });
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function createLayaDocumentSearch({ runtime = new LocalLayaRuntime(), maxCandidates = 24, cacheEntries = 12 } = {}) {
  const cache = new Map(), inFlight = new Map(), corpora = new Map();
  const candidateLimit = Math.min(24, Math.max(1, maxCandidates));
  async function search({ query, documents = [], scope = "documents", revision = "", limit = 80 } = {}) {
    if (typeof query !== "string" || query.length > 200 || !Array.isArray(documents)) {
      throw Object.assign(new Error("检索参数无效，请缩短描述后重试。"), { code: "LAYA_SEARCH_ERROR" });
    }
    query = query.trim();
    const index = documentsIndex(documents, scope, revision, corpora);
    const count = Math.min(index.records.size, Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 80));
    const key = `${index.key}:${query}:${count}`;
    if (cache.has(key)) return structuredClone(cache.get(key));
    if (inFlight.has(key)) return structuredClone(await inFlight.get(key));
    const pending = (async () => {
      const hits = query ? recall(index, query) : [];
      // A small catalog can be evaluated in full even across languages. A
      // larger zero-recall catalog is never mislabeled as fully model searched.
      const modelOnly = query && !hits.length && index.records.size <= candidateLimit;
      const candidates = modelOnly ? [...index.records.values()].map(row => ({ id: row.id, title: row.title, snippet: row.chunks[0], score: 0 })) : hits.slice(0, candidateLimit);
      const coverage = { total: index.total, indexed: index.records.size, candidates: candidates.length };
      const base = { query, engine: "keyword", fallback: false, message: "", elapsedMs: 0, coverage };
      if (!query) return { ...base, results: [] };
      if (!candidates.length) return { ...base, results: [], message: "未找到有文本依据的匹配资源。" };
      const topScore = hits[0]?.score || 1;
      try {
        const ranked = await runtime.request("rank-documents", candidates.map(row => ({ id: row.id, text: `${row.title}\n${row.snippet}` })), cleanSearchText(query));
        const candidateIds = new Set(candidates.map(row => row.id));
        const decisions = new Map();
        for (const row of ranked.items || []) if (candidateIds.has(row.id) && ["match", "related", "unrelated"].includes(row.choice)) decisions.set(row.id, row.choice);
        if (!decisions.size) throw new Error("No validated model decisions");
        const results = (modelOnly ? candidates : hits).filter(row => !modelOnly || ["match", "related"].includes(decisions.get(row.id))).map(row => {
          const decision = decisions.get(row.id) || "keyword";
          return { ...row, decision, score: row.score / topScore + (decision === "match" ? 1.25 : decision === "related" ? 0.15 : decision === "unrelated" ? -0.3 : 0) };
        }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, count);
        return { ...base, engine: "laya", results, elapsedMs: Number(ranked.elapsedMs) || 0,
          message: "Laya 已按检索意图排序，匹配依据来自已有资料。" };
      } catch {
        return { ...base, fallback: true, results: hits.slice(0, count).map(row => ({ ...row, decision: "keyword" })), message: "Laya 暂不可用，已使用普通搜索。" };
      }
    })();
    inFlight.set(key, pending);
    try {
      const result = await pending;
      // Failed inference is not cached: the next query can recover a restarted
      // local worker rather than keeping a successful keyword fallback forever.
      if (!result.fallback) {
        cache.set(key, result);
        while (cache.size > cacheEntries) cache.delete(cache.keys().next().value);
      }
      return structuredClone(result);
    } finally { inFlight.delete(key); }
  }
  return { search, runtime, clear: () => { cache.clear(); corpora.clear(); } };
}
