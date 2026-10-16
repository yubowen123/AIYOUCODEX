import {spawn} from 'node:child_process';
import {access, mkdir, open, readFile, realpath, rename, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {createModelRouter} from './codex-model-router.mjs';
import {DEEPSEEK_CATALOG_PATH, readBundledDeepSeekModel, deepSeekProviderOverrides} from './deepseek-config.mjs';

export function isStdioAppServer(args) {
  const takesValue = new Set(['-c', '--config', '--enable', '--disable', '-p', '--profile', '-C', '--cd', '--remote', '--remote-auth-token-env']);
  let index = 0;
  for (; index < args.length; index++) {
    if (takesValue.has(args[index])) { index++; continue; }
    if (args[index].startsWith('-')) continue;
    break;
  }
  if (args[index] !== 'app-server') return false;
  const remaining = args.slice(index + 1);
  if (remaining.some(value => ['daemon', 'proxy', 'generate-ts', 'generate-json-schema', 'help', '--help', '-h', '--version', '-V'].includes(value))) return false;
  const inlineListen = remaining.find(value => value.startsWith('--listen='));
  if (inlineListen) return inlineListen === '--listen=stdio://';
  const listen = remaining.findIndex(value => value === '--listen');
  return listen < 0 || remaining[listen + 1] === 'stdio://';
}

export function nativeModelFromCatalog(model) {
  return {
    id: model.slug, model: model.slug, displayName: model.display_name,
    description: model.description || '', modelSpecialty: null, hidden: false,
    upgrade: null, upgradeInfo: null, availabilityNux: null,
    supportedReasoningEfforts: model.supported_reasoning_levels.map(level => ({reasoningEffort: level.effort, description: level.description})),
    defaultReasoningEffort: model.default_reasoning_level,
    inputModalities: model.input_modalities || ['text'], supportsPersonality: false,
    multiAgentVersion: model.multi_agent_version || null,
    additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
    availableAccessPrograms: [], isDefault: false,
  };
}

/** Resolve only published, exact-slug model metadata; never guess a provider's token budget. */
export function createContextWindowResolver({home = path.join(os.homedir(), '.codex'), globalContextWindow} = {}) {
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
  return async (model, overrides = {}) => {
    if (typeof model !== 'string' || !model) return null;
    try {
      const cache = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'));
      if (!Array.isArray(cache?.models)) return null;
      const matches = cache.models.filter(entry => entry?.slug === model);
      if (matches.length !== 1) return null;
      const entry = matches[0];
      if (!positiveInteger(entry.context_window)) return null;
      const maximum = entry.max_context_window;
      if (maximum !== undefined && (!positiveInteger(maximum) || entry.context_window > maximum)) return null;
      const requested = overrides && Object.hasOwn(overrides, 'model_context_window')
        ? overrides.model_context_window : globalContextWindow;
      if (requested === undefined) return entry.context_window;
      return positiveInteger(requested) && positiveInteger(maximum) && requested <= maximum ? requested : null;
    } catch { return null; }
  };
}

/** Publish only model entries, retaining every native capability field unchanged. */
export async function prepareModelCatalog({home, deepSeekCatalogPath} = {}) {
  let temporary;
  try {
    const cache = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'));
    const extra = JSON.parse(await readFile(deepSeekCatalogPath, 'utf8'));
    const validEntry = model => model && typeof model === 'object' && !Array.isArray(model)
      && typeof model.slug === 'string' && model.slug.trim() === model.slug && model.slug.length > 0
      && typeof model.display_name === 'string' && typeof model.description === 'string'
      && Array.isArray(model.supported_reasoning_levels) && model.supported_reasoning_levels.every(level =>
        level && typeof level.effort === 'string' && typeof level.description === 'string')
      && typeof model.shell_type === 'string' && typeof model.visibility === 'string'
      && typeof model.supported_in_api === 'boolean' && Number.isSafeInteger(model.priority)
      && model.truncation_policy && typeof model.truncation_policy.mode === 'string'
      && Number.isSafeInteger(model.truncation_policy.limit) && model.truncation_policy.limit > 0
      && Array.isArray(model.input_modalities) && model.input_modalities.every(item => typeof item === 'string');
    if (!Array.isArray(cache?.models) || !cache.models.length || !cache.models.every(validEntry)) return null;
    if (new Set(cache.models.map(model => model.slug)).size !== cache.models.length) return null;
    const candidates = Array.isArray(extra?.models) ? extra.models.filter(model => model?.slug === 'deepseek-flash') : [];
    if (candidates.length !== 1 || !validEntry(candidates[0])) return null;
    const nativeModels = cache.models.filter(model => model.slug !== 'deepseek-flash');
    if (!nativeModels.length) return null;
    const model = {...candidates[0], comp_hash: null};
    const content = JSON.stringify({models: [...nativeModels, model]}, null, 2) + '\n';
    const directory = path.join(home, 'models');
    const destination = path.join(directory, 'aiyou-gpt-deepseek.json');
    if (await readFile(destination, 'utf8').catch(() => null) === content) return destination;
    await mkdir(directory, {recursive: true, mode: 0o700});
    temporary = path.join(directory, `.aiyou-gpt-deepseek-${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, destination);
    temporary = undefined;
    return destination;
  } catch { return null; }
  finally { if (temporary) await unlink(temporary).catch(() => {}); }
}

export async function configuredExtraModel(env, args = []) {
  if (env.AIYOUCODEX_MODEL_ROUTER_ENABLED === '0') return {};
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  try {
    // Some desktop-only installs have the bundled Node runtime but no npm.
    // The optional router must never prevent the native GPT process starting.
    const {parse} = await import('smol-toml');
    const configText = await readFile(path.join(home, 'config.toml'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const config = parse(configText);
    let selectedProfile = config.profile;
    let providerOverride;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '-p' || arg === '--profile') selectedProfile = args[++index];
      else if (arg.startsWith('--profile=')) selectedProfile = arg.slice('--profile='.length);
      else if (arg === '-c' || arg === '--config' || arg.startsWith('--config=')) {
        const value = arg.startsWith('--config=') ? arg.slice('--config='.length) : args[++index];
        // An explicitly supplied provider definition owns its configuration.
        if (/^\s*model_providers\s*(\.|=)/.test(value || '')) return {};
        try {
          const override = parse(value);
          if (Object.hasOwn(override, 'model_provider')) providerOverride = override.model_provider;
        } catch {}
      }
    }
    if (selectedProfile && !config.profiles?.[selectedProfile]) return {};
    const profile = config.profiles?.[selectedProfile] || {};
    if ((providerOverride || profile.model_provider || config.model_provider || 'openai') !== 'openai') return {};
    const provider = config.model_providers?.deepseek;
    if (provider && (provider.base_url !== 'https://api.deepseek.com' || provider.wire_api !== 'responses')) return {};
    const model = await readBundledDeepSeekModel();
    const nativeCatalogPath = await prepareModelCatalog({home, deepSeekCatalogPath: DEEPSEEK_CATALOG_PATH});
    if (!nativeCatalogPath) return {catalogUnavailable: true};
    return {nativeCatalogPath, catalogPath: DEEPSEEK_CATALOG_PATH, extraModel: nativeModelFromCatalog(model),
      providerArgs: provider ? ['-c', 'thread_unload_delay_secs=0'] : deepSeekProviderOverrides(),
      resolveContextWindow: createContextWindowResolver({home, globalContextWindow: profile.model_context_window ?? config.model_context_window})};
  } catch { return {}; }
}

export async function resolveNativeCodex(env = process.env, proxyPath = process.argv[1]) {
  const candidates = env.AIYOUCODEX_NATIVE_CODEX_BINARY ? [env.AIYOUCODEX_NATIVE_CODEX_BINARY] : [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex'];
  const ownPath = proxyPath ? await realpath(proxyPath).catch(() => proxyPath) : null;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if (await realpath(candidate) !== ownPath) return candidate;
    } catch {}
  }
  throw new Error('Native Codex CLI is unavailable; no provider or login configuration was changed.');
}

export async function threadHasBackingStorage(thread) {
  if (thread.ephemeral || !thread.path) return false;
  try {await access(thread.path); return true;} catch {return false;}
}

/** JSON-RPC stdio adapter. Account traffic and approvals stay in the native process. */
export async function runModelProxy({args = process.argv.slice(2), env = process.env, input = process.stdin,
  output = process.stdout, errorOutput = process.stderr, spawnProcess = spawn, nativeBinary} = {}) {
  nativeBinary ||= await resolveNativeCodex(env);
  const wrapping = isStdioAppServer(args);
  const routing = wrapping ? await configuredExtraModel(env, args) : {};
  if (routing.catalogUnavailable) errorOutput.write('AIYOUcodex 无法安全加载完整模型目录，DeepSeek 暂不可用；原有 GPT 配置保持不变。\n');
  const childArgs = routing.extraModel ? [...args, ...routing.providerArgs,
    '-c', `model_catalog_json=${JSON.stringify(routing.nativeCatalogPath)}`] : args;
  const child = spawnProcess(nativeBinary, childArgs, {env, stdio: wrapping ? ['pipe', 'pipe', 'pipe'] : 'inherit'});
  if (!wrapping) return new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
  // Never log protocol bodies, HTTP headers, configuration layers or credential-helper output.
  child.stderr.pipe(errorOutput, {end: false});
  const nonce = randomUUID(), pending = new Map();
  let sequence = 0, ended = false;
  const writeChild = message => child.stdin.write(JSON.stringify(message) + '\n');
  const writeClient = message => { if (!ended) output.write(JSON.stringify(message) + '\n'); };
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = `aiyou-model-${nonce}-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(id); reject(Object.assign(new Error('Codex model request timed out'), {code: -32000}));
    }, method === 'thread/resume' || method === 'thread/start' ? 120000 : 30000);
    pending.set(id, {resolve, reject, timer});
    writeChild({id, method, params});
  });
  const router = createModelRouter({call, ...routing, isPersisted: threadHasBackingStorage});
  const childLines = readline.createInterface({input: child.stdout});
  childLines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (waiter && !message.method) {
      clearTimeout(waiter.timer); pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), message.error));
      else waiter.resolve(message.result);
    } else if (router.notification(message)) writeClient(message);
  });
  const inputLines = readline.createInterface({input});
  inputLines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { writeClient({id: null, error: {code: -32700, message: 'Invalid JSON-RPC'}}); return; }
    if (!message.method || message.id === undefined) { writeChild(message); return; }
    router.request(message.method, message.params || {}).then(
      result => writeClient({id: message.id, result}),
      error => writeClient({id: message.id, error: {code: Number.isInteger(error.code) ? error.code : -32000,
        message: String(error.message || 'Model routing failed')}}),
    );
  });
  inputLines.on('close', () => { child.stdin.end(); });
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ended = true; inputLines.close(); childLines.close();
      process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
      for (const waiter of pending.values()) {clearTimeout(waiter.timer); waiter.reject(new Error('Native Codex process exited'));}
      pending.clear();
    };
    child.once('error', error => {cleanup(); reject(error);});
    child.once('exit', code => {cleanup(); resolve(code ?? 1);});
  });
}
