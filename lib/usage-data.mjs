function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function normalizeWindow(value) {
  const usedPercent = clampPercent(value?.used_percent);
  const windowMinutes = Number(value?.window_minutes);
  if (usedPercent == null || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null;
  const resetsAtSeconds = Number(value?.resets_at);
  const resetsAt = Number.isFinite(resetsAtSeconds) && resetsAtSeconds > 0
    ? new Date(resetsAtSeconds * 1000).toISOString()
    : null;
  return { usedPercent, windowMinutes, resetsAt };
}

export function parseRateLimitLines(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] || "").trim();
    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") continue;
    const limits = entry.payload.rate_limits;
    const windows = [normalizeWindow(limits?.primary), normalizeWindow(limits?.secondary)].filter(Boolean);
    if (!windows.length) continue;
    const governing = windows.reduce((current, candidate) => (
      candidate.usedPercent > current.usedPercent ? candidate : current
    ));
    return {
      limitId: String(limits.limit_id || "codex"),
      planType: limits.plan_type ? String(limits.plan_type) : null,
      usedPercent: governing.usedPercent,
      remainingPercent: Math.round(100 - governing.usedPercent),
      windowMinutes: governing.windowMinutes,
      resetsAt: governing.resetsAt,
    };
  }
  return null;
}

function windowLabel(minutes) {
  if (minutes === 10_080) return "本周";
  if (minutes === 1_440) return "今日";
  if (minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}

function resetLabel(value, timeZone) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${Number(part("month"))}月${Number(part("day"))}日 ${part("hour")}:${part("minute")}`;
}

export function presentRateLimit(usage, { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const remainingPercent = clampPercent(usage?.remainingPercent);
  if (remainingPercent == null) {
    return {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      ariaLabel: "Codex 剩余量暂不可用",
    };
  }
  const period = windowLabel(Number(usage.windowMinutes));
  const reset = resetLabel(usage.resetsAt, timeZone);
  const roundedRemaining = Math.round(remainingPercent);
  const tone = roundedRemaining <= 10 ? "critical" : roundedRemaining <= 30 ? "warning" : "normal";
  return {
    available: true,
    text: `${period}剩余 ${roundedRemaining}%`,
    remainingPercent: roundedRemaining,
    tone,
    ariaLabel: `Codex ${period}额度剩余 ${roundedRemaining}%${reset ? `，${reset} 重置` : ""}`,
  };
}

const TOKEN_FIELDS = Object.freeze({
  inputTokens: "input_tokens",
  cachedInputTokens: "cached_input_tokens",
  outputTokens: "output_tokens",
  reasoningOutputTokens: "reasoning_output_tokens",
  totalTokens: "total_tokens",
});

function tokenCounters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const counters = Object.fromEntries(Object.entries(TOKEN_FIELDS).map(([label, key]) => [
    label, Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : null,
  ]));
  return Object.values(counters).some((count) => count !== null) ? counters : null;
}

/**
 * Read one session's latest actual token snapshot, including from a bounded log tail.
 * Cumulative events replace previous snapshots: they must not be summed together.
 * Cached input is a subset of input; reasoning output is a subset of output.
 * Missing totals remain unknown, and last_token_usage is one request, not a user turn.
 */
export function parseTokenUsageLines(lines) {
  if (!Array.isArray(lines)) return null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = typeof lines[index] === "string" ? lines[index].trim() : "";
    if (!line.includes('"token_count"') || !line.includes('"info"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "event_msg" || entry.payload?.type !== "token_count") continue;
    const info = entry.payload.info;
    const cumulative = tokenCounters(info?.total_token_usage);
    const lastRequest = tokenCounters(info?.last_token_usage);
    if (!cumulative && !lastRequest) continue;
    return {
      source: "codex-token-count",
      timestamp: typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : null,
      cumulative,
      lastRequest,
    };
  }
  return null;
}

export function presentTokenUsage(usage) {
  const counters = usage?.cumulative || usage?.lastRequest;
  const available = counters && Object.keys(TOKEN_FIELDS).some((key) => Number.isSafeInteger(counters[key]) && counters[key] >= 0);
  const scope = usage?.cumulative ? "本会话累计" : "最近请求";
  const format = (value) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("zh-CN") : "--";
  const text = available
    ? `${scope}：输入 ${format(counters.inputTokens)} · 缓存 ${format(counters.cachedInputTokens)} · 输出 ${format(counters.outputTokens)} · 推理 ${format(counters.reasoningOutputTokens)} · 总计 ${format(counters.totalTokens)}`
    : "Token 用量暂不可用";
  return {
    available: Boolean(available), text,
    scope: available ? (usage.cumulative ? "session" : "request") : null,
    source: available ? "codex-token-count" : null,
    cumulative: available ? usage.cumulative || null : null,
    lastRequest: available ? usage.lastRequest || null : null,
    note: "缓存输入包含在输入中，推理包含在输出中；未推算节省比例。",
  };
}
