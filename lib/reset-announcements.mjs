import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const RESET_SOURCE = "https://x.com/thsottiaux";
export const RESET_RSS_SOURCE = "https://fxtwitter.com/thsottiaux/feed.xml";
export const RESET_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MAX_BYTES = 128 * 1024;
const MAX_EVENTS = 40;
const MAX_HISTORY = 200;
const DAY = 86400000;
export const RESET_ALERT_THRESHOLD = 70;
export const RESET_CRITICAL_THRESHOLD = 90;
export const RESET_TYPES = Object.freeze(["direct", "banked"]);
export const RESET_DELIVERY_STATUSES = Object.freeze(["unknown", "pending", "delivered", "not-applicable"]);

export function resetAnnouncementPath(env = process.env) {
  return env.AIYOUCODEX_RESET_ANNOUNCEMENTS_PATH
    || path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "aiyoucodex", "reset-announcements.json");
}

function text(value, max = 500) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
function resetType(raw) {
  const explicit = typeof raw?.resetType === "string" ? raw.resetType.trim().toLowerCase() : "";
  if (RESET_TYPES.includes(explicit)) return explicit;
  const haystack = `${raw?.summary || ""} ${raw?.evidence || ""} ${raw?.text || ""}`;
  return /banked\s+reset|reset\s+count|重置次数|重置券/iu.test(haystack) ? "banked" : "direct";
}
function deliveryStatus(raw, status, type) {
  const explicit = typeof raw?.deliveryStatus === "string" ? raw.deliveryStatus.trim().toLowerCase() : "";
  if (explicit === "delivered") {
    const before = safeCount(raw?.accountResetCountBefore);
    const after = safeCount(raw?.accountResetCountAfter);
    return raw?.deliveryEvidence || (before != null && after != null && after > before) ? "delivered" : "pending";
  }
  if (RESET_DELIVERY_STATUSES.includes(explicit)) return explicit;
  if (status === "cancelled") return "not-applicable";
  // A completed post is an author-side confirmation. It is only an account
  // delivery confirmation when the monitor or user supplies that evidence.
  const before = safeCount(raw?.accountResetCountBefore);
  const after = safeCount(raw?.accountResetCountAfter);
  if (status === "completed" && (raw?.deliveryEvidence || (before != null && after != null && after > before))) return "delivered";
  return type === "banked" || status === "scheduled" || status === "tentative" ? "pending" : "unknown";
}
function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function accountCountFor(event, accountReset) {
  if (!event || !accountReset) return null;
  return event.resetType === "banked" ? safeCount(accountReset.bankedCount) : safeCount(accountReset.directCount);
}

export function resolveResetDeliveryStatus(event, accountReset = null) {
  if (!event || event.deliveryStatus === "delivered" || event.deliveryStatus === "not-applicable") return event?.deliveryStatus || "unknown";
  const current = accountCountFor(event, accountReset);
  const before = safeCount(event.accountResetCountBefore);
  const after = safeCount(event.accountResetCountAfter);
  if (current != null && before != null && after != null && after > before && current >= after) return "delivered";
  return event.deliveryStatus || "unknown";
}
function iso(value, label) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} requires an ISO timestamp with an explicit timezone`);
  }
  return new Date(value).toISOString();
}
export function normalizeResetAnnouncement(raw, now = Date.now()) {
  const match = /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/(\d{16,22})\/?$/.exec(raw?.sourceUrl || "");
  if (!match) throw new Error("An original @thsottiaux post URL is required");
  const publishedAt = iso(raw.publishedAt, "publishedAt");
  if (Date.parse(publishedAt) > now + 5 * 60000) throw new Error("The source post cannot be in the future");
  const status = raw.status;
  if (!["scheduled", "tentative", "completed", "cancelled"].includes(status)) throw new Error("Invalid announcement status");
  const summary = text(raw.summary, 240);
  const scope = text(raw.scope, 160);
  if (!summary || !scope) throw new Error("A summary and explicit scope (or unknown) are required");
  const verified = raw.verification === "original" || (raw.verification === "rss" && raw.feedUrl === RESET_RSS_SOURCE);
  const type = resetType(raw);
  const event = { id: match[1], sourceUrl: `${RESET_SOURCE}/status/${match[1]}`, publishedAt,
    status, summary, scope, verification: verified ? raw.verification : "unverified",
    feedUrl: raw.verification === "rss" ? RESET_RSS_SOURCE : null,
    evidence: text(raw.evidence, 240), timeBasis: text(raw.timeBasis, 300), precision: "unknown",
    targetAt: null, windowStartAt: null, checkedAt: new Date(now).toISOString(), supersedes: [],
    resetType: type, deliveryStatus: deliveryStatus(raw, status, type),
    deliveryEvidence: text(raw.deliveryEvidence, 240),
    accountResetCountBefore: safeCount(raw.accountResetCountBefore),
    accountResetCountAfter: safeCount(raw.accountResetCountAfter) };
  if (status === "scheduled") {
    if (!verified || !event.evidence || !event.timeBasis) throw new Error("Countdown requires original-source verification, evidence and time basis");
    if (!["exact", "window", "deadline"].includes(raw.precision)) throw new Error("Unknown times cannot start a countdown");
    event.precision = raw.precision;
    event.targetAt = iso(raw.targetAt, "targetAt");
    const target = Date.parse(event.targetAt);
    if (target < Date.parse(publishedAt) || target > Date.parse(publishedAt) + 30 * DAY) throw new Error("Reset time is outside the announced upcoming window");
    if (event.precision === "window") {
      event.windowStartAt = iso(raw.windowStartAt, "windowStartAt");
      const start = Date.parse(event.windowStartAt);
      if (start < Date.parse(publishedAt) || start >= target || target - start > DAY) throw new Error("A time window must be ordered and at most 24 hours");
    }
  }
  if (verified) {
    event.supersedes = [...new Set((Array.isArray(raw.supersedes) ? raw.supersedes : [])
      .filter((id) => /^\d{16,22}$/.test(id) && id !== event.id))].slice(0, 20);
  }
  return event;
}

/**
 * RSS records are retained as historical signals even when they were already
 * acknowledged and did not contain enough information to become an event.
 * They are display/history data only; they never create a countdown by
 * themselves.
 */
export function normalizeResetHistorySignal(raw, now = Date.now()) {
  const match = /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/(\d{16,22})\/?$/.exec(raw?.sourceUrl || "");
  if (!match) throw new Error("A historical signal must link to an original @thsottiaux post");
  const publishedAt = iso(raw.publishedAt, "publishedAt");
  if (Date.parse(publishedAt) > now + 5 * 60000) throw new Error("A historical signal cannot be in the future");
  const verified = raw.verification === "original" || (raw.verification === "rss" && raw.feedUrl === RESET_RSS_SOURCE);
  const summary = text(raw.summary || raw.text, 240);
  if (!summary) throw new Error("A historical signal requires a bounded summary");
  const reviewKey = typeof raw.reviewKey === "string" && /^\d{16,22}:[a-f0-9]{16}$/.test(raw.reviewKey) ? raw.reviewKey : null;
  return {
    id: match[1], sourceUrl: `${RESET_SOURCE}/status/${match[1]}`, publishedAt,
    status: "signal", summary, translationSource: text(raw.translationSource, 600), evidenceTranslation: text(raw.evidenceTranslation, 600), evidence: text(raw.evidence || raw.text, 240), scope: "未说明",
    postKind: raw.postKind === "reply" ? "reply" : "post",
    references: (Array.isArray(raw.references) ? raw.references : []).filter(id => /^\d{16,22}$/.test(id)).slice(0, 8),
    verification: verified ? raw.verification : "unverified", feedUrl: raw.verification === "rss" ? RESET_RSS_SOURCE : null,
    reviewKey, checkedAt: new Date(now).toISOString(), kind: "historical-signal",
  };
}

const emptyState = () => ({ schemaVersion: 1, sourceUrl: RESET_SOURCE, lastCheckAt: null,
  lastSuccessAt: null, checkStatus: "never", checkMessage: "尚未完成首次检查", events: [], history: [], reviewedPosts: [] });

export async function readResetAnnouncements(filePath = resetAnnouncementPath()) {
  let info;
  try { info = await stat(filePath); } catch (error) { if (error.code === "ENOENT") return emptyState(); throw error; }
  if (info.size > MAX_BYTES) throw new Error("Reset announcement state is too large");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) throw new Error("Invalid reset announcement state");
  const events = raw.events.map((event) => ({ ...normalizeResetAnnouncement(event), checkedAt: iso(event.checkedAt, "checkedAt") }));
  const history = (Array.isArray(raw.history) ? raw.history : []).slice(0, MAX_HISTORY)
    .map((signal) => normalizeResetHistorySignal(signal));
  return { ...emptyState(), lastCheckAt: raw.lastCheckAt ? iso(raw.lastCheckAt, "lastCheckAt") : null,
    lastSuccessAt: raw.lastSuccessAt ? iso(raw.lastSuccessAt, "lastSuccessAt") : null,
    checkStatus: ["ok", "partial", "error", "never"].includes(raw.checkStatus) ? raw.checkStatus : "error",
    checkMessage: text(raw.checkMessage, 300), events, history,
    reviewedPosts: (Array.isArray(raw.reviewedPosts) ? raw.reviewedPosts : []).filter((id) => /^\d{16,22}:[a-f0-9]{16}$/.test(id)).slice(-200) };
}

/** Called by the scheduled reader, not by website content or renderer events. */
export async function recordResetCheck(input, { filePath = resetAnnouncementPath(), now = Date.now() } = {}) {
  if (!["ok", "partial", "error"].includes(input?.status)) throw new Error("Check status must be ok, partial or error");
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) throw new Error("events must be a bounded array");
  const inputHistory = input.history == null ? [] : input.history;
  if (!Array.isArray(inputHistory) || inputHistory.length > MAX_HISTORY) throw new Error("history must be a bounded array");
  if (input.status === "error" && (input.events.length || inputHistory.length)) throw new Error("A failed check cannot introduce announcements or history");
  const events = input.events.map((event) => normalizeResetAnnouncement(event, now));
  const history = inputHistory.map((signal) => normalizeResetHistorySignal(signal, now));
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const state = await readResetAnnouncements(filePath);
    const byId = new Map(state.events.map((event) => [event.id, event]));
    for (const event of events) {
      const previous = byId.get(event.id);
      if (previous && previous.verification !== "unverified" && event.verification === "unverified") continue;
      byId.set(event.id, event);
    }
    const historyById = new Map(state.history.map((signal) => [signal.id, signal]));
    for (const signal of history) {
      const previous = historyById.get(signal.id);
      if (previous && previous.verification !== "unverified" && signal.verification === "unverified") continue;
      historyById.set(signal.id, signal);
    }
    const next = { ...state, lastCheckAt: new Date(now).toISOString(),
      lastSuccessAt: input.status === "ok" ? new Date(now).toISOString() : state.lastSuccessAt,
      checkStatus: input.status, checkMessage: text(input.message, 300),
      reviewedPosts: [...new Set([...state.reviewedPosts, ...(Array.isArray(input.reviewedPosts) ? input.reviewedPosts : [])
        .filter((id) => /^\d{16,22}:[a-f0-9]{16}$/.test(id))])].slice(-200),
      events: [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_EVENTS),
      history: [...historyById.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_HISTORY) };
    const serialized = JSON.stringify(next, null, 2);
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error("Reset announcement state is too large");
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(serialized + "\n"); await file.sync(); } finally { await file.close(); }
    await rename(temporary, filePath);
    return next;
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

/**
 * A confidence score describes the quality of the evidence we stored, not the
 * probability that an account will reset. It is deliberately derived at read
 * time so old records never need a schema migration.
 */
export function scoreResetAnnouncement(event, now = Date.now()) {
  if (!event || typeof event !== "object") return null;
  const reasons = [];
  let score = event.verification === "original" ? 91 : event.verification === "rss" ? 76 : 28;
  reasons.push(event.verification === "original" ? "X 原帖直读" : event.verification === "rss" ? "FxEmbed RSS 已核验作者与原帖" : "仅有未核验线索");
  if (event.evidence) { score += 4; reasons.push("保留原文依据"); }
  if (event.timeBasis) { score += 3; reasons.push("记录时间换算依据"); }
  if (event.scope && !/未说明|unknown/i.test(event.scope)) { score += 2; reasons.push("适用范围已说明"); }
  if (event.status === "scheduled") {
    const precision = event.precision === "exact" ? 4 : event.precision === "window" ? 3 : event.precision === "deadline" ? 2 : 0;
    score += precision;
    if (precision) reasons.push(`时间精度：${event.precision}`);
  }
  const age = Date.parse(event.publishedAt);
  if (Number.isFinite(age) && now - age > 7 * DAY) {
    const decay = Math.min(12, Math.floor((now - age - 7 * DAY) / DAY) * 2);
    if (decay > 0) { score -= decay; reasons.push("公告发布时间较早"); }
  }
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const alertLevel = value >= RESET_CRITICAL_THRESHOLD ? "red" : value >= RESET_ALERT_THRESHOLD ? "yellow" : "none";
  return { value, band: value >= 85 ? "高" : value >= 65 ? "中" : "低", alertLevel, reasons };
}

export function resetAlertLevel(value) {
  const score = Number(value);
  return score >= RESET_CRITICAL_THRESHOLD ? "red" : score >= RESET_ALERT_THRESHOLD ? "yellow" : "none";
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Summarize all bounded historical signals without treating them as account telemetry. */
export function analyzeResetHistory(state, now = Date.now()) {
  const allEvents = Array.isArray(state?.events) ? state.events.filter(Boolean) : [];
  const storedSignals = Array.isArray(state?.history) ? state.history.filter(Boolean) : [];
  const combinedById = new Map(storedSignals.map((signal) => [signal.id, signal]));
  for (const event of allEvents) combinedById.set(event.id, { ...combinedById.get(event.id), ...event });
  const allSignals = [...combinedById.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const superseded = new Set(allEvents.flatMap((event) => Array.isArray(event.supersedes) ? event.supersedes : []));
  const currentEvents = allEvents.filter((event) => !superseded.has(event.id))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const completed = allEvents.filter((event) => event.status === "completed").sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const intervals = completed.slice(1).map((event, index) => (Date.parse(event.publishedAt) - Date.parse(completed[index].publishedAt)) / 3600000).filter((value) => value > 0);
  const counts = {
    total: allEvents.length,
    historyTotal: allSignals.length,
    historicalSignals: storedSignals.length,
    current: currentEvents.length,
    scheduled: allEvents.filter((event) => event.status === "scheduled").length,
    tentative: allEvents.filter((event) => event.status === "tentative").length,
    completed: completed.length,
    cancelled: allEvents.filter((event) => event.status === "cancelled").length,
    superseded: superseded.size,
  };
  const latest = allSignals[0] || null;
  const latestCompleted = completed.at(-1) || null;
  const medianIntervalHours = median(intervals);
  const history = allSignals.map((event) => ({
      id: event.id,
      publishedAt: event.publishedAt,
      status: event.status || "signal",
      precision: event.precision || "unknown",
      verification: event.verification,
      superseded: superseded.has(event.id),
    }));
  const parts = counts.historyTotal === 0
    ? ["暂无历史重置信号可供分析。"]
    : [`已记录 ${counts.historyTotal} 条公开信号：${counts.completed} 条完成、${counts.scheduled} 条排期、${counts.tentative} 条待确认、${counts.cancelled} 条取消；其中 ${counts.historicalSignals} 条来自历史 RSS 信号，当前有效 ${counts.current} 条事件。`,
      counts.superseded ? `${counts.superseded} 条已被后续明确关联公告替代。` : "没有发现被后续公告替代的记录。",
      medianIntervalHours ? `已完成公告间隔中位数约 ${medianIntervalHours >= 48 ? `${(medianIntervalHours / 24).toFixed(1)} 天` : `${medianIntervalHours.toFixed(1)} 小时`}（样本 ${completed.length} 次）。` : "已完成公告样本不足，暂不推断固定周期。"];
  const confidenceEvent = currentEvents.find((event) => event.status === "scheduled") || currentEvents[0] || latest;
  const confidence = scoreResetAnnouncement(confidenceEvent, now);
  return {
    counts, latestPublishedAt: latest?.publishedAt || null, latestCompletedAt: latestCompleted?.publishedAt || null,
    medianIntervalHours, confidence, summary: parts.join(" "), history,
  };
}

/** Heuristic forecast, deliberately separate from evidence quality and account delivery. */
export function estimateResetProbability(state, now = Date.now()) {
  const events = state?.events || [];
  const completed = events.filter(e => e.status === "completed" && e.verification !== "unverified")
    .sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] || null;
  const after = completed ? Date.parse(completed.publishedAt) : now - 2 * DAY;
  const fresh = events.filter(e => e.verification !== "unverified" && Date.parse(e.publishedAt) > after
    && now - Date.parse(e.publishedAt) < 2 * DAY && e.deliveryStatus !== "delivered");
  const superseded = new Set(events.flatMap(e => e.supersedes || []));
  const promise = fresh.find(e => !superseded.has(e.id) && (e.status === "tentative"
    || e.status === "scheduled" && Date.parse(e.targetAt) > now && Date.parse(e.targetAt) <= now + DAY));
  const signals = (state?.history || []).filter(e => e.verification !== "unverified"
    && Date.parse(e.publishedAt) > after && now - Date.parse(e.publishedAt) < DAY);
  const positive = signals.find(e => /\b(?:like giving resets|reset.{0,30}(?:vote|both)|(?:vote|both).{0,30}reset)\b/i.test(e.translationSource || e.evidence || e.summary));
  const cancelled = fresh.find(e => e.status === "cancelled" && (!promise || Date.parse(e.publishedAt) >= Date.parse(promise.publishedAt)));
  const value = cancelled ? 5 : promise ? promise.status === "scheduled" ? 90 : 80 : positive ? 35 : null;
  const checked = Date.parse(state?.lastSuccessAt);
  return { value, horizonHours: 24, method: "公开信号规则估计，未经统计校准",
    stale: state?.checkStatus !== "ok" || !Number.isFinite(checked) || now - checked > 30 * 60000,
    reason: cancelled ? "作者明确取消重置。" : promise ? promise.summary : positive ? "作者表达重置意愿，尚未承诺。"
      : completed ? "最近重置已完成，尚无新的重置承诺。" : "暂无足够信号估计下一次重置概率。",
    sourceUrl: (cancelled || promise || positive)?.sourceUrl || null, latestCompleted: completed };
}

export function presentResetAnnouncements(state, now = Date.now(), { accountReset = null } = {}) {
  const superseded = new Set((state?.events || []).flatMap((event) => event.supersedes || []));
  const events = (state?.events || []).filter((event) => !superseded.has(event.id))
    .map((event) => ({ ...event, deliveryStatus: resolveResetDeliveryStatus(event, accountReset) }));
  const upcoming = events.filter((event) => event.verification !== "unverified" && event.status === "scheduled"
    && Date.parse(event.targetAt) > now && scoreResetAnnouncement(event, now)?.value >= RESET_ALERT_THRESHOLD)
    .sort((a, b) => Date.parse(a.targetAt) - Date.parse(b.targetAt));
  const analysis = analyzeResetHistory(state, now);
  const tentative = events.find((event) => event.status === "tentative"
    && event.verification !== "unverified" && event.deliveryStatus !== "delivered"
    && Date.parse(event.publishedAt) + 3 * DAY > now
    && scoreResetAnnouncement(event, now)?.value >= RESET_ALERT_THRESHOLD
    && !(events.some(done => done.status === "completed" && Date.parse(done.publishedAt) > Date.parse(event.publishedAt))));
  const active = upcoming[0] || tentative || null;
  const confidence = scoreResetAnnouncement(active, now);
  const recentById = new Map();
  for (const event of events) recentById.set(event.id, { ...(state?.history || []).find(signal => signal.id === event.id), ...event, confidence: scoreResetAnnouncement(event, now) });
  for (const signal of (state?.history || [])) if (!recentById.has(signal.id)) recentById.set(signal.id, { ...signal, confidence: scoreResetAnnouncement(signal, now) });
  const recent = [...recentById.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 5);
  return { sourceUrl: RESET_SOURCE, lastCheckAt: state?.lastCheckAt || null,
    lastSuccessAt: state?.lastSuccessAt || null, checkStatus: state?.checkStatus || "never",
    checkMessage: state?.checkMessage || "尚未完成首次检查", intervalMinutes: 15, intervalHours: 0.25,
    active,
    confidence, probability: estimateResetProbability(state, now), analysis, recent, accountReset: accountReset && typeof accountReset === "object" ? accountReset : null };
}

export function createResetAnnouncementReader({ filePath = resetAnnouncementPath() } = {}) {
  let lastRead = 0;
  let cached = emptyState();
  return async ({ accountReset = null } = {}) => {
    if (Date.now() - lastRead >= 5000) {
      lastRead = Date.now();
      try { cached = await readResetAnnouncements(filePath); }
      catch { cached = { ...cached, checkStatus: "error", checkMessage: "本地公告记录暂不可读，保留上次已核验数据" }; }
    }
    return presentResetAnnouncements(cached, Date.now(), { accountReset });
  };
}
