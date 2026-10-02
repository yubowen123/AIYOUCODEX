import { createHash } from "node:crypto";

const clean = (v, max = 80) => String(v || "").trim().replace(/[\u0000-\u001f]/gu, "").slice(0, max);
const variants = /(?:日常|战斗|觉醒|未觉醒|受伤|少年|青年|成年|老年|幼年|黑化|喜悦|愤怒|悲伤|微笑|哭泣|正面|侧面|背面|全身|半身|特写|三视图|立绘|设定|古装|现代|制服|礼服|睡衣|换装|写实|动漫|二次元|水墨|油画|赛博|像素|Q版|草图|定稿|状态|风格|版本|参考|造型|表情|姿态|动作|\b(?:front|side|back|outfit|anime|realistic|portrait|variant|v\d+)\b)/iu;
const generic = /^(?:角色|人物|角色图|人物图|角色设定|角色海报|主角|女主|男主|参考图|图片生成|生成图|画布图片|四宫格|九宫格|三视图|全身图|半身图|contact.?sheet|collage|grid|image|img|character|char|hero|portrait|exec|u\d+|[\d_]+|[^\p{L}\p{N}]+)$/iu;
const normalizedPath = v => String(v || "").replace(/\\/gu, "/");
const styleWords = /^(?:写实|动漫|二次元|水墨|油画|赛博|像素|Q版|草图|定稿|anime|realistic)$/iu;
export function hasSameCharacterInstruction(prompt) {
  return /(?:同一|同一个)\s*(?:角色|人物)|same\s+character|保持.{0,12}(?:角色|人物|身份|外貌)|(?:角色|人物).{0,12}(?:衍生|变体|换装)|(?:参考图|参考图片).{0,12}(?:角色|人物)/iu.test(String(prompt || ""));
}

function inferredVariants(asset, name) {
  const parts = String(asset.title || asset.name || "").replace(/\.[^.]+$/u, "").split(/[_—\-·\s]+/u);
  return { state: clean(parts.filter(p => p !== name && (variants.test(p) || /(?:服装|服|装|形态)$/u.test(p)) && !styleWords.test(p) && !generic.test(p)).join(" · ")),
    style: clean(parts.filter(p => styleWords.test(p)).join(" · ")) };
}

export function normalizeCharacterMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { name: clean(value.name), state: clean(value.state), style: clean(value.style),
    parentAssetId: clean(value.parentAssetId, 4096), excluded: value.excluded === true };
}

export function inferCharacterName(asset, association = {}) {
  if (asset.kind !== "image" || asset.smartGroup === "noise") return "";
  const explicit = String(association.prompt || "").match(/(?:角色名|人物名|character\s*name)\s*[:：=]\s*["“]?([^\n,，。;；"”]{1,40})/iu)?.[1];
  if (explicit && !generic.test(explicit.trim())) return clean(explicit, 40);
  const title = String(asset.title || asset.name || "").replace(/\.[^.]+$/u, "");
  const opaque = /^(?:exec[-_])?[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(title);
  if (asset.category !== "角色" && !/角色|人物|character/iu.test(title)) return "";
  const namedCanvas = title.match(/^(?:画布图片|角色图|人物图)(?:[-_]\d+){0,3}[-_]([^\s_—\-·]{1,20})(?:[-_]|$)/u)?.[1];
  if (namedCanvas && !generic.test(namedCanvas) && !variants.test(namedCanvas)) return clean(namedCanvas,40);
  const parts = title.replace(/^\d+[-_.\s]+/u, "").split(/[_—\-·\s]+/u).filter(Boolean);
  // Only a named identity next to explicit role/variant semantics qualifies.
  // Random generation IDs, portraits and aspect ratio alone never identify a role.
  if (!opaque && parts.length > 1 && parts.some(v => variants.test(v) || /^(?:角色|人物|character|char)$/iu.test(v))) {
    const name = parts.find(v => !variants.test(v) && !generic.test(v) && !/^[a-f\d]{8,}$/iu.test(v));
    if (name && [...name].length <= 40) return clean(name, 40);
  }
  const directory = normalizedPath(asset.directory || "").split("/").filter(Boolean).at(-1) || "";
  if (/角色|人物|characters?/iu.test(normalizedPath(asset.directory || "")) && directory
    && !generic.test(directory) && !variants.test(directory) && [...directory].length <= 20
    && (variants.test(title) || generic.test(title) || opaque)) return clean(directory, 40);
  return "";
}

export function characterGroupId(projectId, name) {
  return name ? `character:${createHash("sha256").update(`${projectId}\n${name.normalize("NFKC").toLocaleLowerCase("zh-CN")}`).digest("hex").slice(0, 24)}` : "";
}

export function deriveCharacterRelations(assets, { projectId = "", metadata = {}, associations = {} } = {}) {
  const byId = new Map(assets.map(a => [a.id, a]));
  const byPath = new Map(assets.filter(a => a.kind === "image").map(a => [normalizedPath(a.sourcePath), a]));
  const records = new Map();
  for (const asset of assets) {
    if (asset.kind !== "image") continue;
    const manual = normalizeCharacterMetadata(metadata[asset.sourcePath]?.character ?? asset.characterMeta);
    const association = associations[asset.sourcePath] || asset.characterEvidence || {};
    const name = manual ? manual.name : inferCharacterName(asset, association);
    const referenceIds = [...new Set((Array.isArray(association.references) ? association.references : [])
      .slice(0, 30).map(p => byPath.get(normalizedPath(p))?.id).filter(id => id && id !== asset.id))];
    let parent = manual?.parentAssetId && byId.get(manual.parentAssetId)?.kind === "image" ? manual.parentAssetId : "";
    const referenceDerived = !manual && referenceIds.length === 1 && (association.sameCharacter === true || hasSameCharacterInstruction(association.prompt));
    if (referenceDerived) parent = referenceIds[0];
    const inferred = name ? inferredVariants(asset, name) : { state: "", style: "" };
    records.set(asset.id, { name: manual?.excluded ? "" : name, state: manual ? manual.state : inferred.state, style: manual ? manual.style : inferred.style,
      parentAssetId: manual?.excluded ? "" : parent, candidateParentIds: manual?.excluded ? [] : referenceIds,
      source: manual ? "manual" : referenceDerived ? "reference-rule" : name ? "name-rule" : referenceIds.length ? "reference-candidate" : "unidentified",
      excluded: Boolean(manual?.excluded), groupId: "", count: 0, baseAssetId: "", depth: 0 });
  }
  // Resolve bounded parent chains, including unnamed children, without recursion.
  for (const [id, record] of records) {
    if (record.excluded) continue;
    let cursor = record, seen = new Set([id]), depth = 0;
    while (cursor.parentAssetId && depth < 64) {
      if (seen.has(cursor.parentAssetId)) { record.parentAssetId = ""; break; }
      seen.add(cursor.parentAssetId);
      const next = records.get(cursor.parentAssetId);
      if (!next || next.excluded || (record.name && next.name && record.name !== next.name)) { record.parentAssetId = ""; break; }
      if (!record.name && next.name) record.name = next.name;
      cursor = next; depth++;
    }
    record.depth = depth;
    record.groupId = characterGroupId(projectId, record.name);
  }
  const families = new Map();
  for (const [id, r] of records) {
    if (!r.groupId) continue;
    const family = families.get(r.groupId) || [];
    family.push(id); families.set(r.groupId, family);
    // A sole reference corroborates a known identity but does not identify an unnamed image.
    if (!r.parentAssetId && r.candidateParentIds.length === 1) {
      const parent = records.get(r.candidateParentIds[0]);
      const parentId = r.candidateParentIds[0];
      const earlier = (Number(byId.get(parentId)?.mtimeMs) || 0) < (Number(byId.get(id)?.mtimeMs) || 0)
        || (byId.get(parentId)?.mtimeMs === byId.get(id)?.mtimeMs && parentId.localeCompare(id) < 0);
      if (parent?.name === r.name && !parent.excluded && earlier) r.parentAssetId = parentId;
    }
  }
  for (const ids of families.values()) {
    const base = ids.filter(id => !records.get(id).parentAssetId).sort((a,b) =>
      Number(byId.get(a).mtimeMs) - Number(byId.get(b).mtimeMs) || a.localeCompare(b))[0] || ids[0];
    for (const id of ids) { records.get(id).count = ids.length; records.get(id).baseAssetId = base; }
  }
  return assets.map(asset => asset.kind === "image" ? { ...asset, character: records.get(asset.id) } : asset);
}

export function keepCharacterFamiliesAdjacent(sortedAssets) {
  const families = new Map();
  for (const asset of sortedAssets) {
    const key = asset.character?.groupId;
    if (key) { const items = families.get(key) || []; items.push(asset); families.set(key, items); }
  }
  const result = [], emitted = new Set();
  for (const asset of sortedAssets) {
    const key = asset.character?.groupId;
    if (!key) { result.push(asset); continue; }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const ordered = families.get(key).sort((a,b) => Number(b.id === b.character.baseAssetId) - Number(a.id === a.character.baseAssetId)
      || a.character.depth - b.character.depth);
    for (const member of ordered) result.push(member);
  }
  return result;
}
