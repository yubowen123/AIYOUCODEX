import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../vendor/codex-workspace-enhancer/asset-browser/server.js", import.meta.url));

test("isolated asset service reconciles offline additions/updates/deletions once and exposes cheap revision probes", { timeout: 20000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-restart-safety-"));
  const assetsRoot = path.join(root, "assets");
  await fs.mkdir(assetsRoot);
  const stable = path.join(assetsRoot, "stable.txt");
  const changed = path.join(assetsRoot, "changed.txt");
  const deleted = path.join(assetsRoot, "deleted.txt");
  await Promise.all([fs.writeFile(stable, "unchanged text"), fs.writeFile(changed, "old"), fs.writeFile(deleted, "delete while offline")]);
  await fs.writeFile(path.join(root, "config.json"), JSON.stringify({ projects: [{ id: "fixture", name: "Fixture", path: assetsRoot, folders: [assetsRoot] }], deduplication: { automaticSweep: false } }));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const token = "isolated-asset-restart-test-token-0000000001";
  const env = { ...process.env, PORT: String(port), ASSET_BROWSER_API_TOKEN: token };
  // Redirect every service data source/registry so this test cannot read or
  // mutate the real Codex projects, generated images, tokens or local assets.
  for (const [key, name] of Object.entries({
    ASSET_BROWSER_TOKEN_FILE: "token", ASSET_BROWSER_CONFIG: "config.json", ASSET_BROWSER_LEDGER: "ledger.json",
    GENERATION_TICKETS: "generation.json", GENERATION_THREAD_BINDINGS: "bindings.json", CODEX_PROMPT_ASSOCIATIONS: "associations.json",
    ASSET_LIBRARY_INDEX: "index.json", CODEX_SESSIONS_ROOT: "sessions", CODEX_GENERATED_IMAGES_ROOT: "generated", CODEX_GLOBAL_STATE: "global.json",
    CODEX_SESSION_INDEX: "sessions.jsonl", DUPLICATE_CLEANUP_LEDGER: "duplicates.json", DUPLICATE_QUARANTINE: "quarantine",
    RHYTHM_CONTROL_REGISTRY: "rhythm.json", PROMPT_LIBRARY_ROOT: "prompts", THREE_D_TASKS: "three-d.json", ASSET_ACTION_TRASH: "trash",
    IMG2THREEJS_SKILL_ROOT: "no-three-d-skill", SCORE_MIX_SKILL_ROOT: "no-audio-skill",
  })) env[key] = path.join(root, name);
  let child;
  let logs = "";
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  t.after(async () => { await stop(); await fs.rm(root, { recursive: true, force: true }); });
  async function request(route) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { "x-asset-console-token": token }, signal: AbortSignal.timeout(2000) });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    return data;
  }
  async function start() {
    child = spawn(process.execPath, [serverPath], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { logs += chunk; });
    child.stderr.on("data", (chunk) => { logs += chunk; });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { await request("/api/config"); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(logs);
  }
  await start();
  const initialProbe = await request("/api/library/revision?project=fixture");
  assert.equal(initialProbe.revision, "uninitialized");
  assert.equal((await fs.readdir(root)).includes("index.json"), false, "revision lookup must not initialize or scan a library");
  const initial = await request("/api/library?project=fixture");
  assert.equal(initial.assets.length, 3);
  const before = await request("/api/library/revision?project=fixture");
  assert.equal(before.revision, initial.index.revision);
  const firstPage = await request("/api/library?project=fixture&limit=2&offset=0&sort=oldest");
  assert.equal(firstPage.assets.length, 2);
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.filteredTotal, 3);
  assert.equal(firstPage.page.hasMore, true);
  const lastPage = await request(`/api/library?project=fixture&limit=2&offset=2&sort=oldest&revision=${firstPage.index.revision}`);
  assert.equal(lastPage.assets.length, 1);
  assert.equal(lastPage.page.hasMore, false);
  assert.ok(!firstPage.assets.some((asset) => asset.id === lastPage.assets[0].id));
  const fullSearch = await request("/api/library?project=fixture&limit=1&query=delete%20while%20offline");
  assert.equal(fullSearch.filteredTotal, 1);
  assert.equal(fullSearch.assets[0].name, "deleted.txt");
  assert.equal(fullSearch.counts.all, 3);
  const stalePage = await fetch(`http://127.0.0.1:${port}/api/library?project=fixture&limit=2&offset=2&revision=obsolete`, { headers: { "x-asset-console-token": token } });
  assert.equal(stalePage.status, 409);
  await stalePage.arrayBuffer();
  await stop();
  await fs.writeFile(changed, "edited while service offline");
  await fs.unlink(deleted);
  await fs.writeFile(path.join(assetsRoot, "new.txt"), "added offline");
  await start();
  let library;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    library = await request("/api/library?project=fixture");
    if (library.assets.some((asset) => asset.name === "new.txt") && !library.assets.some((asset) => asset.name === "deleted.txt") && library.assets.some((asset) => asset.preview === "edited while service offline")) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.deepEqual(library.assets.map((asset) => asset.name).sort(), ["changed.txt", "new.txt", "stable.txt"]);
  assert.equal(library.assets.find((asset) => asset.name === "changed.txt").preview, "edited while service offline");
  assert.equal(library.index.mode, "persistent");
  assert.equal(library.assets.find((asset) => asset.name === "stable.txt").mtimeMs, initial.assets.find((asset) => asset.name === "stable.txt").mtimeMs);
  const after = await request("/api/library/revision?project=fixture");
  assert.notEqual(after.epoch, before.epoch);
  assert.equal(after.revision, library.index.revision);
  const persisted = await fs.readFile(path.join(root, "index.json"), "utf8");
  await request("/api/library?project=fixture");
  await request("/api/library/revision?project=fixture");
  assert.equal(await fs.readFile(path.join(root, "index.json"), "utf8"), persisted, "reopening and polling must not rewrite unchanged persisted assets");
  const largeMedia = path.join(assetsRoot, "sparse.m4v");
  const sparseHandle = await fs.open(largeMedia, "w");
  await sparseHandle.truncate(512 * 1024 ** 2);
  await sparseHandle.close();
  const mediaUrl = `http://127.0.0.1:${port}/media?id=${Buffer.from(largeMedia).toString("base64url")}`;
  const mediaHeaders = { "x-asset-console-token": token, "x-aiyoucodex-bounded-media": "1" };
  const media = await fetch(mediaUrl, { headers: mediaHeaders });
  assert.equal(media.status, 206, "the real authenticated route must bound m4v as video too");
  assert.equal(media.headers.get("content-type"), "video/mp4");
  assert.equal((await media.arrayBuffer()).byteLength, 2 * 1024 ** 2);
  const mediaHead = await fetch(mediaUrl, { method: "HEAD", headers: mediaHeaders });
  assert.equal(mediaHead.status, 200);
  assert.equal(Number(mediaHead.headers.get("content-length")), 512 * 1024 ** 2);
  assert.equal((await mediaHead.arrayBuffer()).byteLength, 0);
  const invalidMedia = await fetch(mediaUrl, { headers: { ...mediaHeaders, range: "bytes=9999999999-" } });
  assert.equal(invalidMedia.status, 416);
  assert.equal((await invalidMedia.arrayBuffer()).byteLength, 0);
  const missing = await request("/api/library/revision?project=not-found");
  assert.equal(missing.projectExists, false);
  assert.equal(missing.revision, "missing");
});
