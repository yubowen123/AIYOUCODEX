import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { bootstrapOpenChatCut, createOpenChatCutMcpClient, openChatCutToolPolicy, localEditorOrigin } from '../lib/openchatcut-mcp.mjs';
import { adaptedUpstreamTool, createOpenChatCutStdioServer } from '../plugins/openchatcut/server/index.mjs';

test('OpenChatCut transport performs real HTTP initialize, auth, session binding and SSE result parsing', async t => {
  const calls = [], token = 'private-local-token-for-test-only';
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    // v0.2.16 project-store-http-auth requires both trusted loopback Origin
    // and browserEnforcedRequest's same-origin/none Fetch Metadata shape.
    if (!['same-origin', 'none'].includes(req.headers['sec-fetch-site'])
      || req.headers.origin !== `http://${req.headers.host}`) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'invalid request origin' })); return;
    }
    if (req.url === '/api/external-agent/bootstrap') {
      assert.equal(req.headers.origin, `http://127.0.0.1:${server.address().port}`);
      assert.equal(req.headers['x-openchatcut-editor-bootstrap'], '1');
      res.end(JSON.stringify({ mcpToken: token })); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.method === 'DELETE') { res.end('{}'); return; }
    assert.equal(req.headers['x-openchatcut-tool-exposure'], 'full');
    const value = JSON.parse(Buffer.concat(chunks)); calls.push(value);
    if (value.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (value.method !== 'initialize') assert.equal(req.headers['mcp-session-id'], 'session-a');
    res.setHeader('Mcp-Session-Id', 'session-a');
    res.setHeader('Content-Type', 'text/event-stream');
    const result = value.method === 'initialize' ? { protocolVersion: '2025-03-26' }
      : value.method === 'tools/list' ? { tools: [{ name: 'split_item', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: '{"ok":true}' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }], structuredContent: { ok: true } };
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: value.id, result })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const noFetchMetadata = await fetch(`${baseUrl}/api/external-agent/bootstrap`, { method: 'POST', headers: { Origin: baseUrl }, body: '{}' });
  assert.equal(noFetchMetadata.status, 403, 'Bare Node requests must reproduce the upstream rejection');
  const connection = await bootstrapOpenChatCut(baseUrl);
  const client = createOpenChatCutMcpClient(connection); t.after(() => client.close());
  assert.equal((await client.listTools())[0].name, 'split_item');
  const result = await client.callTool('split_item', { itemId: 'clip', frame: 30 });
  assert.equal(result.ok, true); assert.equal(result.__mcpImages[0].type, 'image');
  assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  await client.close();
});

test('automatic editing never forwards generation, publishing, external execution or unreviewed real effects', () => {
  for (const name of ['submit_video', 'submit_image', 'submit_motion_graphic', 'create_motion_graphic', 'publish_to_social', 'run_code', 'install_skill', 'upload_file']) assert.equal(openChatCutToolPolicy(name).allowed, false, name);
  assert.equal(openChatCutToolPolicy('unknown_real_tool').manual, true);
  assert.equal(openChatCutToolPolicy('split_item').allowed, true);
  assert.equal(openChatCutToolPolicy('submit_render_job').allowed, true);
  assert.equal(openChatCutToolPolicy('read_timeline').readOnly, true);
  assert.equal(openChatCutToolPolicy('manage_design_style', { action: 'save' }).manual, true);
  assert.throws(() => localEditorOrigin('https://example.com'), /loopback/);
});

test('prohibited supplier parameters are blocked even in native manual tools without matching ordinary media text', () => {
  for (const args of [{ provider: 'Qiniu' }, { vendor: 'QNAIGC' }, { endpoint: 'https://api.qnaigc.com/v1' },
    { baseUrl: 'https://api.qiniu.com/v1' }, { options: { api_base_url: 'https://upload.qbox.me' } }]) {
    assert.equal(openChatCutToolPolicy('transcribe_track', args).allowed, false);
    assert.equal(openChatCutToolPolicy('unknown_real_tool', args).allowed, false);
  }
  assert.equal(openChatCutToolPolicy('transcribe_track', { provider: 'local' }).manual, undefined);
  assert.equal(openChatCutToolPolicy('transcribe_track', { provider: 'assemblyai' }).manual, true);
  assert.equal(openChatCutToolPolicy('edit_item', { name: 'Qiniu case study.mp4', text: 'QNAIGC' }).allowed, true);
});

test('portable stdio exposes bootstrap tools while host is unavailable, then actual upstream schema with thread isolation', async () => {
  const sent = [], requests = []; let available = false;
  const server = createOpenChatCutStdioServer({ output: value => sent.push(value), request: async payload => {
    requests.push(payload);
    if (!available) throw new Error('Host unavailable');
    if (payload.action === 'list-tools') return { tools: [{ name: 'split_item', inputSchema: { type: 'object', properties: { itemId: { type: 'string' }, editSessionId: { type: 'string' }, editorProjectId: { type: 'string' } }, required: ['itemId', 'editSessionId'] } }] };
    return { result: { ok: true } };
  } });
  await server.receive({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(sent.at(-1).result.tools.length, 5);
  available = true;
  await server.receive({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tool = sent.at(-1).result.tools.find(tool => tool.name === 'occ_split_item');
  assert.deepEqual(tool.inputSchema.required, ['itemId', 'threadId']);
  assert.equal(tool.inputSchema.properties.editSessionId, undefined);
  await server.receive({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'occ_split_item', arguments: { threadId: 'thread-a', itemId: 'clip' } } });
  assert.deepEqual(requests.at(-1), { action: 'call-tool', threadId: 'thread-a', name: 'split_item', arguments: { itemId: 'clip' } });
  assert.equal(sent.at(-1).result.structuredContent.result.ok, true);
  await server.receive({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'openchatcut_new_project', arguments: { threadId: 'thread-a', projectTitle: 'Explicit new project' } } });
  assert.deepEqual(requests.at(-1), { action: 'new-project', threadId: 'thread-a', projectTitle: 'Explicit new project' });
});
