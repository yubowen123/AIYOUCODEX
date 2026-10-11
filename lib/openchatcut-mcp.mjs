import { createHash } from 'node:crypto';

export const OPENCHATCUT_MCP_PATH = '/api/external-mcp/mcp';
export class OpenChatCutError extends Error {
  constructor(message, code = 'OPENCHATCUT_UNAVAILABLE', details) {
    super(message); this.name = 'OpenChatCutError'; this.code = code; this.details = details;
  }
}

export function localEditorOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new OpenChatCutError('OpenChatCut 本地地址无效。', 'OPENCHATCUT_INVALID_URL'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new OpenChatCutError('OpenChatCut 必须使用本机 loopback 服务。', 'OPENCHATCUT_INVALID_URL');
  return url.origin;
}

export async function bootstrapOpenChatCut(baseUrl, { fetchImpl = fetch } = {}) {
  const origin = localEditorOrigin(baseUrl);
  const response = await fetchImpl(`${origin}/api/external-agent/bootstrap`, {
    method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json', 'X-OpenChatCut-Editor-Bootstrap': '1' },
    body: '{}', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new OpenChatCutError(`OpenChatCut 启动握手失败（HTTP ${response.status}）。`);
  const value = await response.json();
  if (typeof value.mcpToken !== 'string' || value.mcpToken.length < 16) throw new OpenChatCutError('OpenChatCut 未返回有效的本地 MCP 凭证。');
  return { baseUrl: origin, mcpUrl: `${origin}${OPENCHATCUT_MCP_PATH}`, token: value.mcpToken };
}

export function unpackMcpResult(result) {
  if (result?.isError) {
    const content = result.structuredContent || result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
    const message = typeof content === 'string' ? content : content?.error || content?.message || JSON.stringify(content);
    throw new OpenChatCutError(message || 'OpenChatCut 操作失败。', 'OPENCHATCUT_TOOL_FAILED', content);
  }
  if (result?.structuredContent !== undefined) {
    const images = result.content?.filter(item => item.type === 'image') || [];
    return images.length ? { ...result.structuredContent, __mcpImages: images } : result.structuredContent;
  }
  const text = result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return result;
}

// A small Streamable HTTP client keeps the bundled plugin independent of npm
// installation. Each instance owns exactly one upstream transport session.
export function createOpenChatCutMcpClient({ baseUrl, token, fetchImpl = fetch, timeoutMs = 70000 } = {}) {
  const origin = localEditorOrigin(baseUrl);
  let sessionId, initialized = false, sequence = 0, initPromise;
  async function rpc(method, params, { notification = false, timeout = timeoutMs } = {}) {
    const id = notification ? undefined : ++sequence;
    const response = await fetchImpl(`${origin}${OPENCHATCUT_MCP_PATH}`, {
      method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'none', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26',
        'X-OpenChatCut-Tool-Exposure': 'full', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(timeout),
    });
    const suppliedSession = response.headers.get('mcp-session-id');
    if (suppliedSession) sessionId = suppliedSession;
    if (notification && response.ok) return;
    if (!response.ok) throw new OpenChatCutError(`OpenChatCut MCP 返回 HTTP ${response.status}；未自动重试操作。`,
      response.status === 404 ? 'OPENCHATCUT_TRANSPORT_EXPIRED' : 'OPENCHATCUT_MCP_HTTP');
    const raw = await response.text();
    let messages;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      messages = raw.split(/\r?\n\r?\n/u).map(frame => frame.split(/\r?\n/u)
        .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(data => JSON.parse(data));
    } else messages = raw ? [JSON.parse(raw)] : [];
    const message = messages.find(value => value.id === id);
    if (!message) throw new OpenChatCutError('OpenChatCut MCP 未返回此操作的结果；未自动重试。', 'OPENCHATCUT_MCP_RESPONSE');
    if (message.error) throw new OpenChatCutError(message.error.message, 'OPENCHATCUT_MCP_PROTOCOL');
    return message.result;
  }
  async function initialize() {
    if (initialized) return;
    initPromise ||= (async () => {
      await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AIYOUcodex', version: '1.0.3' } });
      await rpc('notifications/initialized', undefined, { notification: true });
      initialized = true;
    })();
    await initPromise;
  }
  return {
    initialize,
    async listTools() { await initialize(); return (await rpc('tools/list')).tools || []; },
    async callTool(name, args = {}) { await initialize(); return unpackMcpResult(await rpc('tools/call', { name, arguments: args })); },
    async close() {
      if (!sessionId) return;
      await fetchImpl(`${origin}${OPENCHATCUT_MCP_PATH}`, { method: 'DELETE', headers: { Origin: origin, 'Sec-Fetch-Site': 'none', Authorization: `Bearer ${token}`, 'Mcp-Session-Id': sessionId,
        'MCP-Protocol-Version': '2025-03-26' }, signal: AbortSignal.timeout(5000) }).catch(() => {});
      sessionId = undefined; initialized = false; initPromise = undefined;
    },
    get sessionId() { return sessionId; },
  };
}

export const OPENCHATCUT_DRAFT_TOOLS = new Set([
  'add_motion_graphic', 'update_item_props', 'move_item', 'set_item_timing', 'duplicate_item', 'remove_item', 'split_item',
  'add_audio', 'clear_timeline', 'set_aspect_ratio', 'manage_timelines', 'edit_track', 'apply_script', 'edit_item', 'manage_effects',
  'edit_captions', 'update_watermark', 'manage_markers', 'apply_caption_avoidance', 'place_graphics_in_safe_zone', 'auto_reframe',
  'manage_design_style', 'import_timeline', 'export_jianying_draft', 'import_asset', 'import_assets', 'import_folder',
]);
export const OPENCHATCUT_READ_TOOLS = new Set([
  'ToolSearch', 'load_skill', 'read_timeline', 'list_templates', 'search_templates', 'list_audio', 'read_script', 'view_timeline_frames',
  'view_asset_frames', 'browse_library', 'read_captions', 'read_project', 'read_transcript', 'find_transcript', 'search_media',
  'search_stock_media', 'search_fonts', 'analyze_music', 'inspect_music', 'music_edit_plan', 'music_image_plan', 'read_agent_artifact',
  'browse_local_media', 'openchatcut_status', 'list_projects', 'get_editor_url', 'list_edit_sessions', 'get_edit_session',
  'probe_media', 'inspect_color', 'read_export_history', 'verify_export', 'track_export',
]);
// These upstream real tools operate locally and are part of an editing task.
// Generation, network publishing, arbitrary code and installing remote Skills
// remain unavailable through the automatic editing transport.
const LOCAL_EDIT_TOOLS = new Set([
  'submit_render_job', 'track_export', 'track_progress', 'probe_media', 'detect_scenes', 'remove_silence', 'normalize_loudness',
  'isolate_voice', 'apply_layout', 'undo_last_change', 'redo_last_change', 'manage_versions', 'sync_multicam', 'edit_multicam',
  'switch_multicam', 'inspect_export', 'verify_export', 'export_qa', 'analyze_color_scope', 'color_scope', 'auto_grade', 'detect_beats',
  'multicam_sync', 'change_cam', 'manage_link_group', 'inspect_color', 'read_export_history',
  'edit_gap', 'delete_text', 'clean_script',
  'import_media', 'finalize_uploaded_asset',
]);
export function openChatCutToolPolicy(name, args = {}) {
  const providerFields = new Set(['provider', 'vendor', 'endpoint', 'baseurl', 'apiendpoint', 'apibaseurl']);
  const prohibitedProvider = value => value && typeof value === 'object' && Object.entries(value).some(([field, entry]) =>
    (providerFields.has(field.replace(/[_-]/gu, '').toLowerCase()) && typeof entry === 'string' && /qiniu|qnaigc|qbox/iu.test(entry))
    || (entry && typeof entry === 'object' && prohibitedProvider(entry)));
  if (prohibitedProvider(args)) return { allowed: false, reason: '工具的供应商或服务地址属于禁用供应商，未提交操作。' };
  if (/^(submit_(?!render_job$)|generate_|publish_|upload_|run_code$|run_skill_script$|install_skill$|create_motion_graphic$)/u.test(name)) {
    return { allowed: false, reason: '此操作涉及生成、发布或外部执行。自动剪辑 MCP 不提交这些操作；生成须遵守当前用户指定的通道、供应商限制与次数规则。' };
  }
  if (name === 'manage_design_style' && (['save', 'delete'].includes(args.action) || (args.action === 'update' && args.presetId))) {
    return { allowed: true, manual: true, reason: '此操作修改持久样式库，将使用 OpenChatCut 原生确认卡。' };
  }
  if (name === 'edit_captions' && (['bilingual', 'preset_save', 'preset_delete', 'preset_rename'].includes(args.action)
    || (args.action === 'language_mode' && args.mode === 'bilingual'))) return { allowed: true, manual: true, reason: '字幕翻译或持久预设写入使用 OpenChatCut 原生确认卡。' };
  if (name === 'transcribe_track' && args.provider === 'local') return { allowed: true, readOnly: false };
  if (name === 'manage_transcript' && (['fix', 'clear_edits', 'set_play_order', 'translation_list', 'translation_read'].includes(args.action)
    || (args.action === 'retry_transcription' && args.provider === 'local'))) return { allowed: true, readOnly: ['translation_list', 'translation_read'].includes(args.action) };
  if (name === 'manage_template' && ['get', 'list', 'list_assets', 'apply'].includes(args.action)) return { allowed: true, readOnly: args.action !== 'apply' };
  if (OPENCHATCUT_READ_TOOLS.has(name)) return { allowed: true, readOnly: true };
  if (OPENCHATCUT_DRAFT_TOOLS.has(name) || LOCAL_EDIT_TOOLS.has(name)) return { allowed: true, readOnly: false };
  if (['review_edit_session', 'discard_edit_session', 'recover_edit_session', 'begin_edit_session'].includes(name)) return { allowed: true, lifecycle: true };
  return { allowed: true, manual: true, reason: `上游工具 ${name} 使用 OpenChatCut 原生确认流程，不通过自动剪辑会话放行。` };
}
export function toolCatalogDigest(tools) { return createHash('sha256').update(JSON.stringify(tools)).digest('hex'); }
