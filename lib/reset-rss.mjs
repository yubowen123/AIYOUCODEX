import { createHash } from "node:crypto";
import { RESET_RSS_SOURCE, readResetAnnouncements } from "./reset-announcements.mjs";

const LIMIT = 1024 * 1024;
function decode(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    }).replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name]);
}
const field = (item, name) => decode(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(item)?.[1] || "").trim();
const plain = (html) => decode(html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Bounded RSS 2 reader: rejects DTD/entities and never executes feed HTML. */
export function parseResetRss(xml, now = Date.now()) {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml)
    || !/<rss\b/i.test(xml) || !/<\/rss>/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error("Expected a bounded RSS 2 feed");
  const header = xml.split(/<item\b/i)[0];
  if (!/^https:\/\/(?:fx)?twitter\.com\/thsottiaux\/?$|^https:\/\/x\.com\/thsottiaux\/?$/.test(field(header, "link"))) {
    throw new Error("RSS feed account is not @thsottiaux");
  }
  const entries = [];
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (entries.length >= 100) break;
    const url = field(item[1], "link");
    const match = /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/(\d{16,22})\/?$/.exec(url);
    const published = Date.parse(field(item[1], "pubDate"));
    if (!match || !Number.isFinite(published) || published > now + 300000) continue;
    const title = plain(field(item[1], "title"));
    if (/^(?:RT|R to|Replying to)\b/i.test(title)) continue;
    const body = plain(field(item[1], "description")) || title;
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    entries.push({ id: match[1], reviewKey: `${match[1]}:${hash}`, sourceUrl: `https://x.com/thsottiaux/status/${match[1]}`,
      publishedAt: new Date(published).toISOString(), text: body.slice(0, 6000),
      references: [...new Set([...item[1].matchAll(/https:\/\/x\.com\/thsottiaux\/status\/(\d{16,22})/g)].map((m) => m[1]))].filter((id) => id !== match[1]),
      relevant: /\breset(?:s|ting)?\b|usage limit|banked|重置/i.test(body) });
  }
  if (!entries.length) throw new Error("RSS returned no verifiable account posts; not treated as no news");
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function collectResetRss({ fetchImpl = fetch, filePath, now = Date.now() } = {}) {
  const state = await readResetAnnouncements(filePath);
  const response = await fetchImpl(RESET_RSS_SOURCE, { signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "AIYOUcodex-ResetMonitor/1.0" } });
  if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > LIMIT) throw new Error("RSS response is too large");
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > LIMIT) throw new Error("RSS response is too large");
    chunks.push(Buffer.from(chunk));
  }
  const entries = parseResetRss(Buffer.concat(chunks).toString("utf8"), now);
  const seen = new Set(state.reviewedPosts);
  const unread = entries.filter((entry) => !seen.has(entry.reviewKey));
  const candidates = unread.filter((entry) => entry.relevant && now - Date.parse(entry.publishedAt) < 7 * 86400000).slice(0, 12);
  // Acknowledged only by a later record command, so crashes cannot lose candidates.
  return { source: RESET_RSS_SOURCE, fetchedAt: new Date(now).toISOString(), newestPostAt: entries[0].publishedAt,
    candidates, reviewedPosts: unread.filter((entry) => !entry.relevant || now - Date.parse(entry.publishedAt) >= 7 * 86400000
      || candidates.some((candidate) => candidate.id === entry.id)).map((entry) => entry.reviewKey),
    fetched: entries.length, unchanged: !unread.length };
}
