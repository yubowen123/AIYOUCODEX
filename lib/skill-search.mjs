import { open, stat } from "node:fs/promises";
import { createLayaDocumentSearch } from "./laya-document-search.mjs";

export function createSkillSearchController({ readCatalog, runtime, search = createLayaDocumentSearch({ runtime }) } = {}) {
  const content = new Map();
  async function document(entry) {
    let body = "", revision = "metadata";
    let handle;
    try {
      const info = await stat(entry.skillFile);
      if (info.isFile()) {
        revision = `${info.size}:${info.mtimeMs}`;
        const cached = content.get(entry.skillFile);
        if (cached?.revision === revision) body = cached.body;
        else {
          handle = await open(entry.skillFile, "r");
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("Skill changed");
          const buffer = Buffer.alloc(Math.min(opened.size, 65536));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          body = buffer.subarray(0, bytesRead).toString("utf8");
          content.set(entry.skillFile, { revision, body });
        }
      }
    } catch {} finally { await handle?.close(); }
    return { id: entry.id, title: entry.title || entry.name, text: `${entry.name}\n${entry.description}\n${body}`, revision };
  }
  async function request(payload) {
    if (typeof payload?.query !== "string" || payload.query.length > 200
      || (payload.skillIds !== undefined && (!Array.isArray(payload.skillIds) || payload.skillIds.length > 5000 || payload.skillIds.some(id => typeof id !== "string" || id.length > 100)))) {
      throw Object.assign(new Error("Skills 检索参数无效。"), { code: "LAYA_SEARCH_ERROR" });
    }
    const catalog = await readCatalog();
    const allowed = payload.skillIds ? new Set(payload.skillIds) : null;
    const entries = catalog.filter(entry => !allowed || allowed.has(entry.id));
    const files = new Set(catalog.map(entry => entry.skillFile));
    for (const key of content.keys()) if (!files.has(key)) content.delete(key);
    const documents = [];
    // Bound simultaneous disk reads while retaining all admitted Skills.
    for (let start = 0; start < entries.length; start += 16) documents.push(...await Promise.all(entries.slice(start, start + 16).map(document)));
    return search.search({ query: payload.query, documents, scope: "skills", limit: entries.length });
  }
  return { request };
}
