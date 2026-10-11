import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function connectionFile(env = process.env) {
  return env.AIYOUCODEX_OPENCHATCUT_CONNECTION || path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'openchatcut', 'controller.json');
}
export async function requestController(payload, { fetchImpl = fetch, env = process.env, timeoutMs = 120000 } = {}) {
  let connection;
  try { connection = JSON.parse(await readFile(connectionFile(env), 'utf8')); }
  catch { throw Object.assign(new Error('AIYOUcodex 剪辑服务尚未启动。请启动 AIYOUcodex，并在左侧 OpenChatCut 或设置中检查安装状态。'), { code: 'OPENCHATCUT_HOST_REQUIRED' }); }
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || typeof connection.token !== 'string' || connection.token.length < 32) throw new Error('本地剪辑服务连接记录无效。');
  let response;
  try {
    response = await fetchImpl(`${url.origin}/request`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw Object.assign(new Error('AIYOUcodex 剪辑服务无法连接。请重新启动 AIYOUcodex；没有重试任何剪辑写入。'), { code: 'OPENCHATCUT_HOST_REQUIRED' }); }
  const value = await response.json();
  if (!response.ok || value.ok !== true) throw Object.assign(new Error(value.error || '本地剪辑服务操作失败。'), { code: value.code || 'OPENCHATCUT_UNAVAILABLE' });
  return value.data;
}
