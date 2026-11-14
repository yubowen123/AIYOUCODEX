import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { readImageDimensions } from "./image-dimensions.js";

const run = promisify(execFile);
const formats = "mov,matroska,webm,avi,mp3,wav,flac,ogg,aac,aiff,asf,mpeg,mpegts,m4v,flv,ape,amr,image2,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,tiff_pipe,av1";
const probeBin = process.env.AIYOU_FFPROBE || ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"].find(existsSync) || "ffprobe";
const pending = new Map(), successful = new Map();
const number = value => Number(value) > 0 && Number.isFinite(Number(value)) ? Number(value) : undefined;
const label = value => typeof value === "string" && value.trim() && !/^(unknown|n\/a|none|unspecified)$/i.test(value.trim()) ? value.trim().slice(0, 220) : undefined;
function rate(value) {
  const [top, bottom] = String(value || "").split("/");
  return bottom ? number(Number(top) / Number(bottom)) : number(top);
}
function timestamp(value) {
  const time = value ? new Date(value) : null;
  return time && Number.isFinite(time.valueOf()) ? time.toISOString() : undefined;
}
function tag(tags, key) {
  return label(Object.entries(tags || {}).find(([name]) => name.toLowerCase() === key)?.[1]);
}
function pixelDepth(stream) {
  return number(stream?.bits_per_raw_sample)
    || (/^(?:rgb24|bgr24|rgba|bgra|argb|abgr|gray|pal8|yuv(?:j)?[0-9]{3}p|nv12)$/.test(stream?.pix_fmt || "") ? 8 : undefined)
    || number(stream?.pix_fmt?.match(/(?:p|gray)(9|10|12|14|16)(?:le|be)$/)?.[1]);
}

export function normalizeProbeData(data = {}, kind) {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const format = data.format || {};
  const video = streams.find(s => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audioStreams = streams.filter(s => s.codec_type === "audio");
  const audio = audioStreams[0];
  const colors = (source) => source && [source.color_space, source.color_primaries, source.color_transfer, source.color_range].map(label).filter(Boolean).filter((value, i, list) => list.indexOf(value) === i).join(" / ") || undefined;
  const tags = { ...format.tags, ...audio?.tags };
  const rawRotation = video?.side_data_list?.find(side => side.rotation !== undefined)?.rotation ?? tag(video?.tags, "rotate");
  const rotation = Number(rawRotation);
  return {
    duration: kind === "image" && !["gif", "webp"].includes(video?.codec_name) ? undefined : number(format.duration) || number(video?.duration) || number(audio?.duration),
    bitrate: kind === "image" ? undefined : number(format.bit_rate),
    embeddedDate: timestamp(tag(format.tags, "creation_time") || tag(video?.tags, "creation_time")),
    software: tag(format.tags, "encoder") || tag(format.tags, "software") || tag(video?.tags, "encoder"),
    video: kind === "video" && video ? {
      codec: label(video.codec_name), width: number(video.width), height: number(video.height),
      rotation: Number.isFinite(rotation) && rotation !== 0 ? rotation : undefined,
      displayAspect: label(video.display_aspect_ratio?.replace(/^0:1$/, "")),
      pixelAspect: label(video.sample_aspect_ratio?.replace(/^0:1$/, "")),
      frameRate: rate(video.avg_frame_rate) || rate(video.r_frame_rate), frames: number(video.nb_frames),
      bitrate: number(video.bit_rate), depth: pixelDepth(video), pixelFormat: label(video.pix_fmt),
      colors: colors(video), scan: label(video.field_order),
    } : undefined,
    image: kind === "image" && video ? {
      width: number(video.width), height: number(video.height), pixelFormat: label(video.pix_fmt), colors: colors(video),
      depth: pixelDepth(video),
    } : undefined,
    audio: audio ? {
      codec: label(audio.codec_name), sampleRate: number(audio.sample_rate), channels: number(audio.channels),
      layout: label(audio.channel_layout), bitrate: number(audio.bit_rate),
      depth: number(audio.bits_per_raw_sample) || number(audio.bits_per_sample),
      compression: /^pcm_/.test(audio.codec_name || "") ? "无压缩 PCM" : /^(flac|alac|wavpack)$/.test(audio.codec_name || "") ? "无损压缩" : /^(aac|mp3|opus|vorbis|ac3)$/.test(audio.codec_name || "") ? "有损压缩" : undefined,
    } : undefined,
    audioTrackCount: kind === "video" && video ? audioStreams.length : undefined,
    track: kind === "audio" ? Object.fromEntries(["title", "artist", "album", "genre", "track"].map(key => [key, tag(tags, key)])) : undefined,
  };
}

async function probe(filePath, kind) {
  // Never start a player, accept remote protocols, or probe every file in the grid.
  if (!["video", "audio", "image"].includes(kind)) return {};
  const result = await run(probeBin, [
    "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", formats,
    "-max_alloc", "67108864", "-probesize", "5000000", "-analyzeduration", "4000000",
    "-show_format", "-show_streams", "-of", "json", path.resolve(filePath),
  ], { timeout: 4500, killSignal: "SIGKILL", maxBuffer: 256 * 1024, windowsHide: true });
  return normalizeProbeData(JSON.parse(result.stdout), kind);
}

export async function readAssetFileInspector({ filePath, stats, kind } = {}) {
  const basics = {
    kind, size: stats.size, modifiedAt: timestamp(stats.mtimeMs), createdAt: timestamp(stats.birthtimeMs > 0 ? stats.birthtimeMs : null),
    filename: path.basename(filePath), directory: path.dirname(filePath), path: filePath,
    format: path.extname(filePath).slice(1).toUpperCase(),
  };
  if (!["image", "video", "audio"].includes(kind)) return basics;
  const key = JSON.stringify([filePath, stats.mtimeMs, stats.size, stats.ctimeMs]);
  if (successful.has(key)) return { ...basics, ...successful.get(key) };
  if (!pending.has(key) && pending.size < 3) {
    pending.set(key, (async () => {
      let metadata = {}, status = "ready";
      try { metadata = await probe(filePath, kind); }
      catch (error) { status = error.code === "ENOENT" ? "unavailable" : "partial"; }
      if (kind === "image" && !metadata.image?.width) {
        const dimensions = await readImageDimensions(filePath).catch(() => null);
        if (dimensions) metadata.image = { ...metadata.image, ...dimensions };
      }
      const value = { ...metadata, status };
      if (status === "ready") {
        successful.set(key, value);
        if (successful.size > 128) successful.delete(successful.keys().next().value);
      }
      return value;
    })().finally(() => pending.delete(key)));
  }
  return { ...basics, ...(pending.has(key) ? await pending.get(key) : { status: "busy" }) };
}
