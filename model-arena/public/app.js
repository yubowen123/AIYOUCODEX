(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ROOT = new URL("../", location.href), API = new URL("api/arena/", ROOT);
  const params = new URLSearchParams(location.search);
  const threadId = params.get("threadId") || "", threadTitle = params.get("threadTitle") || "";
  const DRAFT_KEY = `aiyoucodex:model-arena:draft:${threadId || "local"}`;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const mediaUrl = item => new URL(item.mediaUrl, API).href;
  const localUrl = value => new URL(String(value).replace(/^\/+/, ""), ROOT).href;
  let state, view = "generate", mode = "video", selected = new Set(), selectedByMode = { video: new Set(), image: new Set() }, assetIds = [], preview, busy = false, visible = true, lastError = "";
  let pickerMode = "library", nextOffset = 0, pickerGeneration = 0, urlAsset = "";
  const familyNames = { seedance: "Seedance 系列", wan: "Wan 3.0", h3: "MiniMax H3", "openai-image": "OpenAI 图片", "dashscope-image": "阿里云百炼图片", "ark-image": "火山方舟图片", "google-image": "Google Imagen", "stability-image": "Stability AI", "bfl-image": "Black Forest Labs" };
  const stateLabels = { queued: "准备中", uploading: "上传参考素材", submitting: "正在提交", submit_unknown: "提交结果待核对", running: "生成中", downloading: "保存结果", succeeded: "已完成", failed: "失败", download_failed: "下载待恢复", poll_paused: "查询已暂停" };
  const modelsForMode = () => mode === "image" ? (state.imageModels || state.models.filter(model => model.kind === "image" || model.type === "image")) : state.models.filter(model => !model.kind || model.kind === "video");
  const settingsFor = model => { const key = mode === "image" ? "imageModels" : "models"; return state.settings[key]?.[model.id] || state.settings.models?.[model.id] || {}; };
  const familyConfig = model => state.settings[mode === "image" ? "imageFamilies" : "families"]?.[model.family] || state.settings.families?.[model.family] || {};
  const modelReady = model => { const cfg = settingsFor(model), family = familyConfig(model); const configured = mode === "image" ? state.settings.imageConfigured === true : state.settings.configured === true; return configured && cfg.enabled !== false && Boolean(cfg.apiId || model.apiId) && Boolean(family.baseUrl); };
  const modelProtocol = model => state.protocols[familyConfig(model).protocol]?.name || familyConfig(model).protocol || "未配置通道";
  const options = (values, current, label = x => x) => values.map(value => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label(value))}</option>`).join("");
  async function request(route, method = "GET", body) {
    const response = await fetch(new URL(route, API), { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `请求失败 ${response.status}`); return value;
  }
  function notice(message, error = false) { $("notice").textContent = message; $("notice").classList.toggle("error", error); $("notice").hidden = !message; }
  async function action(button, work) {
    if (button.disabled) return; button.disabled = true;
    try { await work(); } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  }
  function showView(value) {
    if (!state) return;
    view = value;
    for (const name of ["config", "generate", "results"]) $(`${name}-view`).hidden = name !== value;
    document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === value));
    if (value === "generate") { renderPicks(); renderAssets(); }
    if (value === "results") renderRuns();
  }
  function renderConfig() {
    $("families").innerHTML = Object.entries(state.settings.families).map(([family, cfg]) => `<section class="family" data-family="${family}"><h3>${familyNames[family]}</h3><div class="fields">
      <label>接口协议<select data-field="protocol">${options(Object.keys(state.protocols).filter(p => state.protocols[p].families.includes(family)), cfg.protocol, p => state.protocols[p].name)}</select></label>
      <label>API 地址<input data-field="baseUrl" type="url" value="${esc(cfg.baseUrl)}" placeholder="https://your-api.example"></label>
      <label>凭证变量名（推荐）<input data-field="credentialName" value="${esc(cfg.credentialName)}" placeholder="${esc(state.protocols[cfg.protocol]?.credentialHint || "填写当前通道的环境变量名称")}" autocomplete="off" spellcheck="false"></label>
      <label>或输入临时 API Key<input data-secret type="password" placeholder="仅本次服务会话有效" autocomplete="new-password"></label>
      <label data-identity-field ${state.protocols[cfg.protocol]?.requiresIdentity ? "" : "hidden"}>账号 ID<input data-identity="id" value="${esc(cfg.identity?.id)}" placeholder="按接口账号填写"></label><label data-identity-field ${state.protocols[cfg.protocol]?.requiresIdentity ? "" : "hidden"}>账号名称<input data-identity="name" value="${esc(cfg.identity?.name)}" placeholder="用于生成记录"></label>
      </div><details><summary>高级：同源上传服务</summary><p class="hint">官方 LAS / 方舟的视频参考、百炼的本地素材需要公开 URL。可逐素材填写公网地址，或指定同源 multipart 文件上传服务（file 字段，响应 {url} / {data:{url}}）；不会借用另一家供应商上传。</p><input data-field="uploadUrl" value="${esc(cfg.uploadUrl || "")}" placeholder="留空使用通道原生上传 / 内联能力"></details></section>`).join("");
    $("image-families").innerHTML = Object.entries(state.settings.imageFamilies || {}).map(([family, cfg]) => `<section class="family" data-image-family="${family}"><h3>${familyNames[family] || family}</h3><div class="fields">
      <label>接口协议<select data-image-field="protocol">${options(Object.keys(state.protocols).filter(p => (state.protocols[p].mediaTypes || []).includes("image") && state.protocols[p].families.includes(family)), cfg.protocol, p => state.protocols[p].name)}</select></label>
      <label>API 地址<input data-image-field="baseUrl" type="url" value="${esc(cfg.baseUrl)}" placeholder="https://your-api.example"></label>
      <label>凭证变量名（推荐）<input data-image-field="credentialName" value="${esc(cfg.credentialName)}" placeholder="填写当前图片通道的环境变量名称" autocomplete="off" spellcheck="false"></label>
      <label>或输入临时 API Key<input data-image-secret type="password" placeholder="仅本次服务会话有效" autocomplete="new-password"></label>
      </div><details><summary>高级：图片上传服务</summary><p class="hint">参考图若需要公网 URL，可填写与 API 同源的 multipart 上传服务；不会借用视频通道的上传地址。</p><input data-image-field="uploadUrl" value="${esc(cfg.uploadUrl || "")}" placeholder="留空使用通道原生上传 / 内联能力"></details></section>`).join("");
    renderModelConfigs(); renderImageModelConfigs();
  }
  function resolutions(model) { const protocol = state.settings.families[model.family].protocol;
    return ["ark", "las"].includes(protocol) && model.id === "seedance20" ? ["480p", "720p", "1080p"] : model.resolutions; }
  function renderModelConfigs() {
    $("model-configs").innerHTML = state.models.map(model => { const cfg = state.settings.models[model.id];
      return `<article class="model-config" data-model="${model.id}"><div class="model-head"><label><input type="checkbox" data-model-field="enabled" ${cfg.enabled ? "checked" : ""}>${esc(model.name)}</label></div>
        <label>请求模型 ID<input data-model-field="apiId" value="${esc(cfg.apiId)}" spellcheck="false"></label><label>输出分辨率<select data-model-field="resolution">${options(resolutions(model), cfg.resolution, x => x.toUpperCase())}</select></label>
        <small>${model.min}–${model.max}s · ≤${model.images} 图 / ${model.videos} 视频 / ${model.audios} 音频</small>
        <details><summary>自定义限制</summary><div class="fields">${[["max", "最长秒数"], ["images", "图片上限"], ["videos", "视频上限"], ["audios", "音频上限"]].map(([key, label]) => `<label>${label}<input type="number" data-limit="${key}" value="${cfg.limits?.[key] ?? model[key]}" min="${key === "max" ? model.min : 0}" max="${model[key]}"></label>`).join("")}</div></details></article>`;
    }).join("");
  }
  function renderImageModelConfigs() {
    $("image-model-configs").innerHTML = (state.imageModels || []).map(model => { const cfg = state.settings.imageModels?.[model.id] || {};
      const status = model.lifecycle === "deprecated" ? "待下线" : model.lifecycle === "legacy" ? "旧版" : model.tier === "quality" ? "高质量" : model.tier === "fast" ? "快速" : model.tier === "balanced" ? "均衡" : "标准";
      return `<article class="model-config" data-image-model="${esc(model.id)}"><div class="model-head"><label><input type="checkbox" data-image-model-field="enabled" ${cfg.enabled ? "checked" : ""}>${esc(model.name)}</label><small>${esc(status)} · ${esc(model.edits ? "支持参考图" : "纯文生图")}</small></div>
        <label>请求模型 ID<input data-image-model-field="apiId" value="${esc(cfg.apiId || model.apiId || "")}" spellcheck="false"></label><label>输出分辨率<select data-image-model-field="resolution">${options(model.resolutions, cfg.resolution || model.resolutions[0], x => x.toUpperCase())}</select></label>
        <small>比例：${esc((model.ratios || []).join(" / "))} · 参考图上限：${model.references || 0}</small>
        <label>参考图上限<input type="number" data-image-limit="references" value="${cfg.limits?.references ?? model.references ?? 0}" min="0" max="${model.references || 0}"></label></article>`;
    }).join("");
  }
  function readConfig() {
    const cfg = structuredClone(state.settings);
    document.querySelectorAll("[data-family]").forEach(section => {
      const target = cfg.families[section.dataset.family];
      section.querySelectorAll("[data-field]").forEach(input => { target[input.dataset.field] = input.value.trim(); });
      target.identity ||= {}; section.querySelectorAll("[data-identity]").forEach(input => { target.identity[input.dataset.identity] = input.value.trim(); });
    });
    document.querySelectorAll("[data-model]").forEach(section => {
      const target = cfg.models[section.dataset.model]; target.limits = {};
      section.querySelectorAll("[data-model-field]").forEach(input => { target[input.dataset.modelField] = input.type === "checkbox" ? input.checked : input.value.trim(); });
      section.querySelectorAll("[data-limit]").forEach(input => { target.limits[input.dataset.limit] = Number(input.value); });
    });
    document.querySelectorAll("[data-image-family]").forEach(section => {
      const target = cfg.imageFamilies[section.dataset.imageFamily];
      section.querySelectorAll("[data-image-field]").forEach(input => { target[input.dataset.imageField] = input.value.trim(); });
    });
    document.querySelectorAll("[data-image-model]").forEach(section => {
      const target = cfg.imageModels[section.dataset.imageModel]; target.limits = {};
      section.querySelectorAll("[data-image-model-field]").forEach(input => { target[input.dataset.imageModelField] = input.type === "checkbox" ? input.checked : input.value.trim(); });
      section.querySelectorAll("[data-image-limit]").forEach(input => { target.limits[input.dataset.imageLimit] = Number(input.value); });
    });
    cfg.imageConfigured = (state.imageModels || []).some(model => { const item = cfg.imageModels?.[model.id], family = cfg.imageFamilies?.[model.family]; return item?.enabled && item.apiId && family?.baseUrl; });
    return cfg;
  }
  $("families").addEventListener("change", event => {
    if (event.target.dataset.field !== "protocol") return;
    state.settings = readConfig(); const section = event.target.closest("[data-family]"), family = section.dataset.family, protocol = event.target.value;
    const base = state.protocols[protocol].baseUrl; section.querySelector('[data-field="baseUrl"]').value = base;
    section.querySelector('[data-field="uploadUrl"]').value = "";
    section.querySelector('[data-field="credentialName"]').placeholder = state.protocols[protocol].credentialHint || "填写当前通道的环境变量名称";
    section.querySelectorAll("[data-identity-field]").forEach(label => { label.hidden = !state.protocols[protocol].requiresIdentity; });
    state.settings.families[family].baseUrl = base; state.settings.families[family].uploadUrl = "";
    for (const model of state.models.filter(m => m.family === family)) {
      const cfg = state.settings.models[model.id]; cfg.apiId = state.protocols[protocol].modelIds?.[model.id] || "";
      if (!resolutions(model).includes(cfg.resolution)) cfg.resolution = family === "h3" ? "768P" : "720p";
    }
    renderModelConfigs(); notice(protocol === "ark" ? "火山方舟请填写你账号实际开通的模型 ID / 推理接入点 ID，不会自动猜测。" : "已切换请求协议，请核对 API 地址与凭证。");
  });
  $("image-families").addEventListener("change", event => {
    if (event.target.dataset.imageField !== "protocol") return;
    state.settings = readConfig(); const section = event.target.closest("[data-image-family]"), family = section.dataset.imageFamily, protocol = event.target.value;
    const base = state.protocols[protocol]?.baseUrl || ""; section.querySelector('[data-image-field="baseUrl"]').value = base;
    section.querySelector('[data-image-field="uploadUrl"]').value = "";
    state.settings.imageFamilies[family].baseUrl = base; state.settings.imageFamilies[family].uploadUrl = ""; state.settings.imageFamilies[family].protocol = protocol;
    for (const model of (state.imageModels || []).filter(m => m.family === family)) {
      const cfg = state.settings.imageModels[model.id]; cfg.apiId = state.protocols[protocol]?.modelIds?.[model.id] || model.apiId || "";
      if (!model.resolutions.includes(cfg.resolution)) cfg.resolution = model.resolutions[0];
    }
    renderImageModelConfigs(); notice("已切换图片请求协议，请核对 API 地址、凭证与模型 ID。");
  });
  $("save-config").onclick = event => action(event.currentTarget, async () => {
    const raw = readConfig(); const secrets = [
      ...Array.from(document.querySelectorAll("[data-family]")).map(section => ({ family: section.dataset.family, key: section.querySelector("[data-secret]").value })),
      ...Array.from(document.querySelectorAll("[data-image-family]")).map(section => ({ family: section.dataset.imageFamily, key: section.querySelector("[data-image-secret]").value })),
    ];
    state.settings = await request("settings", "PUT", raw);
    for (const item of secrets) if (item.key) await request("credential", "POST", item);
    document.querySelectorAll("[data-secret], [data-image-secret]").forEach(input => { input.value = ""; });
    selected = new Set([...selected].filter(id => settingsFor({ id }).enabled !== false)); if (!selected.size) modelsForMode().filter(modelReady).forEach(m => selected.add(m.id));
    renderConfig(); showView("generate"); saveDraft(); notice("配置已保存。先添加素材与提示词，再预览确认生成。");
  });
  function currentModels() { return modelsForMode().filter(m => selected.has(m.id) && modelReady(m)).map(m => ({ ...m, ...settingsFor(m), ...settingsFor(m).limits })); }
  function renderPicks() {
    const models = modelsForMode().filter(modelReady);
    $("model-picks").innerHTML = models.map(m => { const cfg = settingsFor(m);
      return `<button class="model-pick ${selected.has(m.id) ? "selected" : ""}" data-pick="${esc(m.id)}" aria-pressed="${selected.has(m.id)}"><b>${esc(m.name)}</b><span>${esc((cfg.resolution || m.resolution || "默认").toUpperCase())} · ${esc(modelProtocol(m))}</span></button>`;
    }).join("");
    $("model-empty").hidden = models.length > 0;
    updateLimits();
  }
  function updateLimits() {
    const models = currentModels(), ratio = $("ratio").value || "16:9"; $("model-count").textContent = `${models.length} 个模型`;
    if (!models.length) { $("limits").textContent = mode === "image" ? "请先配置并选择至少一个图片模型" : "请先配置并选择至少一个视频模型"; $("preview").disabled = true; return; }
    if (mode === "image" && slots().some(asset => asset.type !== "image")) { $("limits").textContent = "图片竞技只接受图片参考；已选的视频或音频仍保留在草稿中，请移除后再发送。"; $("preview").disabled = true; return; }
    $("preview").disabled = busy;
    if (mode === "image") {
      const ratios = (models[0].ratios || ["1:1"]).filter(r => models.every(m => (m.ratios || []).includes(r)));
      const resolution = $("resolution").value || models[0].resolution;
      const resolutions = (models[0].resolutions || [models[0].resolution]).filter(r => models.every(m => (m.resolutions || []).includes(r)));
      $("ratio").innerHTML = options(ratios, ratio); $("resolution").innerHTML = options(resolutions, resolution, x => x.toUpperCase()); $("preview").disabled = busy;
      $("limits").textContent = `共同输入限制：最多 ${Math.min(...models.map(m => m.references ?? m.images ?? 1))} 张参考图；分辨率与比例按所选图片模型共同能力取交集。未配置模型已禁用，不会发送请求。`;
      return;
    }
    const min = Math.max(...models.map(m => m.min)), max = Math.min(...models.map(m => m.max));
    const ratios = models[0].ratios.filter(r => models.every(m => m.ratios.includes(r)));
    $("ratio").innerHTML = options(ratios, ratio); $("duration").min = min; $("duration").max = max;
    $("limits").textContent = `共同输入限制：${min}–${max} 秒 · 最多 ${Math.min(...models.map(m => m.images))} 张图 / ${Math.min(...models.map(m => m.videos))} 段视频 / ${Math.min(...models.map(m => m.audios))} 段音频。参考视频与音频分别合计 ≤${Math.min(...models.map(m => m.referenceSeconds))} 秒。超限会提示，不会自动删素材或改时长。`;
  }
  $("model-picks").onclick = event => { const button = event.target.closest("[data-pick]"); if (!button) return; const model = modelsForMode().find(item => item.id === button.dataset.pick); if (!modelReady(model)) { notice(`${model?.name || "该模型"} 尚未完成 API 配置，请从右上角进入配置。`, true); return; } const id = button.dataset.pick; selected.has(id) ? selected.delete(id) : selected.add(id); renderPicks(); saveDraft(); };
  function saveDraft() { try { selectedByMode[mode] = new Set(selected); localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode, selected: [...selected], selectedByMode: { video: [...selectedByMode.video], image: [...selectedByMode.image] }, assetIds, prompt: $("prompt").value, duration: $("duration").value, ratio: $("ratio").value, resolution: $("resolution").value, generateAudio: $("generate-audio").checked })); } catch {} }
  function slots() { const counts = { image: 0, audio: 0, video: 0 }, labels = { image: "图片", audio: "音频", video: "视频" };
    return assetIds.map(id => state.assets.find(a => a.id === id)).filter(Boolean).map(a => ({ ...a, slot: `@${labels[a.type]}${++counts[a.type]}` })); }
  function renderAssets() {
    $("assets").innerHTML = slots().map(a => `<article class="asset ${mode === "image" && a.type !== "image" ? "incompatible" : ""}"><button class="remove" data-remove="${a.id}" aria-label="移除 ${esc(a.name)}">×</button>${a.type === "image" ? `<img loading="lazy" src="${esc(mediaUrl(a))}" alt="${esc(a.name)}">` : `<div class="placeholder">${a.type === "video" ? "▷" : "♫"}</div>`}<div class="body"><button class="slot" data-slot="${esc(a.slot)}">${esc(a.slot)}</button><div class="name" title="${esc(a.name)}">${esc(a.name)}</div>${mode === "image" && a.type !== "image" ? '<div class="asset-warning">图片竞技不可用</div>' : `<button class="url" data-url="${a.id}">${a.hasRemoteUrl ? "✓ 已配置公网 URL" : "配置公网 URL"}</button>`}</div></article>`).join("") || `<div class="empty">${mode === "image" ? "添加图片作为参考，或直接使用提示词生成。" : "从本机或资产控制台选择图片、音频、视频；也支持纯文字生成。"}</div>`;
  }
  function insertSlot(slot) {
    const input = $("prompt"), pos = input.selectionStart, end = input.selectionEnd;
    const start = input.value.slice(0, pos).endsWith("@") ? pos - 1 : pos;
    input.setRangeText(slot + " ", start, end, "end"); input.focus(); $("mentions").hidden = true; saveDraft();
  }
  $("assets").onclick = event => {
    const remove = event.target.closest("[data-remove]"), slot = event.target.closest("[data-slot]"), url = event.target.closest("[data-url]");
    if (remove) {
      const before = slots(); assetIds = assetIds.filter(id => id !== remove.dataset.remove); const after = slots();
      const mapping = new Map(before.map(a => [a.slot, after.find(b => b.id === a.id)?.slot || `（已移除素材：${a.name}）`]));
      $("prompt").value = $("prompt").value.replace(/@(?:图片|视频|音频)\d+/g, token => mapping.get(token) || token);
      notice("已移除素材，并按原资产身份更新 @ 编号；请检查提示词。"); renderAssets(); saveDraft();
    }
    if (slot) insertSlot(slot.dataset.slot);
    if (url) { urlAsset = url.dataset.url; $("asset-url").value = ""; $("url-dialog").showModal(); }
  };
  $("save-asset-url").onclick = event => action(event.currentTarget, async () => { const item = await request("asset-url", "PUT", { id: urlAsset, url: $("asset-url").value.trim() }); mergeAsset(item); renderAssets(); $("url-dialog").close(); });
  function mergeAsset(item) { const i = state.assets.findIndex(a => a.id === item.id); if (i >= 0) state.assets[i] = item; else state.assets.push(item); }
  function addAsset(item) { if (mode === "image" && item.type !== "image" && item.kind !== "image") { notice("图片竞技只支持添加图片参考素材。", true); return; } mergeAsset(item); if (!assetIds.includes(item.id)) assetIds.push(item.id); renderAssets(); updateLimits(); saveDraft(); }
  $("prompt").addEventListener("input", () => { saveDraft(); const input = $("prompt"); const show = input.value.slice(0, input.selectionStart).endsWith("@");
    $("mentions").innerHTML = slots().map(a => `<button data-slot="${esc(a.slot)}">${esc(a.slot)} · ${esc(a.name)}</button>`).join(""); $("mentions").hidden = !show || !slots().length; });
  $("mentions").onclick = event => { const b = event.target.closest("[data-slot]"); if (b) insertSlot(b.dataset.slot); };
  for (const id of ["duration", "ratio", "resolution", "generate-audio"]) $(id).onchange = saveDraft;
  function switchMode(next) {
    selectedByMode[mode] = new Set(selected);
    mode = next === "image" ? "image" : "video";
    const ready = modelsForMode().filter(modelReady), remembered = selectedByMode[mode];
    selected = remembered.size ? new Set([...remembered].filter(id => ready.some(model => model.id === id))) : new Set(ready.map(model => model.id));
    selectedByMode[mode] = new Set(selected);
    document.querySelectorAll("[data-mode]").forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
    $("duration-field").hidden = mode === "image"; $("audio-field").hidden = mode === "image"; $("resolution-field").hidden = mode !== "image";
    $("prompt-label-text").textContent = mode === "image" ? "图片提示词" : "视频提示词";
    $("prompt").placeholder = mode === "image" ? "描述画面主体、风格、构图与光线；输入 @ 可选择参考图片…" : "描述你希望对比的画面、动作、镜头与声音。输入 @ 可选择资产…";
    $("file-input").accept = mode === "image" ? ".png,.jpg,.jpeg,.webp" : ".png,.jpg,.jpeg,.webp,.mp4,.mov,.mp3,.wav";
    $("library-kind").disabled = mode === "image"; if (mode === "image") $("library-kind").value = "image";
    renderPicks(); renderAssets(); saveDraft();
  }
  document.querySelectorAll("[data-mode]").forEach(button => { button.onclick = () => switchMode(button.dataset.mode); });
  $("empty-config").onclick = () => { renderConfig(); showView("config"); };
  $("local-upload").onclick = () => $("file-input").click();
  $("file-input").onchange = async () => {
    if (busy) return; busy = true; $("local-upload").disabled = true; updateLimits();
    try {
      for (const file of $("file-input").files) {
        if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} 超过 100 MB`);
        const upload = await request("upload", "POST", { name: file.name, size: file.size });
        for (let offset = 0; offset < file.size; offset += 256 * 1024) {
          const bytes = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer()); let binary = "";
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          await request(`upload/${upload.id}`, "PUT", { offset, data: btoa(binary) });
          notice(`导入 ${file.name} · ${Math.min(100, Math.round((offset + bytes.length) / file.size * 100))}%`);
        }
        addAsset(await request(`upload/${upload.id}/finish`, "POST", {}));
      }
      notice("素材已导入本机，尚未上传到生成平台。");
    } catch (error) { notice(error.message, true); }
    finally { busy = false; $("file-input").value = ""; $("local-upload").disabled = false; updateLimits(); }
  };
  function pickerRow(a, imported = false) { return `<div class="picker-item">${a.type === "image" || a.kind === "image" ? `<img loading="lazy" src="${esc(imported ? mediaUrl(a) : localUrl(a.mediaUrl))}" alt="">` : ""}<div class="text">${esc(a.name)}<small>${esc(a.type || a.kind)} · ${(a.size / 1024 / 1024).toFixed(1)} MB</small></div><button data-import="${esc(a.id)}" data-existing="${imported}">添加</button></div>`; }
  async function searchLibrary(append = false) {
    if (pickerMode !== "library") return; const generation = ++pickerGeneration;
    const query = new URLSearchParams({ project: $("library-project").value, kind: $("library-kind").value, query: $("library-query").value, limit: "48", offset: String(append ? nextOffset : 0) });
    if (!append) $("library-list").innerHTML = '<div class="empty">读取资产索引…</div>';
    try { const response = await fetch(new URL(`api/library?${query}`, ROOT)); const result = await response.json(); if (!response.ok) throw new Error(result.error || "资产库读取失败");
      if (generation !== pickerGeneration || pickerMode !== "library") return;
      const html = (result.assets || []).map(a => pickerRow(a)).join("") || '<div class="empty">当前筛选没有素材</div>';
      if (append) $("library-list").insertAdjacentHTML("beforeend", html); else $("library-list").innerHTML = html;
      nextOffset = result.page?.nextOffset || 0; $("library-more").hidden = !result.page?.hasMore;
    } catch (error) { if (generation === pickerGeneration) $("library-list").textContent = error.message; }
  }
  $("library-open").onclick = event => action(event.currentTarget, async () => {
    pickerMode = "library"; $("picker-title").textContent = "资产控制台 · 选择参考素材"; document.querySelector(".picker-filters").hidden = false;
    const response = await fetch(new URL("api/projects", ROOT)); const result = await response.json(); if (!response.ok) throw new Error(result.error || "无法读取项目");
    $("library-project").innerHTML = (result.projects || []).map(p => `<option value="${esc(p.id)}">${esc(p.name || p.label || p.id)}</option>`).join("");
    $("library-dialog").showModal(); if (result.projects?.length) await searchLibrary(); else $("library-list").innerHTML = '<div class="empty">请先在资产控制台关联项目文件夹。</div>';
  });
  $("recent-open").onclick = () => { pickerGeneration++; pickerMode = "recent"; $("picker-title").textContent = "已导入本机的素材"; document.querySelector(".picker-filters").hidden = true; $("library-more").hidden = true;
    $("library-list").innerHTML = state.assets.slice().reverse().map(a => pickerRow(a, true)).join("") || '<div class="empty">还没有导入素材</div>'; $("library-dialog").showModal(); };
  $("library-search").onclick = () => searchLibrary(); $("library-more").onclick = () => searchLibrary(true);
  for (const id of ["library-project", "library-kind"]) $(id).onchange = () => searchLibrary();
  $("library-list").onclick = event => { const button = event.target.closest("[data-import]"); if (!button) return;
    action(button, async () => { const item = button.dataset.existing === "true" ? state.assets.find(a => a.id === button.dataset.import) : await request("import", "POST", { assetRef: button.dataset.import });
      addAsset(item); button.textContent = "已添加"; notice("已添加到本次参考素材。"); }); };
  $("preview").onclick = event => action(event.currentTarget, async () => {
    if (!currentModels().length) throw new Error(`请先配置并选择至少一个${mode === "image" ? "图片" : "视频"}模型`);
    preview = await request("preview", "POST", { mode, kind: mode, models: [...selected], assetIds, prompt: $("prompt").value, duration: Number($("duration").value), ratio: $("ratio").value, resolution: $("resolution").value, generateAudio: $("generate-audio").checked, threadId, threadTitle });
    $("preview-content").innerHTML = `<p class="muted">${esc(preview.note)}</p>${preview.requests.map(r => `<section class="request"><h3>${esc(r.model)}</h3><p>${esc(r.protocol)} · ${esc(r.host)}</p><pre>${esc(JSON.stringify(r.payload, null, 2))}</pre></section>`).join("")}`;
    $("confirm").textContent = `确认生成（${preview.count} 个任务）`; $("preview-dialog").showModal();
  });
  $("confirm").onclick = event => action(event.currentTarget, async () => { if (!preview) return;
    const run = await request("confirm", "POST", { token: preview.token, fingerprint: preview.fingerprint });
    state.runs = [run, ...state.runs.filter(r => r.id !== run.id)]; preview = null; $("preview-dialog").close(); showView("results"); notice("已保存任务，开始上传与提交。可关闭面板，稍后回来查看。"); });
  function jobCard(job) {
    const output = job.output;
    const image = output && (output.type === "image" || output.mime?.startsWith("image/"));
    const media = output ? (image ? `<img src="${esc(mediaUrl(output))}" loading="lazy" alt="${esc(job.model)} 生成结果">` : `<video src="${esc(mediaUrl(output))}" preload="none" controls playsinline></video>`) : `<div class="result-placeholder"><strong>${esc(stateLabels[job.state] || job.state)}</strong><span>${esc(job.error || "任务状态已保存在本机")}</span></div>`;
    return `${media}<div class="result-body"><label><input type="checkbox" data-select-job="${job.id}" ${output ? "" : "disabled"}>${esc(job.model)}</label><small>${esc(job.resolution || "")}${output?.duration ? ` · ${output.duration.toFixed(1)}s` : ""} · ${esc(stateLabels[job.state] || job.state)}</small>${job.taskId ? `<small title="${esc(job.taskId)}">任务 ID：${esc(job.taskId)}</small>` : ""}${output ? `<button data-reveal="${output.id}">定位本地文件</button>` : ""}${["submit_unknown", "download_failed", "poll_paused"].includes(job.state) ? `<button data-recover="${job.id}">${job.state === "submit_unknown" ? "关联平台任务 ID" : job.state === "download_failed" ? "仅重试下载" : "恢复状态查询"}</button>` : ""}</div>`;
  }
  function renderRuns() {
    const container = $("runs");
    $("runs-more").hidden = state.runs.length >= (state.runPage?.total || 0);
    if (!state.runs.length) { container.innerHTML = '<div class="empty">还没有生成记录。配置模型后创建第一次对比。</div>'; return; }
    container.querySelector(":scope > .empty")?.remove();
    for (const run of state.runs) {
      let section = container.querySelector(`[data-run="${run.id}"]`);
      if (!section) { section = document.createElement("article"); section.className = "run"; section.dataset.run = run.id;
        const imageRun = run.mode === "image" || run.kind === "image" || run.draft?.mode === "image";
        section.innerHTML = `<div class="run-title"><h3>${esc(run.threadTitle || (imageRun ? "多模型图片对比" : "多模型视频对比"))}</h3><small>${esc(new Date(run.createdAt).toLocaleString())}</small></div><p class="run-prompt" title="${esc(run.draft.prompt)}">${esc(run.draft.prompt)}</p><div class="results-strip"></div><div class="run-actions"><button data-compose="grid">${imageRun ? "选中图片 → 拼接对比" : "选中视频 → 静音同屏对比"}</button>${imageRun ? "" : '<button data-compose="sequence">选中视频 → 静音顺序拼接</button>'}</div><div class="composite"></div>`;
        container.appendChild(section); }
      const strip = section.querySelector(".results-strip");
      for (const job of run.jobs) {
        let card = strip.querySelector(`[data-job="${job.id}"]`); if (!card) { card = document.createElement("div"); card.className = "result-card"; card.dataset.job = job.id; strip.appendChild(card); }
        const signature = JSON.stringify([job.state, job.error, job.taskId, job.output?.id]);
        if (card.dataset.signature !== signature) { const checked = card.querySelector("input")?.checked; card.innerHTML = jobCard(job); if (checked) card.querySelector("input").checked = true; card.dataset.signature = signature; }
      }
      const comp = section.querySelector(".composite"), signature = JSON.stringify(run.composite);
      if (comp.dataset.signature !== signature) { comp.dataset.signature = signature;
        const compositeImage = run.composite?.output && (run.composite.output.type === "image" || run.composite.output.mime?.startsWith("image/"));
        comp.innerHTML = run.composite?.output ? `${compositeImage ? `<img src="${esc(mediaUrl(run.composite.output))}" loading="lazy" alt="拼接结果">` : `<video src="${esc(mediaUrl(run.composite.output))}" preload="none" controls playsinline></video>`}<p>${compositeImage ? "已生成图片拼接对比结果。" : run.composite.mode === "grid" ? "同屏合成使用最短视频的公共时长，等比留黑边并标注模型名。" : "按选择列表顺序拼接，保留各段完整时长。所有音轨已移除。"}</p><button data-reveal="${run.composite.output.id}">定位合成文件</button>` : run.composite ? `<p>${run.composite.state === "working" ? "正在本机生成拼接结果…" : esc(run.composite.error)}</p>` : ""; }
    }
    // Reorder only when needed; do not rebuild videos during polling.
    state.runs.forEach((run, index) => { const node = container.querySelector(`[data-run="${run.id}"]`); if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
  }
  $("runs").onclick = event => {
    const compose = event.target.closest("[data-compose]"), recover = event.target.closest("[data-recover]"), reveal = event.target.closest("[data-reveal]");
    if (reveal) action(reveal, () => request("reveal", "POST", { id: reveal.dataset.reveal }));
    if (compose) action(compose, async () => { const section = compose.closest("[data-run]"); const jobIds = Array.from(section.querySelectorAll("[data-select-job]:checked")).map(input => input.dataset.selectJob);
      const run = await request("composite", "POST", { runId: section.dataset.run, jobIds, mode: compose.dataset.compose }); state.runs = state.runs.map(r => r.id === run.id ? run : r); renderRuns(); });
    if (recover) action(recover, async () => { const section = recover.closest("[data-run]"), run = state.runs.find(r => r.id === section.dataset.run), job = run.jobs.find(j => j.id === recover.dataset.recover);
      const taskId = job.state === "submit_unknown" ? window.prompt("请粘贴平台后台中实际已创建的任务 ID（不会创建新任务）") : ""; if (taskId === null) return;
      const updated = await request("recover", "POST", { runId: run.id, jobId: job.id, taskId }); state.runs = state.runs.map(r => r.id === updated.id ? updated : r); renderRuns(); });
  };
  document.addEventListener("play", event => { if (!(event.target instanceof HTMLMediaElement)) return; document.querySelectorAll("video,audio").forEach(media => { if (media !== event.target) media.pause(); }); }, true);
  new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (!visible) document.querySelectorAll("video,audio").forEach(media => media.pause()); }).observe(document.querySelector("main"));
  async function refresh() {
    const incoming = await request("state"); if (!state) state = incoming;
    else { const merged = new Map([...state.runs, ...incoming.runs].map(run => [run.id, run])); state.runs = [...merged.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); state.runPage = incoming.runPage; incoming.assets.forEach(mergeAsset); }
    if (view === "results") renderRuns();
  }
  $("refresh").onclick = event => action(event.currentTarget, refresh);
  $("runs-more").onclick = event => action(event.currentTarget, async () => { const next = await request(`state?offset=${state.runs.length}`);
    for (const run of next.runs) if (!state.runs.some(r => r.id === run.id)) state.runs.push(run); state.runPage = next.runPage; renderRuns(); });
  document.querySelectorAll("[data-view]").forEach(button => { button.onclick = () => showView(button.dataset.view); });
  $("config-button").onclick = () => { if (!state) return; renderConfig(); showView("config"); };
  async function initialize() {
    $("config-button").disabled = true;
    try { await refresh();
    let saved; try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch {}
    mode = saved?.mode === "image" ? "image" : "video";
    selectedByMode = { video: new Set(saved?.selectedByMode?.video || []), image: new Set(saved?.selectedByMode?.image || []) };
    const available = modelsForMode(), savedSelection = saved?.selectedByMode?.[mode] || saved?.selected || available.map(m => m.id); selected = new Set(savedSelection.filter(id => { const model = available.find(item => item.id === id); return model && modelReady(model); }));
    assetIds = (saved?.assetIds || []).filter(id => state.assets.some(a => a.id === id));
    $("prompt").value = saved?.prompt || ""; $("duration").value = saved?.duration || 5; $("resolution").value = saved?.resolution || "1K"; $("generate-audio").checked = saved?.generateAudio !== false;
    if (threadTitle) $("draft-hint").textContent = `关联对话：${threadTitle} · 草稿保存在本机`;
    renderConfig(); switchMode(mode); if (saved?.ratio && Array.from($("ratio").options).some(o => o.value === saved.ratio)) $("ratio").value = saved.ratio;
    showView("generate");
    $("retry-connect").hidden = true; $("config-button").disabled = false; notice("");
    } catch (error) { notice("模型竞技场无法连接本机服务：" + error.message, true); $("retry-connect").hidden = false; }
  }
  $("retry-connect").onclick = event => action(event.currentTarget, initialize);
  initialize();
  setInterval(() => { if (!state || !visible || document.hidden || view !== "results") return;
    refresh().then(() => { lastError = ""; }).catch(error => { if (lastError !== error.message) notice(error.message, true); lastError = error.message; }); }, 5000);
})();
