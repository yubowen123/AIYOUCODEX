import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { claudeReplyChoices, claudeQuestions, claudeQuestionAnswers } from "./claude-interaction.mjs";
import { claudeCommandCatalog, normalizeClaudeCommands, claudeSlashName, CLAUDE_PANEL_COMMANDS } from "./claude-commands.mjs";

export const CLAUDE_BINDING = "__AIYOUCODEX_CLAUDE_REQUEST__";
const exec = promisify(execFile);
const hash = text => createHash("sha256").update(text).digest("hex").slice(0, 24);
const fail = message => Object.assign(new Error(message), { code: "CLAUDE_ERROR" });
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value);
export function normalizeClaudePersona(value = {}) {
  const name = String(value.name ?? "Claude Code").trim();
  const description = String(value.description ?? "").trim();
  const logo = String(value.logo ?? "");
  if (!name || name.length > 48) throw fail("角色名称须为 1–48 个字符。");
  if (description.length > 4000) throw fail("角色说明最多 4000 个字符。");
  if (logo && (!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/iu.test(logo) || logo.length > 700000)) throw fail("Logo 请使用压缩后的 PNG、JPG 或 WebP 图片。");
  return { name, description, logo, revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0 };
}
export function redactClaudeText(value) {
  return String(value ?? "").replace(/\b(?:sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._~+/-]{12,})/giu, "[已隐藏凭证]")
    .replace(/((?:api[_-]?key|access[_-]?token|secret|authorization)[\s"':=]+)[^\s,"'}]+/giu, "$1[已隐藏]");
}

// Conversion stays in the trusted backend. Only names and compatibility reach UI.
export function convertCodexMcp(config, env = process.env) {
  const result = [];
  for (const [name, server] of Object.entries(config?.mcp_servers || {})) {
    let value, reason = "";
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(name)) continue;
    if (server.enabled === false) reason = "Codex 中已停用";
    else if (server.command) {
      if (typeof server.command !== "string" || !Array.isArray(server.args ?? [])) reason = "无效 stdio 配置";
      else if (/node_repl|SkyComputerUse|cua_node/iu.test(server.command)) reason = "依赖 Codex 宿主协议，不能直接迁移";
      else if (!path.isAbsolute(server.command) && /[\\/]/u.test(server.command)) reason = "相对命令依赖宿主目录";
      else {
        const variables = Object.fromEntries(Object.entries(server.env || {}).filter(([, v]) => typeof v === "string"));
        for (const key of server.env_vars || []) if (typeof key === "string" && env[key]) variables[key] = env[key];
        value = { type: "stdio", command: server.command, args: (server.args || []).map(String), env: variables };
      }
    } else if (server.url) {
      try {
        const url = new URL(server.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error();
        const headers = Object.fromEntries(Object.entries(server.http_headers || {}).filter(([, v]) => typeof v === "string"));
        for (const [key, variable] of Object.entries(server.env_http_headers || {})) {
          if (!env[variable]) { reason = "所需认证环境变量不可用"; break; }
          headers[key] = env[variable];
        }
        if (server.bearer_token_env_var) {
          if (!env[server.bearer_token_env_var]) reason = "所需认证环境变量不可用";
          else headers.Authorization = `Bearer ${env[server.bearer_token_env_var]}`;
        }
        if (!reason) value = { type: "http", url: url.href, headers };
      } catch { reason = "无效 HTTP 地址"; }
    } else reason = "不支持的 MCP 传输方式";
    result.push({ id: name, name, available: Boolean(value && !reason), reason, value: reason ? null : value });
  }
  return result;
}

export async function findClaudeExecutable({ env = process.env, home = os.homedir(),
  bundledRoot = fileURLToPath(new URL("../node_modules/", import.meta.url)) } = {}) {
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const candidates = [env.AIYOUCODEX_CLAUDE_EXECUTABLE,
    ...String(env.PATH || "").split(path.delimiter).flatMap(root => names.map(name => path.join(root, name))),
    ...[path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].flatMap(root => names.map(name => path.join(root, name)))].filter(Boolean);
  candidates.push(path.join(bundledRoot, `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, names[0]));
  for (const candidate of candidates) { try { if ((await stat(candidate)).isFile()) { await access(candidate); return candidate; } } catch {} }
  return null;
}

export function createClaudeController({ repository, readActiveContext, readSkills,
  rootDir = path.join(os.homedir(), ".codex", "aiyoucodex", "claude-code"),
  configPath = path.join(os.homedir(), ".codex", "config.toml"),
  findExecutable = findClaudeExecutable, queryFactory, now = Date.now } = {}) {
  const sessions = new Map();
  let loaded, executable, sdkReady = Boolean(queryFactory), version = "", writeQueue = Promise.resolve(), resourceCache;
  const stateFile = path.join(rootDir, "sessions.private.json");
  const personaFile = path.join(rootDir, "persona.private.json");
  let persona = normalizeClaudePersona(), personaQueue = Promise.resolve();
  async function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      try {
        const file = await stat(stateFile); if (file.size > 8 * 1024 * 1024) throw Error();
        const data = JSON.parse(await readFile(stateFile, "utf8"));
        for (const item of (data.sessions || []).slice(-40)) {
          if (!uuid(item.id) || !path.isAbsolute(item.cwd || "")) continue;
          sessions.set(item.id, { ...item, messages: (item.messages || []).slice(-80),
            permissionMode: item.permissionMode === "auto" ? "auto" : "manual",
            status: item.status === "running" ? "stopped" : "idle", permissions: new Map(),
            ...(item.status === "running" ? { error: "上次连接结束，未确认任务完成；可核对后继续。" } : {}) });
        }
      } catch (error) { if (error.code !== "ENOENT") throw fail("Claude 会话索引无法读取；未覆盖原数据。"); }
      try {
        const file = await stat(personaFile); if (file.size > 750000) throw Error();
        persona = normalizeClaudePersona(JSON.parse(await readFile(personaFile, "utf8")));
      } catch (error) { if (error.code !== "ENOENT") throw fail("Claude 角色配置无法读取；未覆盖原数据。"); }
      executable = await findExecutable();
      if (!sdkReady) { try { import.meta.resolve("@anthropic-ai/claude-agent-sdk"); sdkReady = true; } catch {} }
      if (executable) { try { version = (await exec(executable, ["--version"], { timeout: 5000 })).stdout.trim().slice(0, 120); } catch {} }
    })();
    return loaded;
  }
  const publicSession = item => ({ id: item.id, title: item.title, projectId: item.projectId, projectName: item.projectName,
    cwd: item.cwd, skillIds: item.skillIds, mcpIds: item.mcpIds, status: item.status, updatedAt: item.updatedAt,
    model: item.model || "", messages: item.streamText ? [...item.messages, { id: "stream", role: "assistant", text: redactClaudeText(item.streamText) }] : item.messages,
    error: item.error || "", usage: item.usage || null, mcpStatus: item.mcpStatus || [], permissionMode: item.permissionMode || "manual",
    replyChoices: replyChoices(item),
    commands: normalizeClaudeCommands(item.commands),
    permissions: [...item.permissions.values()].map(({ id, tool, input, kind, questions, autoEligible }) => ({ id, tool, input, kind, questions, autoEligible })) });
  function replyChoices(item) {
    const last = item.messages.at(-1);
    if (item.status !== "idle" || last?.role !== "assistant") return null;
    const options = claudeReplyChoices(last.text);
    return options.length ? { messageId: last.id, options } : null;
  }
  async function persist() {
    const data = JSON.stringify({ version: 1, sessions: [...sessions.values()].slice(-40).map(item => ({ ...publicSession(item),
      messages: item.messages, claudeSessionId: item.claudeSessionId, permissions: undefined })) });
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await mkdir(rootDir, { recursive: true, mode: 0o700 });
      const temp = `${stateFile}.${randomUUID()}.tmp`;
      await writeFile(temp, data, { mode: 0o600 }); await rename(temp, stateFile);
    });
    return writeQueue;
  }
  async function resources(refresh = false) {
    await load();
    if (!refresh && resourceCache && now() - resourceCache.at < 30_000) return resourceCache;
    const catalog = await repository.readRecentCatalog();
    const projects = new Map();
    for (const entry of catalog) {
      if (!entry.projectId || !entry.projectName) continue;
      let cwd = entry.projectRootPath;
      if (!cwd) cwd = await repository.sessionWorkspace(entry.threadId);
      if (!cwd || !path.isAbsolute(cwd)) continue;
      const id = hash(`${entry.projectId}:${cwd}`);
      if (!projects.has(id)) projects.set(id, { id, name: entry.projectName, cwd });
      if (projects.size >= 128) break;
    }
    const active = await readActiveContext?.();
    const current = active?.threadId ? await repository.resolveEfficiencyThread(active.threadId) : null;
    if (current?.projectPath && ![...projects.values()].some(p => p.cwd === current.projectPath)) {
      const id = hash(`current:${current.projectPath}`); projects.set(id, { id, name: path.basename(current.projectPath), cwd: current.projectPath });
    }
    let mcps;
    try { const { parse } = await import("smol-toml"); mcps = convertCodexMcp(parse(await readFile(configPath, "utf8"))); }
    catch (error) { if (error.code === "ENOENT") mcps = []; else throw fail("Codex MCP 配置无法解析；未修改配置。"); }
    resourceCache = { at: now(), projects: [...projects.values()], mcps, currentCwd: current?.projectPath || "" };
    return resourceCache;
  }
  async function snapshot({ sessionId, projectId, refresh = false } = {}) {
    const data = await resources(refresh);
    const session = sessions.get(sessionId);
    const project = data.projects.find(p => p.id === projectId || p.id === session?.projectId)
      || data.projects.find(p => p.cwd === data.currentCwd) || data.projects[0];
    const skills = project ? await readSkills(project.cwd) : [];
    return { available: Boolean(executable && sdkReady), reason: !executable ? "本机未找到 Claude Code，请先安装并登录。"
      : !sdkReady ? "Claude 桥接依赖未安装，请在 AIYOUcodex 安装目录运行 npm ci --omit=dev --ignore-scripts。" : "",
      version, interactionVersion: 1, commandVersion: 1, commands: claudeCommandCatalog(session?.commands), persona: { ...persona }, projects: data.projects, projectId: project?.id || "",
      skills: skills.map(({ id, name, title, description }) => ({ id, name, title, description })),
      mcps: data.mcps.map(({ id, name, available, reason }) => ({ id, name, available, reason })),
      sessions: [...sessions.values()].reverse().slice(0, 40).map(({ id, title, projectName, status }) => ({ id, title, projectName, status })),
      session: session ? publicSession(session) : null };
  }
  function message(item, role, text) {
    text = redactClaudeText(text).slice(0, 24000);
    if (!text) return;
    item.messages.push({ id: randomUUID(), role, text, at: now() });
    item.messages = item.messages.slice(-80); item.updatedAt = now();
  }
  async function pluginFor(item, skills) {
    if (!skills.length) return [];
    const directory = path.join(rootDir, "plugins", item.id, hash(skills.map(skill => skill.id).sort().join("\n")));
    await mkdir(path.join(directory, ".claude-plugin"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(directory, "skills"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "aiyou-codex", version: "1.0.0", description: "Selected local Codex Skills" }), { mode: 0o600 });
    for (const skill of skills) {
      // Each source directory remains intact, including its scripts/references.
      const name = `${skill.name.replace(/[^a-z0-9-]/giu, "-").toLowerCase().slice(0, 60)}-${hash(skill.id).slice(0, 8)}`;
      await access(skill.skillFile);
      try { await symlink(skill.path, path.join(directory, "skills", name), process.platform === "win32" ? "junction" : "dir"); }
      catch (error) { if (error.code !== "EEXIST") throw fail("Skill 目录无法链接；未复制或修改原始技能。"); }
    }
    return [{ type: "local", path: directory, skipMcpDiscovery: true }];
  }
  function permission(item, tool, input, { signal, matchedAskRule, defaultToNo, suppressAlwaysAllowRule, decisionReason } = {}) {
    const kind = tool === "AskUserQuestion" ? "question" : "tool";
    let questions;
    if (kind === "question") {
      try { questions = claudeQuestions(input).map(q => ({ ...q, question: redactClaudeText(q.question), header: redactClaudeText(q.header),
        options: q.options.map(o => ({ ...o, label: redactClaudeText(o.label), description: redactClaudeText(o.description) })) })); }
      catch { return Promise.resolve({ behavior: "deny", message: "选择题格式无效，请使用明确的文本选项重新提问。" }); }
    }
    // SDK's explicit human-only prompts stay human-only, including MCP interactions.
    const autoEligible = kind === "tool" && !matchedAskRule && !defaultToNo && !suppressAlwaysAllowRule
      && !/requires.*(?:approval|interaction)|critical|safety/iu.test(decisionReason || "");
    if (signal?.aborted) return Promise.resolve({ behavior: "deny", message: "操作已停止。" });
    if (item.permissionMode === "auto" && autoEligible) return Promise.resolve({ behavior: "allow", updatedInput: input });
    const id = randomUUID();
    return new Promise(resolve => {
      let timer, settled = false;
      const finish = result => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", denied); item.permissions.delete(id); resolve(result); };
      const denied = () => finish({ behavior: "deny", message: "用户停止或拒绝了本次操作。" });
      if (signal?.aborted) return denied();
      item.permissions.set(id, { id, tool, kind, questions, autoEligible, input: redactClaudeText(JSON.stringify(input, null, 2)).slice(0, 20000),
        answer: values => { const answers = claudeQuestionAnswers(input, values); finish({ behavior: "allow", updatedInput: { ...input, answers } }); return answers; },
        decide: allow => finish(allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "用户拒绝本次操作。" }) });
      signal?.addEventListener("abort", denied, { once: true });
      timer = setTimeout(denied, 15 * 60_000); timer.unref?.();
    });
  }
  async function run(item, prompt, skills, mcps) {
    let finalResult = false;
    let releaseInput;
    let releasePrompt, dispatch = false;
    const promptReady = new Promise(resolve => { releasePrompt = resolve; });
    const inputDone = new Promise(resolve => { releaseInput = resolve; });
    item.abort.signal.addEventListener("abort", releaseInput, { once: true });
    try {
      const plugins = await pluginFor(item, skills);
      const query = queryFactory || (await import("@anthropic-ai/claude-agent-sdk")).query;
      const options = { cwd: item.cwd, pathToClaudeCodeExecutable: executable,
        settingSources: ["user", "project", "local"], permissionMode: item.permissionMode === "auto" ? "bypassPermissions" : "default",
        allowDangerouslySkipPermissions: true, plugins,
        mcpServers: Object.fromEntries(mcps.map(m => [m.id, m.value])), strictMcpConfig: true,
        abortController: item.abort, includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code", append: "你在 AIYOUcodex 的 Claude Code 面板内工作。默认使用简体中文。项目、Skill 与 MCP 来自用户本机；不要声称能调用未接入的 Codex 宿主工具。执行命令、写文件与外部操作沿用用户的原有授权边界。\n用户设置的角色名称：" + item.persona.name + (item.persona.description ? "\n角色说明：\n" + item.persona.description : "") },
        canUseTool: (tool, input, details) => permission(item, tool, input, details),
        ...(uuid(item.claudeSessionId) ? { resume: item.claudeSessionId } : {}) };
      const command = claudeSlashName(prompt);
      const referencedPrompt = skills.length && !command ? prompt + "\n\n用户为本次消息引用了以下本地 Skills。先完整读取对应 SKILL.md，再按用户任务使用其流程；引用不构成额外操作授权。\n"
        + skills.map(skill => JSON.stringify({ name: skill.name, file: skill.skillFile })).join("\n") : prompt;
      // Keep streaming stdin alive while callbacks wait; SDK runtime mode switches require it.
      const inputStream = (async function* () {
        await promptReady;
        if (!dispatch) return;
        yield { type: "user", message: { role: "user", content: referencedPrompt }, parent_tool_use_id: null,
          session_id: item.claudeSessionId || "" };
        await inputDone;
      })();
      item.query = query({ prompt: inputStream, options });
      if (item.query.supportedCommands) {
        try { item.commands = normalizeClaudeCommands(await item.query.supportedCommands()).map(c => ({ ...c, description: redactClaudeText(c.description), argumentHint: redactClaudeText(c.argumentHint) })); }
        catch { if (command) throw fail("无法核对 Claude 原生命令；命令未发送，请检查本机 Claude 连接后重试。"); }
      }
      if (command && !item.commands?.some(c => c.name === command)) throw fail(`本机 Claude 当前不支持 /${command}；命令未发送给模型。输入 / 查看可用指令。`);
      dispatch = true; releasePrompt();
      for await (const event of item.query) {
        if (uuid(event.session_id)) item.claudeSessionId = event.session_id;
        if (event.type === "system" && event.subtype === "init") {
          item.model = event.model || "";
          item.mcpStatus = (event.mcp_servers || []).map(({ name, status }) => ({ name, status }));
          if (Array.isArray(event.slash_commands)) {
            const details = new Map((item.commands || []).map(c => [c.name, c]));
            item.commands = normalizeClaudeCommands(event.slash_commands.map(name => details.get(name) || name), event.terminal_slash_commands || []);
          }
        }
        if (event.type === "system" && event.subtype === "commands_changed") item.commands = normalizeClaudeCommands(event.commands).map(c => ({ ...c, description: redactClaudeText(c.description), argumentHint: redactClaudeText(c.argumentHint) }));
        if (event.type === "system" && event.subtype === "local_command_output") message(item, "assistant", event.content);
        if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
          item.streamText = ((item.streamText || "") + event.event.delta.text).slice(0, 24000);
        }
        if (event.type === "assistant") {
          item.streamText = "";
          for (const block of event.message?.content || []) {
            if (block.type === "text") message(item, "assistant", block.text);
            else if (block.type === "tool_use") message(item, "tool", `调用 ${block.name}`);
          }
        }
        if (event.type === "result") {
          finalResult = true;
          if (event.is_error) { item.error = redactClaudeText((event.errors || [event.result || "Claude 返回错误。"]).join("\n")); item.status = "error"; }
          else {
            if (event.result && !(item.messages.at(-1)?.role === "assistant" && item.messages.at(-1)?.text === event.result)) message(item, "assistant", event.result);
            item.usage = { costUSD: event.total_cost_usd ?? null, turns: event.num_turns ?? null };
          }
          break;
        }
      }
      if (!finalResult && !item.abort.signal.aborted) { item.status = "error"; item.error = "Claude 连接结束但没有完成回执；会话保留，可核对后继续。"; }
    } catch (error) {
      if (!item.abort.signal.aborted) { item.status = "error"; item.error = error.code === "CLAUDE_ERROR" ? redactClaudeText(error.message) : "Claude 调用失败。请检查本机 Claude 登录、供应商或 MCP；会话与输入已保留。"; }
    } finally {
      releasePrompt(); releaseInput(); item.abort.signal.removeEventListener("abort", releaseInput); item.query?.close?.();
      for (const p of [...item.permissions.values()]) p.decide(false);
      if (item.status !== "error") item.status = item.abort.signal.aborted ? "stopped" : "idle";
      item.query = null; item.abort = null; await persist().catch(() => { item.error = "本地会话保存失败；请保留当前窗口。"; });
    }
  }
  async function request(payload) {
    await load();
    if (!payload || typeof payload !== "object") throw fail("无效 Claude 请求。");
    if (payload.action === "persona-get") return { persona: { ...persona } };
    if (payload.action === "persona-save") {
      const candidate = normalizeClaudePersona(payload.persona);
      const operation = personaQueue.catch(() => {}).then(async () => {
        if (candidate.revision !== persona.revision) throw fail("角色配置已在其他窗口更新，请重新打开设置。");
        const next = { ...candidate, revision: persona.revision + 1 };
        await mkdir(rootDir, { recursive: true, mode: 0o700 });
        const temp = `${personaFile}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await rename(temp, personaFile);
        persona = next; return { persona: { ...persona } };
      });
      personaQueue = operation;
      return operation;
    }
    if (payload.action === "refresh") return snapshot(payload);
    const item = sessions.get(payload.sessionId);
    if (payload.action === "permission-mode") {
      if (!item || !["manual", "auto"].includes(payload.mode)) throw fail("无效会话或权限模式。");
      if (item.changingMode) throw fail("权限模式正在切换，请等待回执。");
      item.changingMode = true;
      try {
        if (item.status === "running") {
          if (!item.query?.setPermissionMode) throw fail("Claude 尚未就绪或不支持运行中切换，请稍后重试。");
          await item.query.setPermissionMode(payload.mode === "auto" ? "bypassPermissions" : "default");
        }
        item.permissionMode = payload.mode;
        await persist();
        if (payload.mode === "auto") for (const p of [...item.permissions.values()]) if (p.autoEligible) p.decide(true);
        return { session: publicSession(item) };
      } finally { item.changingMode = false; }
    }
    if (payload.action === "question-answer") {
      const pending = item?.permissions.get(payload.permissionId);
      if (pending?.kind !== "question") throw fail("此问题已回答或已失效。");
      const answers = pending.answer(payload.answers);
      message(item, "user", Object.entries(answers).map(([question, answer]) => `${question}\n${Array.isArray(answer) ? answer.join("、") : answer}`).join("\n\n"));
      await persist(); return { session: publicSession(item) };
    }
    if (payload.action === "permission") {
      const pending = item?.permissions.get(payload.permissionId);
      if (!pending || typeof payload.allow !== "boolean" || (pending.kind === "question" && payload.allow)) throw fail("此操作确认已失效，选择题须提交答案。");
      pending.decide(payload.allow); return { session: publicSession(item) };
    }
    if (payload.action === "stop") {
      if (!item) throw fail("会话不存在。");
      for (const p of [...item.permissions.values()]) p.decide(false);
      item.abort?.abort(); return { session: publicSession(item) };
    }
    if (payload.action === "choice") {
      const choices = item && replyChoices(item);
      const choice = choices?.messageId === payload.messageId && choices.options.find(o => o.value === payload.value);
      if (!choice || item.starting) throw fail("此选项已回答或已失效。");
      payload = { ...payload, prompt: choice.value };
    } else if (payload.action !== "send") throw fail("不支持的 Claude 操作。");
    if (payload.permissionMode !== undefined && !["manual", "auto"].includes(payload.permissionMode)) throw fail("无效权限模式。");
    if (payload.sessionId && !item) throw fail("会话已不可用；请重新载入，不要重复发送。");
    if ([...sessions.values()].filter(s => s.status === "running" || s.starting).length >= 3) throw fail("已有 3 个 Claude 会话运行，请等待完成或先停止。");
    if (!executable) throw fail("本机未找到 Claude Code；请先完成安装和登录。");
    if (!sdkReady) throw fail("Claude 桥接依赖尚未安装。");
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt || Buffer.byteLength(prompt) > 12000) throw fail("请输入不超过 12000 字节的提示词。");
    if (CLAUDE_PANEL_COMMANDS.some(c => c.name === claudeSlashName(prompt))) throw fail("此快捷指令应在 Claude 面板内操作，不发送给模型。");
    const data = await resources(true);
    const project = data.projects.find(p => p.id === (item?.projectId || payload.projectId));
    if (!project || !(await stat(project.cwd).catch(() => null))?.isDirectory()) throw fail("所选项目已不可用；请重新选择。");
    if (item?.status === "running" || item?.starting || item?.changingMode) throw fail("此会话正在运行，请先停止或等待完成。");
    const requestedSkills = [...new Set(payload.skillIds ?? item?.skillIds ?? [])];
    const requestedMcps = [...new Set(payload.mcpIds ?? item?.mcpIds ?? [])];
    if (requestedSkills.length > 20 || requestedMcps.length > 30) throw fail("最多引用 20 个 Skills 与 30 个 MCP。");
    const selected = item || { id: randomUUID(), title: prompt.slice(0, 50), projectId: project.id, projectName: project.name,
      cwd: project.cwd, skillIds: requestedSkills, mcpIds: requestedMcps,
      messages: [], permissions: new Map(), status: "idle", permissionMode: payload.permissionMode || "manual" };
    if (selected.cwd !== project.cwd) throw fail("项目路径已变化，请新建会话。");
    selected.starting = true; sessions.set(selected.id, selected);
    try {
      const catalog = await readSkills(project.cwd);
      const skills = requestedSkills.map(id => catalog.find(s => s.id === id));
      const mcps = requestedMcps.map(id => data.mcps.find(m => m.id === id && m.available));
      if (skills.some(s => !s) || mcps.some(m => !m)) throw fail("所选 Skill 或 MCP 已不可用；请重新选择。");
      selected.skillIds = requestedSkills; selected.mcpIds = requestedMcps;
      selected.persona = { name: persona.name, description: persona.description };
      selected.status = "running"; selected.error = ""; selected.abort = new AbortController();
      message(selected, "user", prompt); await persist();
      void run(selected, prompt, skills, mcps);
      return { session: publicSession(selected) };
    } finally { selected.starting = false; }
  }
  return { request, snapshot, sessions, async stopAll() { for (const item of sessions.values()) item.abort?.abort(); await Promise.allSettled([writeQueue, personaQueue]); } };
}
