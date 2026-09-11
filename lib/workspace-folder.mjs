import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const failure = (message) => Object.assign(new Error(message), { code: "WORKSPACE_FOLDER_UNAVAILABLE" });

// This input must come from the exact local session record, never the renderer.
export function describeWorkspaceFolder(record, { platform = process.platform } = {}) {
  const unavailable = (reason) => ({ available: false, path: null, parentPath: null, canRevealParent: false, reason });
  if (!record?.threadId || !record.projectPath) return unavailable("当前对话尚未关联本地文件夹。");
  if (!["darwin", "win32"].includes(platform)) return unavailable("当前系统暂不支持文件管理器入口。");
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directory = record.projectPath;
  if (typeof directory !== "string" || !pathApi.isAbsolute(directory) || /[\u0000-\u001f\u007f]/u.test(directory)
    || (platform === "win32" && (!/^[a-z]:[\\/]/iu.test(directory) || /["<>|?*]/u.test(directory)))) {
    return unavailable("该目录不是当前电脑上的可验证本地路径，无法打开。");
  }
  // Preserve the named directory (including symlinks), so reveal selects the
  // user's folder, not an unrelated realpath target elsewhere on disk.
  const folder = pathApi.normalize(directory);
  const parentPath = pathApi.dirname(folder);
  return { available: true, path: folder, parentPath, canRevealParent: parentPath !== folder, reason: "" };
}

export function workspaceFolderCommand(folder, mode, { platform = process.platform, env = process.env } = {}) {
  if (!["parent", "folder"].includes(mode)) throw failure("请选择打开母文件夹或子文件夹。");
  if (platform === "darwin") return { command: "/usr/bin/open", args: mode === "parent" ? ["-R", folder] : [folder] };
  if (platform === "win32") return {
    command: path.win32.join(env.SystemRoot || "C:\\Windows", "explorer.exe"),
    args: mode === "parent" ? ["/select,", folder] : [folder],
  };
  throw failure("当前系统暂不支持文件管理器入口。");
}

export async function openWorkspaceFolder({ record, mode, validateTarget }, {
  platform = process.platform, env = process.env, statPath = stat, launch = runFile,
} = {}) {
  const folder = describeWorkspaceFolder(record, { platform });
  if (!folder.available) throw failure(folder.reason);
  if (mode === "parent" && !folder.canRevealParent) throw failure("当前目录已是磁盘根目录，没有上级文件夹。");
  const command = workspaceFolderCommand(folder.path, mode, { platform, env });
  try {
    if (!(await statPath(folder.path)).isDirectory()) throw failure("关联路径不是文件夹，无法打开。");
  } catch (error) {
    if (error.code === "WORKSPACE_FOLDER_UNAVAILABLE") throw error;
    throw failure(error.code === "ENOENT" ? "文件夹不存在或已被移动，请检查当前对话的目录。" : "无法访问该文件夹，请检查磁盘连接和目录权限。");
  }
  // Revalidate after I/O and immediately before asking the OS to open anything.
  if (typeof validateTarget !== "function" || !await validateTarget()) throw failure("当前对话或所在目录已变化，请重新点击“打开文件”。");
  try { await launch(command.command, command.args, { shell: false, timeout: 8000, maxBuffer: 64 * 1024, windowsHide: false }); }
  catch { throw failure("文件管理器未确认打开，请检查系统状态后重试。"); }
  return { status: "requested", mode, path: folder.path,
    message: mode === "parent" ? "已请求在上级目录中选中当前文件夹。" : "已请求打开当前对话所在文件夹。" };
}
