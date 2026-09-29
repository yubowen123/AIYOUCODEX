import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { analyzeResetHistory, normalizeResetAnnouncement, presentResetAnnouncements, recordResetCheck, readResetAnnouncements, scoreResetAnnouncement,
  RESET_RSS_SOURCE, createResetAnnouncementReader, resolveResetDeliveryStatus } from "../lib/reset-announcements.mjs";
import { parseResetRss, collectResetRss } from "../lib/reset-rss.mjs";

const now = Date.parse("2026-09-13T10:00:00Z");
const post = { sourceUrl: "https://x.com/thsottiaux/status/2099000000000000001", publishedAt: "2026-09-13T09:00:00Z",
  status: "scheduled", summary: "预计重置", scope: "Codex 付费用户", verification: "rss", feedUrl: RESET_RSS_SOURCE,
  precision: "exact", targetAt: "2026-09-13T12:00:00+00:00", evidence: "Reset at 12:00 UTC September 13", timeBasis: "原文明确 UTC 日期和时分" };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aiyou-reset-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "state.json");
}

test("only attributable, bounded exact times or windows can start a countdown", () => {
  assert.equal(normalizeResetAnnouncement(post, now).targetAt, "2026-09-13T12:00:00.000Z");
  for (const patch of [{ sourceUrl: "https://x.com/another/status/2099000000000000001" },
    { sourceUrl: "https://x.com/thsottiaux/status/2099000000000000001?malicious" }, { verification: "unverified" },
    { precision: "unknown" }, { evidence: "" }, { timeBasis: "" }, { targetAt: "2026-09-13T12:00:00" },
    { targetAt: "2027-01-01T00:00:00Z" }, { targetAt: "2026-09-12T00:00:00Z" },
    { precision: "window", windowStartAt: "2026-09-13T13:00:00Z" }]) {
    assert.throws(() => normalizeResetAnnouncement({ ...post, ...patch }, now));
  }
  const tentative = normalizeResetAnnouncement({ ...post, status: "tentative", precision: "unknown" }, now);
  assert.equal(tentative.targetAt, null);
  assert.equal(normalizeResetAnnouncement({ ...post, precision: "window", windowStartAt: "2026-09-13T11:00:00Z" }, now).precision, "window");
});

test("banked reset announcements stay pending until account reset-count evidence arrives", () => {
  const announced = normalizeResetAnnouncement({ ...post, status: "tentative",
    summary: "作者将提供 banked reset", evidence: "banked reset for Plus", resetType: "banked" }, now);
  assert.equal(announced.resetType, "banked");
  assert.equal(announced.deliveryStatus, "pending");
  const delivered = normalizeResetAnnouncement({ ...post, status: "tentative", resetType: "banked",
    deliveryStatus: "delivered", deliveryEvidence: "banked reset count increased from 1 to 2",
    accountResetCountBefore: 1, accountResetCountAfter: 2 }, now);
  assert.equal(delivered.deliveryStatus, "delivered");
  assert.equal(delivered.accountResetCountBefore, 1);
  assert.equal(delivered.accountResetCountAfter, 2);
  assert.equal(resolveResetDeliveryStatus(announced, { bankedCount: 1 }), "pending");
  assert.equal(resolveResetDeliveryStatus({ ...announced, accountResetCountBefore: 1, accountResetCountAfter: 2 }, { bankedCount: 2 }), "delivered");
  const display = presentResetAnnouncements({ events: [{ ...announced, accountResetCountBefore: 1, accountResetCountAfter: 2 }] }, now, { accountReset: { bankedCount: 2 } });
  assert.equal(display.active, null, "Account arrival belongs to history, not the next-reset headline");
  assert.equal(display.recent[0].deliveryStatus, "delivered");
});

test("records are atomic, survive restart, deduplicate and keep confirmed data on failed checks", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const filePath = await fixture(t);
  await recordResetCheck({ status: "ok", events: [post], reviewedPosts: ["2099000000000000001:0123456789abcdef"] }, { filePath, now });
  await recordResetCheck({ status: "ok", events: [post] }, { filePath, now });
  const initial = await readResetAnnouncements(filePath);
  assert.equal(initial.events.length, 1);
  assert.equal(initial.reviewedPosts.length, 1);
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  await recordResetCheck({ status: "error", message: "RSS HTTP 503", events: [] }, { filePath, now: now + 1000 });
  const failed = await readResetAnnouncements(filePath);
  assert.equal(failed.lastSuccessAt, initial.lastSuccessAt);
  assert.equal(failed.events[0].id, initial.events[0].id);
  assert.equal(failed.checkStatus, "error");
  assert.equal((await createResetAnnouncementReader({ filePath })()).active?.id, post.sourceUrl.split("/").at(-1));
  const before = await readFile(filePath, "utf8");
  await assert.rejects(recordResetCheck({ status: "ok", events: [{ ...post, verification: "unverified" }] }, { filePath, now }));
  assert.equal(await readFile(filePath, "utf8"), before);
});

test("completion and cancellation explicitly supersede an announcement without faking account resets", () => {
  const scheduled = normalizeResetAnnouncement(post, now);
  const complete = normalizeResetAnnouncement({ ...post, sourceUrl: "https://x.com/thsottiaux/status/2099000000000000002",
    publishedAt: "2026-09-13T09:30:00Z", status: "completed", supersedes: [scheduled.id] }, now);
  const display = presentResetAnnouncements({ events: [complete, scheduled] }, now);
  assert.equal(display.active, null, "A completed announcement cannot become a future-reset forecast");
  assert.equal(display.recent.length, 1);
  assert.equal(presentResetAnnouncements({ events: [scheduled] }, Date.parse(scheduled.targetAt) + 86400001).active, null);
  assert.equal(presentResetAnnouncements({ events: [scheduled] }, now + 3 * 86400000).active, null);
});

test("confidence explains evidence quality and history analysis does not invent a cadence", () => {
  const scheduled = normalizeResetAnnouncement(post, now);
  const complete = normalizeResetAnnouncement({ ...post, sourceUrl: "https://x.com/thsottiaux/status/2099000000000000002",
    publishedAt: "2026-09-13T09:30:00Z", status: "completed", supersedes: [scheduled.id] }, now);
  const tentative = normalizeResetAnnouncement({ ...post, sourceUrl: "https://x.com/thsottiaux/status/2099000000000000003",
    publishedAt: "2026-09-13T09:45:00Z", status: "tentative", precision: "unknown" }, now);
  const confidence = scoreResetAnnouncement(scheduled, now);
  assert.ok(confidence.value >= 80 && confidence.value <= 100);
  assert.equal(confidence.band, "高");
  assert.match(confidence.reasons.join(" "), /RSS/);
  const analysis = analyzeResetHistory({ events: [complete, scheduled, tentative] }, now);
  assert.deepEqual(analysis.counts, { total: 3, historyTotal: 3, historicalSignals: 0, current: 2, scheduled: 1, tentative: 1, completed: 1, cancelled: 0, superseded: 1 });
  assert.match(analysis.summary, /样本不足/);
  assert.equal(analysis.medianIntervalHours, null);
  assert.equal(analysis.history.length, 3);
  assert.ok(presentResetAnnouncements({ events: [complete, scheduled, tentative] }, now).recent[0].confidence.value >= 0);
});

test("70 and 90 percent thresholds map to yellow/red warnings and low scores stay quiet", () => {
  const yellow = scoreResetAnnouncement({ ...post, verification: "rss", evidence: "", timeBasis: "", scope: "未说明" }, now);
  assert.equal(yellow.alertLevel, "yellow");
  assert.ok(yellow.value >= 70 && yellow.value < 90);
  const red = scoreResetAnnouncement({ ...post, verification: "original", evidence: "exact source evidence", timeBasis: "UTC conversion", scope: "Codex", precision: "exact" }, now);
  assert.equal(red.alertLevel, "red");
  const quiet = scoreResetAnnouncement({ ...post, verification: "unverified", evidence: "", timeBasis: "", scope: "未说明" }, now);
  assert.equal(quiet.alertLevel, "none");
});

test("historical RSS signals persist separately and never invent a countdown", async (t) => {
  const filePath = await fixture(t);
  const signal = { sourceUrl: "https://x.com/thsottiaux/status/2099000000000000004", publishedAt: "2026-09-13T08:00:00Z",
    summary: "reset mention without a precise time", text: "reset mention without a precise time", verification: "rss", feedUrl: RESET_RSS_SOURCE,
    reviewKey: "2099000000000000004:0123456789abcdef" };
  await recordResetCheck({ status: "ok", events: [], history: [signal] }, { filePath, now });
  const state = await readResetAnnouncements(filePath);
  assert.equal(state.history.length, 1);
  const display = presentResetAnnouncements(state, now);
  assert.equal(display.active, null);
  assert.equal(display.analysis.counts.historyTotal, 1);
  assert.equal(display.analysis.history[0].status, "signal");
});

const feed = (body = "Reset in two hours", title = "Reset") => `<?xml version="1.0"?><rss version="2.0"><channel><title>Tibo</title><link>https://fxtwitter.com/thsottiaux</link>
  <item><title>${title}</title><link>${post.sourceUrl}</link><pubDate>Sun, 13 Sep 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>${body}</p><blockquote>tomorrow we will reset</blockquote>]]></description></item></channel></rss>`;

test("RSS parser excludes quoted promises, retweets, wrong authors, executable HTML and invalid responses", () => {
  const parsed = parseResetRss(feed("Reset &amp; refresh"), now);
  assert.equal(parsed[0].text, "Reset & refresh");
  assert.equal(parsed[0].publishedAt, "2026-09-13T09:00:00.000Z");
  assert.equal(parseResetRss(feed("Thanks everyone"), now)[0].relevant, false);
  assert.throws(() => parseResetRss(feed("reset", "RT another account"), now));
  assert.throws(() => parseResetRss(feed().replaceAll("thsottiaux", "someoneelse"), now));
  assert.throws(() => parseResetRss("<html>Login</html>", now));
  assert.throws(() => parseResetRss("<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>" + feed(), now));
  assert.throws(() => parseResetRss(feed().repeat(20000), now));
});

test("RSS acknowledgement is two-phase, edits are new candidates, and failures never look like no news", async (t) => {
  const filePath = await fixture(t);
  let xml = feed();
  const fetchImpl = async () => new Response(xml, { status: 200 });
  const collected = await collectResetRss({ filePath, fetchImpl, now });
  assert.equal(collected.candidates.length, 1);
  assert.equal((await collectResetRss({ filePath, fetchImpl, now })).candidates.length, 1, "No ACK before review");
  await recordResetCheck({ status: "ok", events: [], reviewedPosts: collected.reviewedPosts }, { filePath, now });
  assert.equal((await collectResetRss({ filePath, fetchImpl, now })).candidates.length, 0);
  xml = feed("Reset in three hours");
  assert.equal((await collectResetRss({ filePath, fetchImpl, now })).candidates.length, 1);
  await assert.rejects(collectResetRss({ filePath, fetchImpl: async () => new Response("limited", { status: 429 }), now }), /429/);
});

test("RSS conditional requests and content digest skip unchanged feeds after recording", async (t) => {
  const filePath = await fixture(t);
  const options = { filePath, now };
  const first = await collectResetRss({ ...options,
    fetchImpl: async () => new Response(feed(), { headers: { ETag: '"feed-v1"' } }) });
  await recordResetCheck({ status: "ok", events: [], reviewedPosts: first.reviewedPosts }, { filePath, now });
  const unchanged = await collectResetRss({ ...options, cache: first.cache, fetchImpl: async (_, request) => {
    assert.equal(request.headers["If-None-Match"], '"feed-v1"');
    return new Response(null, { status: 304 });
  } });
  assert.equal(unchanged.notModified, true);
  assert.equal(unchanged.newestPostAt, first.newestPostAt);
  assert.deepEqual(unchanged.candidates, []);
  const digest = await collectResetRss({ ...options, cache: first.cache, fetchImpl: async () => new Response(feed()) });
  assert.equal(digest.notModified, true);
  assert.equal(digest.fetched, 0);
  const changed = await collectResetRss({ ...options, cache: first.cache,
    fetchImpl: async () => new Response(feed("Reset in three hours")) });
  assert.equal(changed.candidates.length, 1);
  assert.notEqual(changed.cache.bodyHash, first.cache.bodyHash);
  await collectResetRss({ ...options, cache: { ...first.cache, etag: null, lastModified: "Sun, 13 Sep 2026 09:00:00 GMT" },
    fetchImpl: async (_, request) => {
      assert.equal(request.headers["If-Modified-Since"], "Sun, 13 Sep 2026 09:00:00 GMT");
      return new Response(null, { status: 304 });
    } });
  await assert.rejects(collectResetRss({ ...options,
    fetchImpl: async () => new Response(null, { status: 304 }) }), /without a verified local cache/);
});

test("RSS batches never cache away candidates beyond the twelve-post review limit", async (t) => {
  const filePath = await fixture(t);
  const item = /<item>[\s\S]*?<\/item>/.exec(feed())[0];
  const xml = feed().replace(item, Array.from({ length: 13 }, (_, index) =>
    item.replaceAll("2099000000000000001", String(2099000000000000001n + BigInt(index)))).join(""));
  const fetchImpl = async () => new Response(xml, { headers: { ETag: '"large-batch"' } });
  const first = await collectResetRss({ filePath, fetchImpl, now });
  assert.equal(first.candidates.length, 12);
  assert.equal(first.cache, null);
  await recordResetCheck({ status: "ok", events: [], reviewedPosts: first.reviewedPosts }, { filePath, now });
  const remaining = await collectResetRss({ filePath, fetchImpl, now, cache: first.cache });
  assert.equal(remaining.candidates.length, 1);
  assert.ok(remaining.cache.bodyHash);
});
