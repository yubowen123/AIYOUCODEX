import assert from "node:assert/strict";
import test from "node:test";
import { parseTokenUsageLines, presentTokenUsage } from "../lib/usage-data.mjs";

async function usageModule() {
  return import("../lib/usage-data.mjs").catch(() => ({}));
}

test("latest Codex rate-limit event determines the truthful remaining percentage", async () => {
  const { parseRateLimitLines } = await usageModule();
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 35, window_minutes: 10080, resets_at: 1786825820 },
          secondary: null,
          plan_type: "prolite",
        },
      },
    }),
    JSON.stringify({
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
    }),
  ];

  assert.deepEqual(parseRateLimitLines?.(lines), {
    limitId: "codex",
    planType: "prolite",
    usedPercent: 48,
    remainingPercent: 52,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  });
});

function tokenEvent(info, timestamp = "2026-09-06T10:00:00Z") {
  return JSON.stringify({ type: "event_msg", timestamp, payload: { type: "token_count", info } });
}

test("actual token events replace cumulative snapshots without summing counters or reasoning twice", () => {
  const earlier = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 120 };
  const latest = { input_tokens: 250, cached_input_tokens: 160, output_tokens: 50, reasoning_output_tokens: 20, total_tokens: 300 };
  const last = { input_tokens: 150, cached_input_tokens: 80, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 180 };
  const event = tokenEvent({ total_token_usage: latest, last_token_usage: last });
  const usage = parseTokenUsageLines([tokenEvent({ total_token_usage: earlier }), event, event]);
  assert.deepEqual(usage, {
    source: "codex-token-count", timestamp: "2026-09-06T10:00:00Z",
    cumulative: { inputTokens: 250, cachedInputTokens: 160, outputTokens: 50, reasoningOutputTokens: 20, totalTokens: 300 },
    lastRequest: { inputTokens: 150, cachedInputTokens: 80, outputTokens: 30, reasoningOutputTokens: 10, totalTokens: 180 },
  });
  assert.equal(presentTokenUsage(usage).scope, "session");
  assert.match(presentTokenUsage(usage).text, /总计 300/u);
  assert.equal("savingsPercent" in presentTokenUsage(usage), false);
});

test("token usage tolerates bounded tails, partial writes and later rate-limit-only events", () => {
  const valid = tokenEvent({ total_token_usage: { input_tokens: 123 } });
  const usage = parseTokenUsageLines([
    'truncated prefix "token_count"', valid,
    tokenEvent(null), tokenEvent({ total_token_usage: {} }),
    '{"type":"event_msg","payload":{"type":"token_count","info":',
    JSON.stringify({ type: "response_item", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 999 } } } }),
  ]);
  assert.deepEqual(usage.cumulative, { inputTokens: 123, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null, totalTokens: null });
  assert.equal(usage.lastRequest, null);
  assert.equal(parseTokenUsageLines(null), null);
  assert.equal(parseTokenUsageLines([]), null);
  assert.equal(parseTokenUsageLines([{}, "bad", "null", tokenEvent({})]), null);
});

test("real zero counters remain zero while missing, malformed and impossible counts stay unknown", () => {
  const usage = parseTokenUsageLines([tokenEvent({ total_token_usage: {
    input_tokens: 0, cached_input_tokens: null, output_tokens: "0", reasoning_output_tokens: -1, total_tokens: 0,
  } }, "not-a-date")]);
  assert.deepEqual(usage.cumulative, { inputTokens: 0, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null, totalTokens: 0 });
  assert.equal(usage.timestamp, null);
  assert.equal(presentTokenUsage(usage).available, true);
  assert.match(presentTokenUsage(usage).text, /输入 0.*总计 0/u);
  assert.equal(parseTokenUsageLines([tokenEvent({ total_token_usage: { input_tokens: 1.5, output_tokens: Number.MAX_SAFE_INTEGER + 1 } })]), null);
  assert.equal(parseTokenUsageLines([tokenEvent({ total_token_usage: [0] })]), null);
});

test("last request is not mislabelled as a whole turn and missing totals are never inferred", () => {
  const usage = parseTokenUsageLines([tokenEvent({ last_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 4 } })]);
  assert.equal(usage.cumulative, null);
  assert.equal(usage.lastRequest.totalTokens, null);
  const presentation = presentTokenUsage(usage);
  assert.equal(presentation.scope, "request");
  assert.match(presentation.text, /^最近请求/u);
  assert.match(presentation.text, /总计 --/u);
  assert.match(presentation.note, /推理包含在输出中/u);
  assert.equal(presentTokenUsage(null).available, false);
  assert.equal(presentTokenUsage(null).text, "Token 用量暂不可用");
});

test("the most constrained active window is displayed when Codex returns two limits", async () => {
  const { parseRateLimitLines } = await usageModule();
  const lines = [JSON.stringify({
    timestamp: "2026-08-09T12:22:49Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 22, window_minutes: 300, resets_at: 1786230000 },
        secondary: { used_percent: 70, window_minutes: 10080, resets_at: 1786825820 },
        plan_type: "prolite",
      },
    },
  })];

  assert.equal(parseRateLimitLines?.(lines)?.remainingPercent, 30);
  assert.equal(parseRateLimitLines?.(lines)?.windowMinutes, 10080);
});

test("usage presentation is compact and has an honest unavailable fallback", async () => {
  const { presentRateLimit } = await usageModule();
  const usage = {
    remainingPercent: 52,
    usedPercent: 48,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  };

  assert.deepEqual(presentRateLimit?.(usage, { timeZone: "Asia/Shanghai" }), {
    available: true,
    text: "本周剩余 52%",
    remainingPercent: 52,
    tone: "normal",
    ariaLabel: "Codex 本周额度剩余 52%，8月16日 04:30 重置",
  });
  assert.deepEqual(presentRateLimit?.(null), {
    available: false,
    text: "剩余量 --",
    remainingPercent: null,
    tone: "muted",
    ariaLabel: "Codex 剩余量暂不可用",
  });
});
