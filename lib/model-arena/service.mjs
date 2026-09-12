import { mkdir, readFile, writeFile, rename, copyFile, unlink, appendFile, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { defaults, normalizeSettings, profile, validateDraft, MODELS } from "./catalog.mjs";
import { Provider, buildPayload, publicUrl } from "./providers.mjs";
import { mediaType, inspectMedia, MAX_IMPORT_BYTES, downloadVideo, composeVideos } from "./media.mjs";
import { mergeArenaExtension } from "./local-extension.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const idValid = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pending = new Set(["queued", "uploading", "running", "downloading"]);
export class ArenaService {
  constructor({ root, extension = {}, provider, inspect = inspectMedia, download = downloadVideo, compose = composeVideos, interval = 10000 } = {}) {
    this.catalog = mergeArenaExtension(extension);
    this.root = root; this.provider = provider || new Provider({ protocols: this.catalog.protocols, adapters: this.catalog.adapters }); this.inspect = inspect; this.download = download; this.compose = compose; this.interval = interval;
    this.previews = new Map(); this.uploads = new Map(); this.busy = false; this.composing = false; this.credentialRevision = 0; this.writeQueue = Promise.resolve(); this.actionQueue = Promise.resolve();
    this.ready = this.init();
  }
  async init() {
    await mkdir(path.join(this.root, "media"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, "runs"), { recursive: true, mode: 0o700 });
    this.settings = await this.readJson("settings.json", defaults(this.catalog));
    this.checkProtocols(this.settings.families);
    this.assets = await this.readJson("assets.json", []);
    this.index = await this.readJson("runs.json", []);
    this.runs = new Map();
    for (const entry of this.index) {
      if (!idValid(entry.id)) continue;
      const run = await this.readJson(`runs/${entry.id}.json`, null); if (!run) continue;
      for (const job of run.jobs) {
        if (["queued", "uploading", "submitting", "running", "downloading", "submit_unknown", "poll_paused", "download_failed"].includes(job.state)) this.checkProtocols({ [job.model.family]: job.config });
        if (job.state === "submitting") { job.state = "submit_unknown"; job.error = "服务重启前正在提交，请核对平台任务 ID，不会自动重发"; }
        if (job.state === "uploading") job.state = "queued";
        if (job.state === "downloading") job.state = "running";
      }
      if (run.composite?.state === "working") { run.composite.state = "failed"; run.composite.error = "合成被服务重启中断，可重新合成"; }
      this.runs.set(run.id, run);
    }
    this.timer = setInterval(() => this.tick().catch(() => {}), this.interval); this.timer.unref?.();
    return this;
  }
  checkProtocols(families) {
    if (!families || typeof families !== "object") throw new Error("竞技场配置无法读取，不会覆盖原记录");
    for (const [family, config] of Object.entries(families)) {
      if (!this.catalog.protocols[config?.protocol]?.families.includes(family)) throw new Error("已有生成通道的本机适配器未加载或不匹配；配置与任务保留，不会切换到其他通道");
    }
  }
  async readJson(file, fallback) {
    try { return JSON.parse(await readFile(path.join(this.root, file), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return fallback; throw new Error("竞技场本地状态无法读取，请保留文件并检查，不会覆盖原记录"); }
  }
  writeJson(file, value) {
    const body = JSON.stringify(value, null, 2);
    const op = this.writeQueue.then(async () => {
      const destination = path.join(this.root, file), temp = destination + "." + randomUUID() + ".tmp";
      await writeFile(temp, body, { mode: 0o600, flag: "wx" });
      try { for (let attempt = 0;; attempt++) {
        try { await rename(temp, destination); break; } catch (error) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5) throw error;
          await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
        }
      } } finally { await unlink(temp).catch(() => {}); }
    });
    this.writeQueue = op.catch(() => {}); return op;
  }
  serial(action) { const work = this.actionQueue.then(action); this.actionQueue = work.catch(() => {}); return work; }
  assetPath(asset) { return path.join(this.root, "media", asset.file); }
  internalAsset(asset) { return { ...asset, path: this.assetPath(asset) }; }
  publicAsset(asset) { const { file, remoteUrl, ...safe } = asset; return { ...safe, hasRemoteUrl: Boolean(remoteUrl), mediaUrl: `media/${asset.id}` }; }
  publicRun(run) {
    return { id: run.id, createdAt: run.createdAt, updatedAt: run.updatedAt, threadId: run.threadId, threadTitle: run.threadTitle, draft: run.draft,
      jobs: run.jobs.map(({ model, id, state, taskId, error, output, pollFailures }) => ({ id, model: model.name, modelId: model.id, resolution: model.resolution, state, taskId, error, pollFailures,
        ...(output ? { output: this.publicAsset(output) } : {}) })),
      composite: run.composite ? { state: run.composite.state, mode: run.composite.mode, error: run.composite.error,
        ...(run.composite.output ? { output: this.publicAsset(run.composite.output) } : {}) } : null };
  }
  async snapshot({ offset = 0 } = {}) { await this.ready;
    const start = Math.max(0, Math.floor(Number(offset) || 0)), all = [...this.runs.values()].reverse();
    return { settings: clone(this.settings), models: MODELS, protocols: clone(this.catalog.protocols),
      assets: this.assets.map(a => this.publicAsset(a)), runs: all.slice(start, start + 50).map(r => this.publicRun(r)),
      runPage: { total: all.length, nextOffset: start + 50 < all.length ? start + 50 : null } };
  }
  async saveSettings(raw) { await this.ready; return this.serial(async () => {
    const result = normalizeSettings(raw, this.settings, this.catalog); await this.writeJson("settings.json", result); this.settings = result;
    this.previews.clear(); return clone(result);
  }); }
  async setCredential(family, key) { await this.ready; return this.serial(async () => {
    if (!this.settings.families[family]) throw new Error("未知 API 分组");
    // Queued and in-flight submissions must keep the billing identity confirmed
    // by the user. Session secrets remain in memory, never in the run record.
    if ([...this.runs.values()].some(run => run.jobs.some(job => job.model.family === family && ["queued", "uploading", "submitting"].includes(job.state)))) {
      throw new Error("该 API 分组还有待提交任务，请等待提交结束后再更换凭证");
    }
    this.provider.credentials.setSession(family, this.settings.families[family], key);
    this.credentialRevision++; this.previews.clear(); return { ok: true };
  }); }
  async beginUpload({ name, size }) { await this.ready; mediaType(name);
    for (const [id, item] of this.uploads) if (Date.now() - item.at > 30 * 60000) { this.uploads.delete(id); await unlink(item.path).catch(() => {}); }
    if (this.uploads.size >= 12 || !Number.isInteger(size) || size < 1 || size > MAX_IMPORT_BYTES) throw new Error("上传最多 100 MB，或上传队列已满");
    const id = randomUUID(), file = path.join(this.root, "media", id + ".upload");
    const safeName = path.basename(String(name)).replace(/[\r\n\x00-\x1f]/g, "").slice(0, 200);
    await writeFile(file, "", { mode: 0o600, flag: "wx" }); this.uploads.set(id, { path: file, name: safeName, size, offset: 0, at: Date.now() }); return { id };
  }
  async uploadChunk(id, { offset, data }) { return this.serial(async () => {
    const entry = this.uploads.get(id); if (!entry) throw new Error("上传已过期");
    if (typeof data !== "string" || data.length > 400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("上传分片无效");
    const chunk = Buffer.from(data, "base64");
    if (offset !== entry.offset || !chunk.length || entry.offset + chunk.length > entry.size) throw new Error("上传偏移或大小不匹配");
    await appendFile(entry.path, chunk); entry.offset += chunk.length; entry.at = Date.now(); return { offset: entry.offset };
  }); }
  async finishUpload(id) { return this.serial(async () => {
    const entry = this.uploads.get(id); if (!entry || entry.offset !== entry.size) throw new Error("上传尚未完成");
    try { return await this.importFile(entry.path, entry.name); }
    finally { this.uploads.delete(id); await unlink(entry.path).catch(() => {}); }
  }); }
  async importFile(source, name = path.basename(source)) {
    await this.ready;
    if (this.assets.length >= 500) throw new Error("本机竞技场素材已达 500 个，请先清理不再使用的素材");
    const meta = await this.inspect(source, name);
    const known = this.assets.find(a => a.sha256 === meta.sha256 && a.type === meta.type);
    if (known && await stat(this.assetPath(known)).then(s => s.size === known.size, () => false)) return this.publicAsset(known);
    const id = randomUUID(), file = id + meta.ext;
    await copyFile(source, path.join(this.root, "media", file));
    // Source may change during an import. Verify the immutable copy before using it.
    const copied = await this.inspect(path.join(this.root, "media", file), name);
    if (copied.sha256 !== meta.sha256) { await unlink(path.join(this.root, "media", file)); throw new Error("源素材在导入中发生变化，请重试"); }
    const asset = { id, file, name: path.basename(name).slice(0, 200), ...meta, createdAt: now() };
    this.assets.push(asset); await this.writeJson("assets.json", this.assets); return this.publicAsset(asset);
  }
  async setAssetUrl(id, url) { await this.ready; return this.serial(async () => {
    const asset = this.assets.find(a => a.id === id); if (!asset) throw new Error("素材不存在");
    if (url && new URL(publicUrl(url)).search) throw new Error("持久素材地址不应携带密钥或签名；请使用公开只读 URL 或上传服务");
    asset.remoteUrl = url ? publicUrl(url) : ""; await this.writeJson("assets.json", this.assets); this.previews.clear(); return this.publicAsset(asset);
  }); }
  async preview(raw) {
    await this.ready;
    const settings = clone(this.settings), credentialRevision = this.credentialRevision;
    const assets = (raw.assetIds || []).map(id => this.assets.find(a => a.id === id)).filter(Boolean).map(a => this.internalAsset(a));
    const draft = validateDraft(raw, settings, assets);
    draft.projectName = String(raw.threadTitle || "模型竞技场").slice(0, 150);
    const jobs = draft.models.map(id => ({ model: profile(id, settings), config: settings.families[profile(id, settings).family] }));
    for (const job of jobs) { await this.provider.preflight(job.model, job.config, assets); await this.provider.liveCheck(job.model, job.config, draft); }
    if (settings.version !== this.settings.version || credentialRevision !== this.credentialRevision) throw new Error("配置或凭证已更改，请重新预览");
    const token = randomUUID(); const item = { token, at: Date.now(), settings, credentialRevision, draft, assets: assets.map(({ path: _, ...a }) => a),
      threadId: String(raw.threadId || "").slice(0, 160), threadTitle: String(raw.threadTitle || "").slice(0, 300), jobs };
    item.fingerprint = fingerprint(item);
    if (this.previews.size > 10) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(token, item);
    return { token, fingerprint: item.fingerprint, count: jobs.length, expiresAt: new Date(item.at + 10 * 60000).toISOString(),
      requests: jobs.map(job => ({ model: job.model.name, host: job.config.baseUrl, protocol: this.catalog.protocols[job.config.protocol].name,
        payload: buildPayload(job.model, job.config, draft, assets.map((a, i) => ({ type: a.type, url: `<素材${i + 1}:${a.name}>` })), this.provider.adapters || this.catalog.adapters) })),
      assets: assets.map(a => this.publicAsset(a)), note: "确认后上传所选素材并创建这些任务，可能产生费用。提交结果不确定时不会自动重发。" };
  }
  async confirm({ token, fingerprint: submittedFingerprint }) { await this.ready; return this.serial(async () => {
    const existing = [...this.runs.values()].find(r => r.confirmToken === token); if (existing) return this.publicRun(existing);
    const item = this.previews.get(token);
    if (!item || item.fingerprint !== submittedFingerprint || Date.now() - item.at > 10 * 60000 || item.settings.version !== this.settings.version || item.credentialRevision !== this.credentialRevision) throw new Error("预览已过期或配置已变化，请重新预览后确认");
    for (const a of item.assets) { const metadata = await this.inspect(this.assetPath(a), a.name); if (metadata.sha256 !== a.sha256) throw new Error("素材已变化，请重新导入"); }
    const run = { id: randomUUID(), confirmToken: token, createdAt: now(), updatedAt: now(), threadId: item.threadId, threadTitle: item.threadTitle,
      draft: item.draft, assets: item.assets, jobs: item.jobs.map(job => ({ ...job, id: randomUUID(), state: "queued", taskId: "", error: "", pollFailures: 0 })) };
    const index = [...this.index, { id: run.id, createdAt: run.createdAt }];
    try {
      await this.saveRun(run); await this.writeJson("runs.json", index);
    } catch (error) {
      // A run file written before a failed index commit is not executable. The
      // loader only follows runs.json, so even a cleanup failure stays inert.
      await unlink(path.join(this.root, "runs", `${run.id}.json`)).catch(() => {});
      throw error;
    }
    this.index = index; this.runs.set(run.id, run); this.previews.delete(token);
    queueMicrotask(() => this.tick().catch(() => {})); return this.publicRun(run);
  }); }
  async saveRun(run) { run.updatedAt = now(); await this.writeJson(`runs/${run.id}.json`, run); }
  async tick() {
    await this.ready; if (this.busy || this.closed) return; this.busy = true;
    try {
      for (const run of this.runs.values()) {
        const queued = run.jobs.filter(j => j.state === "queued");
        // Upload every channel before creating the first paid task. Cache by
        // family within the immutable run, not globally across credentials.
        if (queued.length) {
          const refs = new Map(); let preparationError = "";
          try {
            for (const job of queued) {
              await this.provider.preflight(job.model, job.config, run.assets.map(a => this.internalAsset(a)));
              const key = job.model.family;
              if (!refs.has(key)) {
                job.state = "uploading"; await this.saveRun(run);
                const list = [];
                for (const asset of run.assets) list.push({ type: asset.type, url: await this.provider.upload(job.model, job.config, this.internalAsset(asset)) });
                refs.set(key, list);
              }
            }
          } catch (error) { preparationError = error.message; }
          if (preparationError) {
            for (const job of queued) { job.state = "failed"; job.error = "提交前检查/素材上传失败，未生成：" + preparationError; } await this.saveRun(run);
          } else {
            let next = 0, stopped = false;
            const worker = async () => { while (!stopped && next < queued.length) {
              const job = queued[next++]; job.state = "submitting";
              try { await this.saveRun(run); }
              catch (error) {
                stopped = true; job.state = "failed"; job.error = "任务保存失败，未提交生成，请检查本地存储"; throw error;
              }
              // Another worker may have failed its durable state transition
              // while this one was waiting in the serialized write queue.
              if (stopped) { job.state = "failed"; job.error = "本地保存失败，已停止后续提交，未生成"; return; }
              try { const result = await this.provider.submit(job.model, job.config, run.draft, refs.get(job.model.family)); job.taskId = result.id; job.state = "running"; }
              catch (error) { job.state = "submit_unknown"; job.error = "提交结果待核对，不会自动重发。" + error.message; }
              try { await this.saveRun(run); } catch (error) { stopped = true; throw error; }
            } };
            // Keep busy until every in-flight POST has settled. Promise.all
            // would release it on the first disk error and permit a second tick
            // to claim work still owned by the surviving workers.
            const results = await Promise.allSettled(Array.from({ length: Math.min(3, queued.length) }, worker));
            if (stopped) {
              for (const job of queued.slice(next)) { job.state = "failed"; job.error = "本地保存失败，已停止后续提交，未生成"; }
              await this.saveRun(run);
              throw results.find(result => result.status === "rejected").reason;
            }
          }
        }
        for (const job of run.jobs.filter(j => j.state === "running" && (!j.nextPollAt || j.nextPollAt <= Date.now()))) {
          try {
            const result = await this.provider.poll(job.model, job.config, job.taskId); job.pollFailures = 0; job.error = "";
            if (result.state === "failed") { job.state = "failed"; job.error = "平台任务失败，请在平台核对原因；未自动重试生成"; }
            if (result.state === "succeeded") {
              if (!result.url) { job.state = "download_failed"; job.error = "平台已完成但没有可下载视频地址"; }
              else {
                job.state = "downloading"; await this.saveRun(run);
                const id = randomUUID(), file = id + ".mp4";
                try { const meta = await this.download(result.url, path.join(this.root, "media", file));
                  job.output = { id, file, name: `${job.model.name}-${run.id.slice(0, 8)}.mp4`, ...meta }; job.state = "succeeded";
                } catch { job.state = "download_failed"; job.error = "结果下载失败，点击仅重试下载；不会重复生成"; }
              }
            }
          } catch { job.pollFailures++; job.error = "状态查询暂不可用，已保存任务 ID；查询会退避重试";
            if (job.pollFailures >= 12) { job.state = "poll_paused"; job.error = "多次查询失败，已暂停；可点击恢复查询，不会重复生成"; } }
          job.nextPollAt = Date.now() + Math.min(120000, this.interval * 2 ** Math.min(job.pollFailures, 4)); await this.saveRun(run);
        }
      }
    } finally { this.busy = false; }
  }
  async recover(runId, jobId, taskId = "") { await this.ready; return this.serial(async () => {
    const run = this.runs.get(runId), job = run?.jobs.find(j => j.id === jobId); if (!job) throw new Error("任务不存在");
    if (!["submit_unknown", "download_failed", "poll_paused"].includes(job.state)) throw new Error("此任务无需恢复");
    if (job.state === "submit_unknown") { if (!/^[\w.:-]{1,256}$/.test(taskId)) throw new Error("请填写平台实际任务 ID"); job.taskId = taskId; }
    job.state = "running"; job.pollFailures = 0; job.nextPollAt = 0; job.error = ""; await this.saveRun(run); return this.publicRun(run);
  }); }
  async composite(runId, jobIds, mode = "grid") { await this.ready;
    if (this.composing) throw new Error("已有视频正在合成，请等待完成");
    const run = this.runs.get(runId); if (!run) throw new Error("任务不存在");
    if (!Array.isArray(jobIds) || new Set(jobIds).size !== jobIds.length || jobIds.length < 2 || jobIds.length > 6 || !["grid", "sequence"].includes(mode)) throw new Error("请选择 2–6 个已完成视频和有效布局");
    const inputs = jobIds.map(id => run.jobs.find(j => j.id === id)); if (inputs.some(j => j?.state !== "succeeded" || !j.output)) throw new Error("仅可合成已完成视频");
    const previous = run.composite;
    this.composing = true; run.composite = { state: "working", mode };
    try { await this.saveRun(run); }
    catch (error) { run.composite = previous; this.composing = false; throw error; }
    const work = async () => {
      try { const id = randomUUID(), file = id + ".mp4";
        const metadata = await this.compose(inputs.map(j => ({ ...this.internalAsset(j.output), label: j.model.name })), path.join(this.root, "media", file), mode);
        run.composite = { state: "succeeded", mode, output: { id, file, name: `模型竞技场-${mode}-${run.id.slice(0, 8)}.mp4`, ...metadata } };
      } catch (error) { run.composite = { state: "failed", mode, error: error.message }; }
      finally { try { await this.saveRun(run); } finally { this.composing = false; } }
    };
    queueMicrotask(() => work().catch(() => {})); return this.publicRun(run);
  }
  async media(id) { await this.ready; if (!idValid(id)) throw new Error("媒体 ID 无效");
    const asset = this.assets.find(a => a.id === id) || [...this.runs.values()].flatMap(r => [...r.jobs.map(j => j.output), r.composite?.output]).find(a => a?.id === id);
    if (!asset) throw new Error("媒体不存在"); return this.internalAsset(asset);
  }
  async close() { this.closed = true; await this.ready.catch(() => {}); clearInterval(this.timer); await this.writeQueue; }
}
