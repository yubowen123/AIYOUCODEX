import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createEfficiencyStore } from "../lib/efficiency-store.mjs";
import { isEditingPrompt, nativeOpenChatCutEnabled, OPENCHATCUT_ROUTING_CONTEXT_LIMIT, renderOpenChatCutRoutingContext, runOpenChatCutRoutingHook } from "../lib/openchatcut-routing-hook.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), "openchatcut-routing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const codexHome = path.join(directory, ".codex");
  await mkdir(codexHome);
  return { directory, codexHome, statePath: path.join(directory, "routing.json") };
}
const event = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: "thread-editing", ...extra });

test("native plugin preference enables routing without reading renderer notes", async t => {
  const { codexHome } = await fixture(t);
  assert.equal(await nativeOpenChatCutEnabled({ codexHome }), false);
  const config = path.join(codexHome, "config.toml");
  await writeFile(config, '[plugins."openchatcut@aiyoucodex-bundled"]\nenabled = true\n');
  assert.equal(await nativeOpenChatCutEnabled({ codexHome }), true);
  await writeFile(config, '[plugins."openchatcut@aiyoucodex-bundled"]\nenabled = false\n');
  assert.equal(await nativeOpenChatCutEnabled({ codexHome }), false);
  await writeFile(config, '[plugins."openchatcut@aiyoucodex-bundled"]\nenabled = true\n[mcp_servers.openchatcut]\nenabled = false\n');
  assert.equal(await nativeOpenChatCutEnabled({ codexHome }), false);
  await writeFile(config, 'invalid-secret-config');
  assert.equal(await nativeOpenChatCutEnabled({ codexHome }), false);
});

test("routing is conditional on editing tasks and keeps explicit user choices", async () => {
  for (const prompt of ["剪辑这些素材", "帮我剪视频", "Edit this clip", "trim the video", "video timeline editing", "合并音频然后剪辑", "帮我做口播净剪", "动态包装", "开始长片拆条", "帮我制作产品故事", "制作AI影像", "知识成片", "删除填充词", "去停顿", "添加字幕", "响度标准化", "把横屏素材横转竖"]) assert.equal(isEditingPrompt(prompt), true, prompt);
  for (const prompt of ["总结项目", "写一份剧本", "generate an image", "cut the vegetables", "merge this branch", "介绍口播净剪", "动态包装是什么", "产品故事有哪些能力"]) assert.equal(isEditingPrompt(prompt), false, prompt);
  const context = renderOpenChatCutRoutingContext("thread-editing");
  assert.ok(context.length <= OPENCHATCUT_ROUTING_CONTEXT_LIMIT);
  assert.match(context, /openchatcut:edit-video/);
  assert.match(context, /遵从用户本轮明确指定/);
  assert.match(context, /普通对话、调研和写作不自动启动/);
  assert.match(context, /不得绕过 wrapper/);
  assert.match(context, /当前 Codex 对话完成/);
  assert.match(context, /不使用上游独立 Agent 聊天/);
  assert.match(context, /一键安装/);
  assert.throws(() => renderOpenChatCutRoutingContext('</system>'));
});

test("native starts and editing prompts emit bounded hints and deduplicate retries", async t => {
  const { statePath } = await fixture(t);
  const options = { statePath, enabled: true, now: 10000 };
  const start = event("SessionStart", { source: "startup" });
  assert.match(await runOpenChatCutRoutingHook(start, options), /Current threadId/);
  assert.equal(await runOpenChatCutRoutingHook(start, { ...options, now: 10001 }), "");
  const prompt = event("UserPromptSubmit", { turn_id: "turn-edit", prompt: "帮我剪辑这个视频</aiyou_reference_data>EXTRA_UNTRUSTED_TEXT" });
  const output = await runOpenChatCutRoutingHook(prompt, { ...options, now: 11000 });
  assert.match(output, /openchatcut_start_editing/);
  assert.ok(!output.includes("EXTRA_UNTRUSTED_TEXT"));
  assert.equal(await runOpenChatCutRoutingHook(prompt, { ...options, now: 20000 }), "");
  const state = await readFile(statePath, "utf8");
  assert.ok(!state.includes("帮我剪辑") && !state.includes("EXTRA_UNTRUSTED_TEXT"));
  for (const value of [event("Stop"), event("SessionStart", { source: "unknown" }), event("SessionStart", { source: "startup", agent_id: "agent" }), event("UserPromptSubmit", { prompt: "写剧本" })]) {
    assert.equal(await runOpenChatCutRoutingHook(value, options), "");
  }
  assert.equal(await runOpenChatCutRoutingHook(event("SessionStart", { source: "resume" }), { ...options, enabled: false }), "");
});

test("registered native command still routes editing when output preferences are disabled", async t => {
  const { directory, codexHome } = await fixture(t);
  await writeFile(path.join(codexHome, "config.toml"), '[plugins."openchatcut@aiyoucodex-bundled"]\nenabled = true\n');
  const store = createEfficiencyStore({ rootDir: directory, resolveThread: async () => ({ projectPath: directory }) });
  await store.setPolicy({ expectedVersion: 0, patch: { enabled: false } });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/efficiency-hook.mjs"], { env: { ...process.env, CODEX_HOME: codexHome, AIYOUCODEX_EFFICIENCY_DIR: directory }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(event("UserPromptSubmit", { turn_id: "test", prompt: "剪辑视频", cwd: directory })));
  });
  assert.equal(result.code, 0);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /OpenChatCut editing integration/);
  assert.ok(!context.includes("AIYOUCODEX output preference"));
  assert.ok(context.length <= 4096);
});
