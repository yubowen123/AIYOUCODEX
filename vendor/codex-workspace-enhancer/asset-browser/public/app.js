const state = {
  system: { platform: "", name: "", pathSeparator: "/" },
  projects: [],
  selectedProject: localStorage.getItem("asset-library:selected-project") || "",
  assets: [],
  counts: { all: 0, text: 0, image: 0, audio: 0, video: 0 },
  settings: { columns: 4, tags: [], taxonomy: {} },
  kind: "all",
  category: "",
  query: "",
  sort: "newest",
  busy: false,
  editingProject: null,
  action: null,
  actionAsset: null,
  textAsset: null,
  refreshTimer: null,
  visibleLimit: 120,
};

const els = Object.fromEntries([
  "localProjectList", "projectCount", "projectFoldersPanel", "projectFolderList", "newProjectButton",
  "editProjectButton", "workspaceTitle", "workspaceSubtitle", "scanState", "refreshLibraryButton", "settingsButton",
  "assetKindTabs", "librarySearchInput", "librarySortSelect", "assetColumnRange", "assetColumnOutput",
  "categoryChips", "assetGrid", "emptyLibraryState", "emptyCreateProjectButton", "projectDialog", "projectForm",
  "projectDialogTitle", "projectNameInput", "codexNewProjectScanRoots", "projectFormError", "saveProjectButton",
  "textViewerDialog", "textViewerTitle", "textViewerFormat", "textViewerPreview", "textViewerEditor",
  "toggleTextEditButton", "saveTextButton", "textSaveState", "assetActionDialog", "assetActionForm",
  "assetActionTitle", "assetActionFields", "assetActionError", "confirmAssetAction", "settingsDialog",
  "settingsForm", "tagManager", "newTagInput", "addTagButton", "taxonomyManager", "toastRegion",
].map((id) => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAbsoluteProjectPath(value, platform = state.system.platform) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  if (platform === "win32") return /^[a-z]:\//i.test(normalized) || /^\/\/[a-z0-9._-]+\//i.test(normalized);
  return normalized.startsWith("/");
}

function parseScanRoots(value) {
  return [...new Set(String(value || "").split(/\r?\n|[,;]+/u).map((item) => item.trim()).filter(Boolean))];
}

function applyPlatformProjectUi(data = { system: state.system }) {
  const platform = data.system?.platform || state.system.platform;
  const copy = document.querySelector("[data-codex-project-platform-copy]");
  const example = platform === "win32" ? "D:\\Projects\\Assets" : "/Users/your-name/Projects/assets";
  els.codexNewProjectScanRoots.placeholder = `${example}\n${platform === "win32" ? "E:\\Media\\References" : "/Volumes/Media/References"}`;
  if (copy) copy.textContent = `已识别 ${data.system?.name || "当前系统"}；每行填写一个绝对路径，文件只在本机扫描。`;
}

async function api(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function showToast(message, tone = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = String(message || "操作完成");
  els.toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 180);
  }, 2600);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProject) || null;
}

function setColumns(value, persist = false) {
  const columns = Math.max(1, Math.min(8, Number(value) || 4));
  state.settings.columns = columns;
  els.assetColumnRange.value = String(columns);
  els.assetColumnOutput.value = String(columns);
  document.documentElement.style.setProperty("--asset-columns", String(columns));
  if (persist) {
    clearTimeout(setColumns.timer);
    setColumns.timer = setTimeout(() => api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ columns }),
    }).catch((error) => showToast(error.message, "error")), 250);
  }
}

function renderProjects() {
  els.projectCount.textContent = String(state.projects.length);
  els.localProjectList.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-item ${project.id === state.selectedProject ? "active" : ""}`;
    button.dataset.projectId = project.id;
    const initial = [...String(project.name || "项")][0] || "项";
    button.innerHTML = `<span class="project-avatar">${escapeHtml(initial)}</span><span class="project-copy"><strong>${escapeHtml(project.name)}</strong><small>${project.folders?.length || 0} 个文件夹</small></span><span class="project-chevron">›</span>`;
    button.addEventListener("click", () => selectProject(project.id));
    els.localProjectList.append(button);
  }
  const project = selectedProject();
  els.projectFoldersPanel.hidden = !project;
  els.projectFolderList.replaceChildren();
  for (const folder of project?.folders || []) {
    const row = document.createElement("div");
    row.className = "folder-row";
    row.innerHTML = `<span aria-hidden="true">⌑</span><span title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>`;
    els.projectFolderList.append(row);
  }
}

function updateKindCounts() {
  document.querySelectorAll("[data-kind-count]").forEach((item) => {
    item.textContent = String(state.counts[item.dataset.kindCount] || 0);
  });
}

function renderCategoryChips() {
  const kind = state.kind === "all" ? "" : state.kind;
  const categories = kind
    ? state.settings.taxonomy?.[kind] || []
    : [...new Set(state.assets.map((asset) => asset.category).filter(Boolean))];
  els.categoryChips.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "全部分类";
  all.className = state.category ? "" : "active";
  all.addEventListener("click", () => { state.category = ""; renderCategoryChips(); resetAssetWindow(); });
  els.categoryChips.append(all);
  for (const category of categories) {
    const count = state.assets.filter((asset) => (!kind || asset.kind === kind) && asset.category === category).length;
    if (!count) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.category === category ? "active" : "";
    button.innerHTML = `<span>${escapeHtml(category)}</span><small>${count}</small>`;
    button.addEventListener("click", () => { state.category = category; renderCategoryChips(); resetAssetWindow(); });
    els.categoryChips.append(button);
  }
}

function commonCardMarkup(asset, typeLabel) {
  const tags = asset.tags.length
    ? asset.tags.map((tag) => `<span class="asset-tag">${escapeHtml(tag)}</span>`).join("")
    : `<span class="asset-tag muted">${escapeHtml(asset.category)}</span>`;
  return `<header class="asset-card-header"><div><span class="asset-format">${escapeHtml(typeLabel)}</span><h3 title="${escapeHtml(asset.name)}">${escapeHtml(asset.title)}</h3></div><details class="asset-menu"><summary aria-label="管理 ${escapeHtml(asset.name)}">•••</summary><div><button data-action="metadata" type="button">分类与标签</button><button data-action="rename" type="button">重命名</button><button data-action="move" type="button">移动到项目</button><button data-action="delete" type="button" class="danger">永久删除</button></div></details></header><div class="asset-meta"><span>${formatBytes(asset.size)}</span><span>${formatDate(asset.mtimeMs)}</span></div><div class="asset-tags">${tags}</div>`;
}

function renderTextCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card text-card";
  card.dataset.assetId = asset.id;
  card.innerHTML = `${commonCardMarkup(asset, asset.extension || "TEXT")}<div class="text-card-preview" tabindex="0">${escapeHtml(asset.preview || "暂无可预览内容")}</div><div class="card-hint">双击放大 · 卡片内可滚动</div>`;
  card.addEventListener("dblclick", (event) => {
    if (event.target.closest(".asset-menu")) return;
    openTextAsset(asset);
  });
  return card;
}

function renderImageCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card image-card";
  card.dataset.assetId = asset.id;
  card.innerHTML = `<figure class="media-frame"><img src="${asset.mediaUrl}" alt="${escapeHtml(asset.title)}" loading="lazy"><figcaption class="dimension-label">读取尺寸…</figcaption></figure>${commonCardMarkup(asset, asset.extension || "IMAGE")}`;
  const image = card.querySelector("img");
  image.addEventListener("load", () => { card.querySelector(".dimension-label").textContent = `${image.naturalWidth} × ${image.naturalHeight}`; });
  image.addEventListener("dblclick", () => openMediaLightbox(image));
  return card;
}

function renderAudioCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card audio-card";
  card.dataset.assetId = asset.id;
  card.innerHTML = `${commonCardMarkup(asset, asset.extension || "AUDIO")}<div class="audio-visual"><button class="audio-play" type="button" aria-label="播放">▶</button><div class="waveform" aria-hidden="true">${Array.from({ length: 34 }, (_, index) => `<i style="--h:${22 + ((index * 17) % 64)}%"></i>`).join("")}</div><span class="duration-label">--:--</span></div><audio src="${asset.mediaUrl}" preload="metadata"></audio><div class="card-hint">鼠标移入试听</div>`;
  const audio = card.querySelector("audio");
  const play = card.querySelector(".audio-play");
  audio.addEventListener("loadedmetadata", () => { card.querySelector(".duration-label").textContent = formatDuration(audio.duration); });
  const start = () => { audio.play().then(() => card.classList.add("playing")).catch(() => {}); };
  const stop = () => { audio.pause(); audio.currentTime = 0; card.classList.remove("playing"); };
  card.addEventListener("mouseenter", start);
  card.addEventListener("mouseleave", stop);
  play.addEventListener("click", (event) => { event.stopPropagation(); audio.paused ? start() : stop(); });
  return card;
}

function renderVideoCard(asset) {
  const card = document.createElement("article");
  card.className = "asset-card video-card";
  card.dataset.assetId = asset.id;
  card.innerHTML = `<figure class="media-frame"><video src="${asset.mediaUrl}" muted loop playsinline preload="metadata"></video><div class="video-overlay"><button class="video-fullscreen" type="button">⛶ 全屏</button><span class="duration-label">--:--</span></div></figure>${commonCardMarkup(asset, asset.extension || "VIDEO")}<div class="card-hint">鼠标移入预览</div>`;
  const video = card.querySelector("video");
  video.addEventListener("loadedmetadata", () => { card.querySelector(".duration-label").textContent = formatDuration(video.duration); });
  card.addEventListener("mouseenter", () => video.play().catch(() => {}));
  card.addEventListener("mouseleave", () => { video.pause(); video.currentTime = 0; });
  card.querySelector(".video-fullscreen").addEventListener("click", (event) => {
    event.stopPropagation();
    if (video.requestFullscreen) video.requestFullscreen();
  });
  return card;
}

function openMediaLightbox(source) {
  const overlay = document.createElement("div");
  overlay.className = "media-lightbox";
  overlay.innerHTML = `<button type="button" aria-label="关闭">×</button><img src="${source.src}" alt="${escapeHtml(source.alt)}">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.append(overlay);
}

function visibleAssets() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  const assets = state.assets.filter((asset) => {
    if (state.kind !== "all" && asset.kind !== state.kind) return false;
    if (state.category && asset.category !== state.category) return false;
    if (!query) return true;
    return [asset.name, asset.preview, asset.category, ...asset.tags].join(" ").toLocaleLowerCase("zh-CN").includes(query);
  });
  return assets.sort((a, b) => {
    if (state.sort === "oldest") return a.mtimeMs - b.mtimeMs;
    if (state.sort === "name") return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    if (state.sort === "size") return b.size - a.size;
    return b.mtimeMs - a.mtimeMs;
  });
}

function resetAssetWindow() {
  state.visibleLimit = 120;
  renderAssets();
}

function renderAssets() {
  const matchingAssets = visibleAssets();
  const assets = matchingAssets.slice(0, state.visibleLimit);
  els.assetGrid.replaceChildren();
  els.assetGrid.className = `asset-grid ${["image", "video"].includes(state.kind) ? "masonry" : ""}`;
  for (const asset of assets) {
    const renderer = { text: renderTextCard, image: renderImageCard, audio: renderAudioCard, video: renderVideoCard }[asset.kind];
    if (renderer) els.assetGrid.append(renderer(asset));
  }
  if (matchingAssets.length > assets.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "load-more-card";
    more.innerHTML = `<strong>继续加载</strong><span>已显示 ${assets.length} / ${matchingAssets.length}</span>`;
    more.addEventListener("click", () => { state.visibleLimit += 120; renderAssets(); });
    els.assetGrid.append(more);
  }
  const hasProject = Boolean(selectedProject());
  els.emptyLibraryState.hidden = Boolean(matchingAssets.length);
  els.emptyLibraryState.querySelector("h2").textContent = hasProject ? "没有符合条件的资产" : "这里还没有资产";
  els.emptyLibraryState.querySelector("p").textContent = hasProject
    ? "换一个类型、分类或搜索词，也可以重新扫描关联文件夹。"
    : "创建项目并关联一个或多个文件夹，扫描结果会自动分类。";
  els.emptyCreateProjectButton.hidden = hasProject;
  els.workspaceSubtitle.textContent = hasProject
    ? `${state.assets.length} 个本地资产 · ${selectedProject().folders.length} 个关联文件夹`
    : "关联本地文件夹后，系统会自动识别并分类资产。";
}

async function loadLibrary({ quiet = false } = {}) {
  const project = selectedProject();
  if (!project) {
    state.assets = [];
    state.counts = { all: 0, text: 0, image: 0, audio: 0, video: 0 };
    els.workspaceTitle.textContent = "选择一个项目";
    renderCategoryChips(); updateKindCounts(); resetAssetWindow();
    return;
  }
  state.busy = true;
  els.scanState.textContent = "正在扫描…";
  els.scanState.classList.add("busy");
  try {
    const data = await api(`/api/library?project=${encodeURIComponent(project.id)}`);
    state.assets = data.assets || [];
    state.counts = data.counts || state.counts;
    state.settings = data.settings || state.settings;
    state.visibleLimit = 120;
    setColumns(state.settings.columns);
    els.workspaceTitle.textContent = project.name;
    els.scanState.textContent = `已同步 ${formatDate(Date.now())}`;
    updateKindCounts(); renderCategoryChips(); renderAssets();
    if (!quiet) showToast(`已扫描 ${state.assets.length} 个资产`);
  } catch (error) {
    els.scanState.textContent = "扫描失败";
    showToast(error.message, "error");
  } finally {
    state.busy = false;
    els.scanState.classList.remove("busy");
  }
}

async function loadBootstrap() {
  try {
    const [config, projectData] = await Promise.all([api("/api/config"), api("/api/projects")]);
    state.system = config.system || state.system;
    state.settings = config.assetManager || state.settings;
    state.projects = projectData.projects || [];
    if (!state.projects.some((project) => project.id === state.selectedProject)) state.selectedProject = state.projects[0]?.id || "";
    applyPlatformProjectUi(config);
    setColumns(state.settings.columns);
    renderProjects();
    await loadLibrary({ quiet: true });
  } catch (error) {
    showToast(`资产服务不可用：${error.message}`, "error");
  }
}

async function selectProject(projectId) {
  if (state.selectedProject === projectId && state.assets.length) return;
  state.selectedProject = projectId;
  state.category = "";
  localStorage.setItem("asset-library:selected-project", projectId);
  renderProjects();
  await loadLibrary({ quiet: true });
}

function openProjectDialog(project = null) {
  state.editingProject = project;
  els.projectDialogTitle.textContent = project ? "管理本地项目" : "新建本地项目";
  els.projectNameInput.value = project?.name || "";
  els.codexNewProjectScanRoots.value = (project?.folders || []).join("\n");
  els.projectFormError.textContent = "";
  els.projectDialog.showModal();
  setTimeout(() => els.projectNameInput.focus(), 30);
}

async function saveProject(event) {
  event.preventDefault();
  const name = els.projectNameInput.value.trim();
  const folders = parseScanRoots(els.codexNewProjectScanRoots.value);
  const invalid = folders.find((folder) => !isAbsoluteProjectPath(folder, state.system.platform));
  if (!name || !folders.length || invalid) {
    els.projectFormError.textContent = invalid ? `不是有效的绝对路径：${invalid}` : "请填写项目名称和至少一个文件夹。";
    return;
  }
  els.saveProjectButton.disabled = true;
  try {
    const route = state.editingProject ? `/api/projects/${encodeURIComponent(state.editingProject.id)}` : "/api/projects";
    const data = await api(route, { method: state.editingProject ? "PATCH" : "POST", body: JSON.stringify({ name, folders }) });
    const project = data.project;
    const projectData = await api("/api/projects");
    state.projects = projectData.projects || [];
    state.selectedProject = project.id;
    localStorage.setItem("asset-library:selected-project", project.id);
    els.projectDialog.close();
    renderProjects();
    await loadLibrary();
  } catch (error) {
    els.projectFormError.textContent = error.message;
  } finally {
    els.saveProjectButton.disabled = false;
  }
}

function markdownToSafeHtml(text) {
  return escapeHtml(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

async function openTextAsset(asset) {
  state.textAsset = asset;
  els.textViewerTitle.textContent = asset.name;
  els.textViewerFormat.textContent = asset.extension || "TEXT";
  els.textViewerPreview.innerHTML = "<p>正在读取…</p>";
  els.textViewerEditor.hidden = true;
  els.textViewerPreview.hidden = false;
  els.saveTextButton.hidden = true;
  els.toggleTextEditButton.hidden = !asset.editable;
  els.toggleTextEditButton.textContent = "编辑";
  els.textSaveState.textContent = "";
  els.textViewerDialog.showModal();
  try {
    const data = await api(`/api/text?id=${encodeURIComponent(asset.id)}`);
    state.textAsset = { ...asset, content: data.content, editable: data.editable };
    els.textViewerPreview.innerHTML = markdownToSafeHtml(data.content);
    els.textViewerEditor.value = data.content;
    els.toggleTextEditButton.hidden = !data.editable;
  } catch (error) {
    els.textViewerPreview.textContent = error.message;
  }
}

function toggleTextEditor() {
  const editing = els.textViewerEditor.hidden;
  els.textViewerEditor.hidden = !editing;
  els.textViewerPreview.hidden = editing;
  els.saveTextButton.hidden = !editing;
  els.toggleTextEditButton.textContent = editing ? "预览" : "编辑";
  if (editing) els.textViewerEditor.focus();
  else els.textViewerPreview.innerHTML = markdownToSafeHtml(els.textViewerEditor.value);
}

async function saveTextAsset() {
  if (!state.textAsset) return;
  els.saveTextButton.disabled = true;
  els.textSaveState.textContent = "正在保存…";
  try {
    await api("/api/text", { method: "PUT", body: JSON.stringify({ assetId: state.textAsset.id, content: els.textViewerEditor.value }) });
    els.textSaveState.textContent = "已保存到原文件";
    showToast("文本已保存");
    await loadLibrary({ quiet: true });
  } catch (error) {
    els.textSaveState.textContent = error.message;
  } finally {
    els.saveTextButton.disabled = false;
  }
}

function assetById(id) {
  return state.assets.find((asset) => asset.id === id);
}

function openAssetAction(action, asset) {
  state.action = action;
  state.actionAsset = asset;
  els.assetActionError.textContent = "";
  els.confirmAssetAction.className = "primary-button";
  const titles = { rename: "重命名文件", move: "移动到项目", delete: "永久删除文件", metadata: "分类与标签" };
  els.assetActionTitle.textContent = titles[action];
  if (action === "rename") {
    els.assetActionFields.innerHTML = `<label>新文件名<input name="name" value="${escapeHtml(asset.name)}" required></label><p class="field-hint">文件格式不能在重命名时改变。</p>`;
  } else if (action === "move") {
    const options = state.projects.filter((project) => project.id !== state.selectedProject).map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
    els.assetActionFields.innerHTML = `<label>目标项目<select name="targetProjectId" required>${options}</select></label><p class="field-hint">只改变项目归属，不移动磁盘上的原文件。</p>`;
  } else if (action === "delete") {
    els.confirmAssetAction.className = "danger-button";
    els.assetActionFields.innerHTML = `<div class="danger-callout"><strong>这会永久删除真实文件，无法撤销。</strong><span>${escapeHtml(asset.directory)}</span></div><label>输入完整文件名确认<input name="confirmName" placeholder="${escapeHtml(asset.name)}" required autocomplete="off"></label>`;
  } else {
    const categories = state.settings.taxonomy?.[asset.kind] || [];
    const categoryOptions = categories.map((category) => `<option value="${escapeHtml(category)}" ${category === asset.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("");
    const tags = state.settings.tags.map((tag) => `<label class="check-chip"><input type="checkbox" name="tags" value="${escapeHtml(tag)}" ${asset.tags.includes(tag) ? "checked" : ""}><span>${escapeHtml(tag)}</span></label>`).join("") || "<p class=\"field-hint\">请先在设置中添加标签。</p>";
    els.assetActionFields.innerHTML = `<label>子分类<select name="category">${categoryOptions}</select></label><fieldset><legend>标签</legend><div class="check-chip-grid">${tags}</div></fieldset>`;
  }
  els.assetActionDialog.showModal();
}

async function submitAssetAction(event) {
  event.preventDefault();
  const form = new FormData(els.assetActionForm);
  const asset = state.actionAsset;
  if (!asset) return;
  els.confirmAssetAction.disabled = true;
  try {
    if (state.action === "rename") {
      await api("/api/assets/rename", { method: "POST", body: JSON.stringify({ assetId: asset.id, name: form.get("name") }) });
      showToast("文件已重命名");
    } else if (state.action === "move") {
      await api("/api/assets/assign", { method: "POST", body: JSON.stringify({ assetId: asset.id, targetProjectId: form.get("targetProjectId") }) });
      showToast("已移动项目归属，磁盘文件未移动");
    } else if (state.action === "delete") {
      await api("/api/assets/delete", { method: "DELETE", body: JSON.stringify({ assetId: asset.id, confirmName: form.get("confirmName") }) });
      showToast("真实文件已永久删除");
    } else {
      await api("/api/assets/metadata", { method: "PATCH", body: JSON.stringify({ assetId: asset.id, category: form.get("category"), tags: form.getAll("tags") }) });
      showToast("分类和标签已保存");
    }
    els.assetActionDialog.close();
    await loadLibrary({ quiet: true });
  } catch (error) {
    els.assetActionError.textContent = error.message;
  } finally {
    els.confirmAssetAction.disabled = false;
  }
}

function renderSettings() {
  els.tagManager.replaceChildren();
  for (const tag of state.settings.tags || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "removable-tag";
    chip.innerHTML = `${escapeHtml(tag)} <span>×</span>`;
    chip.addEventListener("click", () => { state.settings.tags = state.settings.tags.filter((item) => item !== tag); renderSettings(); });
    els.tagManager.append(chip);
  }
  els.taxonomyManager.replaceChildren();
  const labels = { text: "文本", image: "图片", audio: "音频", video: "视频" };
  for (const [kind, label] of Object.entries(labels)) {
    const row = document.createElement("label");
    row.innerHTML = `<span>${label}</span><input data-taxonomy-kind="${kind}" value="${escapeHtml((state.settings.taxonomy?.[kind] || []).join("、"))}" placeholder="用顿号或逗号分隔">`;
    els.taxonomyManager.append(row);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const taxonomy = {};
  document.querySelectorAll("[data-taxonomy-kind]").forEach((input) => {
    taxonomy[input.dataset.taxonomyKind] = String(input.value).split(/[、,，;；]+/u).map((item) => item.trim()).filter(Boolean);
  });
  try {
    const data = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ tags: state.settings.tags, taxonomy, columns: state.settings.columns }) });
    state.settings = data.settings;
    els.settingsDialog.close();
    renderCategoryChips(); resetAssetWindow();
    showToast("资产库设置已保存");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function bindEvents() {
  els.newProjectButton.addEventListener("click", () => openProjectDialog());
  els.emptyCreateProjectButton.addEventListener("click", () => openProjectDialog());
  els.editProjectButton.addEventListener("click", () => openProjectDialog(selectedProject()));
  els.projectForm.addEventListener("submit", saveProject);
  els.refreshLibraryButton.addEventListener("click", () => loadLibrary());
  els.settingsButton.addEventListener("click", () => { renderSettings(); els.settingsDialog.showModal(); });
  els.assetKindTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-asset-kind]");
    if (!button) return;
    state.kind = button.dataset.assetKind;
    state.category = "";
    els.assetKindTabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderCategoryChips(); resetAssetWindow();
  });
  els.librarySearchInput.addEventListener("input", () => { state.query = els.librarySearchInput.value; resetAssetWindow(); });
  els.librarySortSelect.addEventListener("change", () => { state.sort = els.librarySortSelect.value; resetAssetWindow(); });
  els.assetColumnRange.addEventListener("input", () => setColumns(els.assetColumnRange.value, true));
  els.assetGrid.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    event.preventDefault(); event.stopPropagation();
    const asset = assetById(actionButton.closest("[data-asset-id]")?.dataset.assetId);
    if (asset) openAssetAction(actionButton.dataset.action, asset);
  });
  els.assetActionForm.addEventListener("submit", submitAssetAction);
  els.toggleTextEditButton.addEventListener("click", toggleTextEditor);
  els.saveTextButton.addEventListener("click", saveTextAsset);
  els.addTagButton.addEventListener("click", () => {
    const tag = els.newTagInput.value.trim();
    if (!tag || state.settings.tags.includes(tag)) return;
    state.settings.tags.push(tag); els.newTagInput.value = ""; renderSettings();
  });
  els.settingsForm.addEventListener("submit", saveSettings);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog)?.close()));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); els.librarySearchInput.focus();
    }
  });
}

function connectEvents() {
  try {
    const events = new EventSource("/api/events");
    const refresh = () => {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(() => loadLibrary({ quiet: true }), 400);
    };
    events.addEventListener("asset-change", refresh);
    events.addEventListener("project-change", () => loadBootstrap());
    events.addEventListener("config-change", () => loadBootstrap());
  } catch {}
}

bindEvents();
loadBootstrap();
connectEvents();
