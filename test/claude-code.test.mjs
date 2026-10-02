import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { convertCodexMcp, createClaudeController, redactClaudeText, normalizeClaudePersona } from "../lib/claude-code.mjs";
import { EfficiencyBridge } from "../lib/efficiency-bridge.mjs";

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
