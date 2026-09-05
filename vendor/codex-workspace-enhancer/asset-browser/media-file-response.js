import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const EMBEDDED_MEDIA_CHUNK_BYTES = 2 * 1024 * 1024;

export function fileResponseRange(size, rangeHeader, { bounded = false, method = "GET" } = {}) {
  if (method === "HEAD") return { status: 200, length: size };
  if (rangeHeader != null) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
    if (!match || (!match[1] && !match[2]) || size === 0) return { status: 416, length: 0 };
    let start;
    let end;
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return { status: 416, length: 0 };
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return { status: 416, length: 0 };
      end = Math.min(end, size - 1);
    }
    if (bounded) end = Math.min(end, start + EMBEDDED_MEDIA_CHUNK_BYTES - 1);
    return { status: 206, start, end, length: end - start + 1 };
  }
  if (bounded && size) {
    const end = Math.min(size, EMBEDDED_MEDIA_CHUNK_BYTES) - 1;
    return { status: 206, start: 0, end, length: end + 1 };
  }
  return { status: 200, length: size };
}

export async function streamAssetFile(req, res, filePath, { contentType = "application/octet-stream", asDownload = false } = {}) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { allow: "GET, HEAD", "content-length": "0" });
    res.end();
    return;
  }
  if (req.aborted || res.destroyed) return;
  const handle = await fs.open(filePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw Object.assign(new Error("请求的资源不是普通文件"), { statusCode: 404 });
    const bounded = req.headers["x-aiyoucodex-bounded-media"] === "1" && /^(?:audio|video)\//.test(contentType);
    const selected = fileResponseRange(stats.size, req.headers.range, { bounded, method: req.method });
    const headers = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-length": String(selected.length),
    };
    if (selected.status === 416) headers["content-range"] = `bytes */${stats.size}`;
    else if (selected.status === 206) headers["content-range"] = `bytes ${selected.start}-${selected.end}/${stats.size}`;
    if (asDownload) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
    if (req.aborted || res.destroyed) return;
    res.writeHead(selected.status, headers);
    if (req.method === "HEAD" || selected.length === 0) { res.end(); return; }
    const source = handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
      ...(selected.status === 206 ? { start: selected.start, end: selected.end } : {}),
    });
    const abort = () => source.destroy();
    req.once("aborted", abort);
    try {
      // pipeline supplies backpressure, handles read errors, and destroys the
      // source when the client disconnects instead of reading the rest of a video.
      await pipeline(source, res);
    } catch {
      if (!res.destroyed) res.destroy();
    } finally {
      req.removeListener("aborted", abort);
      source.destroy();
    }
  } finally {
    await handle.close().catch(() => {});
  }
}
