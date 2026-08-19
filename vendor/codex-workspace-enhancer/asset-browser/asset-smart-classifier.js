import path from "node:path";

const SMART_GROUPS = new Set(["asset", "review", "noise"]);
const FORMAL_IMAGE_CATEGORIES = new Set(["角色", "场景", "道具", "分镜图"]);

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").toLocaleLowerCase("zh-CN");
}

function sequenceLikeName(filePath, pathApi = path) {
  const stem = pathApi.basename(filePath, pathApi.extname(filePath)).toLocaleLowerCase("zh-CN");
  return /(?:^|[_\-.])(?:frame|shot|thumb|screenshot|preview|extract|img)?[_\-.]*\d{3,}$/iu.test(stem)
    || /(?:帧|截图|缩略图)[_-]*\d{2,}$/u.test(stem);
}

export function buildImageSequenceProfiles(filePaths = [], pathApi = path) {
  const profiles = new Map();
  for (const filePath of filePaths) {
    const directory = pathApi.resolve(pathApi.dirname(filePath));
    const profile = profiles.get(directory) || { total: 0, sequenceLike: 0, density: 0 };
    profile.total += 1;
    if (sequenceLikeName(filePath, pathApi)) profile.sequenceLike += 1;
    profiles.set(directory, profile);
  }
  for (const profile of profiles.values()) {
    profile.density = profile.total ? profile.sequenceLike / profile.total : 0;
  }
  return profiles;
}

function inferFormalImageCategory(filePath) {
  const value = normalizedPath(filePath);
  const rules = [
    ["分镜图", [/(?:^|[/_.-])storyboards?(?:[/_.-]|$)/u, /分镜(?:图)?/u]],
    ["角色", [/(?:^|[/_.-])char(?:acter)?(?:[/_.-]|$)/u, /角色(?:图)?|人物(?:图)?|主角/u]],
    ["场景", [/(?:^|[/_.-])scenes?(?:[/_.-]|$)/u, /场景(?:图)?|环境(?:图)?/u]],
    ["道具", [/(?:^|[/_.-])props?(?:[/_.-]|$)/u, /道具(?:图)?/u]],
  ];
  return rules.find(([, patterns]) => patterns.some((pattern) => pattern.test(value)))?.[0] || "";
}

function noiseCategory(filePath, sequenceNoise) {
  const value = normalizedPath(filePath);
  if (/thumbnail|thumbs?|缩略图/u.test(value)) return "缩略图";
  if (/screenshot|截图/u.test(value)) return "截图";
  if (/contact[_-]?sheets?|联系表/u.test(value)) return "联系表";
  return sequenceNoise ? "视频解析帧" : "过程图";
}

function automaticResult({ smartGroup, category, autoTags, confidence, reason, tags = [] }) {
  return {
    smartGroup,
    category,
    tags,
    autoTags,
    confidence,
    reason,
    source: "local-rule",
    tokenCost: 0,
  };
}

export function classifyLocalAsset(
  { filePath, kind, metadata = {}, inferredCategory = "" } = {},
  { profiles = new Map(), pathApi = path } = {},
) {
  const manualTags = [...new Set((Array.isArray(metadata.tags) ? metadata.tags : [])
    .map((item) => String(item || "").trim()).filter(Boolean))];
  const manualCategory = String(metadata.category || "").trim();
  const manualGroup = SMART_GROUPS.has(metadata.smartGroup) ? metadata.smartGroup : "";
  if (manualGroup || manualCategory || manualTags.length) {
    const category = manualCategory || inferredCategory || (kind === "image" ? "参考图" : "其他");
    return {
      smartGroup: manualGroup || (kind === "image" && !FORMAL_IMAGE_CATEGORIES.has(category) ? "review" : "asset"),
      category,
      tags: manualTags,
      autoTags: [],
      confidence: 100,
      reason: "人工分类优先，自动整理不会覆盖",
      source: "manual",
      tokenCost: 0,
    };
  }

  if (kind !== "image") {
    return automaticResult({
      smartGroup: "asset",
      category: inferredCategory || "其他",
      autoTags: [],
      confidence: 100,
      reason: "非图片资产保留在正式资产分组",
    });
  }

  const normalized = normalizedPath(filePath);
  const directory = pathApi.resolve(pathApi.dirname(filePath));
  const profile = profiles.get(directory) || { total: 0, sequenceLike: 0, density: 0 };
  const denseSequence = profile.total >= 12 && profile.density >= 0.8;
  const explicitFramePath = /(?:^|\/)(?:frames?|second[_-]?frames?|video[_-]?frames?|extracted[_-]?frames?|final[_-]?frames?)(?:\/|$)|抽帧|截帧|视频帧/u.test(normalized);
  const explicitProcessPath = /(?:^|\/)(?:thumbnails?|contact[_-]?sheets?|screenshots?|rendered[_-]?reference|audit|temp|tmp|cache)(?:\/|$)|缩略图|联系表|审计图|过程图/u.test(normalized);
  if (denseSequence || explicitFramePath || explicitProcessPath) {
    const sequenceNoise = denseSequence || explicitFramePath;
    return automaticResult({
      smartGroup: "noise",
      category: noiseCategory(filePath, sequenceNoise),
      autoTags: sequenceNoise
        ? ["自动·视频解析帧", denseSequence ? "连续帧序列" : "解析帧目录"]
        : ["自动·干扰项", "过程产物"],
      confidence: denseSequence && explicitFramePath ? 99 : sequenceNoise ? 96 : 92,
      reason: denseSequence
        ? `同目录 ${profile.sequenceLike}/${profile.total} 张图片采用连续帧编号`
        : explicitFramePath
          ? "路径命中视频解析帧目录"
          : "路径命中缩略图、联系表或审计过程目录",
    });
  }

  const formalCategory = inferFormalImageCategory(filePath);
  if (formalCategory) {
    return automaticResult({
      smartGroup: "asset",
      category: formalCategory,
      autoTags: [`自动·${formalCategory}`, "正式资产"],
      confidence: 96,
      reason: `目录或文件名明确匹配${formalCategory}资产语义`,
    });
  }

  return automaticResult({
    smartGroup: "review",
    category: inferredCategory || "参考图",
    autoTags: ["自动·待确认", "信息不足"],
    confidence: 60,
    reason: "文件路径和名称不足以可靠判断资产用途",
  });
}
