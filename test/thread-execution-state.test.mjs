import assert from "node:assert/strict";
import test from "node:test";
import { parseThreadExecutionLines } from "../lib/thread-execution-state.mjs";
import { readNativeExecutionStates } from "../lib/remote-thread-catalog.mjs";

const event = (type, timestamp = "2026-10-04T01:00:00Z") => JSON.stringify({ type: "event_msg", timestamp, payload: { type, turn_id: "turn-1" } });
test("execution lifecycle changes on starts, failures, completion and explicit abort, never on quoted prose", () => {
  assert.equal(parseThreadExecutionLines([event("task_started")]).state, "running");
  assert.equal(parseThreadExecutionLines([event("task_started"), event("error")]).state, "error");
  assert.equal(parseThreadExecutionLines([event("error"), event("task_started")]).state, "running");
  assert.equal(parseThreadExecutionLines([event("error"), event("task_complete")]).state, "completed");
  assert.equal(parseThreadExecutionLines([event("task_started"), event("turn_aborted")]).state, "idle");
  assert.equal(parseThreadExecutionLines([JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "网络错误已修复" } })]), null);
  assert.equal(parseThreadExecutionLines([JSON.stringify({ type: "response_item", payload: { type: "error" } }), "invalid"]), null);
});
test("native lifecycle keys stay host-scoped and transient failure does not send a clearing snapshot", async () => {
  const session = { client: { evaluate: async () => ({ hosts: [
    { hostId: "local", threads: [{ nativeThreadId: "same-id", status: "active", hasUnreadTurn: false, updatedAt: 1 }] },
    { hostId: "remote-a", threads: [{ nativeThreadId: "same-id", status: "idle", hasUnreadTurn: true, updatedAt: 2 }] },
  ] }) } };
  const states = await readNativeExecutionStates(session, ["remote-a"]);
  assert.equal(states[0].threadId, "same-id");
  assert.equal(states[1].threadId, "remote:remote-a:same-id");
  assert.equal(states[1].unread, true);
  session.client.evaluate = async () => { throw new Error("offline"); };
  assert.equal(await readNativeExecutionStates(session), null);
});
