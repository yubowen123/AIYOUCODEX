// Provider contracts checked 2026-09-12. Resolutions are per model, not a
// silently upscaled common output. The strict intersection applies to inputs.
export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const RESOLUTIONS = ["480p", "720p", "768P", "1080p", "2K"];
export const FAMILIES = ["seedance", "wan", "h3"];
export const MODELS = [
  { id: "wan3", name: "Wan 3.0", family: "wan", apiId: "wan3.0-video", max: 30, min: 2, images: 10, videos: 5, audios: 5, resolutions: ["480p", "720p", "1080p"], ratios: RATIOS.slice(0, 5), referenceSeconds: 15 },
  { id: "seedance20", name: "Seedance 2.0", family: "seedance", apiId: "dreamina-seedance-2-0-260128", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedancefast", name: "Seedance 2.0 Fast", family: "seedance", apiId: "dreamina-seedance-2-0-fast-260128", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedancemini", name: "Seedance 2.0 Mini", family: "seedance", apiId: "dreamina-seedance-2-0-mini-260615", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedance25", name: "Seedance 2.5", family: "seedance", apiId: "dreamina-seedance-2-5-260628", max: 30, min: 4, images: 30, videos: 10, audios: 10, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 30 },
  { id: "h3", name: "MiniMax H3", family: "h3", apiId: "MiniMax-H3", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["768P", "2K"], ratios: RATIOS, referenceSeconds: 15 },
];
export const PROTOCOLS = {
  ark: { name: "官方 · 火山方舟", families: ["seedance"], baseUrl: "https://ark.cn-beijing.volces.com", create: "/api/v3/contents/generations/tasks", status: "/api/v3/contents/generations/tasks/{id}" },
  las: { name: "官方 · BytePlus LAS", families: ["seedance"], baseUrl: "https://operator.las.ap-southeast-1.bytepluses.com", create: "/api/v1/contents/generations/tasks", status: "/api/v1/contents/generations/tasks/{id}" },
  minimax: { name: "官方 · MiniMax V2", families: ["h3"], baseUrl: "https://api.minimax.io", create: "/v2/video_generation", status: "/v2/query/video_generation/{id}", upload: "/v1/files/upload" },
  dashscope: { name: "官方 · 阿里云百炼", families: ["wan"], baseUrl: "", create: "/api/v1/services/aigc/video-generation/video-synthesis", status: "/api/v1/tasks/{id}" },
};
for (const [id, protocol] of Object.entries(PROTOCOLS)) protocol.modelIds = id === "ark" ? {} : Object.fromEntries(MODELS.filter(m => protocol.families.includes(m.family)).map(m => [m.id, m.apiId]));
export const DEFAULT_FAMILIES = { seedance: "las", wan: "dashscope", h3: "minimax" };
export function defaults({ protocols = PROTOCOLS, familyDefaults = DEFAULT_FAMILIES } = {}) {
  return { version: 0, configured: false, families: Object.fromEntries(FAMILIES.map(family => [family, {
    protocol: familyDefaults[family], baseUrl: protocols[familyDefaults[family]].baseUrl, credentialName: "", identity: { id: "", name: "" },
  }])), models: Object.fromEntries(MODELS.map(m => [m.id, { enabled: true, apiId: protocols[familyDefaults[m.family]].modelIds?.[m.id] || "", resolution: m.family === "h3" ? "768P" : "720p" }])) };
}
export function profile(modelId, settings) {
  const base = MODELS.find(m => m.id === modelId);
  if (!base) throw new Error("未知模型");
  const family = settings.families[base.family];
  const selected = settings.models[modelId];
  let result = { ...base, ...selected, protocol: family.protocol };
  if (["las", "ark"].includes(family.protocol) && base.id === "seedance20") result.resolutions = ["480p", "720p", "1080p"];
  // User-supplied capability declarations are explicit and visible. They can
  // narrow the contract, but cannot silently expand unverified hard limits.
  const limits = selected.limits || {};
  for (const key of ["max", "images", "videos", "audios", "referenceSeconds"]) {
    if (limits[key] !== undefined) result[key] = Math.min(base[key], limits[key]);
  }
  return result;
}
export function normalizeSettings(raw, previous, catalog = {}) {
  if (!raw || raw.version !== previous.version) throw Object.assign(new Error("配置已变化，请刷新后保存"), { statusCode: 409 });
  const protocols = catalog.protocols || PROTOCOLS;
  const out = defaults(catalog); out.version = previous.version + 1; out.configured = true;
  for (const family of FAMILIES) {
    const input = raw.families?.[family];
    if (!input || !protocols[input.protocol]?.families.includes(family)) throw new Error("模型与请求协议不匹配或本机扩展未加载");
    let baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
    if (baseUrl) {
      const url = new URL(baseUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("API 地址需为无密钥、无查询参数的 HTTPS 域名");
      if (/qiniu|qnaigc|qbox|qnssl/i.test(url.hostname)) throw new Error("不支持该供应商");
      baseUrl = url.origin;
    }
    const credentialName = String(input.credentialName || "").trim();
    if (credentialName && (!/^[A-Z][A-Z0-9_]{2,95}$/.test(credentialName) || /QINIU|QNAIGC/.test(credentialName))) throw new Error("凭证变量名无效");
    out.families[family] = { protocol: input.protocol, baseUrl, credentialName,
      identity: { id: String(input.identity?.id || "").slice(0, 40), name: String(input.identity?.name || "").slice(0, 100) },
      uploadUrl: String(input.uploadUrl || "").trim(),
    };
    if (out.families[family].uploadUrl) {
      const url = new URL(out.families[family].uploadUrl);
      if (url.origin !== baseUrl || url.search || url.hash || url.username || url.password) throw new Error("上传地址必须与 API 同源，不含密钥");
    }
  }
  for (const model of MODELS) {
    const input = raw.models?.[model.id];
    if (!input || typeof input.enabled !== "boolean" || typeof input.apiId !== "string" || !/^[\w.:-]{0,160}$/.test(input.apiId)) throw new Error("模型配置无效");
    const limits = {};
    for (const key of ["max", "images", "videos", "audios", "referenceSeconds"]) {
      if (input.limits?.[key] === undefined) continue;
      const n = Number(input.limits[key]);
      if (!Number.isInteger(n) || n < (key === "max" ? model.min : 0) || n > model[key]) throw new Error("自定义限制只能在已验证模型上限内调整");
      limits[key] = n;
    }
    out.models[model.id] = { enabled: input.enabled, apiId: input.apiId, resolution: input.resolution, limits };
    if (!profile(model.id, out).resolutions.includes(input.resolution)) throw new Error(`${model.name} 不支持该分辨率`);
  }
  return out;
}
export function constraints(ids, settings) {
  const models = [...new Set(ids)].map(id => profile(id, settings));
  if (!models.length || models.length > MODELS.length) throw new Error("请选择对比模型");
  return { min: Math.max(...models.map(m => m.min)), max: Math.min(...models.map(m => m.max)),
    images: Math.min(...models.map(m => m.images)), videos: Math.min(...models.map(m => m.videos)), audios: Math.min(...models.map(m => m.audios)),
    referenceSeconds: Math.min(...models.map(m => m.referenceSeconds)), ratios: RATIOS.filter(r => models.every(m => m.ratios.includes(r))), models };
}
export function validateDraft(draft, settings, assets) {
  const c = constraints(draft.models || [], settings);
  const prompt = String(draft.prompt || "").trim();
  if (!prompt || prompt.length > 10000) throw new Error("请输入 1–10000 字提示词");
  if (!Number.isInteger(draft.duration) || draft.duration < c.min || draft.duration > c.max) throw new Error(`当前组合支持 ${c.min}–${c.max} 秒`);
  if (!c.ratios.includes(draft.ratio)) throw new Error("比例不在所选模型共同支持范围内");
  if (assets.length !== (draft.assetIds || []).length || new Set(draft.assetIds).size !== assets.length) throw new Error("素材缺失或重复，请重新选择");
  const slots = new Set();
  for (const [type, plural, label] of [["image", "images", "图片"], ["video", "videos", "视频"], ["audio", "audios", "音频"]]) {
    const items = assets.filter(a => a.type === type);
    if (items.length > c[plural]) throw new Error(`当前组合最多 ${c[plural]} 个${label}，不会自动删除素材`);
    items.forEach((_, i) => slots.add(`@${label}${i + 1}`));
    if (type !== "image" && items.some(a => !Number.isFinite(a.duration) || a.duration < 2)) throw new Error(`${label}参考需至少 2 秒且可读取时长`);
    if (type !== "image" && items.reduce((sum, a) => sum + a.duration, 0) > c.referenceSeconds + 0.01) throw new Error(`参考${label}总时长不能超过 ${c.referenceSeconds} 秒`);
  }
  for (const slot of prompt.match(/@(?:图片|视频|音频)\d+/g) || []) if (!slots.has(slot)) throw new Error(`${slot} 没有对应素材`);
  if (assets.length && assets.every(a => a.type === "audio") && c.models.some(m => m.id !== "seedance25")) throw new Error("当前组合不支持仅音频参考，请添加图片或视频");
  if (c.models.some(m => m.family === "wan") && assets.filter(a => a.type === "video").reduce((s, a) => s + a.duration, draft.duration) > 30.01) throw new Error("Wan 输入视频总长 + 输出时长不能超过 30 秒");
  for (const m of c.models) {
    if (!m.enabled || !m.apiId || !settings.families[m.family].baseUrl) throw new Error(`${m.name} 尚未完成 API 配置`);
    if (["ark", "las"].includes(m.protocol) && m.resolution === "1080p" && assets.some(a => a.type === "image")) throw new Error("Seedance 官方 1080p 不支持当前参考图模式，请选择 720p");
  }
  for (const a of assets) {
    const limit = a.type === "image" ? 30 : a.type === "video" ? 50 : 15;
    if (a.size > limit * 1024 * 1024) throw new Error(`${a.name} 超过当前公共素材限制 ${limit} MB`);
    if (a.type === "image") {
      const min = c.models.some(m => m.family === "seedance") ? 300 : 256;
      const ratio = a.width / a.height;
      if (Math.min(a.width, a.height) < min || Math.max(a.width, a.height) > 5760 || ratio < 0.4 || ratio > 2.5) throw new Error(`${a.name} 尺寸或比例不在当前组合支持范围`);
    }
  }
  return { prompt, duration: draft.duration, ratio: draft.ratio, generateAudio: draft.generateAudio !== false, models: c.models.map(m => m.id), assetIds: [...(draft.assetIds || [])] };
}
