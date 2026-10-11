import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createOpenChatCutController } from '../lib/openchatcut-controller.mjs';

async function fixture(t, { installed = true, connect = true, missedMountEvents = 0, readinessTimeoutMs = 10, pollMs = 1,
  registeredOffline = false, reconnectAfterMs = 2000, staleBindingOnce = false, failWrite = false,
  staleDraftOnce = false, staleDispatchOnce = false, staleNonemptyDraft = false, staleBrowserGuards = 0, draftOperationCount = 0, editorIdentity } = {}) {
  const directory = await mkdtemp(path.join(process.env.AIYOUCODEX_TEST_OUTPUT_DIRECTORY || os.tmpdir(), 'openchatcut-controller-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [], events = [], projects = new Map(); let count = 0, activeProject, online = true, listedSession, recoverResult, recoverError;
  const installer = { status: async () => ({ installed, state: installed ? 'installed' : 'not-installed', version: '0.2.16' }),
    launch: async options => { assert.equal(options.background, true); return { installed, running: true, baseUrl: 'http://127.0.0.1:5199' }; },
    stop: async () => ({ installed, stopped: true, running: false, state: 'stopped' }),
    install: async ({ onProgress }) => { installed = true; onProgress({ state: 'installing', progress: 50 }); } };
  const createClient = () => {
    let binding;
    return { initialize: async () => {}, close: async () => {},
      listTools: async () => ['split_item', 'read_timeline', 'get_edit_session', 'list_edit_sessions', 'recover_edit_session', 'review_edit_session', 'transcribe_track', 'discard_edit_session'].map(name => ({ name, inputSchema: { type: 'object' } })),
      callTool: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === 'create_project') { const id = `project-${++count}`; projects.set(id, { draft: null }); return { id, name: args.name }; }
        if (name === 'openchatcut_status') return { connectedProjectIds: online && activeProject ? [activeProject] : [],
          editors: activeProject ? [{ projectId: activeProject, connected: online, editorId: editorIdentity }] : [] };
        if (name === 'target_project') {
          if (staleBindingOnce) {
            staleBindingOnce = false;
            throw Object.assign(new Error('MCP session binding is stale. Re-initialize the MCP session.'), { code: 'OPENCHATCUT_TOOL_FAILED' });
          }
          if (!online) throw new Error(`Project ${args.projectId} is not open in a connected OpenChatCut editor.`);
          binding = args.projectId; return { bindingMode: 'browser', binding: { projectId: binding } };
        }
        if (args.editorProjectId !== binding) throw new Error('Cross-project invocation');
        const project = projects.get(binding);
        if (name === 'begin_edit_session') {
          if (staleDraftOnce) { staleDraftOnce = false; throw Object.assign(new Error(`MCP session binding for project ${binding} is stale. Re-initialize the MCP session.`), { code: 'OPENCHATCUT_TOOL_FAILED' }); }
          project.draft = `draft-${++count}`; project.mode = args.approvalMode; project.draftStatus = 'drafting'; return { editSessionId: project.draft, status: 'drafting', approvalMode: project.mode, operationCount: 0 };
        }
        if (name === 'get_edit_session') return { editSessionId: project.draft, status: staleNonemptyDraft ? 'stale' : project.draft ? project.draftStatus : 'applied', approvalMode: project.mode, operationCount: staleNonemptyDraft ? 2 : draftOperationCount };
        if (name === 'list_edit_sessions') return [listedSession || { editSessionId: project.draft, status: project.draft ? project.draftStatus : 'applied', approvalMode: project.mode, operationCount: 0 }];
        if (name === 'recover_edit_session') {
          if (recoverError) throw recoverError;
          const outcome = recoverResult || { editSessionId: args.editSessionId, status: args.action === 'discard' ? 'cancelled' : 'drafting', operationCount: 0 };
          if (outcome.editSessionId === project.draft) project.draftStatus = outcome.status;
          return outcome;
        }
        if (name === 'review_edit_session') { const editSessionId = project.draft; if (project.mode === 'manual') { project.draftStatus = 'awaiting_review'; return { editSessionId, status: 'awaiting_review' }; } project.draft = null; return { editSessionId, status: 'applied' }; }
        if (name === 'split_item') {
          if (staleBrowserGuards > 0) { staleBrowserGuards--; throw Object.assign(new Error(`Project ${binding} changed; re-initialize the MCP session.`), { code: 'OPENCHATCUT_TOOL_FAILED' }); }
          if (staleDispatchOnce) { const message = staleDispatchOnce === 'editor' ? `Project ${binding} changed; re-initialize the MCP session.` : `MCP session binding for project ${binding} is stale. Re-initialize the MCP session.`; staleDispatchOnce = false; throw Object.assign(new Error(message), { code: 'OPENCHATCUT_TOOL_FAILED' }); }
          if (failWrite) throw Object.assign(new Error('Project changed while the editor call was pending.'), { code: 'OPENCHATCUT_TOOL_FAILED' });
          return { ok: true, projectId: binding };
        }
        if (name === 'read_timeline') return { items: [] };
        if (name === 'transcribe_track') { assert.equal(project.mode, args.provider === 'local' ? 'auto' : 'manual'); return args.provider === 'local' ? { ok: true } : { status: 'pending', confirmationId: 'exact-args-confirmation' }; }
        if (name === 'discard_edit_session') { project.draft = null; return { status: 'cancelled' }; }
        throw new Error(name);
      } };
  };
  const controller = createOpenChatCutController({ installer, stateRoot: directory, connectionPath: path.join(directory, 'controller.json'), readinessTimeoutMs, pollMs, reconnectAfterMs,
    createClient, fetchImpl: async () => new Response(JSON.stringify({ mcpToken: 'private-test-token-32-characters' })),
    onEvent: event => { events.push(event); if (event.type === 'editing' && connect) {
      if (missedMountEvents > 0) missedMountEvents--;
      else { activeProject = event.session.projectId; online = !registeredOffline || Boolean(event.reconnectEditor); }
    } } });
  t.after(() => controller.dispose());
  return { controller, directory, calls, events, installer, createClient,
    setOnline: value => { online = value; }, setConnect: value => { connect = value; },
    setEditorId: value => { editorIdentity = value; },
    setListedSession: value => { listedSession = value; }, setRecoverResult: value => { recoverResult = value; },
    setRecoverError: value => { recoverError = value; } };
}

test('registered disconnected editors are not treated as live and recover only the same conversation project', async t => {
  const { controller, calls, events } = await fixture(t, { registeredOffline: true, reconnectAfterMs: 0 });
  const result = await controller.handle({ action: 'start-editing', threadId: 'disconnected-editor' });
  assert.equal(result.state, 'ready');
  const recovery = events.filter(event => event.reconnectEditor);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].session.projectId, result.session.projectId);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(calls.filter(call => call.name === 'target_project').length, 1);
});

test('menu reopening after a service restart renews tokens and transports on the same port and preserves drafts', async t => {
  const f = await fixture(t, { draftOperationCount: 2 });
  let epoch = 1, tokenReads = 0, clientCount = 0;
  f.installer.launch = async options => { assert.equal(options.background, true); return { installed: true, baseUrl: 'http://127.0.0.1:5199', reused: true, serviceId: `5199:${epoch}` }; };
  const controller = createOpenChatCutController({ installer: f.installer, stateRoot: f.directory,
    connectionPath: path.join(f.directory, 'restart-controller.json'), readinessTimeoutMs: 40, pollMs: 1,
    fetchImpl: async () => { tokenReads++; return new Response(JSON.stringify({ mcpToken: `token-for-service-${epoch}-32-characters` })); },
    createClient: options => { clientCount++; assert.ok(options.token.startsWith(`token-for-service-${epoch}`)); return f.createClient(options); },
    onEvent: event => f.events.push(event) });
  t.after(() => controller.dispose());
  // Use menu open to establish the first binding; native reconnect preserves
  // the persisted draft pointer without creating/discarding media operations.
  const first = await controller.handle({ action: 'open', threadId: 'restart-chat' });
  const state = JSON.parse(await readFile(path.join(f.directory, 'sessions.json'), 'utf8'));
  state.sessions['restart-chat'].editSessionId = 'durable-unapplied-draft';
  await writeFile(path.join(f.directory, 'sessions.json'), JSON.stringify(state));
  // A host restart loads the durable draft. The next server instance uses the
  // same address; two opens inside this controller must renew its transport.
  const restored = createOpenChatCutController({ installer: f.installer, stateRoot: f.directory,
    connectionPath: path.join(f.directory, 'restored-restart-controller.json'),
    fetchImpl: async () => { tokenReads++; return new Response(JSON.stringify({ mcpToken: `token-for-service-${epoch}-32-characters` })); },
    createClient: options => { clientCount++; assert.ok(options.token.startsWith(`token-for-service-${epoch}`)); return f.createClient(options); } });
  t.after(() => restored.dispose());
  await restored.handle({ action: 'open', threadId: 'restart-chat' });
  epoch++;
  const reopened = await restored.handle({ action: 'open', threadId: 'restart-chat' });
  assert.equal(reopened.session.projectId, first.session.projectId);
  assert.equal(reopened.session.editSessionId, 'durable-unapplied-draft');
  assert.equal(reopened.serviceRestarted, true); assert.equal(reopened.reconnectEditor, true);
  assert.equal(clientCount, 3); assert.equal(tokenReads, 3);
  assert.equal(f.calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(f.calls.some(call => call.name === 'discard_edit_session'), false);
});

test('menu reopen repairs an unregistered error document even without a cached native editor', async t => {
  const f = await fixture(t, { connect: false });
  const first = await f.controller.handle({ action: 'open', threadId: 'failed-document' });
  const reopened = await f.controller.handle({ action: 'open', threadId: 'failed-document' });
  assert.equal(reopened.session.projectId, first.session.projectId);
  assert.equal(reopened.editorDisconnected, true); assert.equal(reopened.reconnectEditor, true);
  assert.equal(f.calls.filter(call => call.name === 'create_project').length, 1);
});

test('a cold service waits for the new editor identity before binding instead of using the closing old document', async t => {
  const f = await fixture(t, { editorIdentity: 'old-document' });
  f.installer.launch = async () => ({ installed: true, reused: true, baseUrl: 'http://127.0.0.1:5199', serviceId: '5199:1' });
  const first = await f.controller.handle({ action: 'start-editing', threadId: 'identity-chat' });
  const beforeTargets = f.calls.filter(call => call.name === 'target_project').length;
  f.installer.launch = async () => ({ installed: true, reused: true, baseUrl: 'http://127.0.0.1:5199', serviceId: '5199:2' });
  let newDocument = false, mountCount = 0;
  const clientFactory = f.createClient;
  const restored = createOpenChatCutController({ installer: f.installer, stateRoot: f.directory,
    connectionPath: path.join(f.directory,'identity-controller.json'), readinessTimeoutMs: 100, pollMs: 1,
    fetchImpl: async () => new Response(JSON.stringify({mcpToken:'private-identity-test-token-32chars'})),
    createClient: options => {
      const client = clientFactory(options), original = client.callTool;
      client.callTool = async (name,args) => {
        if(name === 'target_project') assert.equal(newDocument,true,'Closing old document is excluded during preflight');
        return original(name,args);
      }; return client;
    },
    onEvent: event => { if(event.reconnectEditor && !mountCount++) setTimeout(()=>{newDocument=true;f.setEditorId('new-document');},8); }
  });
  t.after(()=>restored.dispose());
  const after=await restored.handle({action:'start-editing',threadId:'identity-chat'});
  assert.equal(after.session.projectId,first.session.projectId);
  assert.equal(after.session.editorId,'new-document');
  assert.ok(f.calls.filter(call=>call.name==='target_project').length>beforeTargets);
});

test('complete shutdown preserves binding, rejects queued edits and requires explicit reopening', async t => {
  const { controller, calls, events, directory, installer } = await fixture(t);
  const opened = await controller.handle({ action: 'open', threadId: 'shutdown-chat' });
  const projectId = opened.session.projectId;
  const queued = controller.handle({ action: 'call-tool', threadId: 'shutdown-chat', name: 'read_timeline', arguments: {} });
  const failure = assert.rejects(queued, error => error.code === 'OPENCHATCUT_STOPPING');
  const stopped = await controller.handle({ action: 'stop', threadId: 'shutdown-chat' }); await failure;
  assert.equal(stopped.stopped, true); assert.equal(stopped.session.projectId, projectId);
  assert.equal(stopped.editorUrl, null); assert.equal(stopped.session.connected, false);
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'shutdown-chat', name: 'read_timeline', arguments: {} }), error => error.code === 'OPENCHATCUT_STOPPED');
  assert.equal(events.at(-1).type, 'stopped');
  assert.equal((await controller.status({ threadId: 'shutdown-chat' })).editorUrl, null);
  const restored = createOpenChatCutController({ installer, stateRoot: directory, connectionPath: path.join(directory, 'restored-connection.json') });
  assert.equal((await restored.status({ threadId: 'shutdown-chat' })).state, 'stopped');
  await assert.rejects(restored.handle({ action: 'call-tool', threadId: 'shutdown-chat', name: 'read_timeline', arguments: {} }), error => error.code === 'OPENCHATCUT_STOPPED');
  await restored.dispose();
  const reopened = await controller.handle({ action: 'open', threadId: 'shutdown-chat' });
  assert.equal(reopened.session.projectId, projectId);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'sessions.json'))).serviceStopped, false);
});

test('complete shutdown clears only verified empty draft pointers and preserves nonempty recovery IDs', async t => {
  const f = await fixture(t);
  await f.controller.handle({ action: 'start-editing', threadId: 'empty-at-shutdown' });
  const stopped = await f.controller.handle({ action: 'stop', threadId: 'empty-at-shutdown' });
  assert.equal(stopped.session.editSessionId, null);
  await f.controller.handle({ action: 'start-editing', threadId: 'nonempty-at-shutdown' });
  const snapshot = await f.controller.status({ threadId: 'nonempty-at-shutdown' });
  f.setListedSession({ editSessionId: snapshot.session.editSessionId, status: 'drafting', operationCount: 2 });
  const pending = await f.controller.handle({ action: 'stop', threadId: 'nonempty-at-shutdown' });
  assert.equal(pending.session.editSessionId, snapshot.session.editSessionId);
  assert.equal(f.calls.filter(call => call.name === 'discard_edit_session').length, 0);
});

test('public connection status reflects a live probe after the previously active editor disconnects', async t => {
  const { controller, setOnline } = await fixture(t);
  await controller.handle({ action: 'start-editing', threadId: 'connection-status' });
  assert.equal((await controller.status({ threadId: 'connection-status' })).session.connected, true);
  setOnline(false);
  assert.equal((await controller.status({ threadId: 'connection-status' })).session.connected, false);
});

test('stale preflight transports reconnect the original project without replaying an edit', async t => {
  const { controller, calls } = await fixture(t, { staleBindingOnce: true });
  const result = await controller.handle({ action: 'call-tool', threadId: 'stale-transport', name: 'split_item', arguments: {} });
  assert.equal(result.review.status, 'applied');
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(calls.filter(call => call.name === 'target_project').length, 2);
  assert.equal(calls.filter(call => call.name === 'split_item').length, 1);
});

test('an unknown mutation result is returned without retrying the media write', async t => {
  const { controller, calls } = await fixture(t, { failWrite: true });
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'unknown-write', name: 'split_item', arguments: {} }), /changed while/);
  assert.equal(calls.filter(call => call.name === 'split_item').length, 1);
  assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 0);
});

test('revision drift during draft preparation and a rejected pre-dispatch call recover the same project', async t => {
  const { controller, calls } = await fixture(t, { staleDraftOnce: true, staleDispatchOnce: true });
  const result = await controller.handle({ action: 'call-tool', threadId: 'revision-drift', name: 'split_item', arguments: { itemId: 'clip', frame: 30 } });
  assert.equal(result.review.status, 'applied');
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  const attempts = calls.filter(call => call.name === 'split_item');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].args.editorProjectId, attempts[1].args.editorProjectId);
  assert.equal(attempts[0].args.itemId, attempts[1].args.itemId);
  assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 1);
});

test('the browser revision guard can reject before running an operation and rebind without replacing the project', async t => {
  const { controller, calls } = await fixture(t, { staleDispatchOnce: 'editor' });
  const result = await controller.handle({ action: 'call-tool', threadId: 'browser-revision-guard', name: 'split_item', arguments: {} });
  assert.equal(result.review.status, 'applied');
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 1);
});

test('a delayed browser registration heartbeat has bounded recovery without repeating a completed operation', async t => {
  const { controller, calls } = await fixture(t, { staleBrowserGuards: 3 });
  const result = await controller.handle({ action: 'call-tool', threadId: 'delayed-revision-heartbeat', name: 'split_item', arguments: {} });
  assert.equal(result.review.status, 'applied');
  assert.equal(calls.filter(call => call.name === 'split_item').length, 4);
  assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 1);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
});

test('terminal stale drafts with unapplied operations remain bound for explicit recovery', async t => {
  const { controller, calls } = await fixture(t, { staleNonemptyDraft: true });
  const before = await controller.handle({ action: 'start-editing', threadId: 'stale-nonempty-draft' });
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'stale-nonempty-draft', name: 'split_item', arguments: {} }), { code: 'OPENCHATCUT_REVIEW_PENDING' });
  const after = await controller.status({ threadId: 'stale-nonempty-draft' });
  assert.equal(after.session.editSessionId, before.session.editSessionId);
  assert.equal(calls.filter(call => call.name === 'begin_edit_session').length, 1);
  assert.equal(calls.filter(call => call.name === 'split_item').length, 0);
  assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 0);
  assert.equal(calls.filter(call => call.name === 'discard_edit_session').length, 0);
});

test('a successful explicit recovery discard clears the matching terminal draft without requiring zero historical operations', async t => {
  for (const status of ['stale', 'cancelled', 'applied', 'rejected']) await t.test(status, async t => {
    const { controller, directory, calls, setRecoverResult } = await fixture(t, { staleNonemptyDraft: true });
    const before = await controller.handle({ action: 'start-editing', threadId: 'recovery-discard' });
    const originalId = before.session.editSessionId;
    setRecoverResult({ editSessionId: originalId, status, operationCount: 8 });
    const discarded = await controller.handle({ action: 'call-tool', threadId: 'recovery-discard',
      name: 'recover_edit_session', arguments: { editSessionId: originalId, action: 'discard' } });
    assert.equal(discarded.result.status, status);
    assert.equal(discarded.result.operationCount, 8);
    assert.equal(discarded.session.editSessionId, null);
    assert.equal(discarded.session.editSessionStatus, status);
    const stored = JSON.parse(await readFile(path.join(directory, 'sessions.json'), 'utf8'));
    assert.equal(stored.sessions['recovery-discard'].editSessionId, null);
    const after = await controller.handle({ action: 'start-editing', threadId: 'recovery-discard' });
    assert.notEqual(after.session.editSessionId, originalId);
    assert.equal(after.session.projectId, before.session.projectId);
    assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 1);
    assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
    assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 0);
  });
});

test('explicit discard releases an older local pointer only after the same terminal session is confirmed already released', async t => {
  for (const status of ['stale', 'applied', 'cancelled', 'rejected']) await t.test(status, async t => {
    const { controller, directory, calls, setListedSession } = await fixture(t, { staleNonemptyDraft: true });
    const before = await controller.handle({ action: 'start-editing', threadId: 'released-terminal' });
    const originalId = before.session.editSessionId;
    setListedSession({ editSessionId: originalId, status, operationCount: 8,
      ownerOnline: false, orphaned: false, recoveryPending: false, ownedByCurrentTransport: false, recoveryActions: [] });
    const released = await controller.handle({ action: 'call-tool', threadId: 'released-terminal',
      name: 'recover_edit_session', arguments: { editSessionId: originalId, action: 'discard' } });
    assert.equal(released.result.editSessionId, originalId);
    assert.equal(released.result.localBindingReleased, true);
    assert.equal(released.result.alreadyReleased, true);
    assert.equal(released.result.status, status);
    assert.equal(released.session.editSessionId, null);
    const stored = JSON.parse(await readFile(path.join(directory, 'sessions.json'), 'utf8'));
    assert.equal(stored.sessions['released-terminal'].editSessionId, null);
    assert.equal(calls.filter(call => call.name === 'list_edit_sessions').length, 1);
    assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 0);
    assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 0);
    const after = await controller.handle({ action: 'start-editing', threadId: 'released-terminal' });
    assert.notEqual(after.session.editSessionId, originalId);
    assert.equal(after.session.projectId, before.session.projectId);
    assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  });
});

test('ordinary reads and resume requests never use the explicitly authorized discard cleanup', async t => {
  const { controller, calls, setListedSession } = await fixture(t, { staleNonemptyDraft: true });
  const before = await controller.handle({ action: 'start-editing', threadId: 'read-terminal' });
  const originalId = before.session.editSessionId;
  setListedSession({ editSessionId: originalId, status: 'stale', operationCount: 8,
    ownerOnline: false, orphaned: false, recoveryPending: false, ownedByCurrentTransport: false, recoveryActions: [] });
  await controller.handle({ action: 'call-tool', threadId: 'read-terminal', name: 'list_edit_sessions', arguments: {} });
  await controller.handle({ action: 'call-tool', threadId: 'read-terminal', name: 'get_edit_session', arguments: { editSessionId: originalId } });
  assert.equal((await controller.status({ threadId: 'read-terminal' })).session.editSessionId, originalId);
  await assert.rejects(controller.handle({ action: 'start-editing', threadId: 'read-terminal' }), { code: 'OPENCHATCUT_REVIEW_PENDING' });
  await controller.handle({ action: 'call-tool', threadId: 'read-terminal', name: 'recover_edit_session',
    arguments: { editSessionId: originalId, action: 'resume' } });
  assert.equal((await controller.status({ threadId: 'read-terminal' })).session.editSessionId, originalId);
  assert.equal(calls.filter(call => call.name === 'list_edit_sessions').length, 1);
  assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 1);
});

test('an unsuccessful, active or mismatched recovery discard result preserves the local draft binding', async t => {
  const cases = [
    { name: 'different returned session', returnedId: 'different-draft', status: 'cancelled', code: 'OPENCHATCUT_SESSION_MISMATCH' },
    { name: 'failed result', status: 'failed', code: 'OPENCHATCUT_TOOL_FAILED' },
    { name: 'drafting result', status: 'drafting', code: 'OPENCHATCUT_RECOVERY_REQUIRED' },
    { name: 'awaiting review result', status: 'awaiting_review', code: 'OPENCHATCUT_RECOVERY_REQUIRED' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async t => {
    const { controller, calls, setRecoverResult } = await fixture(t);
    const before = await controller.handle({ action: 'start-editing', threadId: 'invalid-discard-result' });
    const originalId = before.session.editSessionId;
    setRecoverResult({ editSessionId: scenario.returnedId || originalId, status: scenario.status, operationCount: 8 });
    await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'invalid-discard-result',
      name: 'recover_edit_session', arguments: { editSessionId: originalId, action: 'discard' } }), { code: scenario.code });
    assert.equal((await controller.status({ threadId: 'invalid-discard-result' })).session.editSessionId, originalId);
    assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 1);
    assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 0);
  });
});

test('unreleased, missing or mismatched list metadata cannot clear an older local pointer', async t => {
  const cases = [
    { name: 'different listed session', fields: { editSessionId: 'different-draft' } },
    { name: 'failed terminal', fields: { status: 'failed' } },
    { name: 'active session', fields: { status: 'drafting' } },
    { name: 'orphaned session', fields: { orphaned: true } },
    { name: 'online owner', fields: { ownerOnline: true } },
    { name: 'recovery in progress', fields: { recoveryPending: true } },
    { name: 'current transport still owns session', fields: { ownedByCurrentTransport: true } },
    { name: 'recovery still offered', fields: { recoveryActions: ['discard'] } },
    { name: 'missing owner flag', fields: { ownerOnline: undefined } },
  ];
  for (const scenario of cases) await t.test(scenario.name, async t => {
    const { controller, calls, setListedSession, setRecoverError } = await fixture(t);
    const before = await controller.handle({ action: 'start-editing', threadId: 'unverified-release' });
    const originalId = before.session.editSessionId;
    setListedSession({ editSessionId: originalId, status: 'stale', operationCount: 8,
      ownerOnline: false, orphaned: false, recoveryPending: false, ownedByCurrentTransport: false, recoveryActions: [], ...scenario.fields });
    setRecoverError(Object.assign(new Error('Upstream did not release this session.'), { code: 'OPENCHATCUT_TOOL_FAILED' }));
    await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'unverified-release',
      name: 'recover_edit_session', arguments: { editSessionId: originalId, action: 'discard' } }), { code: 'OPENCHATCUT_TOOL_FAILED' });
    assert.equal((await controller.status({ threadId: 'unverified-release' })).session.editSessionId, originalId);
    assert.equal(calls.filter(call => call.name === 'recover_edit_session').length, 1);
    assert.equal(calls.filter(call => call.name === 'review_edit_session').length, 0);
  });
});

test('a disconnected editor with a pending draft is never automatically reloaded or discarded', async t => {
  const { controller, calls, events, setOnline, setConnect } = await fixture(t, { reconnectAfterMs: 0 });
  await controller.handle({ action: 'start-editing', threadId: 'pending-draft' });
  setOnline(false); setConnect(false);
  await assert.rejects(controller.handle({ action: 'start-editing', threadId: 'pending-draft' }), { code: 'OPENCHATCUT_EDITOR_NOT_READY' });
  assert.ok(!events.some(event => event.reconnectEditor));
  assert.ok(!calls.some(call => call.name === 'discard_edit_session'));
});

test('host restart restores both conversation project identities without creating replacement projects', async t => {
  const { controller, directory, calls, installer, createClient } = await fixture(t);
  const original = await Promise.all(['a', 'b'].map(threadId => controller.handle({ action: 'open', threadId })));
  await controller.dispose();
  const restored = createOpenChatCutController({ installer, createClient, stateRoot: directory,
    connectionPath: path.join(directory, 'controller.json'),
    fetchImpl: async () => new Response(JSON.stringify({ mcpToken: 'private-test-token-32-characters' })) });
  t.after(() => restored.dispose());
  const after = await Promise.all(['b', 'a'].map(threadId => restored.handle({ action: 'open', threadId })));
  assert.notEqual(original[0].session.projectId, original[1].session.projectId);
  assert.equal(after[0].session.projectId, original[1].session.projectId);
  assert.equal(after[1].session.projectId, original[0].session.projectId);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 2);
});

test('duplicate persisted conversation bindings fail without overwriting or editing either project', async t => {
  const { controller, directory, calls } = await fixture(t);
  const filename = path.join(directory, 'sessions.json');
  const record = JSON.stringify({ version: 1, sessions: { a: { projectId: 'same-project' }, b: { projectId: 'same-project' } } });
  await writeFile(filename, record);
  await assert.rejects(controller.handle({ action: 'start-editing', threadId: 'a' }), { code: 'OPENCHATCUT_STATE_ERROR' });
  assert.equal(await readFile(filename, 'utf8'), record);
  assert.equal(calls.length, 0);
});

test('missing install status is discoverable without starting or creating projects', async t => {
  const { controller, calls } = await fixture(t, { installed: false });
  assert.equal((await controller.handle('status')).installed, false);
  const result = await controller.handle({ action: 'list-tools', threadId: 'a' });
  assert.deepEqual(result.tools, []); assert.equal(calls.length, 0);
  await assert.rejects(controller.handle({ action: 'start-editing', threadId: 'a' }), { code: 'OPENCHATCUT_INSTALL_REQUIRED' });
});

test('installed application stays stopped during MCP tool discovery', async t => {
  const { controller, calls } = await fixture(t);
  const result = await controller.handle({ action: 'list-tools', threadId: 'tool-discovery' });
  assert.equal(result.installed, true); assert.equal(result.requiresStart, true);
  assert.deepEqual(result.tools, []); assert.equal(calls.length, 0);
});

test('parallel conversations bind distinct projects, serialize edits and apply timeline updates immediately', async t => {
  const { controller, calls, events, directory } = await fixture(t);
  const [a, b] = await Promise.all(['a', 'b'].map(threadId => controller.handle({ action: 'call-tool', threadId, name: 'split_item', arguments: { itemId: 'clip', frame: 30 } })));
  assert.notEqual(a.session.projectId, b.session.projectId);
  assert.equal(a.review.status, 'applied'); assert.equal(b.review.status, 'applied');
  assert.equal(a.session.editSessionId, null);
  const split = calls.filter(call => call.name === 'split_item');
  assert.equal(split[0].args.editorProjectId, a.session.projectId); assert.equal(split[1].args.editorProjectId, b.session.projectId);
  assert.equal(events.filter(event => event.type === 'editing').length, 2);
  const persisted = JSON.parse(await readFile(path.join(directory, 'sessions.json'), 'utf8'));
  assert.equal(persisted.sessions.a.projectId, a.session.projectId);
  assert.ok(!JSON.stringify(persisted).includes('private-test-token'));
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'a', name: 'split_item', arguments: { editorProjectId: b.session.projectId } }), { code: 'OPENCHATCUT_PROJECT_MISMATCH' });
});

test('unconnected live editor never binds offline or executes a write', async t => {
  const { controller, calls } = await fixture(t, { connect: false });
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'a', name: 'split_item', arguments: {} }), { code: 'OPENCHATCUT_EDITOR_NOT_READY' });
  assert.ok(!calls.some(call => ['target_project', 'split_item'].includes(call.name)));
});

test('a missed initial renderer mount is retried for the same editor before starting the draft', async t => {
  const { controller, calls, events } = await fixture(t, { missedMountEvents: 1, readinessTimeoutMs: 3500, pollMs: 20 });
  const result = await controller.handle({ action: 'start-editing', threadId: 'mount-reconnect', autoOpen: false });
  assert.equal(result.state, 'ready');
  const mounts = events.filter(event => event.type === 'editing');
  assert.equal(mounts.length, 2); assert.equal(mounts[1].editorUrl, mounts[0].editorUrl);
  assert.equal(mounts[1].session.projectId, mounts[0].session.projectId);
  assert.equal(mounts[1].autoOpen, false, 'Background mount retries retain their visibility preference');
  assert.ok(mounts[1].at - mounts[0].at >= 2000);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(calls.filter(call => call.name === 'target_project').length, 1);
  assert.equal(calls.filter(call => call.name === 'begin_edit_session').length, 1);
});

test('restarting the host restores the same conversation project without creating a duplicate', async t => {
  const { controller, directory, calls, events, installer, createClient } = await fixture(t);
  const first = await controller.handle({ action: 'open', threadId: 'a', projectTitle: 'Persistent editing project' });
  assert.equal(events.find(event => event.type === 'editing').autoOpen, false, 'A sidebar open completion leaves visibility with the requesting view');
  await controller.dispose();
  const restored = createOpenChatCutController({ installer, createClient, stateRoot: directory, connectionPath: path.join(directory, 'controller.json'),
    fetchImpl: async () => new Response(JSON.stringify({ mcpToken: 'private-test-token-32-characters' })) });
  t.after(() => restored.dispose());
  const second = await restored.handle({ action: 'open', threadId: 'a' });
  assert.equal(second.session.projectId, first.session.projectId);
  assert.equal(calls.filter(call => call.name === 'create_project').length, 1);
  assert.equal(second.editorUrl, first.editorUrl);
});

test('generation and target mismatch are rejected before any application side effect', async t => {
  const { controller, calls } = await fixture(t);
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'a', name: 'submit_video', arguments: {} }), { code: 'OPENCHATCUT_POLICY_BLOCKED' });
  await assert.rejects(controller.handle({ action: 'open', threadId: 'a' }, { threadId: 'b' }), { code: 'OPENCHATCUT_TARGET_CHANGED' });
  assert.equal(calls.length, 0);
});

test('cloud transcription switches out of the auto session and requires native exact-argument confirmation', async t => {
  const { controller, calls, events } = await fixture(t);
  await controller.handle({ action: 'start-editing', threadId: 'a' });
  const result = await controller.handle({ action: 'call-tool', threadId: 'a', name: 'transcribe_track', arguments: { provider: 'assemblyai', track: 'V1' } });
  assert.equal(result.result.status, 'pending');
  assert.equal(result.session.approvalMode, 'manual');
  assert.deepEqual(calls.filter(call => call.name === 'begin_edit_session').map(call => call.args.approvalMode), ['auto', 'manual']);
  assert.equal(events.at(-1).state, 'awaiting-confirmation');
  await assert.rejects(controller.handle({ action: 'call-tool', threadId: 'a', name: 'split_item', arguments: { itemId: 'clip', atFrame: 30 } }), { code: 'OPENCHATCUT_REVIEW_PENDING' });
  const review = await controller.handle({ action: 'call-tool', threadId: 'a', name: 'review_edit_session', arguments: {} });
  assert.equal(review.result.status, 'awaiting_review');
  const read = await controller.handle({ action: 'call-tool', threadId: 'a', name: 'get_edit_session', arguments: {} });
  assert.equal(read.result.status, 'awaiting_review', 'Session reads stay available while awaiting native review');
});

test('explicit local transcription runs without a cloud generation request', async t => {
  const { controller, calls } = await fixture(t);
  const result = await controller.handle({ action: 'call-tool', threadId: 'a', name: 'transcribe_track', arguments: { provider: 'local', track: 'V1' } });
  assert.equal(result.result.ok, true);
  assert.ok(!calls.some(call => call.args.approvalMode === 'manual'));
});

test('private loopback controller authenticates requests and writes secret-free session configuration', async t => {
  const { controller, directory } = await fixture(t);
  const connection = await controller.start();
  assert.equal((await stat(connection.connectionPath)).mode & 0o777, 0o600);
  const denied = await fetch(`${connection.url}/request`, { method: 'POST', body: '{}' }); assert.equal(denied.status, 401);
  const response = await fetch(`${connection.url}/request`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', threadId: 'a' }) });
  assert.equal((await response.json()).data.installed, true);
  assert.ok(!JSON.stringify(await controller.status()).includes(connection.token));
});


test('only explicit conversation new-project replaces its binding and preserves old project ownership', async t => {
  const {controller,calls,directory}=await fixture(t);
  const a=await controller.handle({action:'start-editing',threadId:'a'});
  const b=await controller.handle({action:'open',threadId:'b'});
  const reopened=await controller.handle({action:'start-editing',threadId:'a',projectTitle:'Rename does not rebind'});
  assert.equal(reopened.session.projectId,a.session.projectId);
  const replaced=await controller.handle({action:'new-project',threadId:'a',projectTitle:'New conversation project',fps:24,compositionWidth:720,compositionHeight:1280});
  assert.notEqual(replaced.session.projectId,a.session.projectId);
  assert.notEqual(replaced.session.projectId,b.session.projectId);
  assert.equal(replaced.projectRebound,true);
  const stored=JSON.parse(await readFile(path.join(directory,'sessions.json'),'utf8')).sessions;
  assert.equal(stored.b.projectId,b.session.projectId);
  assert.equal(stored.a.projectHistory[0].projectId,a.session.projectId);
  const again=await controller.handle({action:'start-editing',threadId:'a'});
  assert.equal(again.session.projectId,replaced.session.projectId);
  assert.equal(calls.filter(c=>c.name==='create_project').length,3);
  assert.equal(calls.filter(c=>c.name==='create_project').at(-1).args.fps,24);
  await assert.rejects(controller.handle({action:'new-project',threadId:'a',projectTitle:''}),{code:'OPENCHATCUT_PROJECT_TITLE_REQUIRED'});
});

test('explicit new-project cannot abandon unapplied edits or change a conversation project', async t => {
  const {controller,calls}=await fixture(t,{draftOperationCount:3});
  const first=await controller.handle({action:'start-editing',threadId:'pending'});
  await assert.rejects(controller.handle({action:'new-project',threadId:'pending',projectTitle:'Blocked replacement'}),{code:'OPENCHATCUT_REVIEW_PENDING'});
  const status=await controller.status({threadId:'pending'});
  assert.equal(status.session.projectId,first.session.projectId);
  assert.equal(calls.filter(c=>c.name==='create_project').length,1);
  assert.equal(calls.filter(c=>c.name==='discard_edit_session').length,0);
});
