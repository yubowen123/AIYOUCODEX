import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptDocumentHealth, recordUpdateFailure, canReuseRenderer, rendererReadiness } from '../lib/renderer-health.mjs';
import { reconcileRendererSessions, DesktopAppRecovery, parseDesktopAppProcess } from '../lib/injector-state.mjs';

test('strict readiness allows closed panels but rejects an unsupported core component', () => {
  const snapshot = { alive: true, health: { ready: true, documentEpoch: 'epoch', runtimeVersion: 'v', components: {
    sidebar: 'ready', header: 'ready', shortcuts: 'ready', sections: 'ready', folders: 'ready', skills: 'not-mounted', panels: 'not-mounted',
  } } };
  assert.deepEqual(rendererReadiness(snapshot), { ready: true, failures: [] });
  snapshot.health.components.folders = 'unsupported';
  assert.equal(rendererReadiness(snapshot).ready, false);
  assert.ok(rendererReadiness(snapshot).failures.includes('folders-unsupported'));
  assert.equal(rendererReadiness({ alive: true }).ready, false);
  snapshot.health.components.folders = 'ready';
  snapshot.health.errors = { cards: {code:'component-render-failed'} };
  assert.ok(rendererReadiness(snapshot).failures.includes('cards-render-failed'));
});

test('new document epochs clear only that document delivery ledger', () => {
  const session = { documentEpoch: 'before', persistentShortcutReady: new Set(['private-fixture']), deliveredHistoryKey: 'history', deliveredSnapshotHash: 'snapshot' };
  assert.equal(acceptDocumentHealth(session, { alive: true, documentEpoch: 'after' }), true);
  assert.equal(session.deliveredHistoryKey, '');
  assert.equal(session.deliveredSnapshotHash, '');
  assert.equal(session.persistentShortcutReady.size, 0);
  assert.equal(session.needsFullRefresh, true);
  session.deliveredHistoryKey = 'sent';
  acceptDocumentHealth(session, { alive: true, documentEpoch: 'after' });
  assert.equal(session.deliveredHistoryKey, 'sent');
});

test('reconnection reuses only the same live source without destroying a page', () => {
  assert.equal(canReuseRenderer({alive: true, sourceHash: 'a'}, 'a'), true);
  assert.equal(canReuseRenderer({alive: true, sourceHash: 'a'}, 'b'), false);
  assert.equal(canReuseRenderer({alive: false, sourceHash: 'a'}, 'a'), false);
});

test('data failures preserve page state and use bounded retry delays', () => {
  const session = { persistentShortcutReady: new Set(['kept']), deliveredHistoryKey: 'kept' };
  for (let i=0;i<20;i++) recordUpdateFailure(session, 100);
  assert.equal(session.retryUpdateAt, 30100);
  assert.equal(session.deliveredHistoryKey, 'kept');
  assert.equal(session.persistentShortcutReady.has('kept'), true);
});

test('failed target discovery does not remove healthy or connecting sessions', async () => {
  const sessions = new Map([['one', {targetId:'one'}]]);
  const result = await reconcileRendererSessions({sessions, targets:[], discoveryAvailable:false,
    attach:()=>assert.fail(), dispose:()=>assert.fail(), isHealthy:()=>assert.fail()});
  assert.equal(sessions.size, 1);
  assert.deepEqual(result.removedTargetIds, []);
});

test('host recovery cannot loop indefinitely or restart a debugging/active host', () => {
  const recovery = new DesktopAppRecovery({maxAttempts:2});
  const app = {pid:1,appPath:'/Applications/ChatGPT.app'};
  assert.equal(recovery.next({app,targetAvailable:false,recoveryAllowed:false}),null);
  assert.equal(recovery.next({app:{...app,debuggingPort:9231},targetAvailable:false}),null);
  assert.equal(recovery.next({app,targetAvailable:false,now:0}).type,'quit');
  assert.equal(recovery.next({app:null,targetAvailable:false,now:100}).type,'launch');
  recovery.markLaunched(100);
  assert.equal(recovery.next({app:{...app,pid:2},targetAvailable:false,now:20000}).type,'quit');
  assert.equal(recovery.next({app:null,targetAvailable:false,now:20100}).type,'launch');
  recovery.markLaunched(20100);
  assert.equal(recovery.next({app:{...app,pid:3},targetAvailable:false,now:50000}),null);
});

test('macOS exact executable matching allows launch arguments but excludes helpers', () => {
  assert.equal(parseDesktopAppProcess('23 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=9231').debuggingPort,9231);
  assert.equal(parseDesktopAppProcess('23 /Applications/ChatGPT.app/Contents/MacOS/ChatGPTOther'),null);
  assert.equal(parseDesktopAppProcess('23 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --type=renderer'),null);
});
