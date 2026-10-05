// Execution lifecycle only. Tool failures and prose mentioning errors are not
// task failures, and an explicit user abort is not a network error.
export function parseThreadExecutionLines(lines) {
  let execution = null;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "event_msg") continue;
    const event = entry.payload;
    if (!event) continue;
    let state;
    if (event.type === "task_started") state = "running";
    else if (event.type === "task_complete") state = "completed";
    else if (event.type === "turn_aborted") state = "idle";
    else if (["error", "turn_failed", "task_failed"].includes(event.type)) state = "error";
    if (state) execution = { state, turnId: event.turn_id || "", revision: `${event.turn_id || ""}:${entry.timestamp || ""}` };
  }
  return execution;
}
