import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanPreviewText,
  coreSummary,
  parseInterruptionLines,
  parsePreviewLines,
  PreviewRepository,
} from "../lib/preview-data.mjs";

test("interruption parsing distinguishes explicit aborts, unfinished runs, and completed turns", () => {
  const event = (timestamp, type) => JSON.stringify({ timestamp, type: "event_msg", payload: { type } });
  assert.deepEqual(parseInterruptionLines([
    event("2026-08-13T10:00:00Z", "task_started"),
    event("2026-08-13T10:01:00Z", "turn_aborted"),
  ]), { kind: "active", interruptedAtMs: Date.parse("2026-08-13T10:01:00Z") });
  assert.deepEqual(parseInterruptionLines([
    event("2026-08-13T11:00:00Z", "task_started"),
    JSON.stringify({ timestamp: "2026-08-13T11:02:00Z", type: "event_msg", payload: { type: "agent_message" } }),
  ]), { kind: "passive", interruptedAtMs: Date.parse("2026-08-13T11:02:00Z") });
  assert.equal(parseInterruptionLines([
    event("2026-08-13T12:00:00Z", "task_started"),
    event("2026-08-13T12:03:00Z", "task_complete"),
  ]), null);
});

test("repository interrupted catalog includes active and stale passive interruptions but excludes running and completed threads", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-interrupted-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "13");
  await mkdir(sessions, { recursive: true });
  const ids = {
    active: "019fe61d-6a11-7cf1-926b-435b108624b6",
    passive: "019ff102-7af6-7eb1-873d-049243b2c469",
    running: "019ff102-7af6-7eb1-873d-049243b2c470",
    complete: "019ff102-7af6-7eb1-873d-049243b2c471",
  };
  const event = (timestamp, type) => JSON.stringify({ timestamp, type: "event_msg", payload: { type } });
  await Promise.all([
    writeFile(path.join(sessions, `rollout-${ids.active}.jsonl`), [event("2026-08-13T10:00:00Z", "task_started"), event("2026-08-13T10:05:00Z", "turn_aborted")].join("\n")),
    writeFile(path.join(sessions, `rollout-${ids.passive}.jsonl`), event("2026-08-13T11:00:00Z", "task_started")),
    writeFile(path.join(sessions, `rollout-${ids.running}.jsonl`), event("2026-08-13T11:59:30Z", "task_started")),
    writeFile(path.join(sessions, `rollout-${ids.complete}.jsonl`), [event("2026-08-13T09:00:00Z", "task_started"), event("2026-08-13T09:10:00Z", "task_complete")].join("\n")),
  ]);
  await writeFile(path.join(codexHome, "session_index.jsonl"), Object.entries(ids).map(([title, id]) => JSON.stringify({
    id, thread_name: title, updated_at: "2026-08-13T12:00:00Z",
  })).join("\n"));
  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual((await repository.readInterruptedCatalog({ nowMs: Date.parse("2026-08-13T12:00:00Z") })).map((item) => ({
    title: item.title, label: item.interruptionLabel,
  })), [
    { title: "passive", label: "被动中断" },
    { title: "active", label: "主动中断" },
  ]);
});

test("preview parsing prefers the latest real user and assistant events", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "旧任务已经完成。旧结果不应覆盖新一轮。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "# My request:\n请增加对话核心总结和最近消息。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "正在实现新的侧栏摘要和悬浮预览。后续状态。" },
    }),
  ];
  const preview = parsePreviewLines(lines, { title: "侧栏优化" });
  assert.equal(preview.recentInput, "请增加对话核心总结和最近消息。");
  assert.equal(preview.recentOutput, "正在实现新的侧栏摘要和悬浮预览。后续状态。");
  assert.equal(preview.summary, "正在实现新的侧栏摘要和悬浮预览。");
});

test("completed threads use their final result as the core summary", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "修复播放器。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:02:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "定位完成：文件未损坏，问题是 HEVC 封装兼容性。\n更多细节。" },
    }),
  ];
  assert.equal(
    parsePreviewLines(lines).summary,
    "定位完成：文件未损坏，问题是 HEVC 封装兼容性。",
  );
});

test("text cleanup removes transport wrappers and clamps summaries", () => {
  assert.equal(
    cleanPreviewText("# My request:\n**更新侧栏**", { user: true }),
    "更新侧栏",
  );
  assert.ok(coreSummary("甲".repeat(200)).length <= 96);
});

test("repository resolves a client-new thread by the newest matching title", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-preview-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const oldId = "019fe61d-6a11-7cf1-926b-435b108624b5";
  const newId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await writeFile(path.join(sessions, `rollout-old-${oldId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T09:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "旧输入" },
  })}\n`);
  await writeFile(path.join(sessions, `rollout-new-${newId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "新的输入" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "新的输出已经产生。" },
    }),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: oldId, thread_name: "同名对话", updated_at: "2026-08-09T09:00:00Z" }),
    JSON.stringify({ id: newId, thread_name: "同名对话", updated_at: "2026-08-09T10:00:00Z" }),
  ].join("\n"));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  const preview = await repository.readPreview("local:client-new-thread:temporary", "同名对话");
  assert.equal(preview.threadId, newId);
  assert.equal(preview.recentInput, "新的输入");
  assert.equal(preview.recentOutput, "新的输出已经产生。");
  assert.equal(preview.updatedAt, "2026-08-09T10:01:00.000Z");
  assert.equal(preview.tags.length, 3);
});

test("repository reads the latest real rate limit from the newest session", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-usage-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const threadId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await writeFile(path.join(sessions, `rollout-${threadId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T12:22:49Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 48, window_minutes: 10080, resets_at: 1786825820 },
        secondary: null,
        plan_type: "prolite",
      },
    },
  })}\n`);
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T12:22:49Z",
  }));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  assert.deepEqual(await repository.readUsage?.(), {
    limitId: "codex",
    planType: "prolite",
    usedPercent: 48,
    remainingPercent: 52,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  });
});

test("repository search catalog includes every indexed thread assigned to a saved project", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-search-catalog-test-"));
  const targetId = "019f0d8f-9645-75a0-87f7-6e5cf6328ba6";
  const unassignedId = "019f0d8f-9645-75a0-87f7-6e5cf6328ba7";
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: targetId, thread_name: "旧知识卡名称", updated_at: "2026-06-27T09:00:00Z" }),
    JSON.stringify({ id: targetId, thread_name: "创建知识卡片技能", updated_at: "2026-06-28T09:29:06Z" }),
    JSON.stringify({ id: unassignedId, thread_name: "未分配项目的对话", updated_at: "2026-06-29T09:00:00Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      "project-innovation": {
        id: "project-innovation",
        name: "为创新而生",
        rootPaths: ["/Users/test/Documents/为创新而生"],
      },
    },
    "thread-project-assignments": {
      [targetId]: {
        projectKind: "local",
        projectId: "project-innovation",
        cwd: "/Users/test/Documents/为创新而生",
      },
    },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal(typeof repository.readSearchCatalog, "function");
  assert.deepEqual(await repository.readSearchCatalog(), [{
    threadId: targetId,
    title: "创建知识卡片技能",
    updatedAt: "2026-06-28T09:29:06.000Z",
    projectId: "project-innovation",
    projectName: "为创新而生",
  }]);
});

test("repository recent catalog covers assigned and unassigned threads in global activity order", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-recent-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "12");
  const assignedId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  const unassignedId = "019ff102-7af6-7eb1-873d-049243b2c469";
  await mkdir(sessions, { recursive: true });
  const assignedSession = path.join(sessions, `rollout-${assignedId}.jsonl`);
  const unassignedSession = path.join(sessions, `rollout-${unassignedId}.jsonl`);
  await writeFile(assignedSession, `${JSON.stringify({
    timestamp: "2026-08-12T11:30:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "继续优化最近列表" },
  })}\n`);
  await writeFile(unassignedSession, `${JSON.stringify({
    timestamp: "2026-08-12T12:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "刚刚使用的未归类对话" },
  })}\n`);
  // A background reader may touch an old session file. File mtime must not
  // outrank the real latest conversation event shown on the card.
  await utimes(assignedSession, new Date("2026-08-12T13:00:00Z"), new Date("2026-08-12T13:00:00Z"));
  await utimes(unassignedSession, new Date("2026-08-12T12:00:00Z"), new Date("2026-08-12T12:00:00Z"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: assignedId, thread_name: "旧标题", updated_at: "2026-08-10T09:00:00Z" }),
    JSON.stringify({ id: assignedId, thread_name: "项目内最近对话", updated_at: "2026-08-11T10:00:00Z" }),
    JSON.stringify({ id: unassignedId, thread_name: "未归类最近对话", updated_at: "2026-08-11T09:00:00Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": { project: { id: "project", name: "管理优化" } },
    "thread-project-assignments": { [assignedId]: { projectId: "project" } },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual(await repository.readRecentCatalog(), [
    {
      threadId: unassignedId,
      title: "未归类最近对话",
      updatedAt: "2026-08-12T12:00:00.000Z",
      projectId: "",
      projectName: "",
    },
    {
      threadId: assignedId,
      title: "项目内最近对话",
      updatedAt: "2026-08-12T11:30:00.000Z",
      projectId: "project",
      projectName: "管理优化",
    },
  ]);
});

test("repository reads and normalizes the complete native pinned thread set", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-pinned-threads-test-"));
  const first = "019fe61d-6a11-7cf1-926b-435b108624b6";
  const second = "019f0d8f-9645-75a0-87f7-6e5cf6328ba6";
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "pinned-thread-ids": [first.toUpperCase(), `local:${second}`, first, "invalid"],
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual(await repository.readPinnedThreadIds(), [first, second]);
});

test("repository search catalog uses newer conversation activity than the stale title index", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-search-activity-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "10");
  const threadId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await mkdir(sessions, { recursive: true });
  const sessionPath = path.join(sessions, `rollout-${threadId}.jsonl`);
  await writeFile(sessionPath, `${JSON.stringify({
    timestamp: "2026-08-10T11:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "继续修改全部视图" },
  })}\n`);
  await utimes(sessionPath, new Date("2026-08-10T11:00:00Z"), new Date("2026-08-10T11:00:00Z"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T10:00:00Z",
  }));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": { project: { id: "project", name: "管理优化" } },
    "thread-project-assignments": { [threadId]: { projectId: "project" } },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal((await repository.readSearchCatalog())[0].updatedAt, "2026-08-10T11:00:00.000Z");
});

test("repository preview reports the latest conversation event when the title index is stale", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-preview-activity-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "10");
  const threadId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, `rollout-${threadId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-10T11:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "增加全部项目" },
    }),
    JSON.stringify({
      timestamp: "2026-08-10T11:02:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "全部项目正在生成。" },
    }),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T10:00:00Z",
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal((await repository.readPreview(`local:${threadId}`, "侧栏优化")).updatedAt,
    "2026-08-10T11:02:00.000Z");
});

test("repository keeps indexed recent conversations readable when their session file is unavailable", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-index-only-preview-test-"));
  const threadId = "019fefbf-640f-7da2-a6cb-8663ba7f75a8";
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "索引中的最近对话",
    updated_at: "2026-08-12T07:35:46Z",
  }));

  const repository = new PreviewRepository({ codexHome });
  const preview = await repository.readPreview(`local:${threadId}`, "索引中的最近对话");
  assert.equal(preview?.threadId, threadId);
  assert.equal(preview?.summary, "围绕“索引中的最近对话”的对话");
  assert.equal(preview?.updatedAt, "2026-08-12T07:35:46.000Z");
  assert.equal(preview?.tags.length, 3);
});
