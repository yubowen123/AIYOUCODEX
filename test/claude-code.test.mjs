import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { convertCodexMcp, createClaudeController, redactClaudeText, normalizeClaudePersona } from "../lib/claude-code.mjs";
import { EfficiencyBridge } from "../lib/efficiency-bridge.mjs";
import { claudeReplyChoices, claudeQuestionAnswers } from "../lib/claude-interaction.mjs";
import { normalizeClaudeCommands, claudeCommandCatalog, claudeSlashName } from "../lib/claude-commands.mjs";

test("MCP converts standard transports in backend and rejects missing auth / native-only commands", () => {
  const servers = convertCodexMcp({ mcp_servers: {
    docs: { url: "https://example.com/mcp", bearer_token_env_var: "TOKEN" },
    stdio: { command: "node", args: ["server.mjs"], env: { A: "private-value" } },
    missing: { url: "https://example.com/mcp", bearer_token_env_var: "MISSING" },
    native: { command: "/Applications/ChatGPT.app/Contents/cua_node/node_repl" },
    relative: { command: "./native/helper" }, disabled: { command: "node", enabled: false },
  } }, { TOKEN: "private-token" });
  assert.equal(servers[0].value.headers.Authorization, "Bearer private-token");
  assert.equal(servers[1].value.type, "stdio");
  assert.ok(servers.slice(2).every(s => !s.available && s.reason && !s.value));
  assert.ok(!JSON.stringify(servers.map(({ id, available, reason }) => ({ id, available, reason }))).includes("private-token"));
  assert.ok(!redactClaudeText('api_key="secretvalue" Bearer abcdefghijklmnop').includes("secretvalue"));
});

async function fixture(t, queryFactory) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-claude-controller-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "项目 A"), cwd2 = path.join(root, "项目 B"), skillPath = path.join(root, "source-skill");
  await Promise.all([mkdir(cwd), mkdir(cwd2), mkdir(skillPath)]);
  await writeFile(path.join(skillPath, "SKILL.md"), "---\nname: demo\ndescription: fixture\n---\nRead this skill.\n");
  const configPath = path.join(root, "config.toml");
  await writeFile(configPath, '[mcp_servers.docs]\nurl="https://example.com/mcp"\nhttp_headers={"X-Token"="private-config-token"}\n');
  const repository = { readRecentCatalog: async () => [
    { projectId: "a", projectName: "项目", projectRootPath: cwd },
    { projectId: "b", projectName: "项目", projectRootPath: cwd2 }],
    resolveEfficiencyThread: async () => ({ projectPath: cwd }) };
  const options = { repository, configPath, rootDir: path.join(root, "state"), findExecutable: async () => process.execPath,
    readActiveContext: async () => ({ threadId: "active" }),
    readSkills: async () => [{ id: "skill-demo", name: "demo", title: "Demo", description: "fixture", path: skillPath, skillFile: path.join(skillPath, "SKILL.md") }], queryFactory };
  return { root, cwd, skillPath, options, controller: createClaudeController(options) };
}
async function until(expression) {
  for (let i = 0; i < 100; i++) { const result = await expression(); if (result) return result; await delay(10); }
  assert.fail("Expected asynchronous state was not reached");
}

test("Claude persona persists independently, rejects stale saves and reaches the actual role prompt", async t => {
  let received;
  const f=await fixture(t,({options})=>(async function*(){received=options.systemPrompt.append;yield {type:"result",is_error:false,result:"OK"};})());
  assert.equal((await f.controller.request({action:"persona-get"})).persona.name,"Claude Code");
  const logo="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const profile={name:"小克",logo,description:"负责开发和问题排查，回答简洁。",revision:0};
  const saved=await f.controller.request({action:"persona-save",persona:profile});assert.equal(saved.persona.revision,1);
  await assert.rejects(f.controller.request({action:"persona-save",persona:profile}),/其他窗口更新/);
  assert.throws(()=>normalizeClaudePersona({name:"",logo:""}),/名称/);
  assert.throws(()=>normalizeClaudePersona({name:"小克",logo:"https://example.com/avatar.svg"}),/Logo/);
  const restored=createClaudeController(f.options),view=await restored.snapshot();
  assert.equal(view.persona.name,"小克");assert.equal(view.persona.logo,logo);assert.equal(view.persona.description,profile.description);
  const sent=await restored.request({action:"send",projectId:view.projectId,prompt:"检查项目"});
  await until(()=>restored.sessions.get(sent.session.id).status==="idle");
  assert.match(received,/角色名称：小克/);assert.ok(received.includes(profile.description));
  assert.match(received,/沿用用户的原有授权边界/);
});

test("Only the trusted Claude persona action accepts an uploaded logo sized payload", async () => {
  const received=[];
  const bridge=new EfficiencyBridge({request:async value=>{received.push(value.action);return {};}},{binding:"claude",actionPayloadLimits:{"persona-save":750000}});
  bridge.contexts.add(1);bridge.client={send:async()=>({})};
  const emit=(action,id,context=1)=>bridge.receive({name:"claude",executionContextId:context,payload:JSON.stringify({action,requestId:id,logo:"x".repeat(100000)})});
  await emit("persona-save","valid");await emit("send","ordinary");await emit("persona-save","foreign",2);
  assert.deepEqual(received,["persona-save"]);
});

test("project identities, selected original Skills, secret-free MCP metadata and exact session resume", async t => {
  const seen = [];
  const f = await fixture(t, ({ prompt, options }) => (async function* () {
    seen.push({ prompt, options });
    yield { type: "system", subtype: "init", session_id: "11111111-1111-4111-8111-111111111111", model: "fixture-model" };
    yield { type: "assistant", message: { content: [{ type: "text", text: "OK" }] } };
    yield { type: "result", is_error: false, result: "OK", total_cost_usd: 0 };
  })());
  const view = await f.controller.snapshot();
  assert.equal(view.projects.length, 2); assert.notEqual(view.projects[0].id, view.projects[1].id);
  assert.ok(!JSON.stringify(view).includes("private-config-token"));
  const first = await f.controller.request({ action: "send", projectId: view.projectId, prompt: "first", skillIds: ["skill-demo"], mcpIds: ["docs"], cwd: "/wrong/path" });
  const id = first.session.id;
  await until(() => f.controller.sessions.get(id).status === "idle");
  assert.equal(seen[0].options.cwd, f.cwd);
  assert.equal(seen[0].options.permissionMode, "default");
  assert.equal(seen[0].options.mcpServers.docs.headers["X-Token"], "private-config-token");
  assert.equal(seen[0].options.strictMcpConfig, true);
  const plugin = seen[0].options.plugins[0].path;
  const { readdir } = await import("node:fs/promises");
  const name = (await readdir(path.join(plugin, "skills")))[0];
  assert.equal(await realpath(path.join(plugin, "skills", name)), await realpath(f.skillPath));
  await f.controller.request({ action: "send", sessionId: id, projectId: view.projects[1].id, prompt: "next" });
  await until(() => seen.length === 2 && f.controller.sessions.get(id).status === "idle");
  assert.equal(seen[1].options.resume, "11111111-1111-4111-8111-111111111111");
  assert.equal(seen[1].options.cwd, f.cwd);
  await f.controller.request({ action: "send", sessionId: id, prompt: "without references", skillIds: [], mcpIds: [] });
  await until(() => seen.length === 3 && f.controller.sessions.get(id).status === "idle");
  assert.deepEqual(seen[2].options.plugins, []);
  assert.deepEqual(seen[2].options.mcpServers, {});
  assert.equal(seen[2].options.resume, "11111111-1111-4111-8111-111111111111");
  const saved = await readFile(path.join(f.options.rootDir, "sessions.private.json"), "utf8");
  assert.ok(!saved.includes("private-config-token"));
  const resumed = createClaudeController(f.options);
  assert.equal((await resumed.snapshot({ sessionId: id })).session.messages.filter(m => m.role === "user").length, 3);
  await assert.rejects(resumed.request({ action: "send", sessionId: "missing", prompt: "must not resend" }), /会话已不可用/u);
});

test("tool approvals are single-use, duplicate send is blocked, stop aborts only the selected Claude session", async t => {
  let approved;
  const f = await fixture(t, ({ options }) => (async function* () {
    approved = await options.canUseTool("Edit", { file_path: "file.txt", secret: "sensitive" }, { signal: options.abortController.signal });
    yield { type: "result", is_error: false, result: "finished" };
  })());
  const view = await f.controller.snapshot();
  const first = await f.controller.request({ action: "send", projectId: view.projectId, prompt: "edit" });
  const id = first.session.id;
  const permission = await until(async () => (await f.controller.snapshot({ sessionId: id })).session.permissions[0]);
  assert.ok(!permission.input.includes("sensitive"));
  await assert.rejects(f.controller.request({ action: "send", sessionId: id, prompt: "duplicate" }), /正在运行/u);
  await f.controller.request({ action: "permission", sessionId: id, permissionId: permission.id, allow: true });
  await until(() => f.controller.sessions.get(id).status === "idle");
  assert.equal(approved.behavior, "allow");
  await assert.rejects(f.controller.request({ action: "permission", sessionId: id, permissionId: permission.id, allow: true }), /已失效/u);
  await f.controller.request({ action: "send", sessionId: id, prompt: "next" });
  await until(() => f.controller.sessions.get(id).permissions.size > 0);
  await f.controller.request({ action: "stop", sessionId: id });
  await until(() => f.controller.sessions.get(id).status === "stopped");
  assert.equal(approved.behavior, "deny");
});

const questionInput = { questions: [
  { header: "方式", question: "请选择处理方式", options: [{ label: "自动填写", description: "停在发布前" }, { label: "仅存草稿" }], multiSelect: false },
  { header: "素材", question: "选择素材", options: [{ label: "横版" }, { label: "竖版" }], multiSelect: true },
] };

test("explicit reply choices, not ordinary numbered steps or code, and structured answers validation", () => {
  const text = "下面三种方式选一种：\n1. **自动填写（推荐）**：准备素材\n2. **仅存草稿**：不发布\n3. **你手动发**：打开文件夹\n回复 1、2 或 3，我就开始。";
  assert.deepEqual(claudeReplyChoices(text).map(o => [o.value, o.label]), [["1", "自动填写（推荐）"], ["2", "仅存草稿"], ["3", "你手动发"]]);
  assert.deepEqual(claudeReplyChoices("1. 打开文件\n2. 安装应用\n以上是操作步骤。"), []);
  assert.deepEqual(claudeReplyChoices("```\n1. a\n2. b\n回复 1、2\n```"), []);
  assert.deepEqual(claudeQuestionAnswers(questionInput, [{ selected: ["1"], custom: "" }, { selected: ["0", "1"], custom: "自制封面" }]), { "请选择处理方式": "仅存草稿", "选择素材": ["横版", "竖版", "自制封面"] });
  assert.throws(() => claudeQuestionAnswers(questionInput, [{ selected: ["0", "1"] }, { selected: ["0"] }]), /单选/);
  assert.throws(() => claudeQuestionAnswers(questionInput, [{ selected: ["9"] }, { selected: [] }]), /失效/);
  assert.throws(() => claudeQuestionAnswers(questionInput, []), /全部/);
});

test("Auto starts only by explicit selection, persists per session and still waits for AskUserQuestion", async t => {
  let seen, answer;
  const f = await fixture(t, ({ prompt, options }) => (async function* () {
    seen = { input: await prompt[Symbol.asyncIterator]().next(), options };
    assert.equal((await options.canUseTool("Bash", { command: "fixture only" }, { signal: options.abortController.signal })).behavior, "allow");
    answer = await options.canUseTool("AskUserQuestion", questionInput, { signal: options.abortController.signal });
    yield { type: "result", is_error: false, result: "选择已收到" };
  })());
  const view = await f.controller.snapshot();
  const sent = await f.controller.request({ action: "send", projectId: view.projectId, prompt: "fixture", permissionMode: "auto" });
  const id = sent.session.id;
  const pending = await until(async () => (await f.controller.snapshot({ sessionId: id })).session.permissions[0]);
  assert.equal(seen.options.permissionMode, "bypassPermissions"); assert.equal(seen.options.allowDangerouslySkipPermissions, true);
  assert.equal(seen.input.value.type, "user"); assert.equal(seen.input.value.message.content, "fixture");
  assert.equal(pending.kind, "question"); assert.equal(pending.autoEligible, false); assert.equal(answer, undefined);
  await assert.rejects(f.controller.request({ action: "permission", sessionId: id, permissionId: pending.id, allow: true }), /选择题/);
  const answers = [{ selected: [], custom: "我自己处理" }, { selected: ["0", "1"], custom: "" }];
  await f.controller.request({ action: "question-answer", sessionId: id, permissionId: pending.id, answers });
  await assert.rejects(f.controller.request({ action: "question-answer", sessionId: id, permissionId: pending.id, answers }), /已回答/);
  await until(() => f.controller.sessions.get(id).status === "idle");
  assert.deepEqual(answer.updatedInput.questions, questionInput.questions);
  assert.deepEqual(answer.updatedInput.answers, { "请选择处理方式": "我自己处理", "选择素材": ["横版", "竖版"] });
  const restored = createClaudeController(f.options);
  assert.equal((await restored.snapshot({ sessionId: id })).session.permissionMode, "auto");
  await restored.request({ action: "permission-mode", sessionId: id, mode: "manual" });
  assert.equal((await restored.snapshot({ sessionId: id })).session.permissionMode, "manual");
  await assert.rejects(restored.request({ action: "permission-mode", sessionId: id, mode: "all" }), /无效/);
});

test("runtime mode ACK precedes auto approval; rejected changes stay manual; explicit human prompts remain pending", async t => {
  let controller, resolveMode, failMode = true;
  const modes = [], results = [];
  const f = await fixture(t, ({ options }) => {
    const query = (async function* () {
      results.push(await options.canUseTool("Edit", { file_path: "fixture" }, { signal: options.abortController.signal }));
      results.push(await options.canUseTool("Bash", { command: "fixture" }, { signal: options.abortController.signal, matchedAskRule: { source: "user", toolName: "Bash" } }));
      yield { type: "result", is_error: false, result: "OK" };
    })();
    query.setPermissionMode = async mode => { modes.push(mode); if (failMode) throw Error("fixture rejected"); await new Promise(resolve => { resolveMode = resolve; }); };
    return query;
  }); controller = f.controller;
  const sent = await controller.request({ action: "send", projectId: (await controller.snapshot()).projectId, prompt: "fixture" });
  const id = sent.session.id;
  await until(() => controller.sessions.get(id).permissions.size);
  await assert.rejects(controller.request({ action: "permission-mode", sessionId: id, mode: "auto" }), /rejected/);
  assert.equal(controller.sessions.get(id).permissionMode, "manual"); assert.equal(results.length, 0);
  failMode = false;
  const switchMode = controller.request({ action: "permission-mode", sessionId: id, mode: "auto" });
  await until(() => resolveMode); assert.equal(results.length, 0);
  resolveMode(); await switchMode;
  await until(() => results.length === 1 && controller.sessions.get(id).permissions.size);
  const human = (await controller.snapshot({ sessionId: id })).session.permissions[0];
  assert.equal(human.autoEligible, false); assert.equal(results[0].behavior, "allow");
  await controller.request({ action: "permission", sessionId: id, permissionId: human.id, allow: false });
  await until(() => controller.sessions.get(id).status === "idle");
  assert.deepEqual(modes, ["bypassPermissions", "bypassPermissions"]);
});

test("numbered quick reply is bound to latest final message, single-use and never executes the option text", async t => {
  const prompts = [];
  const f = await fixture(t, ({ prompt }) => (async function* () {
    const packet = await prompt[Symbol.asyncIterator]().next(); prompts.push(packet.value.message.content);
    yield { type: "result", is_error: false, result: prompts.length === 1 ? "1. **自动填写**：准备素材\n2. **仅存草稿**：不发布\n回复 1、2。" : "已收到" };
  })());
  const sent = await f.controller.request({ action: "send", projectId: (await f.controller.snapshot()).projectId, prompt: "选择方式" });
  const id = sent.session.id;
  const choices = await until(async () => (await f.controller.snapshot({ sessionId: id })).session.replyChoices);
  await assert.rejects(f.controller.request({ action: "choice", sessionId: id, messageId: "stale", value: "2" }), /已失效/);
  await assert.rejects(f.controller.request({ action: "choice", sessionId: id, messageId: choices.messageId, value: "9" }), /已失效/);
  const payload = { action: "choice", sessionId: id, messageId: choices.messageId, value: "2" };
  const replies = await Promise.allSettled([f.controller.request(payload), f.controller.request(payload)]);
  assert.equal(replies.filter(r => r.status === "fulfilled").length, 1);
  await until(() => f.controller.sessions.get(id).status === "idle");
  assert.deepEqual(prompts, ["选择方式", "2"]);
  await assert.rejects(f.controller.request(payload), /已失效/);
  assert.equal((await f.controller.snapshot({ sessionId: id })).session.replyChoices, null);
});

test("slash catalog preserves SDK names and aliases, hides terminal commands and separates panel operations", () => {
  const commands = normalizeClaudeCommands([
    { name: "usage", description: "usage", aliases: ["cost", "stats"], builtin: true },
    { name: "usage", description: "shadowed user command" }, { name: "cost", description: "named command wins" },
    { name: "plugin:lint", description: "check", argumentHint: "<file>" }, "theme", "exit", "terminal-setup", "bad name", null,
  ]);
  assert.equal(commands.find(c => c.name === "usage").description, "usage");
  assert.equal(commands.find(c => c.name === "cost").description, "named command wins");
  assert.equal(commands.find(c => c.name === "stats").aliasFor, "usage");
  assert.ok(!commands.some(c => ["theme", "exit", "terminal-setup", "bad name"].includes(c.name)));
  const catalog = claudeCommandCatalog(commands);
  assert.equal(catalog.find(c => c.name === "permissions").kind, "panel");
  assert.equal(catalog.find(c => c.name === "plugin:lint").verified, true);
  assert.equal(catalog.find(c => c.name === "compact").verified, false);
  assert.equal(claudeSlashName("/compact keep files"), "compact");
  assert.equal(claudeSlashName("/Users/person/Documents/file.txt 请读取"), "");
});

test("slash dispatch validates SDK catalog before releasing input, preserves exact arguments and dynamic metadata", async t => {
  const received = []; let verified = false;
  const f = await fixture(t, ({ prompt }) => {
    const query = (async function* () {
      const packet = await prompt[Symbol.asyncIterator]().next(); assert.equal(verified, true);
      received.push(packet.value.message.content);
      yield { type: "system", subtype: "init", slash_commands: ["compact", "usage", "terminal-private"], terminal_slash_commands: ["terminal-private"] };
      yield { type: "system", subtype: "local_command_output", content: "压缩已完成" };
      yield { type: "system", subtype: "commands_changed", commands: [{ name: "plugin:lint", description: "检查项目", argumentHint: "<file>" }, "theme"] };
      yield { type: "result", is_error: false, result: "压缩已完成" };
    })();
    query.supportedCommands = async () => { verified = true; return [{ name: "compact", description: "Summarize", argumentHint: "[focus]" }]; };
    return query;
  });
  const view = await f.controller.snapshot(); assert.equal(view.commandVersion, 1);
  const sent = await f.controller.request({ action: "send", projectId: view.projectId, prompt: "/compact 保留接口约定", skillIds: ["skill-demo"] });
  const id = sent.session.id;
  await until(() => f.controller.sessions.get(id).status === "idle");
  assert.deepEqual(received, ["/compact 保留接口约定"], "Reference instructions must not become slash arguments");
  const result = (await f.controller.snapshot({ sessionId: id })).session;
  assert.deepEqual(result.commands.map(c => c.name), ["plugin:lint"]);
  assert.equal(result.messages.filter(m => m.text === "压缩已完成").length, 1);
  // The in-memory idle state precedes the queued atomic write. Check the
  // durable catalog before starting a new controller that reads it once.
  await until(async () => {
    const stored = JSON.parse(await readFile(path.join(f.options.rootDir, "sessions.private.json"), "utf8"));
    return stored.sessions.some(s => s.id === id && s.commands.some(c => c.name === "plugin:lint" && c.verified));
  });
  const restored = createClaudeController(f.options);
  assert.ok((await restored.snapshot({ sessionId: id })).commands.some(c => c.name === "plugin:lint" && c.verified));
  await assert.rejects(f.controller.request({ action: "send", sessionId: id, prompt: "/clear" }), /面板内/);
});

test("unsupported slash command never releases model input or fabricates successful execution", async t => {
  let delivered = false, closed = false;
  const f = await fixture(t, ({ prompt }) => {
    const query = (async function* () { const packet = await prompt[Symbol.asyncIterator]().next(); delivered = !packet.done; yield { type: "result", is_error: false, result: "must not run" }; })();
    query.supportedCommands = async () => [{ name: "compact" }]; query.close = () => { closed = true; };
    return query;
  });
  const sent = await f.controller.request({ action: "send", projectId: (await f.controller.snapshot()).projectId, prompt: "/unknown-native" });
  await until(() => f.controller.sessions.get(sent.session.id).status === "error");
  assert.equal(delivered, false); assert.equal(closed, true);
  assert.match((await f.controller.snapshot({ sessionId: sent.session.id })).session.error, /命令未发送给模型/);
});
