import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { assetResponseByteLimit, boundedMediaRange, createMediaRequestLimiter, MAX_MEDIA_CHUNK_BYTES } from "../lib/asset-console-media.mjs";

test("open ended media ranges are bounded while seek and suffix ranges remain meaningful", () => {
  assert.equal(boundedMediaRange("bytes=0-"), `bytes=0-${MAX_MEDIA_CHUNK_BYTES - 1}`);
  assert.equal(boundedMediaRange("bytes=9000000-"), `bytes=9000000-${9000000 + MAX_MEDIA_CHUNK_BYTES - 1}`);
  assert.equal(boundedMediaRange("bytes=-99999999"), `bytes=-${MAX_MEDIA_CHUNK_BYTES}`);
  assert.equal(boundedMediaRange("bytes=50-100"), "bytes=50-100");
  assert.equal(boundedMediaRange(null), null);
  assert.equal(assetResponseByteLimit("video/mp4"), MAX_MEDIA_CHUNK_BYTES);
});

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bridge = new AssetConsoleBridge({ port: server.address().port });
  bridge.apiToken = async () => "synthetic-test-token-only";
  try { await run(bridge); } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("bridge sends bounded media requests and refuses huge Content-Length before buffering", async () => {
  await withServer((req, res) => {
    assert.equal(req.headers["x-aiyoucodex-bounded-media"], "1");
    assert.equal(req.headers.range, `bytes=0-${MAX_MEDIA_CHUNK_BYTES - 1}`);
    res.writeHead(200, { "content-type": "video/mp4", "content-length": String(2 * 1024 ** 3) });
    res.flushHeaders(); // No giant allocation is needed to prove early refusal.
  }, async (bridge) => {
    await assert.rejects(bridge.requestLocal({ route: "/media?id=synthetic", headers: { Range: "bytes=0-" }, timeoutMs: 1000 }), /安全传输上限/);
  });
});

test("bridge caps chunked videos, rejects prematurely closed responses, and honors abort", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.flushHeaders();
    if (req.url.includes("chunked")) {
      const chunk = Buffer.alloc(64 * 1024);
      for (let index = 0; index < 34; index++) res.write(chunk);
      res.end();
    } else if (req.url.includes("broken")) {
      res.write(Buffer.alloc(100));
      setTimeout(() => res.destroy(), 10);
    }
  }, async (bridge) => {
    await assert.rejects(bridge.requestLocal({ route: "/media?id=chunked" }), /安全传输上限/);
    await assert.rejects(bridge.requestLocal({ route: "/media?id=broken" }), /中断|关闭|aborted/);
    const controller = new AbortController();
    const request = bridge.requestLocal({ route: "/media?id=slow", signal: controller.signal, timeoutMs: 1000 });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(request, /取消/);
    await assert.rejects(bridge.requestLocal({ route: "/media?id=timeout", timeoutMs: 20 }), /超时/);
  });
});

test("media transfer concurrency and queue are bounded and queued cancellations release slots", async () => {
  const run = createMediaRequestLimiter({ concurrency: 2, maxQueue: 2 });
  const completions = [];
  let active = 0, peak = 0;
  const work = () => new Promise((resolve) => { active++; peak = Math.max(peak, active); completions.push(() => { active--; resolve(); }); });
  const a = run(work), b = run(work);
  const controller = new AbortController();
  const c = run(work, controller.signal), d = run(work);
  await assert.rejects(run(work), /Too many/);
  controller.abort();
  await assert.rejects(c, /cancelled/);
  completions.shift()();
  await a;
  await new Promise((resolve) => setImmediate(resolve));
  completions.shift()(); completions.shift()();
  await Promise.all([b, d]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});
