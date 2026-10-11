import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { requestController } from './controller-client.mjs';

const thread = { type: 'string', description: 'The current Codex conversation threadId. Required for project isolation; never use another conversation id.' };
const object = { type: 'object', additionalProperties: true };
export const BOOTSTRAP_TOOLS = [
  { name: 'openchatcut_status', description: 'Read the local OpenChatCut installation and this conversation editing status. If not installed, use the AIYOUcodex Settings or sidebar one-click install.',
    inputSchema: { type: 'object', properties: { threadId: thread } }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'openchatcut_start_editing', description: 'Open this conversation’s OpenChatCut project in the AIYOUcodex right panel and start its isolated edit draft. Installation is user-triggered in Settings/sidebar.',
    inputSchema: { type: 'object', properties: { threadId: thread, projectTitle: { type: 'string' }, compositionWidth: { type: 'number' }, compositionHeight: { type: 'number' }, fps: { type: 'number' } }, required: ['threadId'] } },
  { name: 'openchatcut_new_project', description: 'Create a new project and replace only this conversation binding. Use only when the human explicitly asks to create a new editing project in this conversation. Ordinary edits and reopening must retain the existing binding. Keeps the old project and refuses unapplied draft edits.',
    inputSchema: { type: 'object', properties: { threadId: thread, projectTitle: { type: 'string' }, compositionWidth: { type: 'number' }, compositionHeight: { type: 'number' }, fps: { type: 'number' } }, required: ['threadId', 'projectTitle'] } },
  { name: 'openchatcut_list_tools', description: 'Discover the actual current upstream OpenChatCut MCP tool schemas and integration policy. Does not generate or publish anything.',
    inputSchema: { type: 'object', properties: { threadId: thread }, required: ['threadId'] }, annotations: { readOnlyHint: true } },
  { name: 'openchatcut_call_tool', description: 'Invoke any named tool in the actual upstream catalog for this conversation. Project/session ids are injected and checked by AIYOUcodex. Draft changes apply immediately by default for live synchronization; generation/publishing are subject to the integration policy.',
    inputSchema: { type: 'object', properties: { threadId: thread, name: { type: 'string' }, arguments: object, summary: { type: 'string' }, deferReview: { type: 'boolean', default: false } }, required: ['threadId', 'name', 'arguments'] } },
];

export function adaptedUpstreamTool(tool) {
  const { editorProjectId: _project, editSessionId: _session, ...properties } = tool.inputSchema?.properties || {};
  const { integrationPolicy: policy, ...schema } = tool;
  const note = policy?.allowed === false || policy?.manual ? policy.reason : 'Draft edits apply immediately and update the right panel.';
  const adapterNote = ['import_asset', 'import_assets', 'import_folder', 'browse_local_media'].includes(tool.name)
    ? 'AIYOUcodex supplies a bounded local-filesystem adapter for this preload-only upstream tool. Imports use the official one-shot loopback upload/receipt protocol, require local storage, and retain AGENT_IMPORT_ROOTS restrictions.' : '';
  return { ...schema, name: `occ_${tool.name}`, description: `${tool.description || tool.name} ${adapterNote} AIYOUcodex binds the project and edit session to threadId. ${note}`,
    inputSchema: { ...tool.inputSchema, type: 'object', properties: { ...properties, threadId: thread },
      required: [...new Set([...(tool.inputSchema?.required || []).filter(name => !['editorProjectId', 'editSessionId'].includes(name)), 'threadId'])] } };
}
function contentResult(value) {
  const images = value?.result?.__mcpImages || value?.__mcpImages || [];
  const clean = images.length ? JSON.parse(JSON.stringify(value, (key, entry) => key === '__mcpImages' ? undefined : entry)) : value;
  return { content: [{ type: 'text', text: JSON.stringify(clean) }, ...images], structuredContent: clean && typeof clean === 'object' && !Array.isArray(clean) ? clean : { result: clean } };
}
export function createOpenChatCutStdioServer({ request = requestController, output = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  let upstreamNames = new Set(), catalogDigest = '';
  async function listTools() {
    let catalog = [];
    try { catalog = (await request({ action: 'list-tools', threadId: 'mcp-tool-discovery' })).tools || []; } catch {}
    upstreamNames = new Set(catalog.map(tool => tool.name));
    const tools = [...BOOTSTRAP_TOOLS, ...catalog.map(adaptedUpstreamTool)];
    const digest = JSON.stringify(tools);
    if (catalogDigest && digest !== catalogDigest) output({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    catalogDigest = digest; return { tools };
  }
  async function receive(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    if (message.id === undefined) return;
    try {
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'aiyoucodex-openchatcut', version: '1.0.4' },
        instructions: 'Use OpenChatCut for video editing. Read the edit-video Skill. Pass the current Codex threadId to isolate projects. Installation is one click in AIYOUcodex Settings/sidebar. Never use automatic editing tools to bypass generation or publishing authorization.' };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = await listTools();
      else if (message.method === 'tools/call') {
        const name = message.params?.name, args = message.params?.arguments || {};
        let payload;
        if (name === 'openchatcut_status') payload = { action: 'status', threadId: args.threadId };
        else if (name === 'openchatcut_start_editing') payload = { ...args, action: 'start-editing' };
        else if (name === 'openchatcut_new_project') payload = { ...args, action: 'new-project' };
        else if (name === 'openchatcut_list_tools') payload = { action: 'list-tools', threadId: args.threadId };
        else if (name === 'openchatcut_call_tool') payload = { ...args, action: 'call-tool' };
        else if (typeof name === 'string' && name.startsWith('occ_') && upstreamNames.has(name.slice(4))) {
          const { threadId, ...argumentsValue } = args;
          payload = { action: 'call-tool', threadId, name: name.slice(4), arguments: argumentsValue };
        } else throw new Error('Unknown OpenChatCut tool');
        try { result = contentResult(await request(payload)); }
        catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }], structuredContent: { code: error.code || 'OPENCHATCUT_UNAVAILABLE', message: error.message } }; }
        // Installation or opening the active editor may expand the actual
        // upstream catalog from server-direct to browser capabilities.
        if (name === 'openchatcut_start_editing' || name === 'openchatcut_list_tools') output({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      } else { output({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
      output({ jsonrpc: '2.0', id: message.id, result });
    } catch (error) { output({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }); }
  }
  return { receive, listTools };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createOpenChatCutStdioServer();
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) return;
    try { void server.receive(JSON.parse(line)); } catch { process.stderr.write('Invalid OpenChatCut MCP JSON request\n'); }
  });
}
