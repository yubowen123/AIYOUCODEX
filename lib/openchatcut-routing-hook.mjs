import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { efficiencyRootPath, readEfficiencyJson, validateEfficiencyThreadId, withEfficiencyFileLock, writeEfficiencyJson } from "./efficiency-store.mjs";

export const OPENCHATCUT_PLUGIN_ID = "openchatcut@aiyoucodex-bundled";
export const OPENCHATCUT_ROUTING_CONTEXT_LIMIT = 700;
const START_SOURCES = new Set(["startup", "resume", "compact", "clear"]);
const digest = value => createHash("sha256").update(value).digest("hex");

// Read the native host's plugin preference, never renderer notes or Skill content.
export async function nativeOpenChatCutEnabled({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex") } = {}) {
  try {
    const text = await readFile(path.join(codexHome, "config.toml"), "utf8");
    if (Buffer.byteLength(text) > 1024 * 1024) return false;
    // A partial dependency installation must not disable the existing hooks.
    const { parse } = await import("smol-toml");
    const config = parse(text.replace(/^\uFEFF/u, ""));
    return config.plugins?.[OPENCHATCUT_PLUGIN_ID]?.enabled === true && config.mcp_servers?.openchatcut?.enabled !== false;
  } catch { return false; }
}

export function isEditingPrompt(prompt) {
  if (typeof prompt !== "string") return false;
  const bounded = prompt.slice(0, 24000);
  if (/剪辑|剪片|剪视频|视频裁剪|视频拼接|音频剪辑|多机位|时间线|混剪|\b(?:video|audio|film|footage|clip)\b[^\n]{0,100}\b(?:edit|editing|cut|trim|split|merge|splice|montage|timeline)\b|\b(?:edit|editing|cut|trim|split|merge|splice)\b[^\n]{0,100}\b(?:video|audio|film|footage|clips?)\b/iu.test(bounded)) return true;
  if (/调研|介绍|解释|区别|是什么|有哪些能力|如何使用|怎么使用/u.test(bounded)) return false;
  const workflow = /口播净剪|动态包装|长片拆条|产品故事|AI\s*影像|知识成片/u;
  const operation = /删除填充词|删(?:掉|除)?静音|去停顿|跳切|(?:生成|添加|加|修改)字幕|响度标准化|横转竖/u;
  return operation.test(bounded) || workflow.test(bounded) && (/帮|开始|制作|做|处理|改成|使用|工作流/u.test(bounded)
    || /^\s*(?:口播净剪|动态包装|长片拆条|产品故事|AI\s*影像|知识成片)\s*(?:[。，:：！？!?\n]|$)/u.test(bounded));
}

export function renderOpenChatCutRoutingContext(threadId) {
  const id = validateEfficiencyThreadId(threadId);
  return [
    "[AIYOUcodex OpenChatCut editing integration]",
    "仅在用户请求视频、音频或时间线剪辑时，默认读取并使用已安装的 openchatcut:edit-video Skill，通过 openchatcut MCP 插件执行。遵从用户本轮明确指定的工具、素材及操作约束；普通对话、调研和写作不自动启动剪辑器。",
    "开始剪辑先调用 openchatcut_start_editing，将当前 threadId 传入 wrapper 工具；此入口负责打开右侧编辑器并同步执行。使用 openchatcut_list_tools/openchatcut_call_tool 或 occ_ 工具；不得绕过 wrapper 直连上游 MCP。",
    "剪辑规划和指令由当前 Codex 对话完成。口播净剪、动态包装、长片拆条、产品故事、AI 影像、知识成片及快捷编辑按 Skill 的 workflows 参考执行；右侧只保留素材、预览与时间线，不使用上游独立 Agent 聊天。模型生成和转写仍按实际资源、供应商与授权规则处理。",
    "应用尚未安装时，使用插件返回的安装状态，引导用户从设置或左侧 OpenChatCut 入口一键安装；不得声称已剪辑或已同步。插件被用户禁用时不强制启用。",
    `Current threadId: ${JSON.stringify(id)}`,
  ].join("\n");
}

/** Only called with the native host's stdin event. The efficiency toggle is independent. */
export async function runOpenChatCutRoutingHook(event, { codexHome, statePath = path.join(efficiencyRootPath(), "openchatcut-routing.json"),
  enabled, now = Date.now() } = {}) {
  const eventName = event?.hook_event_name;
  if (!["SessionStart", "UserPromptSubmit"].includes(eventName) || event?.agent_id || event?.agent_type) return "";
  if (eventName === "SessionStart" && !START_SOURCES.has(event.source)) return "";
  if (eventName === "UserPromptSubmit" && !isEditingPrompt(event.prompt)) return "";
  if (!(enabled ?? await nativeOpenChatCutEnabled({ codexHome }))) return "";
  const threadId = validateEfficiencyThreadId(event.session_id);
  const turnId = typeof event.turn_id === "string" && event.turn_id.length <= 128 ? event.turn_id : "";
  const fingerprint = digest(JSON.stringify([eventName, event.source || "", turnId, event.event_id || "", typeof event.prompt === "string" ? event.prompt : ""]));
  return withEfficiencyFileLock(statePath, async () => {
    const state = await readEfficiencyJson(statePath, { schemaVersion: 1, sessions: {} });
    if (state.schemaVersion !== 1 || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)) return "";
    const previous = state.sessions[threadId];
    if (previous?.fingerprint === fingerprint && (turnId || now - previous.observedAt < 1500)) return "";
    state.sessions[threadId] = { fingerprint, observedAt: now };
    const ids = Object.keys(state.sessions);
    if (ids.length > 1024) {
      ids.sort((a, b) => state.sessions[a].observedAt - state.sessions[b].observedAt);
      for (const id of ids.slice(0, ids.length - 1024)) delete state.sessions[id];
    }
    await writeEfficiencyJson(statePath, state);
    return renderOpenChatCutRoutingContext(threadId);
  }, { timeoutMs: 1000 });
}
