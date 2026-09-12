import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { ArenaService } from "./service.mjs";
import { revealMedia } from "./media.mjs";
import { loadArenaExtension } from "./local-extension.mjs";

export function createArenaHandler({ root, readBody, sendJson, serveFile, resolveAsset, service }) {
  readBody = async req => {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length;
      if (size > 512 * 1024) throw Object.assign(new Error("请求过大，请分片上传素材"), { statusCode: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
    catch { throw new Error("请求 JSON 格式无效"); }
  };
  let arena = service, pending, closed = false;
  const get = async () => {
    if (closed) throw Object.assign(new Error("竞技场服务已关闭"), { statusCode: 503 });
    if (arena) return arena;
    return pending ||= (async () => {
      const extension = await loadArenaExtension(root);
      if (closed) throw Object.assign(new Error("竞技场服务已关闭"), { statusCode: 503 });
      const candidate = new ArenaService({ root, extension });
      try { await candidate.ready; arena = candidate; return candidate; }
      catch (error) { await candidate.close(); throw error; }
    })().catch(error => { pending = undefined; throw error; });
  };
  const staticFiles = new Map([["/model-arena/", "index.html"], ["/model-arena/index.html", "index.html"], ["/model-arena/app.js", "app.js"], ["/model-arena/style.css", "style.css"]]);
  const handler = async (req, res, url) => {
    if (staticFiles.has(url.pathname) && ["GET", "HEAD"].includes(req.method)) {
      const name = staticFiles.get(url.pathname), file = fileURLToPath(new URL(`../../model-arena/public/${name}`, import.meta.url));
      const body = await readFile(file); const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
      res.writeHead(200, { "content-type": type + "; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" }); res.end(req.method === "HEAD" ? undefined : body); return true;
    }
    if (!url.pathname.startsWith("/api/arena/")) return false;
    // Caller authenticates ALL /api/ routes with the existing local bridge token.
    try {
      const a = await get(); await a.ready; const route = url.pathname.slice("/api/arena/".length);
      let result;
      if (route === "state" && req.method === "GET") result = await a.snapshot({ offset: url.searchParams.get("offset") });
      else if (route === "settings" && req.method === "PUT") result = await a.saveSettings(await readBody(req));
      else if (route === "credential" && req.method === "POST") { const b = await readBody(req); result = await a.setCredential(b.family, b.key); }
      else if (route === "upload" && req.method === "POST") result = await a.beginUpload(await readBody(req));
      else if (/^upload\/[a-f0-9-]+$/.test(route) && req.method === "PUT") result = await a.uploadChunk(route.split("/")[1], await readBody(req));
      else if (/^upload\/[a-f0-9-]+\/finish$/.test(route) && req.method === "POST") result = await a.finishUpload(route.split("/")[1]);
      else if (route === "import" && req.method === "POST") { const b = await readBody(req); const source = await resolveAsset(b.assetRef); result = await a.serial(() => a.importFile(source)); }
      else if (route === "asset-url" && req.method === "PUT") { const b = await readBody(req); result = await a.setAssetUrl(b.id, b.url); }
      else if (route === "preview" && req.method === "POST") result = await a.preview(await readBody(req));
      else if (route === "confirm" && req.method === "POST") result = await a.confirm(await readBody(req));
      else if (route === "recover" && req.method === "POST") { const b = await readBody(req); result = await a.recover(b.runId, b.jobId, b.taskId); }
      else if (route === "composite" && req.method === "POST") { const b = await readBody(req); result = await a.composite(b.runId, b.jobIds, b.mode); }
      else if (route === "reveal" && req.method === "POST") { const b = await readBody(req); result = await revealMedia((await a.media(b.id)).path); }
      else if (/^media\/[a-f0-9-]+$/.test(route) && ["GET", "HEAD"].includes(req.method)) {
        const asset = await a.media(route.split("/")[1]);
        if (url.searchParams.get("download") === "1") res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
        await serveFile(req, res, asset.path); return true;
      } else { sendJson(res, { error: "未知竞技场操作" }, 404); return true; }
      sendJson(res, result); return true;
    } catch (error) { sendJson(res, { error: error.message || "操作失败" }, error.statusCode || 400); return true; }
  };
  handler.close = async () => { closed = true; if (pending) await pending.catch(() => {}); await arena?.close(); }; return handler;
}
