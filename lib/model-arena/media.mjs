import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, stat, unlink, rename, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { publicUrl } from "./providers.mjs";

const TYPES = {
  ".png": ["image", "image/png"], ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"], ".webp": ["image", "image/webp"],
  ".mp4": ["video", "video/mp4"], ".mov": ["video", "video/quicktime"],
  ".mp3": ["audio", "audio/mpeg"], ".wav": ["audio", "audio/wav"],
};
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export function mediaType(name) { const ext = path.extname(name).toLowerCase();
  if (!TYPES[ext]) throw new Error("支持 JPG、PNG、WebP、MP4、MOV、MP3、WAV"); return { type: TYPES[ext][0], mime: TYPES[ext][1], ext }; }
async function binary(name) {
  const override = process.env[`AIYOU_${name.toUpperCase()}`];
  if (override) return override;
  if (process.platform === "darwin") for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    const file = path.join(dir, name); if (await access(file).then(() => true, () => false)) return file;
  }
  return name;
}
export async function runMediaTool(name, args, { timeout = 30000 } = {}) {
  const command = await binary(name);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "", exceeded = false; let errorBytes = 0, errorTail = "";
    const timer = setTimeout(() => { exceeded = true; child.kill("SIGKILL"); }, timeout); timer.unref?.();
    child.stdout.on("data", chunk => { output += chunk.toString(); if (output.length > 1024 * 1024) { exceeded = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", chunk => { errorTail = (errorTail + chunk.toString()).slice(-3000); errorBytes += chunk.length; if (errorBytes > 4 * 1024 * 1024) { exceeded = true; child.kill("SIGKILL"); } });
    child.on("error", () => { clearTimeout(timer); reject(new Error(`未找到 ${name}，请先安装 FFmpeg 并加入 PATH`)); });
    child.on("close", code => { clearTimeout(timer); if (code !== 0 || exceeded) reject(new Error(`${name} 处理失败或超时，请检查媒体是否完整`, { cause: new Error(errorTail) })); else resolve(output); });
  });
}
export async function inspectMedia(file, name, { maxBytes = MAX_IMPORT_BYTES } = {}) {
  const info = mediaType(name); const stats = await stat(file);
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) throw new Error("文件为空或超过大小限制");
  const raw = JSON.parse(await runMediaTool("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", file]));
  const stream = raw.streams?.find(s => s.codec_type === (info.type === "audio" ? "audio" : "video"));
  if (!stream) throw new Error("文件内容与媒体类型不符");
  const duration = Number(raw.format?.duration || stream.duration || 0);
  if (info.type !== "image" && (!Number.isFinite(duration) || duration <= 0 || duration > 3600)) throw new Error("无法读取有效媒体时长");
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { ...info, size: stats.size, duration, width: Number(stream.width || 0), height: Number(stream.height || 0), sha256: hash.digest("hex") };
}

export async function downloadVideo(url, destination, { fetcher = fetch } = {}) {
  // Signed result URLs are never exposed as logs. Redirects carry no API headers.
  let current = publicUrl(url), response;
  for (let i = 0; i < 5; i++) {
    response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(180000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = new URL(response.headers.get("location") || "", current); await response.body?.cancel(); current = publicUrl(next.href);
  }
  if (!response?.ok || !response.body) throw new Error("结果下载失败，可稍后仅重试下载");
  const partial = destination + ".part"; let size = 0;
  const limiter = new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > 1024 * 1024 * 1024 ? new Error("结果超过 1 GB 限制") : null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    const meta = await inspectMedia(partial, "result.mp4", { maxBytes: 1024 * 1024 * 1024 });
    await rename(partial, destination); return meta;
  } catch (error) { await unlink(partial).catch(() => {}); throw error; }
}

export function compositePlan(inputs, mode = "grid") {
  if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length > 6) throw new Error("请选择 2–6 个已完成视频");
  if (!["grid", "sequence"].includes(mode)) throw new Error("未知合成布局");
  const duration = Math.min(...inputs.map(a => a.duration));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("视频时长无效");
  const columns = mode === "grid" ? Math.min(3, inputs.length) : 1;
  const rows = mode === "grid" ? Math.ceil(inputs.length / columns) : 1;
  const width = mode === "grid" ? (columns === 2 ? 960 : 640) : 1280;
  const height = Math.round(width * 9 / 16 / 2) * 2;
  const filters = inputs.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,setpts=PTS-STARTPTS,format=yuv420p[base${i}];[base${i}][${inputs.length + i}:v]overlay=x=0:y=0:shortest=1,format=yuv420p${mode === "grid" ? `,trim=duration=${duration}` : ""}[v${i}]`);
  const all = inputs.map((_, i) => `[v${i}]`).join("");
  if (mode === "grid") filters.push(`${all}xstack=inputs=${inputs.length}:layout=${inputs.map((_, i) => `${(i % columns) * width}_${Math.floor(i / columns) * height}`).join("|")}:fill=black:shortest=1[out]`);
  else filters.push(`${all}concat=n=${inputs.length}:v=1:a=0[out]`);
  return { filter: filters.join(";"), labelWidth: width, width: width * columns, height: height * rows, duration: mode === "grid" ? duration : inputs.reduce((s, a) => s + a.duration, 0) };
}
// A tiny portable label raster avoids a dependency on FFmpeg drawtext/libfreetype
// (absent from some macOS/Windows builds) or the user's font installation.
const GLYPHS = {
  A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],D:[30,17,17,17,17,17,30],E:[31,16,16,30,16,16,31],F:[31,16,16,30,16,16,16],G:[14,17,16,23,17,17,15],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],J:[7,2,2,2,18,18,12],K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],O:[14,17,17,17,17,17,14],P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,21,10],X:[17,17,10,4,10,17,17],Y:[17,17,10,4,4,4,4],Z:[31,1,2,4,8,16,31],
  0:[14,17,19,21,25,17,14],1:[4,12,4,4,4,4,14],2:[14,17,1,2,4,8,31],3:[30,1,1,14,1,1,30],4:[2,6,10,18,31,2,2],5:[31,16,16,30,1,1,30],6:[14,16,16,30,17,17,14],7:[31,1,2,4,8,8,8],8:[14,17,17,14,17,17,14],9:[14,17,17,15,1,1,14],".":[0,0,0,0,0,12,12],"-":[0,0,0,31,0,0,0]," ":[0,0,0,0,0,0,0],
};
export function labelRaster(label, width) {
  const height = 36, pixels = Buffer.alloc(width * height * 3, 22), scale = 2;
  [...String(label).toUpperCase().slice(0, 42)].forEach((letter, index) => {
    (GLYPHS[letter] || GLYPHS[" "]).forEach((bits, row) => {
      for (let col = 0; col < 5; col++) if (bits & (1 << (4 - col))) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const px = 12 + index * 12 + col * scale + x, py = 11 + row * scale + y;
        if (px < width) pixels.fill(242, (py * width + px) * 3, (py * width + px) * 3 + 3);
      }
    });
  });
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}
export async function composeVideos(inputs, destination, mode = "grid") {
  const plan = compositePlan(inputs, mode); const filterFile = destination + ".filters.txt";
  const labels = inputs.map((_, i) => `${destination}.label-${i}.ppm`);
  await writeFile(filterFile, plan.filter, { flag: "wx", mode: 0o600 });
  try {
    for (let i = 0; i < labels.length; i++) await writeFile(labels[i], labelRaster(inputs[i].label, plan.labelWidth), { flag: "wx", mode: 0o600 });
    await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-filter_complex_threads", "2",
      ...inputs.flatMap(a => ["-protocol_whitelist", "file,pipe", "-i", a.path]),
      ...labels.flatMap(file => ["-loop", "1", "-framerate", "24", "-i", file]), "-filter_complex_script", filterFile,
      "-map", "[out]", "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", destination], { timeout: 300000 });
    return await inspectMedia(destination, "comparison.mp4", { maxBytes: 1024 * 1024 * 1024 });
  } catch (error) { await unlink(destination).catch(() => {}); throw error; }
  finally { await unlink(filterFile).catch(() => {}); await Promise.all(labels.map(file => unlink(file).catch(() => {}))); }
}

export function revealMedia(file) {
  const [command, args] = process.platform === "darwin" ? ["open", ["-R", file]]
    : process.platform === "win32" ? ["explorer.exe", ["/select,", file]] : ["xdg-open", [path.dirname(file)]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => reject(new Error("无法打开系统文件管理器")));
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  });
}
