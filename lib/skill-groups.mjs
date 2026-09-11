export const DEFAULT_GROUPS = Object.freeze([
  { id: "video", label: "影视分镜", keywords: ["视频", "导演", "分镜", "电影", "video", "storyboard"] },
  { id: "visual", label: "图像设计", keywords: ["图片", "图像", "美术", "设计", "image", "design"] },
  { id: "audio", label: "音频音乐", keywords: ["音频", "音乐", "配音", "音效", "audio", "music"] },
  { id: "writing", label: "写作研究", keywords: ["剧本", "写作", "文章", "研究", "screenplay", "research"] },
  { id: "office", label: "办公协作", keywords: ["钉钉", "飞书", "文档", "表格", "演示", "document", "spreadsheet"] },
  { id: "tools", label: "开发工具", keywords: ["代码", "开发", "安装", "调试", "code", "debug"] },
].map((group) => Object.freeze({ ...group, keywords: Object.freeze(group.keywords) })));

// Specific identity/title signals precede broad descriptions. Each skill has
// one primary category; unknown capabilities remain visible in tools + all.
const RULES = [
  ["office", /dingtalk|钉钉|feishu|飞书|(?:^|\s)dws(?:\s|$)|spreadsheet|document|presentation|\bpdf\b|excel|slides|taskboard|任务看板|办公|文档|表格|演示文稿|artifact-template/i],
  ["tools", /code-review|code review|开发|调试|debug|testing|test-driven|verification|skill-(?:creator|installer|replicator)|writing-skills|plugin-(?:creator|management)|openai-docs|git-worktree|development|backend|编程|安装|skills?生成|skill生成|browser|浏览器|sites-|system-design/i],
  ["writing", /screenplay|script-writing|script-analysis|剧本|juben|写作|改写|文章|copywriting|research|研究|outline|大纲|worldview|创意采集|creative-input|播客转写|podcast-to-article|to-article|^guangbo$|hot-content|热点内容|strategy|报告/i],
  ["audio", /music|audio|voice|transcription|suno|podcast|音乐|音频|配音|音效|播客|转写/i],
  ["visual", /image|图像|图片|生图|出图|mj(?:skills|-casting)|midjourney|visualize|knowledge-card|知识卡片|design|设计|美术|art-concept|style-library|character-scene|角色与场景|视觉资产|mv-asset|aiyou-asset|banner|blender|brand|品牌/i],
  ["video", /video|视频|电影|短剧|漫剧|导演|分镜|镜头|影像|剪辑|seedance|cinema|storyboard|visual-prompts|ai-film|director|drama|aimv|talking-head|digital-human|multicam|motion-graphics|字幕|转场/i],
];

export function automaticSkillCategory(skill) {
  const identity = `${skill?.name || ""} ${skill?.title || ""}`;
  // MV orchestration makes a video, despite containing the word music.
  if (/aimv-(?:orchestrator|mv-video|mv-storyboard)/i.test(identity)) return "video";
  if (/director-style-art-concept/i.test(skill?.path || "")) return "visual";
  if (/^audio|audio-storyboard/i.test(skill?.name || "")) return "audio";
  if (/storyboard|^chatcut-plugin-basics$|^export$|^asset-import$/i.test(skill?.name || "")) return "video";
  for (const [id, pattern] of RULES) if (pattern.test(skill?.name || "")) return id;
  for (const [id, pattern] of RULES) if (pattern.test(skill?.title || "")) return id;
  for (const [id, pattern] of RULES) if (pattern.test(skill?.description || "")) return id;
  return "tools";
}

export function presentSkillOrganization(catalog, state = {}) {
  const groups = [
    { id: "all", label: "全部", builtin: true }, { id: "common", label: "常用", builtin: true },
    ...DEFAULT_GROUPS.map(({ id, label }) => ({ id, label, builtin: true })),
    ...(state.groups || []).map(({ id, label }) => ({ id, label, builtin: false })),
  ];
  const primaryIds = new Set(groups.slice(2).map((group) => group.id));
  return { version: state.version || 0, groups, catalog: catalog.map((skill) => {
    const automaticCategoryId = automaticSkillCategory(skill);
    const manual = state.assignments?.[skill.id];
    return { ...skill, automaticCategoryId, categoryId: primaryIds.has(manual) ? manual : automaticCategoryId,
      classificationSource: primaryIds.has(manual) ? "manual" : "automatic" };
  }) };
}

function stringList(value, { maxItems = 128, maxLength = 512 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength)).filter(Boolean))];
}

/** User keywords are literal substrings, never regular expressions or executable rules. */
export function normalizeSkillGroups(config = {}) {
  const input = Array.isArray(config?.groups) ? config.groups
    : Array.isArray(config?.categories) ? config.categories : DEFAULT_GROUPS;
  const groups = [{ id: "all", label: "全部", keywords: [], builtin: true }, { id: "common", label: "常用", keywords: [], builtin: true }];
  const ids = new Set(["common", "all"]);
  const labels = new Set(["常用", "全部"]);
  for (const raw of input.slice(0, 32)) {
    if (!raw || typeof raw !== "object") continue;
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 40) : "";
    const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 64) : label;
    const keywords = stringList(raw.keywords, { maxItems: 64, maxLength: 80 });
    if (!id || !label || ids.has(id) || labels.has(label)) continue;
    groups.push({ id, label, keywords, builtin: false });
    ids.add(id); labels.add(label);
  }
  return { groups, defaultFavorites: stringList(config?.defaultFavorites, { maxItems: 128, maxLength: 2_048 }) };
}

export function skillMatchesGroup(skill, group, favorites = []) {
  if (group?.id === "all") return true;
  if (group?.id === "common") return (favorites instanceof Set ? favorites : new Set(Array.isArray(favorites) ? favorites : [])).has(skill?.id);
  const text = `${skill?.name || ""} ${skill?.title || ""} ${skill?.description || ""}`.toLocaleLowerCase();
  return stringList(group?.keywords, { maxItems: 64, maxLength: 80 })
    .some((keyword) => text.includes(keyword.toLocaleLowerCase()));
}

/** Preserve exact identities; migrate a legacy name/title only when it is unambiguous. */
export function resolveSkillFavorites(values, catalog) {
  const skills = Array.isArray(catalog) ? catalog : [];
  const ids = new Set(skills.map((skill) => skill.id).filter(Boolean));
  const resolved = new Set();
  for (const value of stringList(values, { maxItems: 128, maxLength: 2_048 })) {
    if (ids.has(value)) { resolved.add(value); continue; }
    const matches = skills.filter((skill) => [skill.skillFile, skill.path, skill.name, skill.title].includes(value));
    if (matches.length === 1 && matches[0].id) resolved.add(matches[0].id);
  }
  return [...resolved];
}
