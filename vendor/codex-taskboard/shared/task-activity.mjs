function time(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Property edits and drag order are not messages and must not bump a card.
export function taskActivity(task, threadActivity = {}) {
  const conversation = time(threadActivity[String(task.threadId || "").toLowerCase()]);
  const comment = time(task.lastCommentAt);
  const message = Math.max(conversation, comment);
  const value = message || time(task.createdAt);
  return {
    time: value,
    timestamp: value ? new Date(value).toISOString() : null,
    source: message ? (conversation >= comment ? "conversation" : "comment") : value ? "created" : "unknown",
  };
}

export function compareTaskActivity(left, right, threadActivity = {}) {
  return taskActivity(right, threadActivity).time - taskActivity(left, threadActivity).time
    || (Number.isFinite(left.sortOrder) ? left.sortOrder : 0) - (Number.isFinite(right.sortOrder) ? right.sortOrder : 0)
    || String(left.id).localeCompare(String(right.id));
}

export function taskActivityLabel(task, threadActivity = {}) {
  const activity = taskActivity(task, threadActivity);
  if (!activity.timestamp) return "消息时间未知";
  const label = { conversation: "对话消息", comment: "议题评论", created: "创建时间（暂无消息）" }[activity.source];
  return `${label} · ${new Date(activity.timestamp).toLocaleString("zh-CN", { hour12: false })}`;
}
