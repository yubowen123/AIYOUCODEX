import { normalizeResetAnnouncement, RESET_RSS_SOURCE } from "./reset-announcements.mjs";

const HOUR = 3_600_000;
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12, twentyfour: 24 };
const OFFSETS = { UTC: 0, GMT: 0, PST: -8, PDT: -7, EST: -5, EDT: -4 };
const number = (value) => /^\d+$/.test(value) ? Number(value) : NUMBERS[value.toLowerCase()];
const excerpt = (text) => text.trim().split(/\s+/u).slice(0, 25).join(" ").slice(0, 240);

export function extractResetTime(text, publishedAt) {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return null;
  const relative = /\b(in|within)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)(?:\s*(?:-|–|to)\s*(\d{1,3}))?\s*(minutes?|hours?)\b/iu.exec(text);
  if (relative && !/\b(?:about|around|roughly|approximately|maybe)\s*$/iu.test(text.slice(0, relative.index))) {
    const unit = /^minute/i.test(relative[4]) ? 60_000 : HOUR;
    const start = published + number(relative[2]) * unit;
    const target = relative[3] ? published + number(relative[3]) * unit : start;
    if (start > published && target >= start && target - published <= 30 * 24 * HOUR && target - start <= 24 * HOUR) {
      return { precision: relative[3] && target > start ? "window" : relative[1].toLowerCase() === "within" ? "deadline" : "exact",
        targetAt: new Date(target).toISOString(),
        ...(target > start ? { windowStartAt: new Date(start).toISOString() } : {}),
        timeBasis: `按原帖发布时间 ${publishedAt} 加上原文“${relative[0]}”计算。` };
    }
  }
  const iso = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/iu.exec(text);
  if (iso && Number.isFinite(Date.parse(iso[0])) && new Date(`${iso[0].slice(0, 10)}T00:00:00Z`).toISOString().startsWith(iso[0].slice(0, 10))) return {
    precision: /\b(?:by|before|no later than)\s*$/iu.test(text.slice(0, iso.index)) ? "deadline" : "exact",
    targetAt: new Date(iso[0]).toISOString(), timeBasis: `原帖给出含时区的时间 ${iso[0]}。`,
  };
  const tomorrow = /\btomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(UTC|GMT|PST|PDT|EST|EDT)\b/iu.exec(text);
  if (tomorrow) {
    const [, hour, minute = "0", meridiem, zoneRaw] = tomorrow;
    if (+hour < 1 || +hour > 12 || +minute > 59) return null;
    const zone = zoneRaw.toUpperCase(), offset = OFFSETS[zone];
    const localDay = new Date(published + offset * HOUR);
    const target = Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate() + 1,
      +hour % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0), +minute) - offset * HOUR;
    return { precision: "exact", targetAt: new Date(target).toISOString(),
      timeBasis: `以原帖发布时间在 ${zone} 的当地日期为基准取次日；原文 ${tomorrow[0]}，按 ${zone}=UTC${offset} 换算。` };
  }
  const absolute = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})\s*(UTC|GMT|PST|PDT|EST|EDT)\b/iu.exec(text);
  if (!absolute) return null;
  const [, year, month, day, hour, minute, zoneRaw] = absolute;
  const zone = zoneRaw.toUpperCase();
  const local = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute));
  if (local.getUTCFullYear() !== +year || local.getUTCMonth() !== +month - 1 || local.getUTCDate() !== +day
    || +hour > 23 || +minute > 59) return null;
  return { precision: /\b(?:by|before|no later than)\s*$/iu.test(text.slice(0, absolute.index)) ? "deadline" : "exact",
    targetAt: new Date(local.getTime() - OFFSETS[zone] * HOUR).toISOString(),
    timeBasis: `原帖明确给出 ${absolute[0]}；按 ${zone} = UTC${OFFSETS[zone] >= 0 ? "+" : ""}${OFFSETS[zone]} 换算。` };
}

/** Rules only promote explicit first-party statements. Ambiguous text stays historical data. */
export function classifyResetPost(post, knownEvents = [], now = Date.now()) {
  const body = String(post?.text || "").replace(/[’‘]/g, "'").slice(0, 6000);
  if (!/^https:\/\/x\.com\/thsottiaux\/status\/\d{16,22}$/.test(post?.sourceUrl || "")) return null;
  const knownIds = new Set(knownEvents.map((event) => event.id));
  const linked = (post.references || []).filter((id) => knownIds.has(id));
  const productContext = /\b(?:codex|chatgpt|quota|usage|limits?|banked reset|reset counts?)\b/iu.test(body) || linked.length > 0
    || /\bresets?\s+(?:all|fully)\s+propagated\b|\breset has been processed\b/iu.test(body)
    || (post.postKind === "reply" && /\b(?:giving|granting|issuing) resets?\b/iu.test(body));
  if (!productContext || !/\breset(?:s|ting)?\b/iu.test(body) || /^(?:RT\s+@|R\s+to\s+@)/iu.test(body)) return null;
  const sentences = body.split(/(?<=[.!?])\s+/u).map((text) => text.trim()).filter(Boolean);
  const relevant = sentences.filter((text) => /\breset(?:s|ting)?\b/iu.test(text));
  for (const sentence of relevant) {
    // Quotes, speculation, questions and negation are not promises of a reset.
    if (/\?|[“”"]|\b(?:wish|hope|jok(?:e|ing)|kidding|rumou?r|according to|someone said|they said|if|maybe|might|could|would)\b/iu.test(sentence)) continue;
    let status;
    if (/\b(?:cancelled|canceled|won't happen|will not happen|not happening)\b/iu.test(sentence)) status = "cancelled";
    else if (/\b(?:not|never|won't|cannot|can't)\b/iu.test(sentence)) continue;
    else if (!/\b(?:will|going to)\b/iu.test(sentence) && (
      /\b(?:we|i)(?:'ve| have)?\s+(?:(?:now|just|already)\s+)?(?:reset\s+(?:codex|chatgpt|(?:your|the|all|everyone's)\s+(?:usage|limits?|quotas?))|(?:added|granted|issued|sent|distributed)\s+(?:(?:an?|one|\d+|extra|new)\s+)*(?:banked\s+)?resets?(?!\s+(?:button|feature|option|API))\b)/iu.test(sentence)
      || /\breset(?:s)?\b.{0,45}\b(?:(?:all|fully) propagated|completed|finished|done|now available|now live|have (?:been )?(?:applied|granted|distributed)|has been (?:applied|granted|distributed|processed))\b/iu.test(sentence)
    )) status = "completed";
    else if (/\b(?:we|i)(?:'ll| will| are going to| am going to| plan to)\s+(?:reset\b|(?:add|grant|issue|send|distribute|load)\s+(?:(?:an?|one|\d+|extra|new)\s+)*(?:banked\s+)?resets?(?!\s+(?:button|feature|option|API))\b)/iu.test(sentence)
      || /\b(?:we are|we're|i am|i'm)\s+(?:resetting\b|(?:adding|granting|issuing|sending|distributing|loading)\s+(?:(?:an?|one|\d+|extra|new)\s+)*(?:banked\s+)?resets?(?!\s+(?:button|feature|option|API))\b)/iu.test(sentence)
      || /\breset(?:s)?\b.{0,35}\b(?:will|coming|scheduled|landing)\b/iu.test(sentence)
      || /\b(?:usage|codex|chatgpt).{0,35}\b(?:will (?:be )?reset|are being reset)\b/iu.test(sentence)) status = "tentative";
    else continue;
    const resetType = /banked\s+reset|reset\s+count|reset\s+(?:credit|token)/iu.test(sentence) ? "banked" : "direct";
    const scope = ["Plus", "Pro", "Business", "Team", "Enterprise"].filter((name) => new RegExp(`\\b${name}\\b`, "i").test(body)).join("、") || (/all paid ChatGPT accounts/iu.test(body) ? "所有付费 ChatGPT 账户" : "未说明");
    const time = status === "tentative" ? extractResetTime(sentence, post.publishedAt) : null;
    const finalStatus = time ? "scheduled" : status;
    const summary = status === "completed" ? `作者宣布${resetType === "banked" ? "重置次数发放" : "重置"}已完成；当前账号到账仍需核验。`
      : status === "cancelled" ? "作者宣布取消相关重置。"
        : `作者预告${resetType === "banked" ? "发放重置次数" : "即将重置"}；${time ? "已提取原帖明确时间。" : "具体时间待确认。"}`;
    const event = { sourceUrl: post.sourceUrl, publishedAt: post.publishedAt, status: finalStatus, summary, scope,
      verification: "rss", feedUrl: RESET_RSS_SOURCE, evidence: excerpt(sentence), resetType,
      ...(time || {}), supersedes: ["completed", "cancelled"].includes(status) ? linked : [] };
    try { return normalizeResetAnnouncement(event, now); }
    catch {
      // Invalid/out-of-range date extraction cannot discard an otherwise clear promise.
      if (time) return normalizeResetAnnouncement({ ...event, status: "tentative", summary: "作者预告重置；原帖时间尚不能可靠换算。" }, now);
      return null;
    }
  }
  return null;
}
