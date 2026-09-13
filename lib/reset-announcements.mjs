import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const RESET_SOURCE = "https://x.com/thsottiaux";
export const RESET_RSS_SOURCE = "https://fxtwitter.com/thsottiaux/feed.xml";
export const RESET_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MAX_BYTES = 128 * 1024;
const MAX_EVENTS = 40;
const DAY = 86400000;

export function resetAnnouncementPath(env = process.env) {
  return env.AIYOUCODEX_RESET_ANNOUNCEMENTS_PATH
    || path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "aiyoucodex", "reset-announcements.json");
}

function text(value, max = 500) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
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
  const event = { id: match[1], sourceUrl: `${RESET_SOURCE}/status/${match[1]}`, publishedAt,
    status, summary, scope, verification: verified ? raw.verification : "unverified",
    feedUrl: raw.verification === "rss" ? RESET_RSS_SOURCE : null,
    evidence: text(raw.evidence, 240), timeBasis: text(raw.timeBasis, 300), precision: "unknown",
    targetAt: null, windowStartAt: null, checkedAt: new Date(now).toISOString(), supersedes: [] };
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

const emptyState = () => ({ schemaVersion: 1, sourceUrl: RESET_SOURCE, lastCheckAt: null,
  lastSuccessAt: null, checkStatus: "never", checkMessage: "尚未完成首次检查", events: [], reviewedPosts: [] });

export async function readResetAnnouncements(filePath = resetAnnouncementPath()) {
  let info;
  try { info = await stat(filePath); } catch (error) { if (error.code === "ENOENT") return emptyState(); throw error; }
  if (info.size > MAX_BYTES) throw new Error("Reset announcement state is too large");
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) throw new Error("Invalid reset announcement state");
  const events = raw.events.map((event) => ({ ...normalizeResetAnnouncement(event), checkedAt: iso(event.checkedAt, "checkedAt") }));
  return { ...emptyState(), lastCheckAt: raw.lastCheckAt ? iso(raw.lastCheckAt, "lastCheckAt") : null,
    lastSuccessAt: raw.lastSuccessAt ? iso(raw.lastSuccessAt, "lastSuccessAt") : null,
    checkStatus: ["ok", "partial", "error", "never"].includes(raw.checkStatus) ? raw.checkStatus : "error",
    checkMessage: text(raw.checkMessage, 300), events,
    reviewedPosts: (Array.isArray(raw.reviewedPosts) ? raw.reviewedPosts : []).filter((id) => /^\d{16,22}:[a-f0-9]{16}$/.test(id)).slice(-200) };
}

/** Called by the scheduled reader, not by website content or renderer events. */
export async function recordResetCheck(input, { filePath = resetAnnouncementPath(), now = Date.now() } = {}) {
  if (!["ok", "partial", "error"].includes(input?.status)) throw new Error("Check status must be ok, partial or error");
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) throw new Error("events must be a bounded array");
  if (input.status === "error" && input.events.length) throw new Error("A failed check cannot introduce announcements");
  const events = input.events.map((event) => normalizeResetAnnouncement(event, now));
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
    const next = { ...state, lastCheckAt: new Date(now).toISOString(),
      lastSuccessAt: input.status === "ok" ? new Date(now).toISOString() : state.lastSuccessAt,
      checkStatus: input.status, checkMessage: text(input.message, 300),
      reviewedPosts: [...new Set([...state.reviewedPosts, ...(Array.isArray(input.reviewedPosts) ? input.reviewedPosts : [])
        .filter((id) => /^\d{16,22}:[a-f0-9]{16}$/.test(id))])].slice(-200),
      events: [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_EVENTS) };
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

export function presentResetAnnouncements(state, now = Date.now()) {
  const superseded = new Set((state?.events || []).flatMap((event) => event.supersedes || []));
  const events = (state?.events || []).filter((event) => !superseded.has(event.id));
  const upcoming = events.filter((event) => event.verification !== "unverified" && event.status === "scheduled"
    && Date.parse(event.targetAt) + DAY > now).sort((a, b) => Date.parse(a.targetAt) - Date.parse(b.targetAt));
  return { sourceUrl: RESET_SOURCE, lastCheckAt: state?.lastCheckAt || null,
    lastSuccessAt: state?.lastSuccessAt || null, checkStatus: state?.checkStatus || "never",
    checkMessage: state?.checkMessage || "尚未完成首次检查", intervalHours: 3,
    active: upcoming[0] || events.find((event) => event.status !== "scheduled" && Date.parse(event.publishedAt) + 3 * DAY > now) || null,
    recent: events.slice(0, 5) };
}

export function createResetAnnouncementReader({ filePath = resetAnnouncementPath() } = {}) {
  let lastRead = 0;
  let cached = emptyState();
  return async () => {
    if (Date.now() - lastRead >= 5000) {
      lastRead = Date.now();
      try { cached = await readResetAnnouncements(filePath); }
      catch { cached = { ...cached, checkStatus: "error", checkMessage: "本地公告记录暂不可读，保留上次已核验数据" }; }
    }
    return presentResetAnnouncements(cached);
  };
}
