const DEFAULT_GROUPS = [
  { id: "video", label: "视频创作", keywords: ["视频", "影像", "seedance", "即梦", "minimax", "剪辑", "节奏", "音乐", "音效", "mv", "生成"] },
  { id: "directing", label: "导演镜头", keywords: ["导演", "镜头", "分镜", "动作", "摄影", "表演", "角色", "转场", "vfx", "特效"] },
  { id: "visual", label: "画面风格", keywords: ["风格", "美学", "视觉", "画面", "图像", "灯光", "材质", "构图", "色彩", "写实"] },
  { id: "assets", label: "资产工作台", keywords: ["资产", "素材", "工作台", "归档", "账本", "管线", "codex", "知识卡", "下载", "清理"] },
  { id: "writing", label: "写作研究", keywords: ["写作", "研究", "知识", "文章", "公众号", "小红书", "脚本", "语义", "阅读", "剧本"] },
  { id: "tools", label: "工具管理", keywords: ["工具", "管理", "浏览器", "网页", "数据", "表格", "文档", "安装", "审计", "测试", "调试", "skill", "codex", "plugin"] },
];

function stringList(value, { maxItems = 128, maxLength = 512 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength)).filter(Boolean))];
}

/** User keywords are literal substrings, never regular expressions or executable rules. */
export function normalizeSkillGroups(config = {}) {
  const input = Array.isArray(config?.groups) ? config.groups
    : Array.isArray(config?.categories) ? config.categories : DEFAULT_GROUPS;
  const groups = [{ id: "common", label: "常用", keywords: [], builtin: true }];
  const ids = new Set(["common", "all"]);
  const labels = new Set(["常用", "全部"]);
  for (const raw of input.slice(0, 32)) {
    if (!raw || typeof raw !== "object") continue;
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 40) : "";
    const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 64) : label;
    const keywords = stringList(raw.keywords, { maxItems: 64, maxLength: 80 });
    if (!id || !label || ids.has(id) || labels.has(label) || !keywords.length) continue;
    groups.push({ id, label, keywords, builtin: false });
    ids.add(id); labels.add(label);
  }
  groups.push({ id: "all", label: "全部", keywords: [], builtin: true });
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
