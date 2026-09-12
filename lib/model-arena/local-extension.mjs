import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_FAMILIES, FAMILIES, MODELS, PROTOCOLS } from "./catalog.mjs";
import { publicUrl, requestJson } from "./providers.mjs";

const copy = value => structuredClone(value);
const validId = value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("本机模型适配器配置无效，请检查仓库外扩展文件；不会切换生成通道");
const endpoint = value => typeof value === "string" && /^\/(?!\/)[\w/{}:.-]+$/.test(value);
const credentialName = value => typeof value === "string" && /^[A-Z][A-Z0-9_]{2,95}$/.test(value) && !/QINIU|QNAIGC/.test(value);

// Every service owns its catalog. Loading a private adapter never mutates the
// public protocol registry or another user's/testing service instance.
export function mergeArenaExtension(extension = {}) {
  if (!record(extension)) throw invalid();
  const protocols = copy(PROTOCOLS), adapters = {}, familyDefaults = { ...DEFAULT_FAMILIES };
  if (extension.protocols !== undefined && !record(extension.protocols)) throw invalid();
  if (extension.adapters !== undefined && !record(extension.adapters)) throw invalid();
  if (extension.familyDefaults !== undefined && !record(extension.familyDefaults)) throw invalid();
  for (const [id, input] of Object.entries(extension.protocols || {})) {
    if (!validId(id) || Object.hasOwn(PROTOCOLS, id) || !record(input)) throw invalid();
    const hooks = extension.adapters?.[id];
    if (!record(hooks) || typeof hooks.buildPayload !== "function" || typeof hooks.parseTask !== "function") throw invalid();
    if (Object.values(hooks).some(value => typeof value !== "function")) throw invalid();
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100 || /[\x00-\x1f]/.test(input.name)) throw invalid();
    if (!Array.isArray(input.families) || !input.families.length || new Set(input.families).size !== input.families.length || input.families.some(f => !FAMILIES.includes(f))) throw invalid();
    if (!endpoint(input.create) || !endpoint(input.status) || (input.upload !== undefined && !endpoint(input.upload))) throw invalid();
    let baseUrl;
    try { const url = new URL(publicUrl(input.baseUrl)); if (url.search || url.hash || url.pathname !== "/") throw invalid(); baseUrl = url.origin; }
    catch { throw invalid(); }
    const protocol = { name: input.name, families: [...input.families], baseUrl, create: input.create, status: input.status, modelIds: {} };
    if (input.upload !== undefined) protocol.upload = input.upload;
    if (!record(input.modelIds)) throw invalid();
    for (const [modelId, apiId] of Object.entries(input.modelIds)) {
      const model = MODELS.find(m => m.id === modelId);
      if (!model || !protocol.families.includes(model.family) || typeof apiId !== "string" || !/^[\w.:-]{1,160}$/.test(apiId)) throw invalid();
      protocol.modelIds[modelId] = apiId;
    }
    if (input.requiresIdentity !== undefined) { if (typeof input.requiresIdentity !== "boolean") throw invalid(); protocol.requiresIdentity = input.requiresIdentity; }
    if (input.credentialHint !== undefined) { if (typeof input.credentialHint !== "string" || input.credentialHint.length > 200) throw invalid(); protocol.credentialHint = input.credentialHint; }
    if (input.credentialOrigin !== undefined) {
      try { const url = new URL(publicUrl(input.credentialOrigin)); if (url.origin !== baseUrl || url.pathname !== "/" || url.search || url.hash) throw invalid(); protocol.credentialOrigin = url.origin; }
      catch { throw invalid(); }
    }
    if (input.credentialNames !== undefined) {
      if (!Array.isArray(input.credentialNames) || input.credentialNames.length > 12 || input.credentialNames.some(name => !credentialName(name)) || !protocol.credentialOrigin) throw invalid();
      protocol.credentialNames = [...new Set(input.credentialNames)];
    }
    protocols[id] = protocol; adapters[id] = { ...hooks };
  }
  if (Object.keys(extension.adapters || {}).some(id => !Object.hasOwn(adapters, id))) throw invalid();
  for (const [family, id] of Object.entries(extension.familyDefaults || {})) {
    if (!FAMILIES.includes(family) || !Object.hasOwn(protocols, id) || !protocols[id].families.includes(family)) throw invalid();
    familyDefaults[family] = id;
  }
  return { protocols, adapters, familyDefaults };
}

// This executable file is trusted local configuration, never shipped inside
// the application. The HTTP service is the sole automatic-loading entrypoint.
export async function loadArenaExtension(arenaRoot) {
  const file = path.join(path.dirname(path.resolve(arenaRoot)), "model-arena.private.mjs");
  try { if (!(await stat(file)).isFile()) throw invalid(); }
  catch (error) { if (error.code === "ENOENT") return {}; throw invalid(); }
  try {
    const module = await import(pathToFileURL(file).href);
    if (typeof module.default !== "function") throw invalid();
    const extension = await module.default(Object.freeze({ requestJson, publicUrl }));
    mergeArenaExtension(extension); return extension;
  } catch { throw new Error("本机模型适配器加载失败，请检查仓库外扩展文件；已保存配置保留，不会切换生成通道"); }
}
