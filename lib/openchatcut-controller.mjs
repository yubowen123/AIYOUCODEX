import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapOpenChatCut, createOpenChatCutMcpClient, localEditorOrigin, OpenChatCutError,
  OPENCHATCUT_DRAFT_TOOLS, openChatCutToolPolicy } from './openchatcut-mcp.mjs';
import { OPENCHATCUT_LOCAL_PATH_TOOLS, browseOpenChatCutLocalMedia, importOpenChatCutLocalMedia, openChatCutImportSettings } from './openchatcut-import.mjs';

export const OPENCHATCUT_CONNECTION_PATH = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'openchatcut', 'controller.json');
const globalRead = new Set(['ToolSearch', 'load_skill']);
const discardedSessionTerminalStatuses = new Set(['stale', 'applied', 'cancelled', 'rejected']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,200}$/u.test(value);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function cleanInstallerStatus(value = {}) {
  const keys = ['state', 'installed', 'progress', 'message', 'version', 'baseUrl', 'editorUrl', 'platform', 'architecture', 'bytesReceived', 'totalBytes', 'error', 'availableVersion', 'running', 'supported', 'managed', 'releaseUrl', 'installDirectory', 'errorCode', 'started', 'serviceId', 'backgroundMode'];
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function resultObject(value) {
  return value?.result !== undefined ? value.result : value?.value !== undefined ? value.value : value;
}
function sessionIdentity(value) {
  const result = resultObject(value);
  return result?.editSessionId || result?.sessionId || result?.id;
}
function liveEditor(value, projectId) {
  const editor = value?.editors?.find(editor => editor.projectId === projectId);
  if (editor?.connected === false) return false;
  const connected = value?.connectedProjectIds || value?.connectedProjects || [];
  return connected.some(project => (typeof project === 'string' ? project : project.projectId || project.id) === projectId
    && (typeof project === 'string' || project.connected !== false)) || editor?.connected === true;
}
function staleTransport(error) {
  return error.code === 'OPENCHATCUT_TRANSPORT_EXPIRED'
    || error.code === 'OPENCHATCUT_TOOL_FAILED' && /MCP session binding.*stale|re-initialize the MCP session/iu.test(error.message);
}
function rejectedStaleDispatch(error, projectId) {
  // v0.2.16's server checks before queueing, and its browser handler checks
  // before runEditorTool/runRealTool. Cancellation while an operation is
  // pending uses different wording and must never replay a mutation.
  return error.code === 'OPENCHATCUT_TOOL_FAILED'
    && (error.message.startsWith(`MCP session binding for project ${projectId} is stale.`)
      || error.message === `Project ${projectId} changed; re-initialize the MCP session.`);
}
function secretEqual(left, right) {
  const a = Buffer.from(left || ''), b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One local controller per AIYOUcodex runtime, with a distinct upstream MCP
 * transport and persisted project binding for each conversation. */
export function createOpenChatCutController({ installer, stateRoot, statePath, connectionPath = OPENCHATCUT_CONNECTION_PATH,
  fetchImpl = fetch, createClient = createOpenChatCutMcpClient, host = '127.0.0.1', port = 0,
  readinessTimeoutMs = 45000, pollMs = 250, reconnectAfterMs = 2000, onEvent, now = Date.now } = {}) {
  if (!installer?.status || !installer?.launch) throw new TypeError('OpenChatCut installer is required');
  statePath ||= path.join(stateRoot || path.dirname(connectionPath), 'sessions.json');
  let server, token, endpoint, initialized, disposed = false, activeThreadId, credentials;
  let stopping = false, stopped = false, operationGeneration = 0;
  let sessions = {}, queue = Promise.resolve(), latest = { state: 'not-installed', installed: false };
  const clients = new Map(), listeners = new Set(onEvent ? [onEvent] : []), streams = new Set();
  const emit = event => {
    const value = { ...event, at: now() };
    for (const listener of listeners) { try { listener(value); } catch {} }
    for (const stream of streams) stream.write(`data: ${JSON.stringify(value)}\n\n`);
  };
  async function load() {
    if (initialized) return initialized;
    initialized = (async () => {
      try {
        const stored = JSON.parse(await readFile(statePath, 'utf8'));
        if (stored.version === 1 && stored.sessions && typeof stored.sessions === 'object') {
          stopped = stored.serviceStopped === true;
          const entries = Object.entries(stored.sessions).filter(([threadId, entry]) => validId(threadId) && validId(entry?.projectId));
          if (new Set(entries.map(([, entry]) => entry.projectId)).size !== entries.length) {
            throw new OpenChatCutError('多个对话绑定到了同一个工程，未覆盖原绑定或执行剪辑。', 'OPENCHATCUT_STATE_ERROR');
          }
          sessions = Object.fromEntries(entries);
        }
      } catch (error) { if (error.code !== 'ENOENT') throw new OpenChatCutError('OpenChatCut 会话记录无法读取，未覆盖原有记录。', 'OPENCHATCUT_STATE_ERROR'); }
    })();
    return initialized;
  }
  async function persist() {
    await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, serviceStopped: stopped, sessions }, null, 2), { mode: 0o600 });
    await rename(temp, statePath);
  }
  function thread(context = {}, payload = {}) {
    const id = context.threadId || payload.threadId;
    if (!validId(id)) throw new OpenChatCutError('请传入当前 Codex 对话的 threadId，剪辑工程按对话隔离。', 'OPENCHATCUT_THREAD_REQUIRED');
    if (context.threadId && payload.threadId && context.threadId !== payload.threadId) throw new OpenChatCutError('对话目标已变化，请重新打开工具。', 'OPENCHATCUT_TARGET_CHANGED');
    return id;
  }
  async function status(context = {}) {
    await load();
    const installed = cleanInstallerStatus(await installer.status());
    latest = { ...latest, ...installed };
    const id = validId(context.threadId) ? context.threadId : undefined;
    let connected = false;
    if (id && sessions[id] && clients.has(id)) {
      try { connected = liveEditor(resultObject(await clients.get(id).callTool('openchatcut_status')), sessions[id].projectId); }
      catch { /* A failed live probe is not evidence of a connected editor. */ }
    }
    const session = id && sessions[id] ? { threadId: id, ...sessions[id], connected, connectionCheckedAt: now() } : null;
    return { ...latest, state: stopped ? 'stopped' : installed.state || (installed.installed ? 'installed' : 'not-installed'),
      ...(stopped ? { running: false, editorUrl: null, baseUrl: null, toolName: null } : {}),
      installed: Boolean(installed.installed), session: stopped && session ? { ...session, connected: false, editorUrl: null } : session,
      ...(!stopped && session?.editorUrl ? { editorUrl: session.editorUrl } : {}),
      controllerAvailable: Boolean(server), activeThreadId, message: latest.message || (installed.installed ? 'OpenChatCut 已安装。' : '请在设置或左侧 OpenChatCut 入口点击一键安装。') };
  }
  async function launch() {
    const installed = await installer.status();
    if (!installed.installed) throw new OpenChatCutError('OpenChatCut 尚未安装，请在设置或左侧入口点击一键安装。', 'OPENCHATCUT_INSTALL_REQUIRED');
    if (stopping) throw new OpenChatCutError('OpenChatCut 正在彻底关闭。', 'OPENCHATCUT_STOPPING');
    const running = await installer.launch({ background: true });
    if (running.started === false || running.errorCode) throw new OpenChatCutError(running.message || 'OpenChatCut 启动失败。', `OPENCHATCUT_${running.errorCode || 'LAUNCH_FAILED'}`);
    const baseUrl = running.baseUrl || running.editorUrl || installed.baseUrl || installed.editorUrl || 'http://127.0.0.1:5199';
    const origin = localEditorOrigin(baseUrl);
    // A restarted server can use the same port with a different token/session.
    // Clear transports before any preflight, never replay a media write.
    if (!credentials || credentials.baseUrl !== origin || running.reused === false
      || running.serviceId && credentials.serviceId !== running.serviceId) {
      for (const client of clients.values()) await client.close().catch(() => {});
      clients.clear(); activeThreadId = undefined;
      credentials = { ...await bootstrapOpenChatCut(origin, { fetchImpl }), serviceId: running.serviceId };
    }
    latest = { ...latest, ...cleanInstallerStatus(running), installed: true, state: 'running', baseUrl: origin };
    return credentials;
  }
  async function getClient(id) {
    const credentials = await launch();
    let client = clients.get(id);
    if (!client) {
      client = createClient({ ...credentials, fetchImpl });
      await client.initialize(); clients.set(id, client);
    }
    return client;
  }
  async function ensureProject(id, payload = {}) {
    await load();
    const client = await getClient(id);
    if (!sessions[id]) {
      const created = resultObject(await client.callTool('create_project', {
        name: String(payload.projectTitle || payload.name || `AIYOUcodex ${id}`).slice(0, 200),
        description: `AIYOUcodex conversation ${id}`, compositionWidth: payload.compositionWidth || 1920,
        compositionHeight: payload.compositionHeight || 1080, fps: payload.fps || 30,
      }));
      if (!validId(created?.id)) throw new OpenChatCutError('OpenChatCut 未确认新工程 ID，未绑定其他工程。', 'OPENCHATCUT_PROJECT_ERROR');
      if (Object.values(sessions).some(entry => entry.projectId === created.id)) {
        throw new OpenChatCutError('OpenChatCut 返回了其他对话的工程，未建立重复绑定。', 'OPENCHATCUT_PROJECT_MISMATCH');
      }
      sessions[id] = { projectId: created.id, projectTitle: created.name, createdAt: now(), updatedAt: now(), editSessionId: null };
      await persist();
    }
    if (payload.projectId && payload.projectId !== sessions[id].projectId) throw new OpenChatCutError('当前对话已绑定独立剪辑工程，不能切换到其他对话的工程。', 'OPENCHATCUT_PROJECT_MISMATCH');
    const entry = sessions[id];
    entry.editorUrl = `${credentials.baseUrl}/#/editor/${encodeURIComponent(entry.projectId)}`;
    return { client, entry };
  }
  async function connectEditor(id, payload = {}) {
    let { client, entry } = await ensureProject(id, payload);
    const serviceChanged = Boolean(latest.serviceId && entry.serviceId !== latest.serviceId);
    const reconnectId = entry.pendingReconnectId || (serviceChanged ? randomBytes(12).toString('hex') : null);
    const serviceRecovery = reconnectId ? { reconnectEditor: true, serviceRestarted: true,
      reconnectId } : {};
    const previousEditorIds = reconnectId ? [...(entry.previousEditorIds || []), entry.editorId].filter(Boolean) : [];
    // The host owns the one active embedded renderer. It may keep this editor
    // hidden while a background conversation executes, without switching chats.
    const requestMount = () => emit({ type: 'editing', threadId: id, editorUrl: entry.editorUrl, session: { threadId: id, ...entry }, state: 'connecting', autoOpen: payload.autoOpen !== false, ...serviceRecovery });
    requestMount();
    const startedAt = now();
    let nextMountAt = startedAt + 2000, renewedTransport = false, requestedReconnect = false;
    const deadline = now() + readinessTimeoutMs;
    let upstream;
    do {
      if (stopping) throw new OpenChatCutError('连接已停止，OpenChatCut 正在彻底关闭。', 'OPENCHATCUT_STOPPING');
      try { upstream = resultObject(await client.callTool('openchatcut_status')); }
      catch (error) {
        if (!staleTransport(error) || renewedTransport) throw error;
        await client.close(); clients.delete(id); client = await getClient(id);
        renewedTransport = true;
        upstream = resultObject(await client.callTool('openchatcut_status'));
      }
      const currentEditor = upstream?.editors?.find(editor => editor.projectId === entry.projectId);
      if (liveEditor(upstream, entry.projectId) && (!currentEditor?.editorId || !previousEditorIds.includes(currentEditor.editorId))) {
        try {
          const bound = resultObject(await client.callTool('target_project', { projectId: entry.projectId }));
          if (bound?.bindingMode !== 'browser' || bound?.binding?.projectId !== entry.projectId) {
            throw new OpenChatCutError('OpenChatCut 工程未绑定到实时编辑器，未执行剪辑。', 'OPENCHATCUT_BINDING_ERROR');
          }
          break;
        } catch (error) {
          // Only preflight binding is retried. A media edit with an unknown
          // result is never replayed here. Transport renewal keeps project and
          // draft ids, so beginDraft can explicitly recover the old owner.
          if (staleTransport(error) && !renewedTransport) {
            await client.close(); clients.delete(id); client = await getClient(id);
            renewedTransport = true; continue;
          }
          if (!/is not open in a connected OpenChatCut editor/iu.test(error.message)) throw error;
        }
      }
      if (activeThreadId === id) activeThreadId = undefined;
      if (now() >= deadline) throw new OpenChatCutError('右侧 OpenChatCut 编辑器尚未连接；请保持工具面板打开后重试。没有退回离线写入。', 'OPENCHATCUT_EDITOR_NOT_READY');
      // A disconnected registration may outlive its browser. Reload this
      // conversation's existing editor at most once, and only when there is no
      // pending edit draft to lose. Healthy editors are never reloaded.
      const registeredOffline = upstream?.editors?.some(editor => editor.projectId === entry.projectId && editor.connected === false);
      if (registeredOffline && !requestedReconnect && !entry.editSessionId && now() - startedAt >= reconnectAfterMs) {
        emit({ type: 'editing', threadId: id, editorUrl: entry.editorUrl, session: { threadId: id, ...entry },
          state: 'connecting', autoOpen: payload.autoOpen !== false, reconnectEditor: true, reconnectId: randomBytes(12).toString('hex') });
        requestedReconnect = true;
      }
      // A host renderer may still be initializing when the first event fires,
      // or reconnect while we wait. Re-request this same editor without making
      // another project/session or reloading an already mounted iframe.
      if (now() >= nextMountAt) { requestMount(); nextMountAt = now() + 2000; }
      await wait(pollMs);
    } while (true);
    activeThreadId = id; entry.updatedAt = now(); entry.serviceId = latest.serviceId;
    entry.editorId = upstream?.editors?.find(editor => editor.projectId === entry.projectId)?.editorId;
    delete entry.pendingReconnectId; delete entry.previousEditorIds; await persist();
    emit({ type: 'update', threadId: id, state: 'ready', editorUrl: entry.editorUrl, session: { threadId: id, ...entry } });
    return { client, entry };
  }
  async function beginDraft(id, client, entry, approvalMode = 'auto') {
    if (entry.editSessionId) {
      try {
        const current = resultObject(await client.callTool('get_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId }));
        if (['stale', 'failed'].includes(current?.status) && Number(current.operationCount) > 0) {
          throw new OpenChatCutError('原草稿已过期且有未应用操作，请在右侧处理；未丢弃草稿。', 'OPENCHATCUT_REVIEW_PENDING');
        }
        if (current?.status === 'drafting') {
          if (current.stale) {
            if (Number(current.operationCount) > 0) throw new OpenChatCutError('工程已变化，原草稿有未应用操作，请在右侧处理；未丢弃草稿。', 'OPENCHATCUT_REVIEW_PENDING');
            await client.callTool('discard_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId });
            entry.editSessionId = null;
          } else {
            entry.approvalMode = current.approvalMode || entry.approvalMode || 'auto';
            if (entry.approvalMode === approvalMode) return current;
            if (entry.approvalMode === 'manual') throw new OpenChatCutError('此工程有原生确认会话，请先在右侧确认、审阅或取消后继续自动剪辑。', 'OPENCHATCUT_REVIEW_PENDING');
            const reviewed = resultObject(await client.callTool('review_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId, summary: '保存当前剪辑并切换到原生确认流程' }));
            if (reviewed?.status !== 'applied') throw new OpenChatCutError('当前剪辑尚未应用，不能切换确认方式。', 'OPENCHATCUT_REVIEW_PENDING');
            entry.editSessionId = null;
          }
        }
        if (current?.status === 'awaiting_review') throw new OpenChatCutError('此工程有待审阅草稿，请先在右侧处理后继续。', 'OPENCHATCUT_REVIEW_PENDING');
        entry.editSessionId = null;
      } catch (error) {
        if (error.code === 'OPENCHATCUT_REVIEW_PENDING') throw error;
        const records = resultObject(await client.callTool('list_edit_sessions', { editorProjectId: entry.projectId }));
        const orphan = Array.isArray(records) ? records.find(record => record.editSessionId === entry.editSessionId) : undefined;
        if (orphan && (orphan.stale || ['applied', 'cancelled', 'rejected', 'stale'].includes(orphan.status))) {
          if (Number(orphan.operationCount) > 0 && !['applied', 'cancelled', 'rejected'].includes(orphan.status)) {
            throw new OpenChatCutError('原草稿已过期且有未应用操作，请在右侧处理；未丢弃草稿。', 'OPENCHATCUT_REVIEW_PENDING');
          }
          if (['drafting', 'awaiting_review'].includes(orphan.status)) {
            await client.callTool('recover_edit_session', { editSessionId: entry.editSessionId, action: 'discard', editorProjectId: entry.projectId });
          }
          entry.editSessionId = null; await persist();
          return beginDraft(id, client, entry, approvalMode);
        }
        // Recovery is explicit and revision-checked upstream, never a silent
        // discard of a draft left by a disconnected transport.
        const recovered = resultObject(await client.callTool('recover_edit_session', { editSessionId: entry.editSessionId, action: 'resume', editorProjectId: entry.projectId }));
        if (recovered?.status !== 'drafting') throw new OpenChatCutError('原剪辑草稿需要在 OpenChatCut 中恢复，未丢弃草稿。', 'OPENCHATCUT_RECOVERY_REQUIRED');
        entry.approvalMode = recovered.approvalMode || entry.approvalMode || 'auto';
        if (entry.approvalMode !== approvalMode) return beginDraft(id, client, entry, approvalMode);
        return recovered;
      }
    }
    const value = resultObject(await client.callTool('begin_edit_session', { clientName: 'AIYOUcodex', approvalMode, reuseExisting: true, editorProjectId: entry.projectId }));
    const editSessionId = sessionIdentity(value);
    if (!validId(editSessionId)) throw new OpenChatCutError('OpenChatCut 未确认剪辑草稿 ID。', 'OPENCHATCUT_SESSION_ERROR');
    entry.editSessionId = editSessionId; entry.editSessionStatus = value.status || 'drafting'; entry.approvalMode = value.approvalMode || approvalMode; await persist();
    if (entry.approvalMode !== approvalMode) throw new OpenChatCutError('上游复用了不同确认方式的草稿；未执行此工具，请在右侧处理原草稿。', 'OPENCHATCUT_REVIEW_PENDING');
    return value;
  }
  async function prepareDraft(id, client, entry, approvalMode, payload) {
    for (let retry = 0; ; retry++) {
      try { return { client, entry, draft: await beginDraft(id, client, entry, approvalMode) }; }
      catch (error) {
        if (!staleTransport(error) || retry >= 3) throw error;
        await wait(pollMs * 2 ** retry);
        ({ client, entry } = await connectEditor(id, payload));
      }
    }
  }
  async function callTool(id, payload) {
    const name = payload.name || payload.toolName;
    if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,100}$/u.test(name)) throw new OpenChatCutError('无效的 OpenChatCut 工具名。', 'OPENCHATCUT_TOOL_INVALID');
    const args = payload.arguments || payload.args || {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OpenChatCutError('工具参数必须是对象。', 'OPENCHATCUT_TOOL_INVALID');
    const policy = openChatCutToolPolicy(name, args);
    if (!policy.allowed) throw new OpenChatCutError(policy.reason, 'OPENCHATCUT_POLICY_BLOCKED');
    if (['create_project', 'target_project', 'list_projects', 'get_editor_url'].includes(name)) {
      if (name === 'list_projects') return { projects: Object.entries(sessions).filter(([threadId]) => threadId === id).map(([, value]) => value) };
      if (name === 'get_editor_url') return status({ threadId: id });
      throw new OpenChatCutError('工程由当前对话自动绑定，请使用 start-editing。', 'OPENCHATCUT_PROJECT_MISMATCH');
    }
    let { client, entry } = await connectEditor(id, payload);
    const tools = await client.listTools();
    if (!tools.some(tool => tool.name === name)) throw new OpenChatCutError(`当前上游未提供工具 ${name}。`, 'OPENCHATCUT_TOOL_UNAVAILABLE');
    if (args.editorProjectId && args.editorProjectId !== entry.projectId) throw new OpenChatCutError('工具工程与当前对话不一致。', 'OPENCHATCUT_PROJECT_MISMATCH');
    if (args.projectId && args.projectId !== entry.projectId) throw new OpenChatCutError('素材工程与当前对话不一致。', 'OPENCHATCUT_PROJECT_MISMATCH');
    if (args.editSessionId && args.editSessionId !== entry.editSessionId) throw new OpenChatCutError('工具草稿与当前对话不一致。', 'OPENCHATCUT_SESSION_MISMATCH');
    const localPathTool = OPENCHATCUT_LOCAL_PATH_TOOLS.has(name);
    let importSettings;
    if (localPathTool || ['import_media', 'finalize_uploaded_asset'].includes(name)) {
      importSettings = await openChatCutImportSettings(credentials.baseUrl, { fetchImpl, requireLocalStorage: name !== 'browse_local_media' });
      if (name === 'browse_local_media') return { result: await browseOpenChatCutLocalMedia(args, importSettings), session: { threadId: id, ...entry } };
      if (localPathTool && ['import_media', 'probe_media', 'finalize_uploaded_asset', 'read_project'].some(required => !tools.some(tool => tool.name === required))) {
        throw new OpenChatCutError('当前 OpenChatCut 缺少已验证的本地上传工具，未导入素材。', 'OPENCHATCUT_TOOL_UNAVAILABLE');
      }
    }
    if (name === 'begin_edit_session') return beginDraft(id, client, entry);
    const existingSessionControl = ['review_edit_session', 'discard_edit_session', 'get_edit_session', 'recover_edit_session'].includes(name);
    if (existingSessionControl && !entry.editSessionId) {
      if (name === 'get_edit_session') return { result: { editSessionId: null, status: entry.editSessionStatus || 'none' }, session: { threadId: id, ...entry } };
      throw new OpenChatCutError('当前对话没有待处理剪辑草稿。', 'OPENCHATCUT_SESSION_REQUIRED');
    }
    if (name === 'recover_edit_session' && args.action === 'discard') {
      // A previous explicit discard may have released the broker owner while
      // an older controller retained its pointer. Only this explicit action
      // can retire that pointer, after a sessionless upstream read confirms
      // the same terminal session has no owner or recovery claim left.
      const records = resultObject(await client.callTool('list_edit_sessions', { editorProjectId: entry.projectId }));
      const current = Array.isArray(records) ? records.find(record => record.editSessionId === entry.editSessionId) : undefined;
      if (current && discardedSessionTerminalStatuses.has(current.status)
        && ['ownerOnline', 'orphaned', 'recoveryPending', 'ownedByCurrentTransport'].every(field => current[field] === false)
        && Array.isArray(current.recoveryActions) && current.recoveryActions.length === 0) {
        const releasedId = entry.editSessionId;
        entry.editSessionId = null; entry.editSessionStatus = current.status; entry.updatedAt = now(); await persist();
        emit({ type: 'update', threadId: id, state: 'ready', toolName: name, editorUrl: entry.editorUrl, session: { threadId: id, ...entry } });
        return { result: { editSessionId: releasedId, status: current.status, operationCount: current.operationCount,
          localBindingReleased: true, alreadyReleased: true }, session: { threadId: id, ...entry } };
      }
    }
    if (!globalRead.has(name) && !['list_edit_sessions', 'openchatcut_status'].includes(name) && !existingSessionControl) {
      const approvalMode = policy.manual ? 'manual' : 'auto';
      let draft;
      ({ client, entry, draft } = await prepareDraft(id, client, entry, policy.readOnly ? entry.approvalMode || approvalMode : approvalMode, payload));
      const realWrite = !policy.readOnly && (localPathTool || !OPENCHATCUT_DRAFT_TOOLS.has(name))
        && !['review_edit_session', 'discard_edit_session', 'get_edit_session', 'recover_edit_session'].includes(name);
      if (realWrite && Number(draft?.operationCount) > 0) {
        const finished = resultObject(await client.callTool('review_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId, summary: '应用当前剪辑后执行本地工具' }));
        if (finished?.status !== 'applied') throw new OpenChatCutError('草稿尚未应用，等待右侧审阅后再执行此工具。', 'OPENCHATCUT_REVIEW_PENDING');
        entry.editSessionId = null; await persist(); await beginDraft(id, client, entry, approvalMode);
      }
    }
    if (localPathTool) {
      const result = await importOpenChatCutLocalMedia(name, args, { baseUrl: credentials.baseUrl, projectId: entry.projectId,
        settings: importSettings, fetchImpl,
        // Call the bound lower-level operation inside this existing serialized
        // job. Reentering handle() here would deadlock its shared write queue.
        invoke: async (toolName, arguments_) => resultObject((await callTool(id, { name: toolName, arguments: arguments_, autoOpen: payload.autoOpen })).result),
        onProgress: progress => emit({ type: 'update', threadId: id, toolName: name, editorUrl: entry.editorUrl, session: { threadId: id, ...entry }, ...progress }) });
      entry.updatedAt = now(); await persist();
      emit({ type: 'update', threadId: id, state: 'ready', toolName: name, editorUrl: entry.editorUrl, session: { threadId: id, ...entry } });
      return { result, session: { threadId: id, ...entry } };
    }
    const invocation = { ...args, editorProjectId: entry.projectId,
      ...(!globalRead.has(name) && !['list_edit_sessions', 'openchatcut_status'].includes(name) ? { editSessionId: entry.editSessionId } : {}) };
    delete invocation.approvalMode;
    let result;
    for (let retry = 0; ; retry++) {
      try { result = await client.callTool(name, invocation); break; }
      catch (error) {
        if (!rejectedStaleDispatch(error, entry.projectId) || retry >= 3) throw error;
        // Wait for the registration heartbeat when the browser guard is ahead
        // of the broker. Only confirmed rejection before the operation can
        // retry; pending cancellations or unknown results exit immediately.
        await wait(pollMs * 2 ** retry);
        ({ client, entry } = await connectEditor(id, payload));
        if (!globalRead.has(name) && !['list_edit_sessions', 'openchatcut_status'].includes(name) && !existingSessionControl) {
          ({ client, entry } = await prepareDraft(id, client, entry, policy.readOnly ? entry.approvalMode || 'auto' : policy.manual ? 'manual' : 'auto', payload));
          invocation.editSessionId = entry.editSessionId;
        }
      }
    }
    const toolOutcome = resultObject(result);
    if (toolOutcome && typeof toolOutcome === 'object' && (toolOutcome.ok === false || toolOutcome.success === false
      || toolOutcome.status === 'failed' || typeof toolOutcome.error === 'string')) {
      throw new OpenChatCutError(toolOutcome.error || toolOutcome.message || `OpenChatCut 工具 ${name} 执行失败；草稿未自动应用。`, 'OPENCHATCUT_TOOL_FAILED', toolOutcome);
    }
    let review;
    if (OPENCHATCUT_DRAFT_TOOLS.has(name) && !policy.readOnly && !policy.manual && payload.deferReview !== true) {
      review = await client.callTool('review_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId,
        summary: String(payload.summary || `${name} · AIYOUcodex`).slice(0, 500) });
      const applied = resultObject(review);
      entry.editSessionStatus = applied?.status;
      if (applied?.status === 'applied') entry.editSessionId = null;
      else if (applied?.status && applied.status !== 'drafting') throw new OpenChatCutError('剪辑草稿尚未确认应用，请检查右侧面板。', 'OPENCHATCUT_REVIEW_PENDING', applied);
    } else if (name === 'recover_edit_session' && args.action === 'discard') {
      // Upstream discard is idempotent for terminal sessions: a successful
      // stale response retains its historical operationCount. It need not
      // become cancelled or report zero, but must identify this exact draft.
      if (toolOutcome?.editSessionId !== invocation.editSessionId) {
        throw new OpenChatCutError('上游解除的草稿 ID 与当前对话不一致，未清理原绑定。', 'OPENCHATCUT_SESSION_MISMATCH');
      }
      if (!discardedSessionTerminalStatuses.has(toolOutcome?.status)) {
        throw new OpenChatCutError('上游尚未确认原剪辑草稿已解除，未清理原绑定。', 'OPENCHATCUT_RECOVERY_REQUIRED');
      }
      entry.editSessionStatus = toolOutcome.status; entry.editSessionId = null;
    } else if (['review_edit_session', 'discard_edit_session'].includes(name)) {
      const outcome = resultObject(result); entry.editSessionStatus = outcome?.status;
      if (['applied', 'cancelled', 'rejected'].includes(outcome?.status)) entry.editSessionId = null;
    } else if (!policy.readOnly && !OPENCHATCUT_DRAFT_TOOLS.has(name)
      && !['get_edit_session', 'recover_edit_session', 'list_edit_sessions'].includes(name) && toolOutcome?.status !== 'pending') {
      // Real tools can advance the live revision. target_project refreshes the
      // binding and explicitly orphans the old draft owner. Sessionless list
      // reads expose operationCount without using the obsolete draft binding.
      // Recovery/discard then closes only an observed empty draft.
      ({ client, entry } = await connectEditor(id, payload));
      const records = resultObject(await client.callTool('list_edit_sessions', { editorProjectId: entry.projectId }));
      const current = Array.isArray(records) ? records.find(record => record.editSessionId === entry.editSessionId) : undefined;
      if (current && (current.stale || current.orphaned || entry.approvalMode === 'manual') && Number(current.operationCount) === 0) {
        if (['drafting', 'awaiting_review'].includes(current.status)) {
          await client.callTool(current.orphaned ? 'recover_edit_session' : 'discard_edit_session', {
            editSessionId: entry.editSessionId, editorProjectId: entry.projectId, ...(current.orphaned ? { action: 'discard' } : {}) });
        }
        entry.editSessionId = null; entry.editSessionStatus = 'cancelled';
      }
    }
    entry.updatedAt = now(); await persist();
    const outcome = resultObject(result);
    emit({ type: 'update', threadId: id, state: outcome?.status === 'pending' && policy.manual ? 'awaiting-confirmation' : 'ready', toolName: name,
      ...(outcome?.status === 'pending' && policy.manual ? { message: '请在右侧 OpenChatCut 中确认此工具的具体操作。' } : {}),
      editorUrl: entry.editorUrl, session: { threadId: id, ...entry } });
    return { result, ...(review ? { review } : {}), session: { threadId: id, ...entry } };
  }
  function serial(operation) {
    const result = queue.then(operation); queue = result.catch(() => {}); return result;
  }
  async function handle(action, context = {}) {
    const payload = typeof action === 'string' ? { action } : action;
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid OpenChatCut action');
    if (disposed) throw new OpenChatCutError('OpenChatCut 控制器已关闭。');
    if (['status', 'refresh'].includes(payload.action)) return status({ ...context, threadId: context.threadId || payload.threadId });
    if (payload.action === 'stop') {
      const id = thread(context, payload);
      if (!installer.stop) throw new OpenChatCutError('此安装管理器不支持彻底关闭。', 'OPENCHATCUT_STOP_FAILED');
      stopping = true; operationGeneration += 1;
      emit({ type: 'stopping', state: 'stopping', threadId: id, message: '正在彻底关闭 OpenChatCut…', autoOpen: false });
      return serial(async () => {
        try {
          const emptyDrafts = new Map();
          for (const [threadId, client] of clients) {
            const entry = sessions[threadId];
            if (!entry?.editSessionId) continue;
            try {
              const records = resultObject(await client.callTool('list_edit_sessions', { editorProjectId: entry.projectId }));
              const current = Array.isArray(records) ? records.find(row => row.editSessionId === entry.editSessionId) : null;
              if (current && Number(current.operationCount) === 0) emptyDrafts.set(threadId, entry.editSessionId);
            } catch { /* Unconfirmed drafts keep their exact recovery pointers. */ }
          }
          // Existing writes finish before closing transports; project/draft IDs
          // remain durable so stopping never silently discards staged work.
          await Promise.all([...clients.values()].map(client => client.close().catch(() => {}))); clients.clear(); credentials = undefined;
          const result = await installer.stop();
          if (result.stopped !== true) throw new OpenChatCutError(result.message || '未确认后台进程已退出。', 'OPENCHATCUT_STOP_FAILED');
          for (const [threadId, draftId] of emptyDrafts) if (sessions[threadId]?.editSessionId === draftId) {
            sessions[threadId].editSessionId = null; sessions[threadId].editSessionStatus = 'stopped-empty';
          }
          stopped = true; activeThreadId = undefined;
          latest = { ...latest, ...cleanInstallerStatus(result), state: 'stopped', running: false, editorUrl: null, baseUrl: null, toolName: null };
          await persist();
          const snapshot = await status({ threadId: id });
          const value = { ...snapshot, type: 'stopped', stopped: true, editorUrl: null, session: snapshot.session ? { ...snapshot.session, connected: false, editorUrl: null } : null, autoOpen: false };
          emit(value); return value;
        } finally { stopping = false; }
      });
    }
    if (payload.action === 'install') return serial(async () => {
      await installer.install({ onProgress: progress => { latest = { ...latest, ...cleanInstallerStatus(progress) }; emit({ type: 'status', ...latest }); } });
      const snapshot = await status(context); emit({ type: 'status', ...snapshot }); return snapshot;
    });
    const id = thread(context, payload);
    const generation = operationGeneration;
    return serial(async () => {
      await load();
      if (generation !== operationGeneration || stopping) throw new OpenChatCutError('操作已被彻底关闭取消，请重新打开剪辑工具。', 'OPENCHATCUT_STOPPING');
      if (stopped && !['open', 'start-editing', 'list-tools'].includes(payload.action)) throw new OpenChatCutError('OpenChatCut 已彻底关闭，请先重新打开。', 'OPENCHATCUT_STOPPED');
      if (['open', 'start-editing'].includes(payload.action)) { stopped = false; await persist(); }
      if (payload.action === 'open') {
        const { client, entry } = await ensureProject(id, payload);
        const serviceChanged = Boolean(latest.serviceId && entry.serviceId !== latest.serviceId);
        // Menu reopening repairs an unregistered error document as well as a
        // cold server. This is preflight only; drafts/project binding survive.
        const upstream = resultObject(await client.callTool('openchatcut_status'));
        const reconnectEditor = serviceChanged || !liveEditor(upstream, entry.projectId);
        if (reconnectEditor) {
          entry.pendingReconnectId ||= randomBytes(12).toString('hex');
          entry.previousEditorIds = [...new Set([entry.editorId, ...upstream?.editors?.filter(editor => editor.projectId === entry.projectId).map(editor => editor.editorId) || []].filter(Boolean))];
        }
        entry.serviceId = latest.serviceId; await persist();
        const recovery = reconnectEditor ? { reconnectEditor: true, serviceRestarted: serviceChanged,
          editorDisconnected: true, reconnectId: entry.pendingReconnectId } : {};
        // The sidebar owns visibility for its request. A late event must not
        // reopen a view the user closed while local startup was in flight.
        emit({ type: 'editing', threadId: id, editorUrl: entry.editorUrl, session: { threadId: id, ...entry }, state: 'opening', autoOpen: false, ...recovery });
        return { ...await status({ threadId: id }), state: 'opening', editorUrl: entry.editorUrl, ...recovery };
      }
      if (payload.action === 'start-editing') {
        let { client, entry } = await connectEditor(id, payload);
        ({ client, entry } = await prepareDraft(id, client, entry, 'auto', payload));
        return { ...await status({ threadId: id }), state: 'ready', session: { threadId: id, ...entry } };
      }
      if (payload.action === 'new-project') {
        if (typeof payload.projectTitle !== 'string' || !payload.projectTitle.trim()) {
          throw new OpenChatCutError('请提供新剪辑项目名称；只有对话明确新建时才换绑。', 'OPENCHATCUT_PROJECT_TITLE_REQUIRED');
        }
        await load();
        const previous = sessions[id];
        let client = await getClient(id);
        if (previous) {
          let entry, draft;
          ({ client, entry } = await connectEditor(id, payload));
          ({ client, entry, draft } = await prepareDraft(id, client, entry, entry.approvalMode || 'auto', payload));
          if (Number(draft.operationCount) > 0) throw new OpenChatCutError('原项目还有未应用剪辑，请先应用或弃用草稿再新建；项目未换绑。', 'OPENCHATCUT_REVIEW_PENDING');
          const closed = resultObject(await client.callTool('discard_edit_session', { editSessionId: entry.editSessionId, editorProjectId: entry.projectId }));
          if (closed?.status !== 'cancelled') throw new OpenChatCutError('原项目空草稿未确认关闭，项目未换绑。', 'OPENCHATCUT_REVIEW_PENDING');
          entry.editSessionId = null; entry.editSessionStatus = 'cancelled'; await persist();
        }
        const created = resultObject(await client.callTool('create_project', {
          name: payload.projectTitle.trim().slice(0, 200), description: `AIYOUcodex conversation ${id}`,
          compositionWidth: payload.compositionWidth || 1920, compositionHeight: payload.compositionHeight || 1080, fps: payload.fps || 30,
        }));
        if (!validId(created?.id) || Object.values(sessions).some(entry => entry.projectId === created.id)) {
          throw new OpenChatCutError('未确认独立新工程，原项目绑定保留。', 'OPENCHATCUT_PROJECT_ERROR');
        }
        const replacedAt = now();
        sessions[id] = { projectId: created.id, projectTitle: created.name, createdAt: replacedAt, updatedAt: replacedAt, editSessionId: null,
          projectHistory: [...(previous?.projectHistory || []), ...(previous ? [{ projectId: previous.projectId, projectTitle: previous.projectTitle, replacedAt }] : [])] };
        await persist();
        ({ client } = await connectEditor(id, payload));
        return { ...await status({ threadId: id }), state: 'ready', projectRebound: true };
      }
      if (payload.action === 'list-tools') {
        const installed = await installer.status();
        if (!installed.installed) return { tools: [], installed: false, message: '请点击设置或左侧 OpenChatCut 入口一键安装。' };
        if (installed.state !== 'running' && installed.running !== true) return { tools: [], installed: true, requiresStart: true,
          message: 'OpenChatCut 已安装；开始剪辑或点击左侧工具入口后加载完整工具目录。' };
        // No project creation or editor navigation for simple discovery.
        const client = await getClient(id); const tools = await client.listTools();
        return { tools: tools.map(tool => ({ ...tool, integrationPolicy: openChatCutToolPolicy(tool.name) })), installed: true };
      }
      if (payload.action === 'call-tool') return callTool(id, payload);
      throw new OpenChatCutError('不支持的 OpenChatCut 操作。', 'OPENCHATCUT_ACTION_INVALID');
    });
  }
  async function start() {
    await load();
    if (server) return { url: endpoint, token, connectionPath };
    token = randomBytes(32).toString('base64url');
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.origin || !secretEqual(req.headers.authorization, `Bearer ${token}`)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      try {
        const url = new URL(req.url || '/', `http://${host}`);
        if (req.method === 'GET' && url.pathname === '/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          streams.add(res); res.write(`data: ${JSON.stringify({ type: 'status', ...await status() })}\n\n`);
          req.on('close', () => streams.delete(res)); return;
        }
        if (req.method === 'GET' && url.pathname === '/health') { res.end(JSON.stringify({ ok: true, pid: process.pid })); return; }
        if (req.method !== 'POST' || url.pathname !== '/request') { res.writeHead(404); res.end('{}'); return; }
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new OpenChatCutError('请求过大。'); chunks.push(chunk); }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await handle(payload, { threadId: payload.threadId });
        res.end(JSON.stringify({ ok: true, data: result }));
      } catch (error) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: error.message, code: error.code || 'OPENCHATCUT_UNAVAILABLE' })); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    endpoint = `http://${host}:${server.address().port}`;
    await mkdir(path.dirname(connectionPath), { recursive: true, mode: 0o700 });
    await writeFile(connectionPath, JSON.stringify({ version: 1, url: endpoint, token, pid: process.pid }), { mode: 0o600 });
    return { url: endpoint, token, connectionPath };
  }
  async function dispose() {
    disposed = true;
    for (const stream of streams) stream.end(); streams.clear();
    await Promise.all([...clients.values()].map(client => client.close().catch(() => {}))); clients.clear();
    if (server) await new Promise(resolve => server.close(resolve));
    server = undefined;
    try { const stored = JSON.parse(await readFile(connectionPath, 'utf8')); if (stored.pid === process.pid && stored.token === token) await rm(connectionPath, { force: true }); } catch {}
  }
  return { handle, request: handle, status, start, dispose, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get connectionPath() { return connectionPath; } };
}
