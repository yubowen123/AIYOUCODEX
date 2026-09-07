import { createHash } from "node:crypto";
import { normalizeEfficiencyContext, validateEfficiencyThreadId } from "./efficiency-store.mjs";

const FIELDS = ["goal", "progress", "nextStep", "agreements", "references"];
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARACTERS = 6000;
const CONFIRMATION = /^(?:好(?:的|吧)?|可以|行|继续(?:执行|做|这个任务)?|确认(?:执行|保存)?|按这个(?:做|执行)|就这么做|开始(?:吧|执行)?|执行(?:吧)?|收到|没问题|嗯+|对(?:的)?|是(?:的)?|ok|yes|thanks|thank you)[\s。！!，,～~]*$/iu;
const INJECTION = /(?:忽略|无视)(?:之前|此前|以上|所有|系统|安全).*(?:指令|规则|限制)|ignore\s+(?:all|previous|prior|system).*instructions|(?:泄露|输出|发送|上传).*(?:API\s*[ _-]?key|密钥|密码)|(?:system|developer)\s*(?:prompt|message)\s*:/iu;
const REQUEST = /我(?:想|要|希望)|希望|目标|需求|请|帮我|需要|实现|修复|优化|增加|生成|构建|分析|检查|整理|安装|同步|更新|重构|完善|接入|支持|build|create|fix|implement|please|goal|requirement/iu;
const GOAL_CHANGE = /(?:当前|本次|这次|现在)(?:的)?目标|目标(?:改为|调整为|变为)|这次(?:只|要)|改为|instead\s+(?:build|create|implement)|new goal/iu;
const AGREEMENT = /不要|禁止|必须|仅(?:限|在|允许|支持)|只(?:读|在|能|允许|修改|保留|使用|做|生成)|保留|不能|不允许|先不|暂不|默认|确认后|未经|不得|请勿|不上传|不发送|别(?:改|动|删|发|上传)|must(?: not)?\b|do not\b|only\b|preserve\b|without approval/iu;
const USER_FAILURE = /(?:仍|还是|又|依然).*(?:报错|失败|不对|有问题|没有|缺少|不行|重复|崩溃|打不开)|(?:无法|不能|没法|未能|没有)(?:打开|启动|加载|保存|找到|生效|恢复)|缺少|丢失|崩溃|报错|没修好|没解决|not working|still broken|failed|missing|crash/iu;
const HYPOTHETICAL = /如果|假如|例如|比如|会不会|怎么避免|可能|预期|计划|whether|if\b|might\b|for example/iu;
const STOP = /先(?:不|别|不要)|暂(?:不|停)|不要执行|停止|不用(?:继续|修改|执行)|未经.*确认|do not execute|stop\b|pause\b/iu;
const PLAN = /^(?:下一步(?:建议)?|接下来|后续|待办|建议(?:方向)?|计划|todo|next(?: step)?)[\s：:]|(?:下一步|接下来)(?:我会|将|要|可以|先)|^(?:我会|将会|建议先|建议进行|建议增加|I will\b|we will\b)/iu;
const LEADING_INTENT = /^(?:我(?:们)?(?:先(?!前)|来|会|将|准备|计划|打算)|先(?:查|看|检|核|分析|整理|运行|执行|修复|确认))/u;
const GENERIC_COMPLETE = /全部(?:已)?完成|所有(?:任务|工作|项目).*(?:已完成|完成了)|都已完成|everything is done|all (?:tasks|work) (?:are |is )?(?:complete|done)/iu;
const KNOWN_HEADER = /^#{0,6}\s*(?:AGENTS\.md|Codex Global Rules|系统提示|开发者指令|工具输出|system instructions|developer instructions)(?:\s|$)/iu;

function limit(value, maximum) {
  if (value.length <= maximum) return value;
  let clipped = value.slice(0, maximum - 1);
  if (/[\uD800-\uDBFF]$/u.test(clipped)) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}
function clean(value, warnings) {
  if (typeof value !== "string") return "";
  if (value.length > MAX_MESSAGE_CHARACTERS) warnings.add("部分长消息已按本地预算截取；本草稿不代表完整历史。");
  let input = value.slice(0, MAX_MESSAGE_CHARACTERS).replace(/\r\n?/gu, "\n");
  const before = input;
  if (KNOWN_HEADER.test(input.trimStart())) {
    warnings.add("已忽略系统/工具样式的完整记录；它不是用户任务事实来源。");
    return "";
  }
  input = input
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .replace(/<(script|style|iframe|object|blockquote|code|pre|system|developer|tool|tool_response|instructions|untrusted_text|environment_context|app-context|skills_instructions|permissions|recommended_plugins)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, "")
    .replace(/&lt;(script|system|developer|tool)\b[\s\S]*?(?:&lt;\/\1\s*&gt;|$)/giu, "")
    .replace(/<[^>\n]*>/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/giu, "[已移除敏感值]")
    .replace(/((?:api[ _-]?key|access[ _-]?token|token|secret|password|密钥|密码)\s*[:=：]\s*)["']?[^\s"'，,；;。&<]+/giu, "$1[已移除敏感值]");
  let fence = null;
  let quotedBlock = false;
  const lines = [];
  for (const line of input.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (fence.character === marker[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    if (!line.trim()) { quotedBlock = false; lines.push(""); continue; }
    if (/^\s*(?:>|\[?(?:system|developer|tool)\]?\s*[:：])/iu.test(line) || /^(?: {4}|\t)/u.test(line)) continue;
    if (/^\s*[“"'「『].*[”"'」』][。.!！]?\s*$/u.test(line)) continue;
    if (/^(?:(?:以下|下面).*(?:引用|网页内容|工具输出|日志内容|提示词样例)|(?:引用|网页原文|工具输出)[：:]|.*(?:提示词|引用|原文|网页).*(?:写着|如下|内容为|内容是)[：:])/u.test(line.trim()) || KNOWN_HEADER.test(line.trim())) { quotedBlock = true; continue; }
    if (quotedBlock || INJECTION.test(line)) continue;
    lines.push(line.trim());
  }
  const result = lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (result !== before.trim()) warnings.add("已过滤代码块、引用、工具/系统样式内容或不安全标记；被过滤内容不会成为执行依据。");
  return result;
}
function phaseOf(line, section = "") {
  // "已安装的技能" can describe an object being inspected, not completed work.
  // An explicit leading intention wins over completion words later in that line.
  if (LEADING_INTENT.test(line)) return "plan";
  if ((PLAN.test(line) || section === "plan") && !/已(?:经)?(?:完成|验证|测试|修复|执行)/u.test(line)) return "plan";
  if (/尚不确定|不知道|无法确认|无法判断|未经验证|未核实|未核验/iu.test(line)) return "uncertain";
  if (/未(?:完成|验证|测试|解决)|没(?:有)?(?:验证|测试|试过|完成|检查)|尚未|失败|阻塞|报错|不通过|无法|待确认|待验证|blocked|failed|not (?:tested|verified|complete)/iu.test(line)) return "blocked";
  if (/可能|推测|似乎|预计|估计|不确定|猜测|maybe|probably|appears|estimate/iu.test(line)) return "uncertain";
  if (PLAN.test(line)) return "plan";
  if (/正在|进行中|检查中|处理中|已(?:开始|启动)|in progress|working on/iu.test(line)) return "running";
  if (GENERIC_COMPLETE.test(line) || /已(?:经)?(?:完成|修复|实现|增加|安装|更新|生成|验证|测试|恢复|同步|提交|保存)|(?:测试|验证|检查).*(?:通过|成功)|(?:完成|修复|实现|增加|安装|更新|生成|验证|测试|恢复|同步|提交|保存)(?:了|完成|成功)|completed|implemented|fixed|tests? passed/iu.test(line)) return "done";
  return section;
}
function fragments(message) {
  let section = "";
  let heading = "";
  const result = [];
  for (const sourceLine of message.text.split("\n")) {
    const line = sourceLine.replace(/^#{1,6}\s*/u, "").replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/u, "").replace(/\*\*([^*]+)\*\*/gu, "$1").trim();
    if (!line) continue;
    if (/^(?:已完成|完成情况|验证结果|当前进度|失败|阻塞|未完成|下一步|接下来|建议(?:方向)?|计划|待办|todo|next step)[：:]?$/iu.test(line)) {
      section = /已完成|完成情况|验证结果/u.test(line) ? "done" : /失败|阻塞|未完成/u.test(line) ? "blocked" : /当前进度/u.test(line) ? "running" : "plan";
      heading = sourceLine;
      continue;
    }
    if (/^#{1,6}\s/u.test(sourceLine)) { section = ""; heading = ""; }
    for (const sentence of line.split(/(?<=[。！？!?；;])\s*/u).filter(Boolean)) {
      result.push({ message, text: sentence.trim(), excerpt: heading ? `${heading}\n${sourceLine}` : sourceLine, phase: phaseOf(sentence, section) });
    }
  }
  return result;
}
function reference(value) {
  const candidate = value.trim().replace(/^<|>$/gu, "").replace(/[。；，、！!.,;]+$/gu, "");
  if (!candidate || candidate.length > 500 || /[<>\u0000-\u001f]/u.test(candidate)) return null;
  if (/^https?:\/\//iu.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => /^(?:api[-_]?key|token|secret|password|authorization)$/iu.test(key))) return null;
      return candidate;
    } catch { return null; }
  }
  if (/^(?:javascript|data|file|vbscript):/iu.test(candidate)) return null;
  if (!/\.[a-z0-9]{1,8}$/iu.test(candidate) || /[|;&]/u.test(candidate)) return null;
  return /^(?:[a-z]:[\\/]|\/|\.\.?\/|[\p{L}\p{N}_.-]+[\\/])/iu.test(candidate) ? candidate : null;
}
function referencesFrom(message) {
  const values = [];
  const add = (raw) => { const normalized = reference(raw); if (normalized && !values.includes(normalized)) values.push(normalized); };
  for (const match of message.text.matchAll(/\[[^\]\n]{1,160}\]\(([^)\n]+)\)/gu)) add(match[1]);
  for (const match of message.text.matchAll(/https?:\/\/[^\s<>"'`\])]+|(?:[a-z]:[\\/]|\/|\.\.?\/|[\p{L}\p{N}_.-]+[\\/])[^\s<>"'`\])]+\.[a-z0-9]{1,8}/giu)) add(match[0]);
  return values.slice(0, 12);
}
function provenance(field, fragment) {
  const message = fragment.message;
  return { field, kind: "history", messageId: message.id, role: message.role, timestamp: message.timestamp,
    excerpt: limit(fragment.excerpt || fragment.text, 1200) };
}

/** Local extraction only: no model, I/O, implicit save or execution authorization. */
export function buildContextDraft({ threadId, title = "", history = [], savedContext = {} } = {}) {
  validateEfficiencyThreadId(threadId);
  if (!Array.isArray(history)) throw new TypeError("history must be an array");
  const warnings = new Set(["本地提取草稿，待用户确认；不是额外模型总结，不代表任务已验收或建议已获执行授权。"]);
  if (history.length > MAX_MESSAGES) warnings.add("仅使用最近 40 条输入记录；更早历史不在本次草稿范围。");
  const messages = history.slice(-MAX_MESSAGES).flatMap((entry, index) => {
    if (!entry || !["user", "assistant"].includes(entry.role)) return [];
    if (entry.threadId !== undefined && entry.threadId !== threadId) { warnings.add("已忽略不属于当前对话的历史记录。"); return []; }
    const body = clean(typeof entry.text === "string" ? entry.text : typeof entry.content === "string" ? entry.content : "", warnings);
    if (!body) return [];
    const time = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    return [{ id: typeof entry.id === "string" && /^[a-z0-9._:-]{1,128}$/iu.test(entry.id) ? entry.id : `entry-${index}`,
      role: entry.role, timestamp: Number.isFinite(time) ? new Date(time).toISOString() : null, text: body, index }];
  });
  const safeTitle = limit(clean(title, warnings).replace(/\n+/gu, " "), 180);
  const supplied = savedContext && typeof savedContext === "object" && !Array.isArray(savedContext) ? savedContext : {};
  const saved = normalizeEfficiencyContext(Object.fromEntries(FIELDS.filter((field) => supplied[field] !== undefined).map((field) => [field, supplied[field]])));
  const context = structuredClone(saved);
  const sources = [];
  for (const field of FIELDS) if (context[field].length) {
    warnings.add("已保存的非空字段优先保留；新草稿不会自动覆盖原有记录。");
    const values = Array.isArray(context[field]) ? context[field] : [context[field]];
    const savedTimestamp = typeof supplied.updatedAt === "string" && Number.isFinite(Date.parse(supplied.updatedAt)) ? new Date(supplied.updatedAt).toISOString() : null;
    for (const value of values) sources.push({ field, kind: "saved", role: "user-confirmed-record", timestamp: savedTimestamp, excerpt: limit(value, 1200) });
  }
  const parts = messages.flatMap(fragments);
  const userParts = parts.filter((part) => part.message.role === "user");
  const requests = userParts.filter((part) => part.text.length >= 8 && !CONFIRMATION.test(part.text) && REQUEST.test(part.text));
  if (!context.goal) {
    const goal = requests.filter((part) => GOAL_CHANGE.test(part.text)).at(-1) || requests.find((part) => part.text.length >= 12) || requests[0];
    const usefulTitle = safeTitle && !/^(?:新对话|新任务|未命名|new chat|untitled)$/iu.test(safeTitle);
    context.goal = limit([usefulTitle ? `任务：${safeTitle}` : "", goal ? `用户目标：${goal.text}` : ""].filter(Boolean).join("\n"), 600);
    if (usefulTitle) sources.push({ field: "goal", kind: "title", excerpt: safeTitle });
    if (goal) sources.push(provenance("goal", goal));
  }
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && !CONFIRMATION.test(message.text));
  const latestFeedback = [...userParts].reverse().find((part) => USER_FAILURE.test(part.text) && !HYPOTHETICAL.test(part.text));
  if (!context.progress) {
    const reports = latestAssistant ? parts.filter((part) => part.message === latestAssistant && ["done", "blocked", "uncertain", "running"].includes(part.phase)) : [];
    const feedbackIsNewer = latestFeedback && (!latestAssistant || latestFeedback.message.index > latestAssistant.index);
    if (feedbackIsNewer) {
      context.progress = limit(`用户最新反馈（待核验）：${latestFeedback.text}`, 1200);
      sources.push(provenance("progress", latestFeedback));
      if (reports.length) warnings.add("最新用户反馈指出仍有问题；没有将更早的助手完成报告当作当前完成状态。");
    } else {
      const eligible = reports.filter((part) => {
        if (GENERIC_COMPLETE.test(part.text)) { warnings.add("笼统的历史全部完成报告未转为当前全局完成状态。"); return false; }
        return true;
      }).slice(-4);
      const labels = { done: "助手报告·已做（待核验）", blocked: "助手报告·失败/阻塞（待核验）", running: "助手报告·进行中", uncertain: "助手推测（未证实）" };
      context.progress = limit(eligible.map((part) => `${labels[part.phase]}：${limit(part.text, 240)}`).join("\n"), 1200);
      for (const part of eligible) sources.push(provenance("progress", part));
    }
  }
  if (!context.nextStep) {
    const explicit = [...userParts].reverse().find((part) => PLAN.test(part.text));
    let suggested = [...parts].reverse().find((part) => part.message.role === "assistant" && part.phase === "plan" && !GENERIC_COMPLETE.test(part.text));
    const newerRequest = requests.at(-1);
    if (suggested && newerRequest && newerRequest.message.index > suggested.message.index) suggested = null;
    const stop = [...userParts].reverse().find((part) => STOP.test(part.text));
    const candidate = stop && (!suggested || stop.message.index > suggested.message.index) ? stop
      : explicit && (!suggested || explicit.message.index >= suggested.message.index) ? explicit
        : suggested || (newerRequest && (!latestAssistant || newerRequest.message.index > latestAssistant.index) ? newerRequest : null);
    if (candidate) {
      context.nextStep = limit(`${candidate.message.role === "assistant" ? "助手建议（待确认，未授权执行）" : "用户提出的下一步（待确认）"}：${candidate.text}`, 600);
      sources.push(provenance("nextStep", candidate));
    }
  }
  if (!context.agreements.length) {
    const constraints = [...userParts].reverse().filter((part) => AGREEMENT.test(part.text) && !CONFIRMATION.test(part.text));
    for (const part of constraints) {
      const agreement = limit(part.text, 300);
      if (!context.agreements.includes(agreement)) { context.agreements.push(agreement); sources.push(provenance("agreements", part)); }
      if (context.agreements.length >= 8) break;
    }
  }
  if (!context.references.length) {
    for (const message of [...messages].reverse()) {
      for (const value of referencesFrom(message)) {
        if (context.references.includes(value)) continue;
        context.references.push(value);
        sources.push(provenance("references", { message, text: value }));
        if (context.references.length >= 8) break;
      }
      if (context.references.length >= 8) break;
    }
  }
  // Preserve saved fields exactly while reducing only newly drafted lists if the
  // combined total reaches the store's 8192-character persistence envelope.
  while (JSON.stringify(context).length > 8192) {
    const field = ["references", "agreements"].find((key) => !saved[key].length && context[key].length);
    if (field) context[field].pop();
    else {
      const shortenable = ["progress", "nextStep", "goal"].find((key) => !saved[key] && context[key]);
      if (!shortenable) throw new TypeError("Saved context leaves insufficient room for a bounded draft");
      context[shortenable] = "";
    }
    warnings.add("新增参考条目已按保存预算缩减；原有记录未改变。");
  }
  const normalized = normalizeEfficiencyContext(context);
  const revisionData = { method: "local-extractive-v1", threadId, title: safeTitle,
    history: messages.map(({ index: _index, ...message }) => message), saved,
    savedVersion: Number.isSafeInteger(supplied.version) ? supplied.version : 0 };
  const sourceRevision = createHash("sha256").update(JSON.stringify(revisionData)).digest("hex");
  return { context: normalized, sourceRevision, sources: sources.slice(0, 48), method: "local-extractive",
    warnings: [...warnings], hasContent: FIELDS.some((field) => normalized[field].length > 0) };
}
