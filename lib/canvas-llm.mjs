import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { createHostLlm } from '../vendor/aiyou-canvas/aiyou/lib/canvas/host-llm.mjs';
import { createCodexCliAdapter } from '../vendor/aiyou-canvas/aiyou/lib/canvas/codex-cli-adapter.mjs';
import { inspectCodexCli } from '../vendor/aiyou-canvas/aiyou/lib/canvas/codex-cli-rpc.mjs';

// Reuse the official local CLI login. Only a later canvas model action starts
// inference; metadata inspection never starts a turn or changes native chats.
export function createCanvasLlm({ home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), resolveContext,
  inspect = inspectCodexCli, spawnImpl = spawn, emit } = {}) {
  const agents = new Map(); let adapter, signature, current, metadataAt = 0, stopped = false;
  // Desktop supervisors can have a minimal PATH; a managed Codex launcher may
  // use /usr/bin/env node. Use the same account home and Node for both phases.
  const spawnWithCliEnv = (command, args, options = {}) => {
    const env = options.env || process.env;
    const entries = (env.PATH || '').split(path.delimiter).filter(Boolean);
    return spawnImpl(command, args, { ...options, env: { ...env, CODEX_HOME: home,
      PATH: [...new Set([path.dirname(process.execPath), ...entries])].join(path.delimiter) } });
  };
  async function metadata() {
    if (current && Date.now() - metadataAt < 30_000) return current;
    const cli = await inspect(undefined, { spawnImpl: spawnWithCliEnv });
    const config = parse(await readFile(path.join(home, 'config.toml'), 'utf8'));
    const cache = JSON.parse(await readFile(path.join(home, 'models_cache.json'), 'utf8'));
    const model = config.model;
    if (typeof model !== 'string' || !Array.isArray(cache.models) || !cache.models.some(m => m.slug === model)) throw Object.assign(new Error('本机默认模型缺少已发布目录，未猜测模型或更改当前对话。'), { code: 'MODEL_UNAVAILABLE' });
    const models = cache.models.filter(m => m.slug && !/qiniu|qnaigc/iu.test(m.slug)).map(m => ({ id: m.slug, name: m.display_name || m.slug,
      description: m.description || '', inputModalities: m.input_modalities || ['text'],
      reasoningEfforts: (m.supported_reasoning_levels || []).map(r => ({ id: r.effort, name: r.effort })), defaultReasoningEffort: m.default_reasoning_level }));
    current = { cli, model, models }; metadataAt = Date.now(); return current;
  }
  const ctx = { agents,
    llm: {
      listProviders: () => [{ id: 'codex-cli', name: 'Codex 本机模型' }],
      resolveModelInfo: async (_provider, id) => { const m = (await metadata()).models.find(m => m.id === id); if (!m) throw new Error('模型不在本机目录'); return m; },
      async prepareCall(selection, signal) {
        const info = await metadata();
        if (!info.cli.loggedIn) throw Object.assign(new Error('本机 Codex CLI 尚未登录；画布不会发起额外授权。'), { code: 'CLI_NOT_LOGGED_IN' });
        const next = JSON.stringify([info.cli.executablePath, info.models]);
        if (!adapter || signature !== next) {
          await adapter?.dispose(); signature = next;
          adapter = createCodexCliAdapter({ ctx, executablePath: info.cli.executablePath, models: info.models,
            spawnImpl: (command, args, options) => spawnWithCliEnv(command, args.flatMap(arg => arg === '--stdio' ? ['--listen', 'stdio://'] : [arg]), options) });
        }
        const call = await adapter.prepareCall(selection.provider, selection.model, signal);
        return { config: selection, inputModalities: call.model.inputModalities, stream: call.stream };
      },
    },
    // The legacy input contract accepts only admitted, already-local image
    // requests. Remote/file attachments are rejected by the common adapter.
    attachments: {
      async admitPromptContent(parts) { return parts.map(part => ({ type: 'image', attachment: { mediaType: part.mediaType, base64: part.data } })); },
      async readImageRequest(ref) {
        if (!/^(?:image\/png|image\/jpeg|image\/webp|image\/gif)$/u.test(ref.mediaType || '') || typeof ref.base64 !== 'string') throw new Error('图片原件格式不受支持');
        const data = Buffer.from(ref.base64, 'base64'); if (!data.length || data.length > 20 * 1024 * 1024) throw new Error('图片原件过大或为空');
        return { mediaType: ref.mediaType, data };
      },
    },
  };
  const inner = createHostLlm({ ctx, emit, select: async context => {
    const info = await metadata();
    const pinned = context.pinnedSelection;
    if (pinned) {
      if (pinned.provider !== 'codex-cli' || !info.models.some(row => row.id === pinned.model)) {
        throw Object.assign(new Error('此次操作固定的本机模型已不可用，请重新发起。'), { code: 'MODEL_UNAVAILABLE' });
      }
      return { provider: 'codex-cli', model: pinned.model };
    }
    return { provider: 'codex-cli', model: info.model };
  } });
  async function invoke(request, context = {}) {
    if (stopped) throw new Error('画布模型连接已关闭');
    const target = await resolveContext?.(context.sessionId);
    if (!target?.threadId || target.threadId !== context.sessionId || !path.isAbsolute(target.projectPath || '')) throw new Error('当前画布对话的本机工作目录不可用');
    // A host-owned run key isolates concurrent or consecutive workbench runs
    // without changing the authoritative Codex conversation or project cwd.
    const scoped = typeof context.runScope === 'string' && /^[0-9a-f-]{36}$/u.test(context.runScope);
    const sessionId = scoped ? 'workbench:' + context.sessionId + ':' + context.runScope : context.sessionId;
    agents.set(sessionId, { session: { id: sessionId, header: { cwd: target.projectPath } } });
    try { return await inner(request, { ...context, sessionId }); }
    finally { if (scoped) agents.delete(sessionId); }
  }
  invoke.capabilities = async () => {
    try { const info = await metadata(); return { available: Boolean(info.cli.loggedIn), selected: { provider: 'codex-cli', model: info.model },
      name: 'Codex 本机默认模型', inputModalities: info.models.find(m => m.id === info.model)?.inputModalities || ['text'],
      credentialManagedByHost: true, authorizationVerified: info.cli.loggedIn, source: 'local-cli-default', tools: true, cancellation: 'local-signal' }; }
    catch (error) { return { available: false, credentialManagedByHost: true, source: 'local-cli-default', diagnostic: error.code || 'CLI_UNAVAILABLE', inputModalities: ['text'] }; }
  };
  invoke.dispose = async () => { stopped = true; inner.dispose(); await adapter?.dispose(); agents.clear(); };
  return invoke;
}
