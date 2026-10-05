export const CLAUDE_PANEL_COMMANDS = [
  { name: "help", description: "查看快捷指令与使用说明", argumentHint: "", kind: "panel" },
  { name: "clear", description: "新建空白对话，原会话和运行中的任务保留", argumentHint: "", kind: "panel" },
  { name: "resume", description: "选择并继续已有 Claude 会话", argumentHint: "[会话名称或 ID]", kind: "panel" },
  { name: "permissions", description: "切换手动确认 / Auto 始终允许", argumentHint: "[auto|manual]", kind: "panel" },
  { name: "skills", description: "打开 Skills 引用列表，搜索并选择技能", argumentHint: "[搜索词]", kind: "panel" },
  { name: "mcp", description: "打开 MCP 引用列表，查看工具连接", argumentHint: "[搜索词]", kind: "panel" },
  { name: "status", description: "查看当前项目、模型、权限和会话状态", argumentHint: "", kind: "panel" },
];
const COMMON = [
  { name: "compact", description: "压缩当前对话上下文，保留重要信息", argumentHint: "[需要保留的内容]" },
  { name: "context", description: "查看上下文占用与组成", argumentHint: "" },
  { name: "usage", description: "查看 Claude 返回的使用情况", argumentHint: "" },
  { name: "model", description: "查看或切换 Claude 模型", argumentHint: "[模型名称]" },
  { name: "init", description: "为项目生成 CLAUDE.md 工作指引", argumentHint: "" },
  { name: "code-review", description: "检查项目代码并给出审查建议", argumentHint: "[审查范围]" },
];
const terminalCommands = new Set(["theme", "terminal-setup", "exit", "quit", "statusline", "login", "logout"]);
export function normalizeClaudeCommands(entries = [], terminal = []) {
  if (!Array.isArray(entries)) return [];
  const excluded = new Set([...terminalCommands, ...terminal]);
  const result = new Map();
  for (const entry of entries.slice(0, 500)) {
    const value = typeof entry === "string" ? { name: entry } : entry;
    const name = typeof value?.name === "string" ? value.name.replace(/^\//u, "") : "";
    if (!/^[\p{L}\p{N}._:@-]{1,160}$/u.test(name) || excluded.has(name)) continue;
    const old = result.get(name);
    if (old?.builtin && !value.builtin) continue;
    const known = COMMON.find(c => c.name === name);
    result.set(name, { name, description: String(value.description || known?.description || "Claude 当前会话提供的指令").slice(0, 1000),
      argumentHint: String(value.argumentHint || known?.argumentHint || "").slice(0, 200), builtin: value.builtin === true,
      aliases: Array.isArray(value.aliases) ? value.aliases.filter(a => typeof a === "string" && /^[\p{L}\p{N}._:@-]{1,160}$/u.test(a)).slice(0, 20) : [] });
  }
  // A named command wins over another command's alias, matching the SDK.
  for (const entry of [...result.values()]) for (const alias of entry.aliases) {
    if (!excluded.has(alias) && !result.has(alias)) result.set(alias, { ...entry, name: alias, aliases: [], aliasFor: entry.name });
  }
  return [...result.values()];
}
export function claudeCommandCatalog(commands = []) {
  const result = new Map(CLAUDE_PANEL_COMMANDS.map(c => [c.name, { ...c, source: "面板操作" }]));
  for (const c of normalizeClaudeCommands(commands)) if (!result.has(c.name)) result.set(c.name, { ...c, kind: "sdk", verified: true, source: "Claude Code" });
  for (const c of COMMON) if (!result.has(c.name)) result.set(c.name, { ...c, kind: "sdk", verified: false, source: "发送前校验" });
  return [...result.values()];
}
export function claudeSlashName(prompt) {
  return typeof prompt === "string" ? prompt.trimStart().match(/^\/([\p{L}\p{N}._:@-]{1,160})(?:\s|$)/u)?.[1] || "" : "";
}
