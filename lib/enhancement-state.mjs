import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ENHANCEMENT_STORAGE_KEY = 'aiyoucodex.enhancement.disabled';

export function guardEnhancementSource(source) {
  return `if (!window.__AIYOUCODEX_ENHANCEMENT_DISABLED__ && (()=>{try{return localStorage.getItem(${JSON.stringify(ENHANCEMENT_STORAGE_KEY)})!=='1'}catch{return true}})()) { ${source}\n }`;
}

export function enhancementStatePath({ platform = process.platform, home = os.homedir(), environment = process.env } = {}) {
  if (environment.AIYOUCODEX_ENHANCEMENT_STATE_FILE) return environment.AIYOUCODEX_ENHANCEMENT_STATE_FILE;
  if (platform === 'win32') return path.win32.join(environment.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'CodexSidebarEnhancer', 'Data', 'enhancement-state.json');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Codex Sidebar Enhancer Data', 'enhancement-state.json');
  return path.posix.join(home, '.local', 'share', 'codex-sidebar-enhancer', 'enhancement-state.json');
}

export async function isEnhancementEnabled(file = enhancementStatePath()) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    // An unreadable/malformed pause file must not silently re-enable helpers.
    return value?.schemaVersion === 1 && value.enabled === true;
  } catch (error) { return error.code === 'ENOENT'; }
}

export async function setEnhancementEnabled(enabled, file = enhancementStatePath()) {
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, enabled, updatedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { enabled };
}

// Installed preloads from different owners must agree before any DOM teardown.
// This changes no theme, workspace, authentication or third-party plugin settings.
export const ENHANCEMENT_TEARDOWN_EXPRESSION = `(() => {
  window.__AIYOUCODEX_ENHANCEMENT_DISABLED__ = true;
  try { localStorage.setItem(${JSON.stringify(ENHANCEMENT_STORAGE_KEY)}, '1'); } catch {}
  const failures = [];
  for (const key of ['__AIYOUCODEX_THEME_CATALOG__','__AIYOUCODEX_THEME__','__AIYOUCODEX_FRAME_CATALOG__','__AIYOUCODEX_FRAME_THEME__','__aiyouAgentWorkspace__','__aiyouOpenChatCut__','__aiyouClaudeInjection__','__codexTaskboardInjection__','__codexConversationPreviewInjection__']) {
    try { window[key]?.destroy?.(); delete window[key]; } catch { failures.push(key); }
  }
  delete window.__AIYOUCODEX_RUNTIME_SOURCE_HASH__;
  delete window.__AIYOUCODEX_THEME_WORKER_HASH__;
  delete window.__AIYOUCODEX_FRAME_WORKER_HASH__;
  return { disabled: true, failures };
})()`;

export const ENHANCEMENT_RESUME_EXPRESSION = `(() => {
  window.__AIYOUCODEX_ENHANCEMENT_DISABLED__ = false;
  try { localStorage.removeItem(${JSON.stringify(ENHANCEMENT_STORAGE_KEY)}); } catch {}
})()`;

export function createEnhancementController({ file, onDisabled = async () => {}, platform = process.platform } = {}) {
  let pending;
  const supported = ['darwin', 'win32'].includes(platform);
  return {
    async request(payload) {
      if (payload?.action === 'snapshot') return { supported, enabled: await isEnhancementEnabled(file) };
      if (payload?.action !== 'disable' || !supported) throw Object.assign(new Error('当前环境不支持关闭插件。'), { code: 'ENHANCEMENT_ERROR' });
      if (!pending) pending = (async () => {
        try { await setEnhancementEnabled(false, file); }
        catch { throw Object.assign(new Error('关闭状态未能保存，插件仍在运行，请重试。'), { code: 'ENHANCEMENT_ERROR' }); }
        await onDisabled();
        return { supported, enabled: false };
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
