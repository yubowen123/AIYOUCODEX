import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_GROUPS, presentSkillOrganization } from "./skill-groups.mjs";
import { managedShortcutsPath } from "./managed-shortcuts.mjs";
import { readEfficiencyJson, writeEfficiencyJson, withEfficiencyFileLock } from "./efficiency-store.mjs";
import { workspaceFolderCommand } from "./workspace-folder.mjs";
import { EfficiencyBridge } from "./efficiency-bridge.mjs";
import { createSkillDetailsReader } from "./skill-details.mjs";

const invalid = (message) => Object.assign(new Error(message), { code: "SKILLS_INPUT" });
const blank = () => ({ schemaVersion: 1, version: 0, groups: [], assignments: {} });
const skillIdValid = (id) => typeof id === "string" && /^skill:[a-f0-9]{64}$/u.test(id);
function groupLabel(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 24 || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid("分类名称请填写 1–24 个字符。");
  return value.trim().normalize("NFC");
}
function validateState(state) {
  if (state?.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || state.version < 0
    || !Array.isArray(state.groups) || state.groups.length > 24 || !state.assignments
    || typeof state.assignments !== "object" || Array.isArray(state.assignments)) throw invalid("分类配置无法读取，请检查本地配置；未覆盖原数据。");
  const ids = new Set(DEFAULT_GROUPS.map((group) => group.id));
  const labels = new Set(["全部", "常用", ...DEFAULT_GROUPS.map((group) => group.label)]);
  for (const group of state.groups) {
    const label = groupLabel(group?.label);
    if (!/^custom-[a-f0-9-]{36}$/u.test(group?.id) || ids.has(group.id) || labels.has(label)) throw invalid("分类配置有重复或无效分类。");
    ids.add(group.id); labels.add(label);
  }
  for (const [id, group] of Object.entries(state.assignments)) if (!skillIdValid(id) || !ids.has(group)) throw invalid("分类配置有无效的技能关联。");
  return state;
}

// Global, local-only preferences. Changing a group never changes SKILL.md or
// source folders. Lock + version prevent two Codex windows losing each other's edits.
export function createSkillOrganizationStore({ filePath = path.join(path.dirname(managedShortcutsPath()), "skills", "organization.json") } = {}) {
  const read = async () => validateState(await readEfficiencyJson(filePath, blank()));
  async function mutate(payload, catalog) {
    return withEfficiencyFileLock(filePath, async () => {
      const state = await read();
      if (payload.expectedVersion !== state.version) throw Object.assign(new Error("分类已在其他窗口修改，已保留原数据；请刷新后重试。"), { code: "SKILLS_CONFLICT" });
      if (["createGroup", "renameGroup"].includes(payload.action)) {
        const label = groupLabel(payload.label);
        if (["全部", "常用", ...DEFAULT_GROUPS.map((group) => group.label), ...state.groups.filter((g) => g.id !== payload.groupId).map((g) => g.label)]
          .some((existing) => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) throw invalid("已有同名分类，请使用其他名称。");
        if (payload.action === "createGroup") {
          if (state.groups.length >= 24) throw invalid("最多保留 24 个自定义分类，请先整理已有分类。");
          state.groups.push({ id: `custom-${randomUUID()}`, label });
        } else {
          const group = state.groups.find((group) => group.id === payload.groupId);
          if (!group) throw invalid("只能修改存在的自定义分类。");
          group.label = label;
        }
      } else if (payload.action === "deleteGroup") {
        if (!state.groups.some((group) => group.id === payload.groupId)) throw invalid("只能删除自定义分类。");
        state.groups = state.groups.filter((group) => group.id !== payload.groupId);
        for (const [id, group] of Object.entries(state.assignments)) if (group === payload.groupId) delete state.assignments[id];
      } else if (payload.action === "moveSkill") {
        if (!skillIdValid(payload.skillId) || !catalog.some((skill) => skill.id === payload.skillId)) throw invalid("未找到此 Skill 的准确来源，请刷新目录后重试。");
        if (payload.groupId === null) delete state.assignments[payload.skillId];
        else {
          if (![...DEFAULT_GROUPS, ...state.groups].some((group) => group.id === payload.groupId)) throw invalid("请选择有效的分类。");
          state.assignments[payload.skillId] = payload.groupId;
        }
      } else throw invalid("不支持的分类操作。");
      state.version += 1;
      await writeEfficiencyJson(filePath, validateState(state));
      return state;
    });
  }
  return { read, mutate, filePath };
}

export async function revealInstalledSkill(skill, { platform = process.platform, env = process.env,
  statPath = stat, realPath = realpath, launch = promisify(execFile) } = {}) {
  const file = skill?.skillFile;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!skillIdValid(skill?.id) || typeof file !== "string" || !pathApi.isAbsolute(file)
    || pathApi.basename(file) !== "SKILL.md" || /[\u0000-\u001f\u007f]/u.test(file)) throw invalid("未找到此 Skill 的准确文件，无法定位。");
  try {
    // Catalog files are canonical. Refuse a subsequently substituted symlink.
    if (!(await statPath(file)).isFile() || await realPath(file) !== file) throw new Error("changed");
  } catch { throw invalid("Skill 文件不存在、已移动或链接已改变，请刷新后重试。"); }
  let command;
  try { command = workspaceFolderCommand(file, "parent", { platform, env }); }
  catch { throw invalid("当前系统暂不支持定位文件。"); }
  try { await launch(command.command, command.args, { shell: false, timeout: 8000, maxBuffer: 64 * 1024, windowsHide: false }); }
  catch { throw invalid("文件管理器未确认打开，请检查系统状态后重试。"); }
  return { status: "requested", message: "已请求在所在文件夹中选中 SKILL.md。" };
}

const fields = {
  refresh: [], createGroup: ["expectedVersion", "label"], renameGroup: ["expectedVersion", "groupId", "label"],
  deleteGroup: ["expectedVersion", "groupId"], moveSkill: ["expectedVersion", "skillId", "groupId"], revealSkill: ["skillId"], describeSkill: ["skillId"], traceSkill: ["skillId"],
};
export function createSkillOrganizationController({ readCatalog, store = createSkillOrganizationStore(), reveal = revealInstalledSkill, describe = createSkillDetailsReader(), trace = async () => ({ status: "unassociated", message: "本地追溯服务尚未连接。" }) } = {}) {
  async function snapshot(catalog) {
    return presentSkillOrganization(catalog || await readCatalog(), await store.read());
  }
  async function request(payload) {
    if (!payload || !Object.hasOwn(fields, payload.action) || Object.keys(payload).some((key) => !["action", "requestId", ...fields[payload.action]].includes(key))) throw invalid("无效的分类请求；文件路径由已安装目录确定。");
    const catalog = await readCatalog({ refresh: payload.action === "refresh" });
    if (payload.action === "refresh") return snapshot(catalog);
    if (["revealSkill", "describeSkill", "traceSkill"].includes(payload.action)) {
      const skill = catalog.find((skill) => skill.id === payload.skillId);
      if (!skill) throw invalid("未找到此 Skill 的准确来源，请刷新目录后重试。");
      if (payload.action === "traceSkill") return { traceResult: await trace(skill, catalog) };
      return payload.action === "describeSkill" ? { skillDetails: await describe(skill) } : { revealResult: await reveal(skill) };
    }
    return presentSkillOrganization(catalog, await store.mutate(payload, catalog));
  }
  return { snapshot, request };
}

export class SkillOrganizationBridge extends EfficiencyBridge {
  constructor(controller) {
    super(controller, { binding: "__AIYOUCODEX_SKILLS_REQUEST__", resolver: "resolveSkillOrganizationRequest",
      publicErrorCodes: ["SKILLS_INPUT", "SKILLS_CONFLICT"], fallbackError: "分类操作未确认完成；请刷新核对，原有配置未主动清空。" });
  }
}
