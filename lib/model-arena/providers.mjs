import { readFile, stat } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROTOCOLS } from "./catalog.mjs";

const BLOCKED = /qiniu|qnaigc|qbox|qnssl|七牛/i;
export function publicUrl(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || BLOCKED.test(u.hostname)
      || /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname)) throw new Error("需使用可访问的 HTTPS 公网地址");
  return u.href;
}

// Secrets never enter saved settings, run manifests or browser responses.
export class Credentials {
  constructor({ env = process.env, keyFile = path.join(os.homedir(), ".codex", "keys.md"), protocols = PROTOCOLS } = {}) {
    this.env = env; this.keyFile = keyFile; this.protocols = protocols; this.session = new Map();
  }
  setSession(family, config, key) {
    if (typeof key !== "string" || key.length < 8 || key.length > 4096 || /[\r\n]/.test(key)) throw new Error("API Key 格式无效");
    this.session.set(family, { origin: config.baseUrl, protocol: config.protocol, key });
  }
  async get(family, config) {
    const session = this.session.get(family);
    if (session?.origin === config.baseUrl && session.protocol === config.protocol) return session.key;
    const protocol = this.protocols[config.protocol];
    const names = config.credentialName ? [config.credentialName] : protocol?.credentialOrigin === config.baseUrl
      ? protocol.credentialNames || [] : [];
    for (const name of names) if (!BLOCKED.test(name) && this.env[name]) return this.env[name];
    const text = await readFile(this.keyFile, "utf8").catch(() => "");
    // Read only an explicitly named assignment, never a generic key in a section.
    let section = "";
    for (const line of text.split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(line)) section = line;
      if (BLOCKED.test(section)) continue;
      for (const name of names) {
        if (!/^[A-Z][A-Z0-9_]{2,95}$/.test(name) || BLOCKED.test(name)) continue;
        const m = line.match(new RegExp("^\\s*(?:[-*]\\s*)?`?" + name + "`?\\s*[:=：]\\s*[`\"']?([^`\"'\\s]+)"));
        if (m?.[1]) return m[1];
        if (line.trim().startsWith("|")) {
          const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim().replace(/^`|`$/g, ""));
          if (cells[1] === name && !BLOCKED.test([cells[0], cells[3]].join(" ")) && cells[2] && !["值", "-", "—", "<redacted>"].includes(cells[2])) return cells[2];
        }
      }
    }
    throw new Error(`${family} 缺少凭证：填写凭证变量名或本次服务会话的 API Key`);
  }
}

export async function requestJson(url, { method = "GET", headers = {}, body, fetcher = fetch, timeout = 90000 } = {}) {
  publicUrl(url);
  let response;
  try { response = await fetcher(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error("API 网络连接中断或超时"); }
  // Never reflect the provider response verbatim: some gateways echo requests / credentials.
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("API 响应过大"); chunks.push(value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("API 响应不是有效 JSON"); }
  } finally { await reader.cancel().catch(() => {}); }
}

export function adaptedPrompt(prompt, model) {
  if (model.family === "h3" || model.family === "wan") {
    const names = { 图片: "Image", 视频: "Video", 音频: "Audio" };
    return prompt.replace(/@(图片|视频|音频)(\d+)/g, (_, type, n) => `${names[type]} ${n}`);
  }
  return prompt;
}

const imageDraft = (draft, model) => draft?.mode === "image" || draft?.kind === "image" || model?.kind === "image" || model?.mediaKind === "image";
const imageSize = (model, draft) => {
  const resolution = String(draft?.resolution || model?.resolution || "").trim();
  if (/^\d+x\d+$/i.test(resolution)) return resolution;
  const ratio = String(draft?.ratio || "1:1");
  const scale = /^4k$/i.test(resolution) ? 4 : /^2k$/i.test(resolution) ? 2 : /^512px$/i.test(resolution) ? 0.5 : 1;
  const sizes = { "1:1": [1024, 1024], "16:9": [1536, 864], "9:16": [864, 1536], "4:3": [1360, 1024], "3:4": [1024, 1360], "21:9": [1536, 656] };
  const base = sizes[ratio] || sizes["1:1"];
  return base.map(value => Math.round(value * scale / 16) * 16).join("x");
};

function imageReferencePayload(references) {
  return references.map((asset, index) => ({ type: "image_url", image_url: { url: asset.url }, role: "reference_image", index }));
}

function dataUrlBlob(value) {
  const match = /^data:(image\/[^;]+);base64,(.+)$/s.exec(value || "");
  if (!match) throw new Error("当前图片通道需要本机参考图，请重新导入该素材");
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}

export function buildPayload(model, config, draft, references, adapters = {}) {
  if (adapters[config.protocol]) return adapters[config.protocol].buildPayload(model, config, draft, references);
  if (!PROTOCOLS[config.protocol]) throw new Error("请求协议不可用，请恢复对应的本机扩展");
  const prompt = adaptedPrompt(draft.prompt, model);
  if (imageDraft(draft, model)) {
    const size = imageSize(model, draft);
    // Image gateways do not share one request envelope.  The local adapter
    // may provide an exact contract; this conservative JSON envelope is for
    // OpenAI-compatible and simple model gateways and keeps references
    // explicit instead of silently dropping them.
    if (config.protocol === "dashscope-image") return { model: model.apiId, prompt, size, n: 1,
      ...(references.length ? { image: references.length === 1 ? references[0].url : references.map(a => a.url) } : {}),
      prompt_extend: false, watermark: false };
    if (["ark-image", "volcengine-image", "seedream"].includes(config.protocol)) return {
      model: model.apiId, prompt, ...(references.length ? { image: references.length === 1 ? references[0].url : references.map(a => a.url) } : {}), size,
      response_format: "url", watermark: false, sequential_image_generation: "disabled",
    };
    if (config.protocol === "google-image") return {
      model: model.apiId,
      input: references.length ? [{ type: "text", text: prompt }, ...references.map(asset => {
        const match = /^data:(image\/[^;]+);base64,(.+)$/s.exec(asset.url);
        return match ? { type: "image", mime_type: match[1], data: match[2] } : { type: "image", uri: asset.url };
      })] : prompt,
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: draft.ratio, image_size: draft.resolution || model.resolution || "1K" },
    };
    if (config.protocol === "bfl-image") {
      const [width, height] = size.split("x").map(Number);
      return { prompt, width, height, ...(references[0] ? { input_image: references[0].url } : {}) };
    }
    return { model: model.apiId, prompt, ...(references.length ? { references: imageReferencePayload(references), images: references.map(a => a.url) } : {}), size, n: 1 };
  }
  if (config.protocol === "dashscope") return { model: model.apiId,
    input: { prompt, ...(references.length ? { media: references.map(a => ({ type: `reference_${a.type}`, url: a.url })) } : {}) },
    parameters: { resolution: model.resolution.toUpperCase(), ratio: draft.ratio, duration: draft.duration, prompt_extend: false, audio: draft.generateAudio } };
  const content = [{ type: "text", text: prompt }, ...references.map(a => ({ type: `${a.type}_url`, [`${a.type}_url`]: { url: a.url }, role: `reference_${a.type}` }))];
  if (config.protocol === "minimax") return { model: model.apiId, content, resolution: model.resolution, duration: draft.duration, ratio: draft.ratio, aigc_watermark: false };
  return { model: model.apiId, content, resolution: model.resolution, duration: draft.duration, ratio: draft.ratio, generate_audio: draft.generateAudio, watermark: false };
}

function imageResultUrl(value, raw) {
  const candidates = [value?.url, value?.image_url, value?.imageUrl, value?.output?.url, value?.output?.image_url,
    value?.output?.images?.[0]?.url, value?.images?.[0]?.url, value?.data?.[0]?.url, value?.result?.sample, raw?.url,
    raw?.image_url, raw?.images?.[0]?.url, raw?.data?.[0]?.url, raw?.result?.sample];
  const remote = candidates.find(item => typeof item === "string" && /^https:\/\//i.test(item));
  if (remote) return remote;
  const b64 = [value?.b64_json, value?.image, value?.output_image?.data, value?.data?.[0]?.b64_json,
    raw?.b64_json, raw?.image, raw?.output_image?.data, raw?.data?.[0]?.b64_json,
    raw?.steps?.flatMap?.(step => step?.content || [])?.find?.(item => item?.type === "image")?.data]
    .find(item => typeof item === "string" && item.length > 0 && item.length <= 140 * 1024 * 1024);
  return b64 ? `data:image/png;base64,${b64}` : "";
}

export function parseTask(protocol, raw, { creating = false, adapters = {}, kind = "video" } = {}) {
  if (adapters[protocol]) return adapters[protocol].parseTask(raw, { creating, kind });
  if (!PROTOCOLS[protocol]) throw new Error("请求协议不可用，请恢复对应的本机扩展");
  if (raw.success === false || (raw.base_resp?.status_code && raw.base_resp.status_code !== 0) || raw.error || raw.code) throw new Error("平台拒绝请求，请核对模型 ID、权限和参数");
  const value = protocol === "minimax" ? raw.task || raw : protocol === "dashscope" ? raw.output || {} : raw;
  const image = kind === "image";
  const url = image ? imageResultUrl(value, raw) : protocol === "minimax" ? value.content?.url : protocol === "dashscope" ? value.video_url : value.content?.video_url;
  let id = String(value.taskId || value.task_id || value.id || raw.task_id || "");
  // Some image APIs are synchronous and return only the generated URL.  The
  // service consumes the URL immediately; no synthetic platform task is
  // submitted or polled.
  if (creating && image && !id && url) id = "image-inline";
  if (creating && (!id || id.length > 256)) throw new Error("平台未返回任务 ID，提交结果不确定");
  const status = String(value.status || value.task_status || "").toLowerCase();
  return { id, state: ["completed", "succeeded", "success", "ready"].includes(status) || (image && url && !status) ? "succeeded"
    : ["failed", "canceled", "cancelled", "expired", "unknown"].includes(status) ? "failed" : "running", url: typeof url === "string" ? url : "" };
}

export class Provider {
  constructor({ credentials, fetcher = fetch, protocols = PROTOCOLS, adapters = {} } = {}) {
    this.protocols = protocols; this.adapters = adapters;
    this.credentials = credentials || new Credentials({ protocols }); this.fetcher = fetcher;
  }
  async headers(model, config) { const key = await this.credentials.get(model.family, config);
    if (this.adapters[config.protocol]?.headers) return this.adapters[config.protocol].headers(key, model, config);
    if (config.protocol === "google-image") return { "x-goog-api-key": key };
    if (config.protocol === "bfl-image") return { "x-key": key };
    return { Authorization: `Bearer ${key}` }; }
  async preflight(model, config, assets) {
    if (!this.protocols[config.protocol]) throw new Error("请求协议不可用，请恢复对应的本机扩展");
    publicUrl(config.baseUrl);
    await this.credentials.get(model.family, config);
    await this.adapters[config.protocol]?.preflight?.(model, config, assets);
    for (const asset of assets) {
      if (asset.remoteUrl) { publicUrl(asset.remoteUrl); continue; }
      if ((config.protocol === "dashscope" || (["ark", "las"].includes(config.protocol) && asset.type === "video")) && !config.uploadUrl) {
        throw new Error(`${model.name} 官方通道需要公网素材 URL；为该素材填写地址，或配置同源文件上传服务后再发送`);
      }
      if (["ark", "las"].includes(config.protocol) && !config.uploadUrl && asset.size > 15 * 1024 * 1024) throw new Error("官方通道内联素材限制 15 MB，大文件请配置公网 URL 或上传服务");
    }
  }
  async liveCheck(model, config, draft) {
    const hook = this.adapters[config.protocol]?.liveCheck;
    if (hook) await hook(model, config, draft, { requestJson, publicUrl, headers: await this.headers(model, config), fetcher: this.fetcher });
  }
  async upload(model, config, asset) {
    if (model?.kind === "image" && config.protocol === "openai-image" && asset.type === "image") {
      if ((await stat(asset.path)).size > 30 * 1024 * 1024) throw new Error("图片参考超过 30 MB");
      return `data:${asset.mime};base64,${(await readFile(asset.path)).toString("base64")}`;
    }
    if (asset.remoteUrl) return publicUrl(asset.remoteUrl);
    // Image generation endpoints commonly accept a data URL for reference
    // images and do not expose the video-oriented upload APIs. Keep local
    // references usable without silently routing them through another vendor.
    if (model?.kind === "image" && asset.type === "image" && !config.uploadUrl) {
      if ((await stat(asset.path)).size > 30 * 1024 * 1024) throw new Error("图片参考超过 30 MB");
      return `data:${asset.mime};base64,${(await readFile(asset.path)).toString("base64")}`;
    }
    if (["ark", "las"].includes(config.protocol) && !config.uploadUrl && asset.type !== "video") {
      if ((await stat(asset.path)).size > 15 * 1024 * 1024) throw new Error("内联素材过大");
      return `data:${asset.mime};base64,${(await readFile(asset.path)).toString("base64")}`;
    }
    const form = new FormData();
    if (config.protocol === "minimax") form.set("purpose", "video_generation_input");
    form.set("file", await openAsBlob(asset.path, { type: asset.mime }), asset.name);
    const uploadPath = this.protocols[config.protocol]?.upload;
    if (!config.uploadUrl && !uploadPath) throw new Error("当前协议未配置上传服务");
    const url = config.uploadUrl || config.baseUrl + uploadPath;
    const raw = await requestJson(url, { method: "POST", headers: await this.headers(model, config), body: form, fetcher: this.fetcher, timeout: 180000 });
    if (config.protocol === "minimax") {
      const id = raw.file?.file_id; if (!id) throw new Error("MiniMax 上传未返回 file_id"); return `mm_file://${id}`;
    }
    const value = raw.data?.url || raw.data?.fileUrl || raw.data?.file_url || raw.url;
    if (typeof value !== "string") throw new Error("上传未返回 url；上传服务需返回 {url} 或 {data:{url}}");
    return publicUrl(value);
  }
  async submit(model, config, draft, references) {
    const payload = buildPayload(model, config, draft, references, this.adapters);
    const baseHeaders = await this.headers(model, config);
    if (!this.adapters[config.protocol] && draft?.mode === "image" && config.protocol === "openai-image" && references.length) {
      const form = new FormData(); form.set("model", model.apiId); form.set("prompt", draft.prompt); form.set("size", imageSize(model, draft));
      references.forEach((asset, index) => form.append("image[]", dataUrlBlob(asset.url), `reference-${index + 1}.png`));
      const raw = await requestJson(config.baseUrl + "/v1/images/edits", { method: "POST", headers: baseHeaders, body: form, fetcher: this.fetcher, timeout: 180000 });
      return parseTask(config.protocol, raw, { creating: true, kind: "image", adapters: this.adapters });
    }
    if (!this.adapters[config.protocol] && draft?.mode === "image" && config.protocol === "stability-image") {
      const form = new FormData(); form.set("prompt", draft.prompt); form.set("output_format", "png"); form.set("aspect_ratio", draft.ratio || "1:1");
      let createPath = "/v2beta/stable-image/generate/core";
      if (model.apiId.startsWith("sd3.5")) { createPath = "/v2beta/stable-image/generate/sd3"; form.set("model", model.apiId); }
      if (references[0]) { form.set("image", dataUrlBlob(references[0].url), "reference.png"); form.set("mode", "image-to-image"); form.set("strength", "0.65"); }
      const raw = await requestJson(config.baseUrl + createPath, { method: "POST", headers: { ...baseHeaders, accept: "application/json" }, body: form, fetcher: this.fetcher, timeout: 180000 });
      return parseTask(config.protocol, raw, { creating: true, kind: "image", adapters: this.adapters });
    }
    const headers = { ...baseHeaders, "content-type": "application/json" };
    if (config.protocol === "dashscope") headers["X-DashScope-Async"] = "enable";
    // Deliberately one attempt. A timeout may still have created a billable task.
    const createPath = this.protocols[config.protocol].create.replace("{model}", encodeURIComponent(model.apiId));
    return parseTask(config.protocol, await requestJson(config.baseUrl + createPath,
      { method: "POST", headers, body: JSON.stringify(payload), fetcher: this.fetcher }), { creating: true, kind: draft?.mode || draft?.kind || model?.kind || "video", adapters: this.adapters });
  }
  async poll(model, config, id) {
    if (!this.protocols[config.protocol]) throw new Error("请求协议不可用，请恢复对应的本机扩展");
    const statusPath = this.protocols[config.protocol].status.replace("{id}", encodeURIComponent(id)).replace("{model}", encodeURIComponent(model.apiId));
    return parseTask(config.protocol, await requestJson(config.baseUrl + statusPath,
      { headers: await this.headers(model, config), fetcher: this.fetcher, timeout: 20000 }), { kind: model?.kind || model?.mediaKind || "video", adapters: this.adapters });
  }
}
