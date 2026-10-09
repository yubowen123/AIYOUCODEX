import assert from "node:assert/strict";
import test from "node:test";
import { projectRemoteThreads, readNativeRemoteThreads, readRemoteCatalog } from "../lib/remote-thread-catalog.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const project = (hostId, root, nativeProjectId = "p") => ({ id: `remote:${hostId}:${nativeProjectId}`, hostId,
  remotePath: root, nativeProjectId, label: "同名远程项目" });
const thread = (cwd, nativeThreadId = id) => ({ nativeThreadId, cwd, title: "真实任务", updatedAt: 1791036580000 });

test("remote threads match their host and deepest path boundary, keeping equal UUIDs distinct", () => {
  const entries = projectRemoteThreads([
    { hostId: "host-a", threads: [thread("/project/sub/child"), thread("/project-other", "22222222-2222-4222-8222-222222222222"), thread("/unknown")] },
    { hostId: "host-b", threads: [thread("/project")] },
    { hostId: "local", threads: [thread("/project")] },
  ], [project("host-a", "/project/"), project("host-a", "/project/sub", "nested"), project("host-b", "/project")]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].projectId, "remote:host-a:nested");
  assert.equal(entries[1].projectId, "remote:host-b:p");
  assert.notEqual(entries[0].threadId, entries[1].threadId);
  assert.equal(entries[0].updatedAt, "2026-10-03T14:09:40.000Z");
  assert.ok(entries.every(entry => entry.remote && !Object.hasOwn(entry, "projectRootPath")));
});

test("remote catalog reads only requested native managers and whitelists metadata", async t => {
  const scopeId = Symbol("catalog");
  const atom = { scope: { id: scopeId }, resolve: () => "registry" };
  const managers = ["local", "host-a", "host-b"].map(hostId => ({ getHostId: () => hostId,
    getThreadSummaries: () => {
      assert.equal(hostId, "host-a", "Never read an unrequested host's threads");
      return [{conversationId:"22222222-2222-4222-8222-222222222222",source:{subAgent:{thread_spawn:{depth:1}}}},
        {conversationId:"33333333-3333-4333-8333-333333333333",source:'{"subagent":{"other":"guardian"}}'},
        { conversationId: id, forkedFromId:"a-parent", source:"vscode", title: "真实任务", cwd: "/project", updatedAt: 1791036580000,
        threadRuntimeStatus: { type: "notLoaded" }, canonicalVoiceHistory: "PRIVATE", turns: "PRIVATE" }];
    },
  }));
  const root = { __reactContainerTest: { memoizedProps: { value: new Map([[scopeId, { store: { get: () => managers } }]]) } } };
  globalThis.window = { __aiyouNativeRemoteCatalogAdapter__: { atom } };
  globalThis.document = { getElementById: () => root };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const snapshot = await readNativeRemoteThreads(["host-a"]);
  assert.equal(snapshot.hosts.length, 1);
  assert.equal(snapshot.hosts[0].threads.length,1,"Children filtered before remote projection; user forks preserved");
  assert.equal(snapshot.hosts[0].threads[0].nativeThreadId, id);
  assert.equal(snapshot.hosts[0].threads[0].status, "notLoaded");
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
});

test("a transient native failure preserves metadata; a successful empty host removes it", async () => {
  let mode = "ready";
  const session = { client: { evaluate: async () => {
    if (mode === "failed") throw new Error("connecting");
    return { hosts: [{ hostId: "host-a", threads: mode === "empty" ? [] : [thread("/project")] }] };
  } } };
  const projects = [project("host-a", "/project")];
  assert.equal((await readRemoteCatalog(session, projects)).length, 1);
  mode = "failed";
  assert.equal((await readRemoteCatalog(session, projects)).length, 1);
  mode = "empty";
  assert.equal((await readRemoteCatalog(session, projects)).length, 0);
  mode = "ready";
  await readRemoteCatalog(session, projects);
  assert.deepEqual(await readRemoteCatalog(session, []), []);
  assert.equal(session.remoteHostCatalogs.size, 0);
});

test("native failed-turn metadata is read without leaking bodies and a new turn supersedes the old failure", async t => {
  const scopeId = Symbol("catalog");
  const atom = { scope: { id: scopeId }, resolve: () => "registry" };
  let turns = { old: { turnId: "old", turnStartedAtMs: 1, status: "failed", error: { message: "PRIVATE" }, items: "PRIVATE" } };
  const manager = { getHostId: () => "local", getThreadSummaries: () => [{ conversationId: id, threadRuntimeStatus: { type: "active" }, hasUnreadTurn: false }],
    getConversation: () => ({ turnHistory: { history: { entitiesByKey: turns } } }) };
  globalThis.window = { __aiyouNativeRemoteCatalogAdapter__: { atom } };
  globalThis.document = { getElementById: () => ({ __reactContainerTest: { memoizedProps: { value: new Map([[scopeId, { store: { get: () => [manager] } }]]) } } }) };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  let snapshot = await readNativeRemoteThreads(["local"]);
  assert.equal(snapshot.hosts[0].threads[0].turnError, true);
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  turns.new = { turnId: "new", turnStartedAtMs: 2, status: "inProgress", error: null };
  snapshot = await readNativeRemoteThreads(["local"]);
  assert.equal(snapshot.hosts[0].threads[0].turnError, false);
  assert.equal(snapshot.hosts[0].threads[0].turnId, "new");
});
