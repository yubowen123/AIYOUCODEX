import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseConversationMessageEntry } from "./preview-data.mjs";

export const LAYA_SEARCH_BINDING = "__AIYOUCODEX_LAYA_SEARCH_REQUEST__";
const unavailable = () => Object.assign(new Error("本地 Laya 尚不可用，请检查部署。"), { code: "LAYA_SEARCH_ERROR" });
const norm = value => String(value || "").normalize("NFKC").toLowerCase();
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const stops = new Set(["的", "了", "是", "在", "我", "你", "我们", "这个", "那个", "项目", "一个", "查找", "搜索", "之前", "可以", "进行", "需要", "希望"]);
const aliases = [ ["对白", "台词", "对话配音"], ["流程图", "画布", "节点", "可视化"], ["视频", "短剧", "成片"], ["书稿", "批注", "修订", "文稿"], ["用量", "token", "额度"], ["检索", "搜索", "查找"] ];
export function searchTerms(text, expand = false) {
  let value = norm(text);
  if (expand) for (const group of aliases) if (group.some(word => value.includes(word))) value += " " + group.join(" ");
  const words = [...segmenter.segment(value)].filter(x => x.isWordLike).map(x => x.segment)
    .filter(x => !stops.has(x) && !(x.length === 1 && /\p{Script=Han}/u.test(x) && value.trim().length > 1));
  // Chinese bigrams cover unknown tool names and phrases without requiring a cloud tokenizer.
  for (const run of value.match(/[\p{Script=Han}]{2,}/gu) || []) for (let i = 0; i < run.length - 1; i++) {
    const pair = run.slice(i, i + 2); if (!stops.has(pair)) words.push(pair);
  }
  return [...new Set(words)];
}
export function cleanSearchText(text) {
  return String(text || "").replace(/```[\s\S]*?```/g, " ")
    .replace(/<(?:in-app-browser-context|aiyou_reference_data|environment_context)[\s\S]*?<\/(?:in-app-browser-context|aiyou_reference_data|environment_context)>/gi, " ")
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+)/gi, "[已隐藏]")
    .replace(/((?:\b(?:api[_ -]?key|token|password|secret|authorization)\b|密码|密钥|令牌)\s*["']?\s*[:=：]\s*)(?:["'][^"'\n]+["']|[^\s,;]+)/gi, "$1[已隐藏]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [已隐藏]")
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "[已隐藏]")
    .replace(/\s+/g, " ").trim();
}
async function atomicJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(data), { mode: 0o600 }); await rename(tmp, file);
}

export class LocalLayaRuntime {
  constructor({ configPath = path.join(os.homedir(), ".codex", "aiyoucodex", "laya-search.json"), timeoutMs = 12_000 } = {}) {
    this.configPath = configPath; this.timeoutMs = timeoutMs; this.pending = new Map(); this.serial = 0; this.ready = false;
  }
  async start() {
    if (this.ready && this.child?.exitCode == null && !this.child?.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => { this.starting = null; }); return this.starting;
  }
  async launch() {
    let config; try { config = JSON.parse(await readFile(this.configPath, "utf8")); } catch { throw unavailable(); }
    if (![config.pythonPath, config.modelPath].every(x => typeof x === "string" && path.isAbsolute(x))) throw unavailable();
    await Promise.all([stat(config.pythonPath), stat(path.join(config.modelPath, "model.safetensors"))]).catch(() => { throw unavailable(); });
    this.stop();
    const worker = fileURLToPath(new URL("../scripts/laya-search-worker.py", import.meta.url));
    const child = spawn(config.pythonPath, ["-u", worker, config.modelPath], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    this.child = child;
    // Drain stderr without retaining private text or checkpoint paths.
    child.stderr.on("data", () => {});
    const lines = createInterface({ input: child.stdout });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(); reject(unavailable()); }, 45_000); timer.unref?.();
      const fail = () => { clearTimeout(timer); if (this.child === child) this.ready = false; reject(unavailable()); };
      child.once("error", fail); child.once("exit", fail);
      lines.on("line", line => {
        let row; try { row = JSON.parse(line); } catch { return; }
        if (row.ready && ["Chinese", "English"].includes(row.probe)) { clearTimeout(timer); this.ready = true; resolve(); return; }
        const pending = this.pending.get(row.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(row.id);
        row.ok ? pending.resolve(row) : pending.reject(unavailable());
      });
    });
    child.on("exit", () => { if (this.child !== child) return; this.ready = false; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); } this.pending.clear(); });
  }
  async request(action, items, query = "") {
    await this.start();
    if (!this.ready || this.pending.size >= 4) throw unavailable();
    const id = String(++this.serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.stop(); reject(unavailable()); }, this.timeoutMs); timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, items, query }) + "\n", error => { if (error) this.stop(); });
    });
  }
  stop() {
    this.ready = false; this.child?.kill(); this.child = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); } this.pending.clear();
  }
}

export class LayaHistoryIndex {
  constructor({ repository, cachePath = path.join(os.homedir(), ".codex", "aiyoucodex", "laya-search-index.json") }) {
    this.repository = repository; this.cachePath = cachePath; this.documents = []; this.profiles = new Map(); this.ready = false; this.progress = { scanned: 0, total: 0 }; this.checkedAt = 0;
  }
  async refresh(force = false) {
    if (this.refreshing) return this.refreshing;
    if (!force && Date.now() - this.checkedAt < 60_000) return;
    this.refreshing = this.build().finally(() => { this.refreshing = null; this.checkedAt = Date.now(); }); return this.refreshing;
  }
  async build() {
    const catalog = (await this.repository.readRecentCatalog()).filter(x => x.projectId && x.projectName && !x.remote);
    let saved; if (!this.ready) try { saved = JSON.parse(await readFile(this.cachePath, "utf8")); } catch {}
    if (saved?.version === 2) for (const doc of saved.documents) for (const chunk of doc.chunks) chunk.text = cleanSearchText(chunk.text);
    const old = new Map((this.ready ? this.documents : [2, 3].includes(saved?.version) ? saved.documents : []).map(x => [x.threadId, x]));
    const documents = []; this.progress = { scanned: 0, total: catalog.length };
    for (const entry of catalog) {
      const file = this.repository.filesById.get(entry.threadId); let info;
      try { info = await stat(file); } catch { documents.push({ ...entry, revision: "unavailable", chunks: [] }); this.progress.scanned++; continue; }
      const revision = `${file}:${info.size}:${info.mtimeMs}:${entry.title}:${entry.projectId}`;
      let record = old.get(entry.threadId);
      if (record?.revision !== revision) {
        const chunks = [], seen = new Set(); const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        let lineNumber = 0;
        for await (const line of lines) {
          lineNumber++; let raw; try { raw = JSON.parse(line); } catch { continue; }
          if (raw.payload?.channel === "analysis" || raw.payload?.phase === "commentary" || raw.payload?.channel === "commentary") continue;
          const message = parseConversationMessageEntry(raw); if (!message) continue;
          const text = cleanSearchText(message.text); if (!text) continue;
          for (let start = 0; start < text.length; start += 420) {
            const snippet = text.slice(start, start + 500); if (seen.has(snippet)) continue; seen.add(snippet);
            chunks.push({ text: snippet, line: lineNumber, role: message.role });
          }
        }
        record = { ...entry, revision, chunks };
      } else record = { ...record, ...entry };
      documents.push(record); this.progress.scanned++;
    }
    const unchanged = this.ready && documents.length === this.documents.length && documents.every((doc, i) =>
      doc.threadId === this.documents[i].threadId && doc.revision === this.documents[i].revision && doc.projectName === this.documents[i].projectName);
    this.documents = documents;
    const profiles = new Map();
    if (this.repository.globalStatePath) try {
      const state = JSON.parse(await readFile(this.repository.globalStatePath, "utf8"));
      for (const [id, project] of Object.entries(state["local-projects"] || {})) if (project.name) {
        profiles.set(id, { id, name: project.name, titles: [], examples: [], topic: "" });
      }
    } catch {}
    for (const doc of documents) {
      let profile = profiles.get(doc.projectId);
      if (!profile) { profile = { id: doc.projectId, name: doc.projectName, titles: [], examples: [], topic: "" }; profiles.set(doc.projectId, profile); }
      profile.titles.push(doc.title);
      if (profile.examples.length < 8) profile.examples.push(doc.chunks.find(c => c.role === "user")?.text || doc.title);
    }
    for (const profile of profiles.values()) profile.topic = this.profiles.get(profile.id)?.topic || "";
    this.profiles = profiles; this.ready = true;
    if (unchanged) return;
    // Tokenize once at index time, rather than traversing private logs on each keystroke.
    this.postings = new Map(); this.chunkRows = [];
    for (const doc of documents) for (const chunk of doc.chunks) {
      const row = { doc, chunk }, index = this.chunkRows.push(row) - 1;
      for (const term of searchTerms(`${doc.title} ${chunk.text}`)) {
        let posting = this.postings.get(term); if (!posting) this.postings.set(term, posting = []); posting.push(index);
      }
    }
    await atomicJSON(this.cachePath, { version: 3, documents });
  }
  async saveProfiles() {
    await atomicJSON(this.cachePath.replace(/\.json$/, "-profiles.json"), { version: 1, updatedAt: new Date().toISOString(),
      projects: [...this.profiles.values()].map(p => ({ ...p, classification: "Laya 自动主题标签，供检索参考", historyThreads: this.documents.filter(d => d.projectId === p.id).length })) });
  }
  candidates(query, limit = 16) {
    const terms = searchTerms(query, true), scores = new Map();
    const primary = new Set([...segmenter.segment(norm(query))].filter(x => x.isWordLike && x.segment.length > 1 && !stops.has(x.segment)).map(x => x.segment));
    for (const term of terms) {
      const posting = this.postings?.get(term) || [];
      const weight = Math.log(1 + (this.chunkRows?.length || 1) / (1 + posting.length)) * (term.length > 2 ? 1.6 : 1) * (primary.has(term) ? 1 : 0.35);
      for (const id of posting) scores.set(id, (scores.get(id) || 0) + weight);
    }
    const projects = new Map();
    for (const [id, rawScore] of scores) {
      const { doc, chunk } = this.chunkRows[id]; const previous = projects.get(doc.projectId);
      const titleMatches = [...primary].filter(term => norm(doc.title).includes(term)).length;
      const score = rawScore * (chunk.role === "user" ? 1.12 : 1) + titleMatches * 2.5;
      const hit = { threadId: doc.threadId, title: doc.title, snippet: chunk.text, line: chunk.line, score };
      if (!previous) projects.set(doc.projectId, { id: doc.projectId, name: doc.projectName, score, hits: [hit] });
      else { previous.score = Math.max(score, previous.score); previous.hits.push(hit); }
    }
    const rows = [...projects.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    for (const row of rows) {
      row.hits.sort((a, b) => b.score - a.score);
      const ids = new Set(); row.hits = row.hits.filter(hit => hit.score >= row.score * 0.65 && !ids.has(hit.threadId) && ids.add(hit.threadId)).slice(0, 3);
      row.text = `${row.name}\n主题：${this.profiles.get(row.id)?.topic || ""}\n` + row.hits.map(hit => `${hit.title}\n${hit.snippet}`).join("\n").slice(0, 800);
    }
    return rows;
  }
}

export function createLayaSearchController({ repository, runtime = new LocalLayaRuntime(), index = new LayaHistoryIndex({ repository }), statePath = path.join(os.homedir(), ".codex", "aiyoucodex", "laya-search-state.json") } = {}) {
  let enabled = false, initialized = false, checking = null, checkedAt = 0, error = "", profiled = "";
  async function save() { await atomicJSON(statePath, { enabled }); }
  async function check(force = false) {
    if (checking) return checking;
    if (!force && Date.now() - checkedAt < 60_000) return;
    checking = (async () => {
      if (!initialized) { try { enabled = JSON.parse(await readFile(statePath, "utf8")).enabled === true; } catch {} initialized = true; }
      try {
        await Promise.all([runtime.start(), index.refresh(force)]);
        error = "";
        const fingerprint = JSON.stringify([[...index.profiles.values()].map(x => [x.id, x.name, x.titles]), index.documents.map(x => x.revision)]);
        if (profiled !== fingerprint && runtime.ready) {
          const rows = [...index.profiles.values()];
          for (let start = 0; start < rows.length; start += 24) {
            const result = await runtime.request("profile", rows.slice(start, start + 24).map(p => ({ id: p.id, text: p.name + "\n" + p.titles.slice(0, 12).join("；") + "\n" + p.examples.join("\n").slice(0, 500) })));
            for (const item of result.items) if (index.profiles.has(item.id)) index.profiles.get(item.id).topic = item.choice;
          }
          profiled = fingerprint;
          await index.saveProfiles?.();
        }
      } catch { error = "本地 Laya 不可用，普通搜索仍可使用"; if (enabled) { enabled = false; await save(); } }
    })().finally(() => { checking = null; checkedAt = Date.now(); }); return checking;
  }
  function view() { const ready = runtime.ready && index.ready && !error;
    return { ready, enabled: enabled && ready, checking: Boolean(checking), indexReady: index.ready,
      projects: index.profiles.size, threads: index.documents.length, progress: index.progress,
      message: error || (ready ? `本地就绪 · ${index.profiles.size} 个项目` : "正在检查本地部署与历史索引"),
      readableThreads: index.documents.filter(doc => doc.chunks.length).length };
  }
  function snapshot() { void check().catch(() => {}); return view(); }
  async function request(payload) {
    if (payload.action === "refresh") { await check(true); return { status: view() }; }
    if (payload.action === "toggle") {
      if (typeof payload.enabled !== "boolean") throw unavailable();
      if (payload.enabled) { await check(true); if (!view().ready) throw unavailable(); }
      enabled = payload.enabled; await save(); return { status: view() };
    }
    if (payload.action !== "search" || typeof payload.query !== "string" || payload.query.length > 200) throw unavailable();
    if (!enabled || !view().ready) return { query: payload.query, results: [], fallback: true, status: view() };
    const candidates = index.candidates(payload.query);
    try {
      const ranked = candidates.length ? await runtime.request("rank", candidates.map(x => ({ id: x.id, text: x.text })), payload.query) : { items: [], elapsedMs: 0 };
      const decisions = new Map(ranked.items.map(x => [x.id, x]));
      // Model decisions adjust ordering. They cannot discard all lexical evidence or invent a source.
      const topScore = candidates[0]?.score || 1;
      const results = candidates.filter(x => x.score >= topScore * 0.45).map(row => {
        const decision = decisions.get(row.id);
        return { projectId: row.id, projectName: row.name, hits: row.hits, decision: decision?.choice || "related",
          score: row.score / topScore + (decision?.choice === "match" ? 0.35 : decision?.choice === "unrelated" ? -0.2 : 0) };
      }).sort((a, b) => b.score - a.score).slice(0, 8);
      return { query: payload.query, results, elapsedMs: ranked.elapsedMs, status: view() };
    } catch { enabled = false; error = "本地 Laya 推理失败，已回到普通搜索"; await save(); return { query: payload.query, results: [], fallback: true, status: view() }; }
  }
  return { snapshot, request, check, stop: () => runtime.stop(), index };
}
