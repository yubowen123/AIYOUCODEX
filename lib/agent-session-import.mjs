import path from 'node:path';
import {createHash} from 'node:crypto';

const fail = message => Object.assign(new Error(message), {code: 'AGENT_ERROR'});
const digest = value => createHash('sha256').update(value).digest();
const label = (value, limit = 200) => String(value || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, limit);
const absolute = value => typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));

function uuid(seed) {
  const bytes = digest(seed).subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Matches the project-key encoder in Claude Agent SDK 0.3.286 / CLI 2.1.286.
// Long keys use Claude's signed 32-bit string hash, not a filesystem truncation.
export function claudeProjectKey(cwd) {
  if (!absolute(cwd) || /[\x00-\x1f\x7f-\x9f]/.test(cwd)) throw fail('原生会话导入需要有效的绝对项目目录。');
  const normalized = path.win32.isAbsolute(cwd) && !path.posix.isAbsolute(cwd)
    ? path.win32.normalize(cwd) : path.posix.normalize(cwd);
  const key = normalized.replace(/[^a-zA-Z0-9]/g, '-');
  if (key.length <= 200) return key;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) hash = (hash << 5) - hash + normalized.charCodeAt(i) | 0;
  return `${key.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

const timestamp = (value, fallback) => {
  const milliseconds = typeof value === 'number' ? value : Date.parse(value || '');
  return new Date(Number.isFinite(milliseconds) ? milliseconds : fallback).toISOString();
};

/**
 * Build files only; the workspace transaction owns validation, creation, and undo.
 * This is text-history conversion, not a copy of tool state, attachments or auth.
 * Native files MUST be create-only. Never replace an existing target transcript:
 * the target CLI may already have appended turns to an earlier import.
 */
export function buildNativeSessionImport({session, source, target, now = Date.now} = {}) {
  if (target?.id !== 'claude-code') return null;
  if (!session || typeof session.id !== 'string' || !session.id || !source?.id || !absolute(target.root))
    throw fail('会话来源或目标 Agent 信息无效。');
  const cwd = absolute(session.cwd) ? session.cwd : absolute(target.projectPath) ? target.projectPath : '';
  if (!cwd) return null;
  const projectKey = claudeProjectKey(cwd);
  const messages = (Array.isArray(session.messages) ? session.messages : [])
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.text === 'string' && message.text.trim());
  if (!messages.length) throw fail('此会话没有可导入的用户或 Agent 文字消息。');
  if (messages.length > 1000) throw fail('单次原生导入最多支持1000条文字消息。');
  const importedAt = timestamp(typeof now === 'function' ? now() : now, Date.now());
  const identity = JSON.stringify({schema: 1, sourceId: source.id, sourceSessionId: session.id,
    targetId: target.id, targetRoot: target.root, cwd,
    signature: session.signature || createHash('sha256').update(JSON.stringify(messages)).digest('hex')});
  const sessionId = uuid(identity);
  const provenance = {schemaVersion: 1, sourceAgentId: label(source.id, 80),
    sourceAgentName: label(source.name, 100), sourceSessionId: label(session.id, 200),
    sourceSignature: label(session.signature, 256), importedAt,
    textOnly: true, inheritedExecutionAuthority: false};
  const title = label(session.title || messages.find(message => message.role === 'user')?.text || '导入的对话');
  // A custom-title event does not enter the transcript's message chain.
  const rows = [{type: 'custom-title', sessionId, customTitle: title, aiyouImport: provenance}];
  let parentUuid = null;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i], messageUuid = uuid(`${identity}\nmessage:${i}:${message.id || ''}`);
    const common = {parentUuid, isSidechain: false, userType: 'external', cwd,
      sessionId, version: '2.1.286', type: message.role, uuid: messageUuid,
      timestamp: timestamp(message.at, Date.parse(importedAt) + i),
      aiyouImport: {...provenance, sourceMessageId: label(message.id, 256)}};
    if (message.role === 'user') rows.push({...common, message: {role: 'user', content: [{type: 'text', text: message.text}]}});
    else rows.push({...common, message: {id: `msg_aiyou_${messageUuid.replaceAll('-', '')}`,
      type: 'message', role: 'assistant', model: `imported-from-${label(source.id, 80)}`,
      content: [{type: 'text', text: message.text}], stop_reason: 'end_turn', stop_sequence: null,
      usage: {input_tokens: 0, output_tokens: 0}}});
    parentUuid = messageUuid;
  }
  const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  if (bytes.length > 8 * 1024 * 1024) throw fail('此会话原生导入文件超过8MiB。');
  return {format: 'claude-project-jsonl', sessionId, relativePath: `projects/${projectKey}/${sessionId}.jsonl`,
    bytes, createOnly: true, projectPath: cwd, messageCount: messages.length,
    limitations: ['只导入用户和 Agent 文字消息；工具记录、附件和运行状态仍在原会话。'],
    provenance};
}

export function nativeSessionImportCapability(target) {
  return target?.id === 'claude-code'
    ? {supported: true, format: 'claude-project-jsonl', verification: 'official-sdk-transcript-reader', requiresProjectPath: true}
    : {supported: false, format: null, verification: null};
}
