// Provider contracts checked 2026-09-12. Resolutions are per model, not a
// silently upscaled common output. The strict intersection applies to inputs.
export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const RESOLUTIONS = ["480p", "720p", "768P", "1080p", "2K"];
export const FAMILIES = ["seedance", "wan", "h3"];
// Image generation is a separate capability surface.  Keeping its families
// and model settings apart from the video catalogue lets the arena show an
// unconfigured image channel as unavailable without making legacy video
// settings invalid.
export const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "auto"];
export const IMAGE_RESOLUTIONS = ["512px", "768px", "1024px", "1K", "2K", "4K"];
export const IMAGE_FAMILIES = ["openai-image", "dashscope-image", "ark-image", "google-image", "stability-image", "bfl-image"];
export const MODELS = [
  { id: "wan3", name: "Wan 3.0", family: "wan", apiId: "wan3.0-video", max: 30, min: 2, images: 10, videos: 5, audios: 5, resolutions: ["480p", "720p", "1080p"], ratios: RATIOS.slice(0, 5), referenceSeconds: 15 },
  { id: "seedance20", name: "Seedance 2.0", family: "seedance", apiId: "dreamina-seedance-2-0-260128", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedancefast", name: "Seedance 2.0 Fast", family: "seedance", apiId: "dreamina-seedance-2-0-fast-260128", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedancemini", name: "Seedance 2.0 Mini", family: "seedance", apiId: "dreamina-seedance-2-0-mini-260615", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 15 },
  { id: "seedance25", name: "Seedance 2.5", family: "seedance", apiId: "dreamina-seedance-2-5-260628", max: 30, min: 4, images: 30, videos: 10, audios: 10, resolutions: ["480p", "720p"], ratios: RATIOS, referenceSeconds: 30 },
  { id: "h3", name: "MiniMax H3", family: "h3", apiId: "MiniMax-H3", max: 15, min: 4, images: 9, videos: 3, audios: 3, resolutions: ["768P", "2K"], ratios: RATIOS, referenceSeconds: 15 },
];
// This is a capability directory, not a claim that every model is enabled in
// the local installation.  A model becomes selectable only after its family
// protocol and credential are configured.  Private/local adapters can add
// further entries without changing this public list.
export const IMAGE_MODELS = [
  { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", family: "openai-image", apiId: "gpt-image-2.5-sunburst", references: 10, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS, edits: true, tier: "quality" },
  { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", family: "openai-image", apiId: "gpt-image-2.5-flare", references: 10, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS, edits: true, tier: "fast" },
  { id: "gpt-image-2", name: "GPT Image 2", family: "openai-image", apiId: "gpt-image-2", references: 10, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS, edits: true },
  { id: "gpt-image-1", name: "GPT Image 1", family: "openai-image", apiId: "gpt-image-1", references: 10, resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "auto"], edits: true, lifecycle: "legacy" },
  { id: "gpt-image-1-mini", name: "GPT Image 1 Mini", family: "openai-image", apiId: "gpt-image-1-mini", references: 10, resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "auto"], edits: true, lifecycle: "deprecated" },
  { id: "dall-e-3", name: "DALL·E 3", family: "openai-image", apiId: "dall-e-3", references: 0, resolutions: ["1024px"], ratios: ["1:1", "16:9", "9:16"], edits: false, lifecycle: "legacy" },
  { id: "qwen-image-3.0-pro", name: "Qwen Image 3.0 Pro", family: "dashscope-image", apiId: "qwen-image-3.0-pro", references: 3, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS, edits: true, tier: "quality" },
  { id: "qwen-image-3.0", name: "Qwen Image 3.0", family: "dashscope-image", apiId: "qwen-image-3.0", references: 0, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS, edits: false, tier: "fast" },
  { id: "qwen-image-2.0-pro", name: "Qwen Image 2.0 Pro", family: "dashscope-image", apiId: "qwen-image-2.0-pro", references: 3, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS, edits: true },
  { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro", family: "dashscope-image", apiId: "wan2.7-image-pro", references: 9, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "quality" },
  { id: "wan2.7-image", name: "Wan 2.7 Image", family: "dashscope-image", apiId: "wan2.7-image", references: 9, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "fast" },
  { id: "z-image-turbo", name: "Z-Image Turbo", family: "dashscope-image", apiId: "z-image-turbo", references: 0, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: false, tier: "fast" },
  { id: "seedream-5.0-pro", name: "Seedream 5.0 Pro", family: "ark-image", apiId: "doubao-seedream-5-0-pro-260628", references: 10, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "quality" },
  { id: "seedream-5.0-flash", name: "Seedream 5.0 Flash", family: "ark-image", apiId: "doubao-seedream-5-0-flash-260915", references: 10, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "fast" },
  { id: "seedream-5.0-lite", name: "Seedream 5.0 Lite", family: "ark-image", apiId: "doubao-seedream-5-0-260128", references: 14, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true },
  { id: "seedream-4.5", name: "Seedream 4.5", family: "ark-image", apiId: "doubao-seedream-4-5-251128", references: 14, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true },
  { id: "seedream-4.0", name: "Seedream 4.0", family: "ark-image", apiId: "doubao-seedream-4-0-250828", references: 14, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, lifecycle: "legacy" },
  { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", family: "google-image", apiId: "gemini-3.1-flash-image", references: 10, resolutions: ["512px", "1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "balanced" },
  { id: "gemini-3.1-flash-lite-image", name: "Gemini 3.1 Flash Lite Image", family: "google-image", apiId: "gemini-3.1-flash-lite-image", references: 14, resolutions: ["1K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "fast" },
  { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image", family: "google-image", apiId: "gemini-3-pro-image", references: 14, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, tier: "quality" },
  { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", family: "google-image", apiId: "gemini-2.5-flash-image", references: 3, resolutions: ["1K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true, lifecycle: "legacy" },
  { id: "stable-image-core", name: "Stable Image Core", family: "stability-image", apiId: "stable-image-core", references: 0, resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], edits: false },
  { id: "stable-diffusion-3.5-large", name: "Stable Diffusion 3.5 Large", family: "stability-image", apiId: "sd3.5-large", references: 1, resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], edits: true },
  { id: "stable-diffusion-3.5-large-turbo", name: "Stable Diffusion 3.5 Large Turbo", family: "stability-image", apiId: "sd3.5-large-turbo", references: 1, resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], edits: true, tier: "fast" },
  { id: "flux-2-max", name: "FLUX.2 Max", family: "bfl-image", apiId: "flux-2-max", references: 0, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: false, tier: "quality" },
  { id: "flux-2-pro", name: "FLUX.2 Pro", family: "bfl-image", apiId: "flux-2-pro", references: 0, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: false },
  { id: "flux-2-flex", name: "FLUX.2 Flex", family: "bfl-image", apiId: "flux-2-flex", references: 0, resolutions: ["1K", "2K", "4K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: false },
  { id: "flux-kontext-max", name: "FLUX Kontext Max", family: "bfl-image", apiId: "flux-kontext-max", references: 1, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true },
  { id: "flux-kontext-pro", name: "FLUX Kontext Pro", family: "bfl-image", apiId: "flux-kontext-pro", references: 1, resolutions: ["1K", "2K"], ratios: IMAGE_RATIOS.filter(r => r !== "auto"), edits: true },
];
export const PROTOCOLS = {
  ark: { name: "官方 · 火山方舟", families: ["seedance"], baseUrl: "https://ark.cn-beijing.volces.com", create: "/api/v3/contents/generations/tasks", status: "/api/v3/contents/generations/tasks/{id}" },
  las: { name: "官方 · BytePlus LAS", families: ["seedance"], baseUrl: "https://operator.las.ap-southeast-1.bytepluses.com", create: "/api/v1/contents/generations/tasks", status: "/api/v1/contents/generations/tasks/{id}" },
  minimax: { name: "官方 · MiniMax V2", families: ["h3"], baseUrl: "https://api.minimax.io", create: "/v2/video_generation", status: "/v2/query/video_generation/{id}", upload: "/v1/files/upload" },
  dashscope: { name: "官方 · 阿里云百炼", families: ["wan"], baseUrl: "", create: "/api/v1/services/aigc/video-generation/video-synthesis", status: "/api/v1/tasks/{id}" },
  "openai-image": { name: "官方 · OpenAI Images", families: ["openai-image"], mediaTypes: ["image"], baseUrl: "https://api.openai.com", create: "/v1/images/generations", status: "/v1/images/generations/{id}", synchronous: true },
  "dashscope-image": { name: "官方 · 阿里云百炼图片", families: ["dashscope-image"], mediaTypes: ["image"], baseUrl: "https://dashscope.aliyuncs.com", create: "/compatible-mode/v1/images/generations", status: "/api/v1/tasks/{id}", synchronous: true },
  "ark-image": { name: "官方 · 火山方舟图片", families: ["ark-image"], mediaTypes: ["image"], baseUrl: "https://ark.cn-beijing.volces.com", create: "/api/v3/images/generations", status: "/api/v3/images/generations/tasks/{id}" },
  "google-image": { name: "官方 · Google Nano Banana", families: ["google-image"], mediaTypes: ["image"], baseUrl: "https://generativelanguage.googleapis.com", create: "/v1beta/interactions", status: "/v1beta/interactions/{id}", synchronous: true },
  "stability-image": { name: "官方 · Stability AI", families: ["stability-image"], mediaTypes: ["image"], baseUrl: "https://api.stability.ai", create: "/v2beta/stable-image/generate/core", status: "/v2beta/stable-image/generate/core/{id}", synchronous: true },
  "bfl-image": { name: "官方 · Black Forest Labs", families: ["bfl-image"], mediaTypes: ["image"], baseUrl: "https://api.bfl.ai", create: "/v1/{model}", status: "/v1/get_result?id={id}" },
};
for (const [id, protocol] of Object.entries(PROTOCOLS)) {
  const models = [...MODELS, ...IMAGE_MODELS].filter(m => protocol.families.includes(m.family));
  protocol.modelIds = id === "ark" ? {} : Object.fromEntries(models.map(m => [m.id, m.apiId]));
}
export const VIDEO_PROTOCOLS = Object.fromEntries(Object.entries(PROTOCOLS).filter(([, protocol]) => (protocol.mediaTypes || ["video"]).includes("video")));
export const IMAGE_PROTOCOLS = Object.fromEntries(Object.entries(PROTOCOLS).filter(([, protocol]) => (protocol.mediaTypes || []).includes("image")));
export const protocolsForMedia = (protocols, mediaType) => Object.fromEntries(Object.entries(protocols || {}).filter(([, protocol]) => (protocol.mediaTypes || ["video"]).includes(mediaType)));
export const imageProtocolCatalog = protocols => protocolsForMedia(protocols, "image");
export const DEFAULT_FAMILIES = { seedance: "las", wan: "dashscope", h3: "minimax" };
export const DEFAULT_IMAGE_FAMILIES = { "openai-image": "openai-image", "dashscope-image": "dashscope-image", "ark-image": "ark-image", "google-image": "google-image", "stability-image": "stability-image", "bfl-image": "bfl-image" };
const protocolBase = (protocols, id) => protocols[id]?.baseUrl || "";
export function defaults({ protocols = PROTOCOLS, familyDefaults = DEFAULT_FAMILIES, imageFamilyDefaults = DEFAULT_IMAGE_FAMILIES } = {}) {
  return { version: 0, configured: false, imageConfigured: false, families: Object.fromEntries(FAMILIES.map(family => [family, {
    protocol: familyDefaults[family], baseUrl: protocols[familyDefaults[family]].baseUrl, credentialName: "", identity: { id: "", name: "" },
  }])), models: Object.fromEntries(MODELS.map(m => [m.id, { enabled: true, apiId: protocols[familyDefaults[m.family]].modelIds?.[m.id] || "", resolution: m.family === "h3" ? "768P" : "720p" }])),
    imageFamilies: Object.fromEntries(IMAGE_FAMILIES.map(family => [family, {
      protocol: imageFamilyDefaults[family], baseUrl: protocolBase(protocols, imageFamilyDefaults[family]), credentialName: "", identity: { id: "", name: "" },
    }])), imageModels: Object.fromEntries(IMAGE_MODELS.map(m => [m.id, { enabled: false, apiId: protocols[imageFamilyDefaults[m.family]]?.modelIds?.[m.id] || m.apiId, resolution: m.resolutions[0] }])) };
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
export function imageProfile(modelId, settings) {
  const base = IMAGE_MODELS.find(m => m.id === modelId);
  if (!base) throw new Error("未知图片模型");
  const family = settings.imageFamilies?.[base.family];
  const selected = settings.imageModels?.[modelId] || {};
  const result = { ...base, ...selected, kind: "image", mediaKind: "image", protocol: family?.protocol || "", configured: Boolean(settings.imageConfigured && selected.enabled && selected.apiId && family?.baseUrl) };
  const limits = selected.limits || {};
  if (limits.references !== undefined) result.references = Math.min(base.references, limits.references);
  return result;
}
export const profileImage = imageProfile;
export function imageConstraints(ids, settings) {
  const models = [...new Set(ids)].map(id => imageProfile(id, settings));
  if (!models.length || models.length > IMAGE_MODELS.length) throw new Error("请选择对比图片模型");
  return {
    references: Math.min(...models.map(m => m.references)),
    resolutions: IMAGE_RESOLUTIONS.filter(size => models.every(m => m.resolutions.includes(size))),
    ratios: IMAGE_RATIOS.filter(ratio => models.every(m => m.ratios.includes(ratio))), models,
  };
}
export const constraintsImage = imageConstraints;
export function validateImageDraft(draft, settings, assets) {
  const c = imageConstraints(draft.models || [], settings);
  const prompt = String(draft.prompt || "").trim();
  if (!prompt || prompt.length > 10000) throw new Error("请输入 1–10000 字提示词");
  if (!c.ratios.includes(draft.ratio)) throw new Error("比例不在所选图片模型共同支持范围内");
  if (draft.resolution && !c.resolutions.includes(draft.resolution)) throw new Error("分辨率不在所选图片模型共同支持范围内");
  if (assets.length !== (draft.assetIds || []).length || new Set(draft.assetIds).size !== assets.length) throw new Error("素材缺失或重复，请重新选择");
  if (assets.some(asset => asset.type !== "image")) throw new Error("图片竞技仅支持图片参考素材");
  if (assets.length > c.references) throw new Error(`当前组合最多 ${c.references} 张参考图片，不会自动删除素材`);
  const slots = new Set(assets.map((_, index) => `@图片${index + 1}`));
  for (const slot of prompt.match(/@图片\d+/g) || []) if (!slots.has(slot)) throw new Error(`${slot} 没有对应素材`);
  for (const model of c.models) {
    if (!model.configured) throw new Error(`${model.name} 尚未完成 API 配置`);
  }
  for (const asset of assets) {
    if (asset.size > 30 * 1024 * 1024) throw new Error(`${asset.name} 超过当前公共素材限制 30 MB`);
    if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height)) throw new Error(`${asset.name} 缺少可读取的图片尺寸`);
    const ratio = asset.width / asset.height;
    if (Math.min(asset.width, asset.height) < 256 || Math.max(asset.width, asset.height) > 8192 || ratio < 0.1 || ratio > 10) throw new Error(`${asset.name} 尺寸或比例不在当前组合支持范围`);
  }
  return { prompt, ratio: draft.ratio, resolution: draft.resolution || c.resolutions[0], models: c.models.map(model => model.id), assetIds: [...(draft.assetIds || [])] };
}
export const validateDraftImage = validateImageDraft;
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
  // Image settings were added after the video arena.  Old settings files do
  // not contain these fields and remain valid; new settings are validated
  // with the same HTTPS/credential and hard-limit rules as video settings.
  if (raw.imageFamilies !== undefined || raw.imageModels !== undefined) {
    for (const family of IMAGE_FAMILIES) {
      const input = raw.imageFamilies?.[family] || out.imageFamilies[family];
      if (!input || !protocols[input.protocol]?.families.includes(family)) throw new Error("图片模型与请求协议不匹配或本机扩展未加载");
      let baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
      if (baseUrl) {
        const url = new URL(baseUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("API 地址需为无密钥、无查询参数的 HTTPS 域名");
        if (/qiniu|qnaigc|qbox|qnssl/i.test(url.hostname)) throw new Error("不支持该供应商");
        baseUrl = url.origin;
      }
      const credentialName = String(input.credentialName || "").trim();
      if (credentialName && (!/^[A-Z][A-Z0-9_]{2,95}$/.test(credentialName) || /QINIU|QNAIGC/.test(credentialName))) throw new Error("凭证变量名无效");
      out.imageFamilies[family] = { protocol: input.protocol, baseUrl, credentialName,
        identity: { id: String(input.identity?.id || "").slice(0, 40), name: String(input.identity?.name || "").slice(0, 100) },
        uploadUrl: String(input.uploadUrl || "").trim(),
      };
      if (out.imageFamilies[family].uploadUrl) {
        const url = new URL(out.imageFamilies[family].uploadUrl);
        if (url.origin !== baseUrl || url.search || url.hash || url.username || url.password) throw new Error("上传地址必须与 API 同源，不含密钥");
      }
    }
    for (const model of IMAGE_MODELS) {
      const input = raw.imageModels?.[model.id] || out.imageModels[model.id];
      if (!input || typeof input.enabled !== "boolean" || typeof input.apiId !== "string" || !/^[\w.:-]{0,160}$/.test(input.apiId)) throw new Error("图片模型配置无效");
      const limits = {};
      if (input.limits?.references !== undefined) {
        const n = Number(input.limits.references);
        if (!Number.isInteger(n) || n < 0 || n > model.references) throw new Error("自定义限制只能在已验证模型上限内调整");
        limits.references = n;
      }
      out.imageModels[model.id] = { enabled: input.enabled, apiId: input.apiId, resolution: input.resolution, limits };
      if (!imageProfile(model.id, out).resolutions.includes(input.resolution)) throw new Error(`${model.name} 不支持该分辨率`);
    }
    out.imageConfigured = Boolean(raw.imageConfigured);
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
