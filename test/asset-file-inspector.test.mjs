import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readAssetFileInspector } from "../vendor/codex-workspace-enhancer/asset-browser/asset-file-inspector.js";

const run = promisify(execFile);
test("selected file facts come from real media, retain unknown values, and separate track data from source metadata", async t => {
  try { await run("ffmpeg", ["-version"]); }
  catch (error) { if (error.code === "ENOENT") return t.skip("ffmpeg is required for synthetic source media"); throw error; }
  const folder = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || tmpdir(), "asset-file-facts-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const paths = ["still.png", "silent.mp4", "song.flac"].map(name => path.join(folder, name));
  const make = (target, args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, target]);
  await Promise.all([
    make(paths[0], ["-f", "lavfi", "-i", "color=blue:s=80x48", "-frames:v", "1", "-threads", "1"]),
    make(paths[1], ["-f", "lavfi", "-i", "testsrc2=size=160x96:rate=24", "-t", "1", "-c:v", "mpeg4", "-threads", "1", "-an"]),
    make(paths[2], ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-ac", "2", "-metadata", "title=Demo Track", "-metadata", "artist=Fixture Studio", "-c:a", "flac"]),
  ]);
  const [image, video, audio] = await Promise.all(paths.map(async (filePath, i) => readAssetFileInspector({ filePath, stats: await stat(filePath), kind: ["image", "video", "audio"][i] })));
  assert.deepEqual([image.image.width, image.image.height, image.image.depth], [80, 48, 8]);
  assert.deepEqual([video.video.width, video.video.height, video.video.frameRate, video.video.frames, video.audioTrackCount], [160, 96, 24, 24, 0]);
  assert.equal(video.audio, undefined);
  assert.equal(video.duration, 1);
  assert.deepEqual([audio.audio.sampleRate, audio.audio.channels, audio.audio.compression, audio.track.title, audio.track.artist], [48000, 2, "无损压缩", "Demo Track", "Fixture Studio"]);
  assert.equal(audio.track.album, undefined);
  assert.equal(audio.filename, "song.flac");
  assert.ok(audio.size && audio.modifiedAt && audio.createdAt);
});
