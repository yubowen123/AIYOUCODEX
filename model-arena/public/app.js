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
  let state, view = "config", selected = new Set(), assetIds = [], preview, busy = false, visible = true, lastError = "";
  let pickerMode = "library", nextOffset = 0, pickerGeneration = 0, urlAsset = "";
  const familyNames = { seedance: "Seedance 系列", wan: "Wan 3.0", h3: "MiniMax H3" };
  const stateLabels = { queued: "准备中", uploading: "上传参考素材", submitting: "正在提交", submit_unknown: "提交结果待核对", running: "生成中", downloading: "保存视频", succeeded: "已完成", failed: "失败", download_failed: "下载待恢复", poll_paused: "查询已暂停" };
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
    if (value !== "config" && !state.settings.configured) { notice("请先保存模型与 API 配置"); value = "config"; }
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
    renderModelConfigs();
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
    }); return cfg;
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
  $("save-config").onclick = event => action(event.currentTarget, async () => {
    const raw = readConfig(); const secrets = Array.from(document.querySelectorAll("[data-family]")).map(section => ({ family: section.dataset.family, key: section.querySelector("[data-secret]").value }));
    state.settings = await request("settings", "PUT", raw);
    for (const item of secrets) if (item.key) await request("credential", "POST", item);
    document.querySelectorAll("[data-secret]").forEach(input => { input.value = ""; });
    selected = new Set([...selected].filter(id => state.settings.models[id].enabled)); if (!selected.size) state.models.filter(m => state.settings.models[m.id].enabled).forEach(m => selected.add(m.id));
    renderConfig(); showView("generate"); saveDraft(); notice("配置已保存。先添加素材与提示词，再预览确认生成。");
  });
  function currentModels() { return state.models.filter(m => selected.has(m.id) && state.settings.models[m.id].enabled).map(m => ({ ...m, ...state.settings.models[m.id], ...state.settings.models[m.id].limits })); }
  function renderPicks() {
    $("model-picks").innerHTML = state.models.filter(m => state.settings.models[m.id].enabled).map(m => `<button class="model-pick ${selected.has(m.id) ? "selected" : ""}" data-pick="${m.id}" aria-pressed="${selected.has(m.id)}"><b>${esc(m.name)}</b><span>${esc(state.settings.models[m.id].resolution.toUpperCase())} · ${esc(state.protocols[state.settings.families[m.family].protocol].name)}</span></button>`).join("");
    updateLimits();
  }
  function updateLimits() {
    const models = currentModels(), ratio = $("ratio").value || "16:9"; $("model-count").textContent = `${models.length} 个模型`;
    if (!models.length) { $("limits").textContent = "请至少选择一个模型"; $("preview").disabled = true; return; }
    $("preview").disabled = busy;
    const min = Math.max(...models.map(m => m.min)), max = Math.min(...models.map(m => m.max));
    const ratios = models[0].ratios.filter(r => models.every(m => m.ratios.includes(r)));
    $("ratio").innerHTML = options(ratios, ratio); $("duration").min = min; $("duration").max = max;
    $("limits").textContent = `共同输入限制：${min}–${max} 秒 · 最多 ${Math.min(...models.map(m => m.images))} 张图 / ${Math.min(...models.map(m => m.videos))} 段视频 / ${Math.min(...models.map(m => m.audios))} 段音频。参考视频与音频分别合计 ≤${Math.min(...models.map(m => m.referenceSeconds))} 秒。超限会提示，不会自动删素材或改时长。`;
  }
  $("model-picks").onclick = event => { const button = event.target.closest("[data-pick]"); if (!button) return; const id = button.dataset.pick; selected.has(id) ? selected.delete(id) : selected.add(id); renderPicks(); saveDraft(); };
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ selected: [...selected], assetIds, prompt: $("prompt").value, duration: $("duration").value, ratio: $("ratio").value, generateAudio: $("generate-audio").checked })); } catch {} }
  function slots() { const counts = { image: 0, audio: 0, video: 0 }, labels = { image: "图片", audio: "音频", video: "视频" };
    return assetIds.map(id => state.assets.find(a => a.id === id)).filter(Boolean).map(a => ({ ...a, slot: `@${labels[a.type]}${++counts[a.type]}` })); }
  function renderAssets() {
    $("assets").innerHTML = slots().map(a => `<article class="asset"><button class="remove" data-remove="${a.id}" aria-label="移除 ${esc(a.name)}">×</button>${a.type === "image" ? `<img loading="lazy" src="${esc(mediaUrl(a))}" alt="${esc(a.name)}">` : `<div class="placeholder">${a.type === "video" ? "▷" : "♫"}</div>`}<div class="body"><button class="slot" data-slot="${esc(a.slot)}">${esc(a.slot)}</button><div class="name" title="${esc(a.name)}">${esc(a.name)}</div><button class="url" data-url="${a.id}">${a.hasRemoteUrl ? "✓ 已配置公网 URL" : "配置公网 URL"}</button></div></article>`).join("") || '<div class="empty">从本机或资产控制台选择图片、音频、视频；也支持纯文字生成。</div>';
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
  function addAsset(item) { mergeAsset(item); if (!assetIds.includes(item.id)) assetIds.push(item.id); renderAssets(); saveDraft(); }
  $("prompt").addEventListener("input", () => { saveDraft(); const input = $("prompt"); const show = input.value.slice(0, input.selectionStart).endsWith("@");
    $("mentions").innerHTML = slots().map(a => `<button data-slot="${esc(a.slot)}">${esc(a.slot)} · ${esc(a.name)}</button>`).join(""); $("mentions").hidden = !show || !slots().length; });
  $("mentions").onclick = event => { const b = event.target.closest("[data-slot]"); if (b) insertSlot(b.dataset.slot); };
  for (const id of ["duration", "ratio", "generate-audio"]) $(id).onchange = saveDraft;
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
    preview = await request("preview", "POST", { models: [...selected], assetIds, prompt: $("prompt").value, duration: Number($("duration").value), ratio: $("ratio").value, generateAudio: $("generate-audio").checked, threadId, threadTitle });
    $("preview-content").innerHTML = `<p class="muted">${esc(preview.note)}</p>${preview.requests.map(r => `<section class="request"><h3>${esc(r.model)}</h3><p>${esc(r.protocol)} · ${esc(r.host)}</p><pre>${esc(JSON.stringify(r.payload, null, 2))}</pre></section>`).join("")}`;
    $("confirm").textContent = `确认生成（${preview.count} 个任务）`; $("preview-dialog").showModal();
  });
  $("confirm").onclick = event => action(event.currentTarget, async () => { if (!preview) return;
    const run = await request("confirm", "POST", { token: preview.token, fingerprint: preview.fingerprint });
    state.runs = [run, ...state.runs.filter(r => r.id !== run.id)]; preview = null; $("preview-dialog").close(); showView("results"); notice("已保存任务，开始上传与提交。可关闭面板，稍后回来查看。"); });
  function jobCard(job) {
    const output = job.output;
    return `${output ? `<video src="${esc(mediaUrl(output))}" preload="none" controls playsinline></video>` : `<div class="result-placeholder"><strong>${esc(stateLabels[job.state] || job.state)}</strong><span>${esc(job.error || "任务状态已保存在本机")}</span></div>`}<div class="result-body"><label><input type="checkbox" data-select-job="${job.id}" ${output ? "" : "disabled"}>${esc(job.model)}</label><small>${esc(job.resolution)} · ${esc(stateLabels[job.state] || job.state)}${output ? ` · ${output.duration.toFixed(1)}s` : ""}</small>${job.taskId ? `<small title="${esc(job.taskId)}">任务 ID：${esc(job.taskId)}</small>` : ""}${output ? `<button data-reveal="${output.id}">定位本地文件</button>` : ""}${["submit_unknown", "download_failed", "poll_paused"].includes(job.state) ? `<button data-recover="${job.id}">${job.state === "submit_unknown" ? "关联平台任务 ID" : job.state === "download_failed" ? "仅重试下载" : "恢复状态查询"}</button>` : ""}</div>`;
  }
  function renderRuns() {
    const container = $("runs");
    $("runs-more").hidden = state.runs.length >= (state.runPage?.total || 0);
    if (!state.runs.length) { container.innerHTML = '<div class="empty">还没有生成记录。配置模型后创建第一次对比。</div>'; return; }
    container.querySelector(":scope > .empty")?.remove();
    for (const run of state.runs) {
      let section = container.querySelector(`[data-run="${run.id}"]`);
      if (!section) { section = document.createElement("article"); section.className = "run"; section.dataset.run = run.id;
        section.innerHTML = `<div class="run-title"><h3>${esc(run.threadTitle || "多模型视频对比")}</h3><small>${esc(new Date(run.createdAt).toLocaleString())}</small></div><p class="run-prompt" title="${esc(run.draft.prompt)}">${esc(run.draft.prompt)}</p><div class="results-strip"></div><div class="run-actions"><button data-compose="grid">选中视频 → 静音同屏对比</button><button data-compose="sequence">选中视频 → 静音顺序拼接</button></div><div class="composite"></div>`;
        container.appendChild(section); }
      const strip = section.querySelector(".results-strip");
      for (const job of run.jobs) {
        let card = strip.querySelector(`[data-job="${job.id}"]`); if (!card) { card = document.createElement("div"); card.className = "result-card"; card.dataset.job = job.id; strip.appendChild(card); }
        const signature = JSON.stringify([job.state, job.error, job.taskId, job.output?.id]);
        if (card.dataset.signature !== signature) { const checked = card.querySelector("input")?.checked; card.innerHTML = jobCard(job); if (checked) card.querySelector("input").checked = true; card.dataset.signature = signature; }
      }
      const comp = section.querySelector(".composite"), signature = JSON.stringify(run.composite);
      if (comp.dataset.signature !== signature) { comp.dataset.signature = signature;
        comp.innerHTML = run.composite?.output ? `<video src="${esc(mediaUrl(run.composite.output))}" preload="none" controls playsinline></video><p>${run.composite.mode === "grid" ? "同屏合成使用最短视频的公共时长，等比留黑边并标注模型名。" : "按选择列表顺序拼接，保留各段完整时长。"}所有音轨已移除。</p><button data-reveal="${run.composite.output.id}">定位合成文件</button>` : run.composite ? `<p>${run.composite.state === "working" ? "正在本机静音合成…" : esc(run.composite.error)}</p>` : ""; }
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
    selected = new Set((saved?.selected || state.models.map(m => m.id)).filter(id => state.settings.models[id]?.enabled));
    assetIds = (saved?.assetIds || []).filter(id => state.assets.some(a => a.id === id));
    $("prompt").value = saved?.prompt || ""; $("duration").value = saved?.duration || 5; $("generate-audio").checked = saved?.generateAudio !== false;
    if (threadTitle) $("draft-hint").textContent = `关联对话：${threadTitle} · 草稿保存在本机`;
    renderConfig(); renderPicks(); if (saved?.ratio && Array.from($("ratio").options).some(o => o.value === saved.ratio)) $("ratio").value = saved.ratio;
    showView(state.settings.configured ? "generate" : "config");
    $("retry-connect").hidden = true; $("config-button").disabled = false; notice("");
    } catch (error) { notice("模型竞技场无法连接本机服务：" + error.message, true); $("retry-connect").hidden = false; }
  }
  $("retry-connect").onclick = event => action(event.currentTarget, initialize);
  initialize();
  setInterval(() => { if (!state || !visible || document.hidden || view !== "results") return;
    refresh().then(() => { lastError = ""; }).catch(error => { if (lastError !== error.message) notice(error.message, true); lastError = error.message; }); }, 5000);
})();
