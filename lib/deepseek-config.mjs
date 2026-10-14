import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const DEEPSEEK_CATALOG_PATH = fileURLToPath(new URL('../models/deepseek-flash.json', import.meta.url));
export const DEEPSEEK_AUTH_HELPER = fileURLToPath(new URL('../scripts/deepseek-auth.mjs', import.meta.url));

export async function readBundledDeepSeekModel() {
  const {models} = JSON.parse(await readFile(DEEPSEEK_CATALOG_PATH, 'utf8'));
  const model = models?.find(entry => entry.slug === 'deepseek-flash');
  if (!model || model.comp_hash !== null) throw new Error('Bundled DeepSeek metadata is unavailable.');
  return model;
}

/** Process-scoped only: no user config, default provider, login or secret writes. */
export function deepSeekProviderOverrides({nodePath = process.execPath, helperPath = DEEPSEEK_AUTH_HELPER} = {}) {
  const provider = '{name="DeepSeek",base_url="https://api.deepseek.com",wire_api="responses",requires_openai_auth=false,'
    + `auth={command=${JSON.stringify(nodePath)},args=[${JSON.stringify(helperPath)},"--codex-auth"],refresh_interval_ms=1000,timeout_ms=5000}}`;
  return ['-c', `model_providers.deepseek=${provider}`, '-c', 'thread_unload_delay_secs=0'];
}
