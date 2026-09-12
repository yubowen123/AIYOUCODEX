import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOLS } from "../lib/model-arena/catalog.mjs";
import { mergeArenaExtension, loadArenaExtension } from "../lib/model-arena/local-extension.mjs";
import { ArenaService } from "../lib/model-arena/service.mjs";
import { createArenaHandler } from "../lib/model-arena/http.mjs";

function fixtureExtension() {
  return { protocols: { fixture: { name: "本地测试协议", families: ["h3"], baseUrl: "https://fixture.example", create: "/tasks", status: "/tasks/{id}",
    modelIds: { h3: "fixture-h3" }, requiresIdentity: true, credentialHint: "测试凭证名称", credentialOrigin: "https://fixture.example", credentialNames: ["FIXTURE_API_KEY"] } },
    adapters: { fixture: { buildPayload: (model, config, draft) => ({ model: model.apiId, text: draft.prompt, duration: draft.duration }), parseTask: raw => ({ id: raw.id, state: "running" }) } },
    familyDefaults: { h3: "fixture" } };
}
async function temporary(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-extension-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 })); return dir;
}
function route(handler, pathname = "/api/arena/state") {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  return handler({ method: "GET" }, response, new URL(pathname, "http://fixture.local")).then(() => response);
}
function handlerOptions(root) { return { root, sendJson: (res, body, status = 200) => { res.status = status; res.body = body; } }; }

test("private extension catalogs and default model IDs remain isolated per service", async t => {
  const dir = await temporary(t), input = fixtureExtension();
  const a = new ArenaService({ root: path.join(dir, "private"), extension: input });
  const b = new ArenaService({ root: path.join(dir, "public") });
  t.after(async () => { await a.close(); await b.close(); });
  await Promise.all([a.ready, b.ready]);
  const privateState = await a.snapshot(), publicState = await b.snapshot();
  assert.equal(privateState.settings.families.h3.protocol, "fixture");
  assert.equal(privateState.settings.models.h3.apiId, "fixture-h3");
  assert.equal(privateState.protocols.fixture.requiresIdentity, true);
  assert.equal(publicState.settings.families.h3.protocol, "minimax");
  assert.equal(publicState.protocols.fixture, undefined);
  assert.equal(PROTOCOLS.fixture, undefined);
  input.protocols.fixture.modelIds.h3 = "changed-after-creation";
  privateState.protocols.fixture.name = "changed-snapshot";
  assert.equal((await a.snapshot()).protocols.fixture.modelIds.h3, "fixture-h3");
  assert.equal((await a.snapshot()).protocols.fixture.name, "本地测试协议");
});

test("extensions reject official overrides, mismatched defaults, bad credential origins and missing adapters", () => {
  const input = fixtureExtension();
  assert.throws(() => mergeArenaExtension({ ...input, protocols: { minimax: input.protocols.fixture } }), /配置无效/);
  assert.throws(() => mergeArenaExtension({ ...input, familyDefaults: { wan: "fixture" } }), /配置无效/);
  assert.throws(() => mergeArenaExtension({ ...input, adapters: {} }), /配置无效/);
  assert.throws(() => mergeArenaExtension({ ...input, protocols: { fixture: { ...input.protocols.fixture, credentialOrigin: "https://other.example" } } }), /配置无效/);
  assert.throws(() => mergeArenaExtension({ ...input, protocols: { fixture: { ...input.protocols.fixture, baseUrl: "https://localhost" } } }), /配置无效/);
  assert.throws(() => mergeArenaExtension({ ...input, protocols: { fixture: { ...input.protocols.fixture, modelIds: { wan3: "wrong-family" } } } }), /配置无效/);
  assert.equal(PROTOCOLS.fixture, undefined);
});

test("private preview uses instance adapter and unavailable saved protocols fail closed without rewriting settings", async t => {
  const dir = await temporary(t), root = path.join(dir, "state"), extension = fixtureExtension();
  let preflight = 0;
  const a = new ArenaService({ root, extension, provider: { preflight: async () => { preflight++; }, liveCheck: async () => {} } });
  t.after(() => a.close()); await a.ready;
  const settings = await a.saveSettings((await a.snapshot()).settings);
  const preview = await a.preview({ models: ["h3"], prompt: "测试提示词", duration: 5, ratio: "16:9", assetIds: [] });
  assert.equal(preflight, 1); assert.equal(preview.requests[0].protocol, "本地测试协议");
  assert.deepEqual(preview.requests[0].payload, { model: "fixture-h3", text: "测试提示词", duration: 5 });
  assert.equal(settings.families.h3.protocol, "fixture");
  await a.close(); const before = await readFile(path.join(root, "settings.json"), "utf8");
  const b = new ArenaService({ root }); t.after(() => b.close());
  await assert.rejects(b.ready, /本机适配器未加载/);
  assert.equal(await readFile(path.join(root, "settings.json"), "utf8"), before);
});

test("HTTP loads only its adjacent private extension lazily and once while direct services never auto-load it", async t => {
  const dir = await temporary(t), root = path.join(dir, "model-arena"), marker = path.join(dir, "factory-calls.txt");
  const module = `import { appendFile } from 'node:fs/promises';
export default async sdk => {
  if (typeof sdk.requestJson !== 'function' || typeof sdk.publicUrl !== 'function') throw new Error('missing SDK');
  await appendFile(${JSON.stringify(marker)}, 'called\\n');
  await new Promise(resolve => setTimeout(resolve, 30));
  return (${fixtureExtension.toString()})();
};`;
  await writeFile(path.join(dir, "model-arena.private.mjs"), module);
  const direct = new ArenaService({ root }); t.after(() => direct.close()); await direct.ready;
  assert.equal((await direct.snapshot()).protocols.fixture, undefined);
  await assert.rejects(access(marker)); await direct.close();
  const handler = createArenaHandler(handlerOptions(root)); t.after(() => handler.close());
  const page = await route(handler, "/model-arena/"); assert.equal(page.status, 200); await assert.rejects(access(marker));
  const states = await Promise.all(Array.from({ length: 5 }, () => route(handler)));
  assert.ok(states.every(state => state.status === 200 && state.body.protocols.fixture.name === "本地测试协议"));
  assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);
  assert.equal(PROTOCOLS.fixture, undefined);
  const otherRoot = path.join(dir, "other", "model-arena"); await mkdir(path.dirname(otherRoot));
  assert.deepEqual(await loadArenaExtension(otherRoot), {});
});

test("pending extension initialization is settled on close and invalid modules are not silently skipped", async t => {
  const dir = await temporary(t), root = path.join(dir, "model-arena"), marker = path.join(dir, "started");
  await writeFile(path.join(dir, "model-arena.private.mjs"), `import { writeFile } from 'node:fs/promises';
export default async () => { await writeFile(${JSON.stringify(marker)}, 'started'); await new Promise(resolve=>setTimeout(resolve,100)); return {}; };`);
  const handler = createArenaHandler(handlerOptions(root));
  const pending = route(handler);
  for (let i = 0; i < 100 && !await access(marker).then(() => true, () => false); i++) await delay(5);
  await access(marker); await handler.close();
  assert.equal((await pending).status, 503);
  assert.equal((await route(handler)).status, 503);
  await assert.rejects(access(root));
  const badDir = path.join(dir, "bad"); await mkdir(badDir);
  await writeFile(path.join(badDir, "model-arena.private.mjs"), "export default { invalid: true };");
  await assert.rejects(loadArenaExtension(path.join(badDir, "model-arena")), /加载失败/);
});
