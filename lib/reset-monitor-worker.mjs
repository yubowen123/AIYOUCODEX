import { readResetAnnouncements, recordResetCheck, resetAnnouncementPath } from "./reset-announcements.mjs";
import { collectResetRss } from "./reset-rss.mjs";
import { classifyResetPost } from "./reset-classifier.mjs";
import { nextResetMonitorRun, readResetMonitorConfig, readResetMonitorStatus, resetMonitorPath, writeMonitorJson } from "./reset-monitor-store.mjs";

/** Runs in the supervised backend, even when there is no Codex renderer/chat. */
export async function tickResetMonitor({ filePath = resetMonitorPath(), announcementPath = resetAnnouncementPath(),
  now = Date.now(), fetchImpl = fetch, force = false } = {}) {
  const config = await readResetMonitorConfig(filePath, now);
  const previous = await readResetMonitorStatus(filePath);
  const lastRunAt = Number.isFinite(previous?.lastRunAt) ? previous.lastRunAt : null;
  const nextRunAt = nextResetMonitorRun(config, previous, now);
  const status = { schemaVersion: 1, pid: process.pid, running: true, heartbeatAt: now,
    configRevision: config.revision, lastRunAt, nextRunAt, lastStatus: previous?.lastStatus || "never",
    message: previous?.message || "等待首次采集", lastEventCount: previous?.lastEventCount || 0,
    consecutiveFailures: previous?.consecutiveFailures || 0, newestPostAt: previous?.newestPostAt || null,
    rssCache: previous?.rssCache || null };
  if (!config.enabled || (!force && nextRunAt > now)) {
    await writeMonitorJson(`${filePath}.status`, status);
    return { ...status, checked: false };
  }
  // One overdue check after wake/restart; never replay every missed interval.
  try {
    const batch = await collectResetRss({ filePath: announcementPath, fetchImpl, now, cache: status.rssCache });
    const old = await readResetAnnouncements(announcementPath);
    const events = [];
    for (const post of [...batch.candidates].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))) {
      const event = classifyResetPost(post, [...old.events, ...events], now);
      if (event) events.push(event);
    }
    const message = batch.notModified ? `RSS 内容未变化，沿用已核验公告；订阅最新发布时间 ${batch.newestPostAt}。`
      : `内置监控采集成功：读取 ${batch.fetched} 条 RSS 记录，新增 ${events.length} 条明确公告；订阅最新发布时间 ${batch.newestPostAt}。`;
    // Persist events and acknowledgements together. A crash cannot acknowledge
    // a candidate before its classification has been durably recorded.
    await recordResetCheck({ status: "ok", message, events, history: batch.history, reviewedPosts: batch.reviewedPosts },
      { filePath: announcementPath, now });
    Object.assign(status, { lastStatus: "ok", message, lastEventCount: events.length, consecutiveFailures: 0,
      newestPostAt: batch.newestPostAt, rssCache: batch.cache });
  } catch (error) {
    const message = `内置监控采集失败，保留既有公告：${error.message}`.slice(0, 300);
    await recordResetCheck({ status: "error", message, events: [] }, { filePath: announcementPath, now });
    Object.assign(status, { lastStatus: "error", message, lastEventCount: 0, consecutiveFailures: status.consecutiveFailures + 1 });
  }
  // Read configuration again: pausing/changing the interval during an HTTP
  // request must not be overwritten by that request's completion.
  const actual = await readResetMonitorConfig(filePath, now);
  const interval = actual.intervalMinutes * 60_000;
  const retryInterval = Math.max(interval, Math.min(60 * 60_000, interval * 2 ** Math.min(status.consecutiveFailures, 10)));
  Object.assign(status, { configRevision: actual.revision, lastRunAt: now,
    nextRunAt: actual.enabled ? now + retryInterval : null });
  await writeMonitorJson(`${filePath}.status`, status);
  return { ...status, checked: true };
}
