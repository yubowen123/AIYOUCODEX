import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { frontmatterValue } from "./skill-catalog.mjs";

const MAX_BYTES = 65_536;
const unavailable = (message) => Object.assign(new Error(message), { code: "SKILLS_INPUT" });
const sectionsFor = {
  scenarios: /适用场景|使用场景|何时使用|适用范围|触发|when\s+to\s+use|use\s+cases?|triggers?|when\s+this\s+skill/i,
  usage: /使用方法|使用方式|使用流程|操作步骤|工作流|快速开始|执行流程|标准流程|how\s+to|usage|quick\s*start|workflow|instructions|getting\s+started|procedure/i,
  inputs: /输入要求|输入材料|所需材料|准备工作|prerequisites|required\s+inputs|^inputs?$/i,
  outputs: /交付物|输出结果|输出格式|最终交付|deliverables|^outputs?$/i,
};

// This is a local document preview, not a prompt. Neither source instructions,
// HTML, command examples nor linked references are executed or fetched.
export function summarizeSkillDocument(skill, source, { truncated = false } = {}) {
  const normalized = source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const body = normalized.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/u, "").trim();
  const lines = body.split("\n"), headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/u);
    if (heading) headings.push({ line: index, depth: heading[1].length, title: heading[2].replace(/[*_`]/gu, "").trim() });
  }
  const sections = {};
  for (const [key, pattern] of Object.entries(sectionsFor)) {
    const chosen = [];
    let consumedUntil = -1;
    for (const heading of headings) {
      if (heading.line < consumedUntil || !pattern.test(heading.title)) continue;
      const end = headings.find((next) => next.line > heading.line && next.depth <= heading.depth)?.line ?? lines.length;
      const text = lines.slice(heading.line + 1, end).join("\n").trim();
      if (text) chosen.push({ heading: heading.title, text: text.slice(0, 6000), truncated: text.length > 6000 });
      consumedUntil = end;
      if (chosen.length === 3) break;
    }
    sections[key] = chosen;
  }
  const description = frontmatterValue(normalized, "description") || skill.description || "";
  const firstParagraph = body.replace(/^#[^\n]*\n+/u, "").split(/\n\s*\n/u)[0] || "";
  return {
    skillId: skill.id, title: skill.title, name: skill.name, skillFile: skill.skillFile,
    overview: (description && description !== "打开查看 Skill 详情" ? description : firstParagraph).slice(0, 4000),
    ...sections, document: body.slice(0, 24_000), truncated: truncated || body.length > 24_000,
    method: "local-document", // No generated claims or model calls.
  };
}

const fingerprint = (info) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
export function createSkillDetailsReader({ openFile = open, realPath = realpath, statFile = stat } = {}) {
  const cache = new Map();
  return async (skill) => {
    const file = skill?.skillFile;
    if (typeof file !== "string" || !path.isAbsolute(file) || path.basename(file) !== "SKILL.md" || !/^skill:[a-f0-9]{64}$/u.test(skill?.id)) throw unavailable("此 Skill 尚无准确文件来源，请刷新目录后重试。");
    let handle;
    try {
      if (await realPath(file) !== file) throw unavailable("Skill 文件链接已改变，请刷新目录后重试。");
      const info = await statFile(file);
      if (!info.isFile()) throw unavailable("Skill 说明不是普通文件，无法展示。");
      const key = `${skill.id}:${fingerprint(info)}`;
      const saved = cache.get(skill.id);
      if (saved?.key === key) return { ...saved.value, title: skill.title, name: skill.name };
      handle = await openFile(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
      const opened = await handle.stat();
      if (!opened.isFile() || fingerprint(opened) !== fingerprint(info)) throw unavailable("Skill 文件正在更新，请稍后重试。");
      const buffer = Buffer.alloc(Math.min(MAX_BYTES, opened.size));
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (fingerprint(await handle.stat()) !== fingerprint(opened)) throw unavailable("Skill 文件正在更新，请稍后重试。");
      const source = buffer.subarray(0, count).toString("utf8").replace(/\uFFFD$/u, "");
      const value = summarizeSkillDocument(skill, source, { truncated: opened.size > count });
      cache.delete(skill.id); cache.set(skill.id, { key, value });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      return value;
    } catch (error) {
      cache.delete(skill.id);
      if (error.code === "SKILLS_INPUT") throw error;
      throw unavailable(error.code === "ENOENT" ? "Skill 文件不存在或已移动，请刷新目录后重试。" : "无法读取 Skill 说明，请检查文件权限后重试。");
    } finally { await handle?.close(); }
  };
}
