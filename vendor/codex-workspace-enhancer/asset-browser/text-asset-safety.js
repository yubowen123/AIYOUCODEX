import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const saveQueues = new Map();
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export function textEditPolicy(filePath, bytes) {
  const extension = path.extname(filePath).toLowerCase();
  let editable = [".md", ".markdown", ".txt"].includes(extension);
  if (editable && bytes) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (bytes.includes(0)) throw new Error("non-text encoding");
    } catch {
      return { editable: false, editableReason: "该文件不是可安全编辑的 UTF-8 文本（可能为 UTF-16、其他编码或二进制内容）。仅供预览，请使用系统编辑器修改，以保留原始编码。" };
    }
  }
  return {
    editable,
    editableReason: editable ? "" : [".docx", ".doc", ".rtf"].includes(extension)
      ? "该文档仅预览。请使用 Word 或系统编辑器修改，以保留表格、图片和格式；资产控制台不会覆盖原件。"
      : "该文件格式暂不支持直接编辑。",
  };
}

export function textContentRevision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export function savePlainTextAsset(filePath, { content, expectedRevision } = {}) {
  const key = path.resolve(filePath);
  const operation = (saveQueues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const policy = textEditPolicy(key);
    if (!policy.editable) throw Object.assign(new Error(policy.editableReason), { statusCode: 415 });
    if (!expectedRevision) throw conflict("缺少文件版本，请重新打开文本后再保存。");
    const stats = await fs.lstat(key);
    if (!stats.isFile() || stats.isSymbolicLink()) throw conflict("文件类型已改变，请重新打开。");
    if (stats.size > MAX_TEXT_BYTES) throw Object.assign(new Error("文本文件超过 5MB，无法保存。"), { statusCode: 413 });
    const original = await fs.readFile(key);
    const encodingPolicy = textEditPolicy(key, original);
    if (!encodingPolicy.editable) throw Object.assign(new Error(encodingPolicy.editableReason), { statusCode: 415 });
    if (textContentRevision(original) !== expectedRevision) throw conflict("文件已被其他程序修改，请重新打开后再编辑，避免覆盖新内容。");
    const hasBom = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    const input = String(content ?? "");
    const bytes = Buffer.from(hasBom && !input.startsWith("\uFEFF") ? `\uFEFF${input}` : input, "utf8");
    if (bytes.length > MAX_TEXT_BYTES) throw Object.assign(new Error("文本内容超过 5MB，无法保存。"), { statusCode: 413 });
    if (bytes.equals(original)) return { size: bytes.length, revision: expectedRevision, changed: false };
    const id = randomUUID();
    const temporary = path.join(path.dirname(key), `.asset-edit-${id}.tmp`);
    const backupDirectory = path.join(path.dirname(key), ".asset-text-backups");
    const backupPath = path.join(backupDirectory, `${path.basename(key)}.${id}.bak`);
    try {
      await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      await fs.writeFile(backupPath, original, { flag: "wx", mode: 0o600 });
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: stats.mode & 0o777 });
      if (textContentRevision(await fs.readFile(key)) !== expectedRevision) throw conflict("保存期间文件已改变，原文件未覆盖，请重新打开。");
      await fs.rename(temporary, key);
      return { size: bytes.length, revision: textContentRevision(bytes), changed: true, backupPath };
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  });
  saveQueues.set(key, operation);
  operation.finally(() => { if (saveQueues.get(key) === operation) saveQueues.delete(key); }).catch(() => {});
  return operation;
}
