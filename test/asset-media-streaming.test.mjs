import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { createServer, get } from "node:http";
import os from "node:os";
import path from "node:path";
import { EMBEDDED_MEDIA_CHUNK_BYTES, fileResponseRange, streamAssetFile } from "../vendor/codex-workspace-enhancer/asset-browser/media-file-response.js";

test("media range selection clamps ends, handles suffixes and rejects malformed/unsatisfiable ranges", () => {
  assert.deepEqual(fileResponseRange(100, "bytes=-10"), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(fileResponseRange(100, "bytes=90-999"), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(fileResponseRange(100, "bytes=90-"), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(fileResponseRange(100, "bytes=-999"), { status: 206, start: 0, end: 99, length: 100 });
  for (const range of ["bytes=100-", "bytes=9-2", "bytes=-0", "bytes=-", "bytes=0-1,8-9", "junkbytes=0-1", "bytes=1-9007199254740992"]) {
    assert.equal(fileResponseRange(100, range).status, 416, range);
  }
  assert.equal(fileResponseRange(0, "bytes=0-").status, 416);
  assert.equal(fileResponseRange(0, undefined, { bounded: true }).length, 0);
  assert.deepEqual(fileResponseRange(100, "bytes=0-1", { method: "HEAD", bounded: true }), { status: 200, length: 100 });
});

test("2 GiB sparse media remains bounded through HTTP, supports seeks/HEAD, and survives disconnects", { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-large-media-"));
  const target = path.join(root, "large-video.mp4");
  const size = 2 * 1024 ** 3;
  const fixture = await fs.open(target, "w");
  await fixture.truncate(size);
  await fixture.write(Buffer.from("TAIL"), 0, 4, size - 4);
  await fixture.close();
  const server = createServer(async (req, res) => {
    try {
      await streamAssetFile(req, res, req.url === "/missing" ? path.join(root, "missing.mp4") : target, { contentType: req.url === "/image" ? "image/png" : "video/mp4" });
    } catch (error) {
      if (res.headersSent || res.destroyed) res.destroy();
      else { res.writeHead(error.code === "ENOENT" ? 404 : 500); res.end(); }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bounded = { "x-aiyoucodex-bounded-media": "1" };
  const initial = await fetch(base, { headers: bounded });
  assert.equal(initial.status, 206);
  assert.equal(initial.headers.get("content-range"), `bytes 0-${EMBEDDED_MEDIA_CHUNK_BYTES - 1}/${size}`);
  assert.equal(initial.headers.get("accept-ranges"), "bytes");
  assert.equal((await initial.arrayBuffer()).byteLength, EMBEDDED_MEDIA_CHUNK_BYTES);
  const seekStart = 500 * 1024 ** 2;
  const seek = await fetch(base, { headers: { ...bounded, range: `bytes=${seekStart}-` } });
  assert.equal(seek.status, 206);
  assert.equal(seek.headers.get("content-range"), `bytes ${seekStart}-${seekStart + EMBEDDED_MEDIA_CHUNK_BYTES - 1}/${size}`);
  assert.equal((await seek.arrayBuffer()).byteLength, EMBEDDED_MEDIA_CHUNK_BYTES);
  const suffix = await fetch(base, { headers: { ...bounded, range: "bytes=-4" } });
  assert.equal(suffix.headers.get("content-range"), `bytes ${size - 4}-${size - 1}/${size}`);
  assert.equal(await suffix.text(), "TAIL");
  const head = await fetch(base, { method: "HEAD", headers: { ...bounded, range: "bytes=0-1" } });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), size);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const invalid = await fetch(base, { headers: { ...bounded, range: `bytes=${size}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${size}`);
  assert.equal((await invalid.arrayBuffer()).byteLength, 0);
  const missing = await fetch(`${base}/missing`, { headers: bounded });
  assert.equal(missing.status, 404);
  // Direct streaming still advertises the full file; abort without buffering it.
  // An image header must not be rewritten to a video chunk either.
  for (const route of ["/", "/image", "/", "/"]) {
    await new Promise((resolve, reject) => {
      const request = get(`${base}${route}`, { headers: route === "/image" ? bounded : {} }, (response) => {
        try {
          assert.equal(response.statusCode, 200);
          assert.equal(Number(response.headers["content-length"]), size);
          response.destroy();
          request.destroy();
          resolve();
        } catch (error) { request.destroy(); reject(error); }
      });
      request.on("error", (error) => error.code === "ECONNRESET" ? resolve() : reject(error));
    });
  }
  const stillAlive = await fetch(base, { headers: { ...bounded, range: "bytes=0-15" } });
  assert.equal(stillAlive.status, 206);
  assert.equal((await stillAlive.arrayBuffer()).byteLength, 16);
});
