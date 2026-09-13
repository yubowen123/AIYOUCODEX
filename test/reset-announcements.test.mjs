import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { normalizeResetAnnouncement, presentResetAnnouncements, recordResetCheck, readResetAnnouncements,
  RESET_RSS_SOURCE, createResetAnnouncementReader } from "../lib/reset-announcements.mjs";
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
  assert.equal(display.active.status, "completed");
  assert.equal(display.active.targetAt, null);
  assert.equal(display.recent.length, 1);
  assert.equal(presentResetAnnouncements({ events: [scheduled] }, Date.parse(scheduled.targetAt) + 86400001).active, null);
  assert.equal(presentResetAnnouncements({ events: [scheduled] }, now + 3 * 86400000).active, null);
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
