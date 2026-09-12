import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { defaults, normalizeSettings, constraints, profile, validateDraft, PROTOCOLS } from "../lib/model-arena/catalog.mjs";
import { Credentials, Provider, buildPayload, parseTask, publicUrl } from "../lib/model-arena/providers.mjs";
import { ArenaService } from "../lib/model-arena/service.mjs";
import { compositePlan } from "../lib/model-arena/media.mjs";

const draft = { models: ["seedance20", "h3", "wan3"], assetIds: [], prompt: "同一个人物走进房间", duration: 5, ratio: "16:9", generateAudio: true };
const image = i => ({ id: `image${i}`, name: `image${i}.png`, type: "image", size: 1000, width: 1024, height: 1536, duration: 0 });
function configured() { const raw = defaults(); for (const f of Object.values(raw.families)) { f.identity = { id: "test-user", name: "测试" }; if (!f.baseUrl) f.baseUrl = "https://fixture.example"; } return normalizeSettings(raw, defaults()); }

test("H3 has exactly 768P and 2K; common inputs do not force common output resolution", () => {
  const cfg = configured(); assert.deepEqual(profile("h3", cfg).resolutions, ["768P", "2K"]);
  assert.equal(cfg.models.h3.resolution, "768P"); const c = constraints(Object.keys(cfg.models), cfg);
  assert.equal(c.max, 15); assert.equal(c.images, 9); assert.equal(c.min, 4); assert.ok(!c.ratios.includes("21:9"));
  cfg.models.h3.resolution = "720p"; assert.throws(() => normalizeSettings(cfg, cfg), /分辨率/);
});
test("strict limits reject excess references, orphan mentions and unsupported per-channel resolution", () => {
  const cfg = configured(), assets = Array.from({ length: 10 }, (_, i) => image(i));
  assert.throws(() => validateDraft({ ...draft, assetIds: assets.map(a => a.id) }, cfg, assets), /最多 9/);
  assert.throws(() => validateDraft({ ...draft, prompt: "@图片1" }, cfg, []), /没有对应/);
  assert.throws(() => validateDraft({ ...draft, duration: 16 }, cfg, []), /4–15/);
  assert.throws(() => validateDraft({ ...draft, ratio: "21:9" }, cfg, []), /比例/);
  assert.deepEqual(validateDraft(draft, cfg, []).assetIds, []);
  cfg.families.seedance.protocol = "las"; cfg.models.seedance20.resolution = "1080p";
  assert.throws(() => validateDraft({ ...draft, assetIds: ["image0"] }, cfg, [image(0)]), /1080p/);
});
test("reference audio/video duration and Wan combined duration are validated", () => {
  const cfg = configured(); const video = { id: "video1", name: "a.mp4", type: "video", duration: 15, size: 1000 };
  assert.throws(() => validateDraft({ ...draft, assetIds: [video.id], models: ["wan3"], duration: 20 }, cfg, [video]), /不能超过 30/);
  assert.throws(() => validateDraft({ ...draft, assetIds: [video.id] }, cfg, [{ ...video, duration: 1 }]), /至少 2 秒/);
  assert.throws(() => validateDraft({ ...draft, assetIds: [video.id] }, cfg, [{ ...video, type: "audio" }]), /仅音频/);
});
test("normalization strips secrets and rejects optimistic write conflicts or expanded hard limits", () => {
  const cfg = configured(); cfg.apiKey = "test-key-do-not-store"; cfg.families.h3.apiKey = "private";
  assert.ok(!JSON.stringify(normalizeSettings(cfg, cfg)).includes("private"));
  assert.throws(() => normalizeSettings({ ...cfg, version: -1 }, cfg), /已变化/);
  cfg.models.h3.limits = { max: 30 }; assert.throws(() => normalizeSettings(cfg, cfg), /已验证/);
  cfg.models.h3.limits = {}; cfg.families.h3.uploadUrl = "https://another.example/upload"; assert.throws(() => normalizeSettings(cfg, cfg), /同源/);
});
test("custom adapter payload receives the original prompt and references without official field injection", () => {
  const cfg = configured(), input = { ...draft, prompt: "@图片1 走向 @图片2，@视频1 动作 @音频1" }, refs = ["a", "b"].map(x => ({ type: "image", url: `https://assets.example/${x}.png` }));
  cfg.families.h3.protocol = "fixture";
  let argumentsReceived;
  const adapters = { fixture: { buildPayload(model, config, request, references) {
    argumentsReceived = { model, config, request, references };
    return { customModel: model.apiId, originalPrompt: request.prompt, references };
  } } };
  const h3 = profile("h3", cfg), payload = buildPayload(h3, cfg.families.h3, input, refs, adapters);
  assert.equal(argumentsReceived.model, h3); assert.equal(argumentsReceived.config, cfg.families.h3);
  assert.equal(argumentsReceived.request, input); assert.equal(argumentsReceived.references, refs);
  assert.deepEqual(payload, { customModel: h3.apiId, originalPrompt: input.prompt, references: refs });
  assert.ok(!("content" in payload)); assert.ok(!("generate_audio" in payload));
});
test("official contracts use typed content versus DashScope input/parameters, without mixing fields", () => {
  const cfg = configured(), refs = [{ type: "image", url: "https://asset.example/a.png" }];
  cfg.families.h3.protocol = "minimax"; cfg.models.h3.resolution = "2K";
  const h3 = buildPayload(profile("h3", cfg), cfg.families.h3, draft, refs); assert.equal(h3.resolution, "2K"); assert.equal(h3.content[1].role, "reference_image"); assert.ok(!("prompt" in h3));
  cfg.families.wan.protocol = "dashscope"; const wan = buildPayload(profile("wan3", cfg), cfg.families.wan, draft, refs); assert.equal(wan.parameters.resolution, "720P"); assert.equal(wan.input.media[0].type, "reference_image");
  cfg.families.seedance.protocol = "las"; const seed = buildPayload(profile("seedance20", cfg), cfg.families.seedance, draft, refs); assert.ok(seed.generate_audio); assert.equal(seed.ratio, "16:9");
});
test("status parsing extracts official task ids and delegates custom response structures", () => {
  const adapters = { fixture: { parseTask(raw, { creating }) { assert.equal(creating, true); return { id: raw.job.identifier, state: "running", url: "" }; } } };
  assert.equal(parseTask("fixture", { job: { identifier: "one" } }, { creating: true, adapters }).id, "one");
  assert.equal(parseTask("minimax", { task: { task_id: "two", status: "succeeded", content: { url: "https://cdn.example/a.mp4" } } }).state, "succeeded");
  assert.equal(parseTask("las", { id: "three", status: "succeeded", content: { video_url: "https://cdn.example/b.mp4" } }).url, "https://cdn.example/b.mp4");
  assert.equal(parseTask("dashscope", { output: { task_id: "four", task_status: "FAILED" } }).state, "failed");
  assert.throws(() => parseTask("las", {}, { creating: true }), /任务 ID/);
});
test("credentials remain in memory or canonical key file; no generic section key / forbidden provider", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-keys-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "keys.md"); await writeFile(file, "| Example | FIXTURE_API_KEY | `fixture-key` | generation |\n## 七牛\nGEMINI_API_KEY=forbidden-key\n");
  const protocols = { ...PROTOCOLS, fixture: { credentialOrigin: "https://api.example", credentialNames: ["FIXTURE_API_KEY"] } };
  const c = new Credentials({ env: {}, keyFile: file, protocols }), config = { baseUrl: "https://api.example", protocol: "fixture", credentialName: "FIXTURE_API_KEY" };
  assert.equal(await c.get("wan", config), "fixture-key");
  assert.equal(await c.get("wan", { ...config, credentialName: "" }), "fixture-key");
  await assert.rejects(c.get("wan", { ...config, credentialName: "", baseUrl: "https://custom.example" }), /缺少凭证/);
  await assert.rejects(c.get("wan", { ...config, credentialName: "", protocol: "dashscope" }), /缺少凭证/);
  c.setSession("h3", config, "session-test-key"); assert.equal(await c.get("h3", config), "session-test-key");
  await assert.rejects(c.get("h3", { ...config, credentialName: "GEMINI_API_KEY", baseUrl: "https://official.example" }), /缺少凭证/);
  assert.throws(() => publicUrl("https://qnaigc.example/a")); assert.throws(() => publicUrl("https://127.0.0.1/a"));
});
test("official video references preflight before upload and generation; provider POST is not retried", async () => {
  let calls = 0;
  const p = new Provider({ credentials: { get: async () => "fake-test-key" }, fetcher: async () => { calls++; throw new Error("timeout"); } });
  const cfg = configured(); cfg.families.seedance.protocol = "las"; cfg.families.seedance.baseUrl = "https://official.example";
  const model = profile("seedance20", cfg);
  await assert.rejects(p.preflight(model, cfg.families.seedance, [{ type: "video" }]), /公网素材/); assert.equal(calls, 0);
  await assert.rejects(p.submit(model, cfg.families.seedance, draft, []), /连接/); assert.equal(calls, 1);
});
test("custom preflight, headers and live-check hooks run with injected fetch before any billed POST", async () => {
  const calls = [], cfg = configured(); cfg.families.h3 = { ...cfg.families.h3, protocol: "fixture", baseUrl: "https://api.example" };
  const model = profile("h3", cfg), assets = [image(0)];
  const adapters = { fixture: {
    headers(key, receivedModel, config) { assert.equal(receivedModel, model); assert.equal(config, cfg.families.h3); return { "X-Fixture-Key": key }; },
    preflight(receivedModel, config, receivedAssets) { assert.equal(receivedModel, model); assert.equal(config, cfg.families.h3); assert.equal(receivedAssets, assets); calls.push("preflight"); },
    async liveCheck(receivedModel, config, request, sdk) {
      assert.equal(receivedModel, model); assert.equal(request, draft);
      const response = await sdk.requestJson(`${config.baseUrl}/capabilities`, { headers: sdk.headers, fetcher: sdk.fetcher });
      if (!response.resolutions.includes(receivedModel.resolution)) throw new Error("Fixture 不支持 768P");
    },
  } };
  const p = new Provider({ adapters, protocols: { ...PROTOCOLS, fixture: { create: "/generate", status: "/tasks/{id}" } },
    credentials: { get: async () => "test-key" }, fetcher: async (url, options) => {
      calls.push(options.method || "GET"); assert.equal(url, "https://api.example/capabilities"); assert.equal(options.headers["X-Fixture-Key"], "test-key");
      return new Response(JSON.stringify({ resolutions: ["2K"] }));
    } });
  assert.deepEqual(await p.headers(model, cfg.families.h3), { "X-Fixture-Key": "test-key" });
  await p.preflight(model, cfg.families.h3, assets);
  await assert.rejects(p.liveCheck(model, cfg.families.h3, draft), /不支持 768P/);
  assert.deepEqual(calls, ["preflight", "GET"]);
});
test("composite plan provides bounded labeled mute-ready same-screen grid and optional sequence", () => {
  const inputs = Array.from({ length: 6 }, (_, i) => ({ label: `Model ${i}`, duration: 5 + i }));
  const p = compositePlan(inputs); assert.equal(p.duration, 5); assert.equal(p.width, 1920); assert.match(p.filter, /xstack=inputs=6/); assert.match(p.filter, /overlay=/);
  assert.equal(compositePlan(inputs, "sequence").duration, 45); assert.throws(() => compositePlan(inputs, "other"));
});

async function setup(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "arena-service-")); const calls = [];
  const provider = { credentials: { setSession() {} }, preflight: async () => {}, liveCheck: async () => {}, upload: async (_, __, asset) => { calls.push("upload"); return `https://assets.example/${asset.id}`; },
    submit: async model => { calls.push(`submit:${model.id}`); return { id: `task-${model.id}` }; }, poll: async () => ({ state: "running" }), ...overrides };
  const service = new ArenaService({ root, provider, interval: 1000000 }); await service.ready;
  t.after(async () => { await service.close(); for (let i = 0; service.busy && i < 100; i++) await delay(5); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  await service.saveSettings({ ...configured(), version: 0 }); return { root, service, provider, calls };
}
async function settle(service) { for (let i = 0; i < 200; i++) { if (!service.busy) { await delay(5); if (!service.busy) return; } await delay(5); } throw new Error("service did not settle"); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); } throw new Error("condition did not settle"); }
test("preview never submits; confirmation is idempotent and frozen across repeated clicks", async t => {
  const { service, calls } = await setup(t); const preview = await service.preview(draft); assert.equal(calls.length, 0);
  const body = { token: preview.token, fingerprint: preview.fingerprint };
  const [first, second] = await Promise.all([service.confirm(body), service.confirm(body)]); assert.equal(first.id, second.id); await settle(service);
  assert.equal(calls.filter(x => x.startsWith("submit:")).length, 3);
  const again = await service.confirm(body); assert.equal(again.id, first.id); assert.equal(calls.length, 3);
  assert.ok(!JSON.stringify(await service.snapshot()).includes("confirmToken"));
});
test("settings revision invalidates a preview without starting generation", async t => {
  const { service, calls } = await setup(t); const preview = await service.preview(draft);
  await service.saveSettings({ ...service.settings }); await assert.rejects(service.confirm({ token: preview.token, fingerprint: preview.fingerprint }), /过期/); assert.equal(calls.length, 0);
});
for (const stage of ["run", "index"]) test(`confirmation ${stage} persistence failure leaves no executable or restorable task`, async t => {
  const { service, root, calls, provider } = await setup(t), write = service.writeJson.bind(service);
  const preview = await service.preview(draft), body = { token: preview.token, fingerprint: preview.fingerprint };
  let injected = false;
  service.writeJson = async (file, value) => {
    if (!injected && (stage === "index" ? file === "runs.json" : file.startsWith("runs/"))) { injected = true; throw new Error("fixture disk failure"); }
    return write(file, value);
  };
  await assert.rejects(service.confirm(body), /fixture disk failure/);
  assert.ok(injected); assert.equal(service.runs.size, 0); assert.deepEqual(service.index, []);
  assert.deepEqual(await readdir(path.join(root, "runs")), []);
  await service.tick(); assert.equal(calls.length, 0);
  const restored = new ArenaService({ root, provider, interval: 1000000 }); await restored.ready;
  try { await restored.tick(); assert.equal(restored.runs.size, 0); assert.equal(calls.length, 0); } finally { await restored.close(); }
  // Retrying the still-valid confirmation creates one durable run, not a
  // second runnable copy left behind by the failed transaction.
  await service.confirm(body); await settle(service); assert.equal(service.runs.size, 1); assert.equal(calls.length, 3);
});
test("worker claim persistence failure stops every unsubmitted job before a billed POST", async t => {
  const { service, calls } = await setup(t); service.busy = true;
  const preview = await service.preview({ ...draft, models: Object.keys(service.settings.models) });
  const result = await service.confirm({ token: preview.token, fingerprint: preview.fingerprint }); await delay(0);
  const write = service.writeJson.bind(service); let injected = false;
  service.writeJson = async (file, value) => {
    if (!injected && file.startsWith("runs/") && value.jobs.some(j => j.state === "submitting")) { injected = true; throw new Error("fixture claim failure"); }
    return write(file, value);
  };
  service.busy = false; await assert.rejects(service.tick(), /fixture claim failure/);
  assert.equal(calls.length, 0); assert.ok(service.runs.get(result.id).jobs.every(j => j.state === "failed"));
  await service.tick(); assert.equal(calls.length, 0); assert.equal(service.busy, false);
});
test("worker result persistence failure retains busy until all concurrent submissions finish, without duplicates", async t => {
  const releases = new Map(), submitted = [];
  const { service, root } = await setup(t, { submit: async model => {
    submitted.push(model.id); const gate = deferred(); releases.set(model.id, gate); await gate.promise; return { id: `task-${model.id}` };
  } });
  service.busy = true;
  const preview = await service.preview({ ...draft, models: Object.keys(service.settings.models) });
  const result = await service.confirm({ token: preview.token, fingerprint: preview.fingerprint }); await delay(0);
  const write = service.writeJson.bind(service); let injected = false;
  service.writeJson = async (file, value) => {
    if (!injected && file.startsWith("runs/") && value.jobs.some(j => j.taskId)) { injected = true; throw new Error("fixture result failure"); }
    return write(file, value);
  };
  service.busy = false; const work = service.tick(); work.catch(() => {});
  try {
    await until(() => releases.size === 3); releases.get(submitted[0]).resolve(); await until(() => injected);
    await delay(10); assert.equal(service.busy, true);
    await service.tick(); assert.equal(submitted.length, 3, "second tick must not enter the existing worker pool");
    for (const gate of releases.values()) gate.resolve();
    await assert.rejects(work, /fixture result failure/);
    assert.equal(service.busy, false); assert.equal(new Set(submitted).size, 3);
    assert.equal(service.runs.get(result.id).jobs.filter(j => j.state === "failed").length, 3);
    await service.tick(); assert.equal(submitted.length, 3);
    const saved = JSON.parse(await readFile(path.join(root, "runs", `${result.id}.json`), "utf8"));
    assert.equal(saved.jobs.filter(j => j.taskId).length, 3); assert.equal(saved.jobs.filter(j => j.state === "failed").length, 3);
  } finally { for (const gate of releases.values()) gate.resolve(); await work.catch(() => {}); }
});
test("credential changes invalidate completed and in-flight previews, and cannot replace a confirmed pending identity", async t => {
  const { service, provider, calls } = await setup(t); let keysSet = 0; provider.credentials.setSession = () => { keysSet++; };
  const preview = await service.preview(draft);
  await service.setCredential("h3", "fixture-session-key");
  await assert.rejects(service.confirm({ token: preview.token, fingerprint: preview.fingerprint }), /过期/);
  const check = deferred(), started = deferred(); provider.liveCheck = async () => { started.resolve(); await check.promise; };
  const inFlight = service.preview({ ...draft, models: ["h3"] }); await started.promise;
  await service.setCredential("h3", "fixture-replacement-key"); check.resolve(); await assert.rejects(inFlight, /凭证已更改/);
  provider.liveCheck = async () => {}; const fresh = await service.preview({ ...draft, models: ["h3"] }); service.busy = true;
  const [confirmation, replacement] = await Promise.allSettled([
    service.confirm({ token: fresh.token, fingerprint: fresh.fingerprint }), service.setCredential("h3", "fixture-third-key")
  ]);
  assert.equal(confirmation.status, "fulfilled"); assert.equal(replacement.status, "rejected"); assert.match(replacement.reason.message, /待提交任务/);
  assert.equal(keysSet, 2); assert.equal(calls.length, 0);
  service.busy = false; await service.tick(); assert.equal(calls.length, 1);
  await service.setCredential("h3", "fixture-third-key"); assert.equal(keysSet, 3);
});
test("composite initial persistence failure rolls back the prior result and releases its lock", async t => {
  const { service } = await setup(t); service.busy = true;
  const preview = await service.preview(draft), result = await service.confirm({ token: preview.token, fingerprint: preview.fingerprint }); await delay(0);
  const run = service.runs.get(result.id), prior = { state: "failed", mode: "sequence", error: "previous" };
  run.composite = prior;
  for (const job of run.jobs) { job.state = "succeeded"; job.output = { id: job.id, file: `${job.id}.mp4`, type: "video", duration: 5, size: 100 }; }
  let composed = 0; service.compose = async () => { composed++; return { type: "video", duration: 5, size: 100 }; };
  const write = service.writeJson.bind(service); let injected = false;
  service.writeJson = async (file, value) => { if (!injected) { injected = true; throw new Error("fixture composite failure"); } return write(file, value); };
  await assert.rejects(service.composite(run.id, run.jobs.slice(0, 2).map(j => j.id)), /fixture composite failure/);
  assert.equal(service.composing, false); assert.equal(run.composite, prior); assert.equal(composed, 0);
  await service.composite(run.id, run.jobs.slice(0, 2).map(j => j.id)); await until(() => !service.composing);
  assert.equal(composed, 1); assert.equal(run.composite.state, "succeeded"); service.busy = false;
});
test("ambiguous creation is never retried and restart preserves uncertainty", async t => {
  const { service, root, calls, provider } = await setup(t, { submit: async () => { calls.push("uncertain"); throw new Error("timeout"); } });
  const preview = await service.preview({ ...draft, models: ["h3"] }); await service.confirm({ token: preview.token, fingerprint: preview.fingerprint }); await settle(service);
  assert.equal([...service.runs.values()][0].jobs[0].state, "submit_unknown"); await service.tick(); assert.equal(calls.length, 1);
  const restored = new ArenaService({ root, provider, interval: 1000000 }); await restored.ready; t.after(() => restored.close()); await restored.tick(); assert.equal(calls.length, 1);
  assert.equal((await restored.snapshot()).runs[0].jobs[0].state, "submit_unknown");
});
test("lost task-id response can be reconciled only to an explicit existing platform task", async t => {
  const { service, calls } = await setup(t, { submit: async () => { calls.push("uncertain"); throw new Error("timeout"); } });
  const preview = await service.preview({ ...draft, models: ["h3"] }); const run = await service.confirm({ token: preview.token, fingerprint: preview.fingerprint }); await settle(service);
  const job = service.runs.get(run.id).jobs[0]; await assert.rejects(service.recover(run.id, job.id, ""), /实际任务 ID/);
  await service.recover(run.id, job.id, "platform-existing-123"); await service.tick(); assert.equal(calls.length, 1); assert.equal(job.taskId, "platform-existing-123");
});
test("chunk offsets and completion prevent partial asset imports", async t => {
  const { service } = await setup(t); const upload = await service.beginUpload({ name: "test.png", size: 8 });
  await assert.rejects(service.uploadChunk(upload.id, { offset: 5, data: "dGVzdA==" }), /偏移/);
  await service.uploadChunk(upload.id, { offset: 0, data: "dGVzdA==" });
  await assert.rejects(service.finishUpload(upload.id), /尚未完成/);
  assert.equal(service.assets.length, 0);
});
