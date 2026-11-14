import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexPromptAssociationStore } from "../vendor/codex-workspace-enhancer/asset-browser/codex-prompt-associations.js";

test("imports Codex image generation events and keeps the prompt linked to the exact output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-prompt-links-"));
  try {
    const sessionsRoot = path.join(root, "sessions");
    const generatedRoot = path.join(root, "generated_images");
    const threadId = "019fe61d-6a11-7cf1-926b-435b108624b6";
    const sessionDirectory = path.join(sessionsRoot, "2026", "08", "20");
    const outputDirectory = path.join(generatedRoot, threadId);
    await Promise.all([mkdir(sessionDirectory, { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
    const callId = "exec-30c19a92-4dfd-413a-8aaa-87acdd92a0dc";
    const outputPath = path.join(outputDirectory, `${callId}.png`);
    await writeFile(outputPath, "image");
    await writeFile(path.join(sessionDirectory, "rollout.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-20T01:00:00.000Z", type: "session_meta", payload: { id: threadId, cwd: "/work/current-project" } }),
      JSON.stringify({ timestamp: "2026-08-20T01:01:00.000Z", type: "event_msg", payload: { type: "image_generation_end", call_id: callId, status: "completed", revised_prompt: "九比十六竖版角色全身设定图" } }),
      "",
    ].join("\n"));

    const store = new CodexPromptAssociationStore({
      registryPath: path.join(root, "associations.json"),
      sessionsRoot,
      generatedImagesRoot: generatedRoot,
      lookbackDays: 365,
    });
    const synced = await store.syncCodexSessions();
    assert.equal(synced.imported, 1);
    const association = await store.get(outputPath);
    assert.equal(association.kind, "image");
    assert.equal(association.prompt, "九比十六竖版角色全身设定图");
    assert.equal(association.threadId, threadId);
    assert.equal(association.cwd, "/work/current-project");
    assert.equal(association.source, "codex-session");
    await store.register({ assetPath: outputPath, prompt: "手动补全的原始提示词" });
    await appendFile(path.join(sessionDirectory, "rollout.jsonl"), JSON.stringify({
      type: "event_msg", payload: { type: "image_generation_end", call_id: callId, revised_prompt: "后续到达的生成事件" },
    }) + "\n");
    await store.syncCodexSessions();
    assert.equal((await store.get(outputPath)).prompt, "手动补全的原始提示词");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers exact markdown companion files and disambiguates shared media stems", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-prompt-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new CodexPromptAssociationStore({ registryPath: path.join(root, "associations.json") });
  const image = path.join(root, "镜头.PNG");
  const video = path.join(root, "镜头.mp4");
  const shared = path.join(root, "镜头.prompt.md");
  await writeFile(image, "image");
  await writeFile(shared, "固定机位，没有字幕");
  assert.equal((await store.get(image)).prompt, "固定机位，没有字幕");
  await writeFile(video, "video");
  assert.equal(await store.get(image), null);
  assert.equal(await store.get(video), null);
  await writeFile(shared, [
    "# 生成提示词与结果记录", "", "- 结果文件：镜头.mp4", "- 生成工具：Seedance", "- 模型：v2",
    "## 正向提示词", "", "雨中开始", "### 运镜", "保持水平", "", "## 负向提示词 / 稳定性约束", "",
    "不要字幕", "", "## 参考素材", "", "- 镜头.PNG", "", "## 生成参数", "", "\x60\x60\x60json",
    '{"duration":5}', "\x60\x60\x60", "", "## 备注", "", "不作为提示词",
  ].join("\n"));
  assert.equal(await store.get(image), null);
  const linked = await store.get(video);
  assert.equal(linked.source, "markdown-sidecar");
  assert.equal(linked.prompt, "雨中开始\n### 运镜\n保持水平");
  assert.equal(linked.negativePrompt, "不要字幕");
  assert.equal(linked.generator, "Seedance");
  assert.equal(linked.model, "v2");
  assert.deepEqual(linked.references, ["镜头.PNG"]);
  assert.deepEqual(linked.settings, { duration: 5 });
  await writeFile(image + ".prompt.md", "独立图片提示词");
  assert.equal((await store.get(image)).prompt, "独立图片提示词");

  const oversized = path.join(root, "oversized.png");
  await writeFile(oversized, "image");
  await writeFile(oversized + ".prompt.md", Buffer.alloc(256 * 1024 + 1, 65));
  assert.equal(await store.get(oversized), null);
  if (process.platform !== "win32") {
    const symlinked = path.join(root, "link.png");
    await writeFile(symlinked, "image");
    await symlink(image + ".prompt.md", symlinked + ".prompt.md");
    assert.equal(await store.get(symlinked), null);
  }
});

test("registers video and audio prompts and reads existing generation sidecars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-prompt-links-"));
  try {
    const store = new CodexPromptAssociationStore({
      registryPath: path.join(root, "associations.json"),
      sessionsRoot: path.join(root, "sessions"),
      generatedImagesRoot: path.join(root, "generated_images"),
    });
    const videoPath = path.join(root, "trailer.mp4");
    const audioPath = path.join(root, "character.wav");
    await Promise.all([writeFile(videoPath, "video"), writeFile(audioPath, "audio")]);
    await store.register({
      assetPath: videoPath,
      kind: "video",
      prompt: "末日城市预告片，缓慢推镜",
      negativePrompt: "不要字幕",
      generator: "Seedance",
      model: "2.5",
      threadId: "video-thread",
    });
    await writeFile(`${audioPath.slice(0, -path.extname(audioPath).length)}.meta.json`, JSON.stringify({
      schemaVersion: 1,
      ticket: {
        kind: "audio",
        prompt: "冷静克制的成年女性角色声音",
        negativePrompt: "避免机械感",
        generator: "local-tts",
        model: "voice-v1",
        references: ["voice-reference.wav"],
        sourceContext: { threadId: "audio-thread" },
      },
    }));

    const video = await store.get(videoPath);
    assert.equal(video.kind, "video");
    assert.equal(video.prompt, "末日城市预告片，缓慢推镜");
    assert.equal(video.negativePrompt, "不要字幕");
    const audio = await store.get(audioPath);
    assert.equal(audio.kind, "audio");
    assert.equal(audio.prompt, "冷静克制的成年女性角色声音");
    assert.equal(audio.threadId, "audio-thread");
    assert.deepEqual(audio.references, ["voice-reference.wav"]);
    assert.deepEqual(await store.summary(audioPath), {
      available: true,
      source: "generation-sidecar",
      kind: "audio",
      generator: "local-tts",
      model: "voice-v1",
      threadId: "audio-thread",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
