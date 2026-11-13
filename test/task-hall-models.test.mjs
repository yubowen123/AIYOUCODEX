import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createCodexHallModels } from '../vendor/codex-taskboard/server/task-hall-models.mjs';

const input = () => ({ system: '任务回执', prompt: '请处理样例', runId: 'd1aec561-05bc-4f2f-84ef-75519de6fe78', signal: new AbortController().signal });

test('Codex hall executes in an isolated directory; a response from a different model cannot complete a task', async () => {
  let actualModel = 'gpt-test', cwd, closes = 0;
  const models = createCodexHallModels({ createCodex: options => Object.assign(async (request, context) => {
    assert.equal(request.tool_choice, 'none');
    assert.equal(context.runScope, context.sessionId);
    assert.equal(options.resolveContext('other-task'), null);
    cwd = options.resolveContext(context.sessionId).projectPath;
    await access(cwd);
    return { text: '  处理结果  ', model: actualModel, provider: 'codex-cli', finishReason: 'stop' };
  }, {
    capabilities: async () => ({ available: true, authorizationVerified: true, selected: { model: 'gpt-test', provider: 'codex-cli' }, inputModalities: ['text'] }),
    dispose: async () => { closes++; },
  }) });
  const selection = await models.codex.select();
  assert.deepEqual(await models.codex.invoke({ ...input(), selection }), { text: '处理结果', model: 'gpt-test' });
  await assert.rejects(access(cwd), { code: 'ENOENT' });
  actualModel = 'substitute';
  await assert.rejects(models.codex.invoke({ ...input(), selection }), { status: 502 });
  await assert.rejects(access(cwd), { code: 'ENOENT' });
  assert.equal(closes, 3);
});

test('Claude hall sends no prompt if its native route changes or MCP is present, and rejects a substituted receipt', async () => {
  let route = 'route1', servers = [], model = 'claude-test-20260101';
  let seen = 0, closes = 0;
  const models = createCodexHallModels({
    findClaude: async () => '/test/claude',
    readClaudeRoute: async () => ({ route, model: 'claude-test', requestedModel: 'claude-test' }),
    readClaudeAuth: async () => ({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }),
    loadClaude: async () => ({ prompt, options }) => ({
      initializationResult: async () => ({}),
      mcpServerStatus: async () => servers,
      close() { closes++; },
      async *[Symbol.asyncIterator]() {
        assert.equal(options.persistSession, false);
        assert.deepEqual(options.tools, []);
        assert.equal(options.strictMcpConfig, true);
        assert.deepEqual(await options.canUseTool(), { behavior: 'deny', message: '此任务只接收文本回执。' });
        const user = await prompt.next();
        assert.equal(user.value.message.content, '请处理样例');
        seen++;
        yield { type: 'system', subtype: 'init', tools: [], mcp_servers: [], model: 'claude-test' };
        yield { type: 'assistant', message: { content: [{ type: 'text' }], model } };
        yield { type: 'result', subtype: 'success', result: '处理结果' };
      },
    }),
  });
  const selection = await models.claude.select();
  route = 'route2';
  await assert.rejects(models.claude.invoke({ ...input(), selection }), { status: 409 });
  assert.equal(seen, 0);
  route = 'route1';
  servers = [{ name: 'unexpected-server' }];
  await assert.rejects(models.claude.invoke({ ...input(), selection }), { status: 502 });
  assert.equal(seen, 0);
  servers = [];
  assert.deepEqual(await models.claude.invoke({ ...input(), selection }), { text: '处理结果', model });
  model = 'claude-different';
  await assert.rejects(models.claude.invoke({ ...input(), selection }), { status: 502 });
  assert.equal(seen, 2);
  assert.equal(closes, 3);
});
