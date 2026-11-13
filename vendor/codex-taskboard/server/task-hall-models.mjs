import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { createCanvasLlm } from '../../../lib/canvas-llm.mjs';
import { findClaudeExecutable } from '../../../lib/claude-code.mjs';
import { hallError } from './task-hall.mjs';

const exec = promisify(execFile);
const prohibited = /qiniu|qnaigc|七牛/iu;
const modelName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:/\-]{0,127}$/iu.test(value) && !prohibited.test(value);
const validText = text => typeof text === 'string' && Boolean(text.trim()) && text.length <= 24_000;
const claudeFlags = ['--safe-mode', '--setting-sources', 'user'];
const claudeUnavailable = () => hallError(503, 'Claude Code 未就绪：请核对本机客户端、登录和默认模型。');
const claudeResultError = () => hallError(502, 'Claude Code 未返回可验证的单轮文本回执。');

async function getClaudeSdk() {
  return (await import('@anthropic-ai/claude-agent-sdk')).query;
}

async function getClaudeCliAuth(executable, env, signal) {
  const { stdout } = await exec(executable, [...claudeFlags, 'auth', 'status', '--json'], {
    env, signal, timeout: 5_000, maxBuffer: 16_384, windowsHide: true,
  });
  const { loggedIn, authMethod, apiProvider } = JSON.parse(stdout);
  return { loggedIn: loggedIn === true, authMethod, apiProvider };
}

async function getClaudeRoute(env, home) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  if (!isAbsolute(configDir)) return null;
  let settings;
  try {
    const filename = join(configDir, 'settings.json');
    if ((await stat(filename)).size > 256 * 1024) return null;
    settings = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') return null;
    settings = {};
  }
  // Keep secrets with the native CLI. Read only routing preferences and refuse
  // known disabled providers; never copy key/token values to process arguments.
  const routingVars = [
    'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_FALLBACK_MODEL',
    'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_RESOURCE',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_VERTEX_BASE_URL', 'CLAUDE_CODE_BEDROCK_BASE_URL',
  ];
  const prefs = routingVars.map(key => [key, settings?.env?.[key] ?? env[key] ?? null]);
  if ([settings?.model, settings?.fallbackModel, settings?.apiKeyHelper, ...prefs.map(([, v]) => v)].some(v => prohibited.test(String(v ?? '')))) return null;
  const prefsMap = new Map(prefs);
  const endpoint = prefsMap.get('ANTHROPIC_BASE_URL');
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    } catch { return null; }
  }
  const requestedModel = prefsMap.get('ANTHROPIC_MODEL') || settings?.model || null;
  if (requestedModel !== null && !modelName(requestedModel)) return null;
  return {
    model: requestedModel || 'default',
    requestedModel,
    // Internal, in-memory comparison only. No route, path, or auth data is
    // returned to the hall API or persisted with a receipt.
    route: JSON.stringify([configDir, prefs, settings?.model ?? null]),
  };
}

async function inEphemeralWorkspace(operation) {
  const cwd = await mkdtemp(join(tmpdir(), 'aiyou-task-hall-'));
  try { return await operation(await realpath(cwd)); }
  finally { await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
}

function matchesClaudeModel(requested, initialized, returned) {
  if (!modelName(returned) || !modelName(initialized)) return false;
  const agrees = (a, b) => a === b || (b.startsWith(a + '-') && /^\d{8}$/u.test(b.slice(a.length + 1)));
  if (requested && /^claude-/u.test(requested)) return agrees(requested, initialized) && agrees(requested, returned);
  return agrees(initialized, returned);
}

/** Native, single-turn task execution. Each call has its own tool-free session. */
export function createCodexHallModels({
  createCodex = createCanvasLlm,
  findClaude = findClaudeExecutable,
  loadClaude = getClaudeSdk,
  readClaudeRoute = getClaudeRoute,
  readClaudeAuth = getClaudeCliAuth,
  env = process.env,
  home = homedir(),
} = {}) {
  const codex = {
    async select() {
      const bridge = createCodex({});
      try {
        const state = await bridge.capabilities();
        return state.available && state.authorizationVerified && state.selected?.provider === 'codex-cli' &&
          modelName(state.selected.model) && state.inputModalities?.includes('text') ? state.selected : null;
      } finally { await bridge.dispose(); }
    },
    async invoke({ selection, system, prompt, signal, runId }) {
      signal.throwIfAborted();
      if (selection?.provider !== 'codex-cli' || !modelName(selection?.model)) {
        throw hallError(503, 'Codex 本机模型未就绪。');
      }
      return inEphemeralWorkspace(async cwd => {
        const bridge = createCodex({ resolveContext: sessionId => sessionId === runId ? { threadId: runId, projectPath: cwd } : null });
        try {
          const receipt = await bridge({ system, prompt, tool_choice: 'none' }, {
            sessionId: runId, runScope: runId, signal, pinnedSelection: selection,
          });
          signal.throwIfAborted();
          if (receipt.finishReason !== 'stop' || receipt.toolCalls?.length || !validText(receipt.text) ||
              receipt.model !== selection.model || receipt.provider !== selection.provider) {
            throw hallError(502, 'Codex 未返回可验证的单轮文本回执。');
          }
          return { text: receipt.text.trim(), model: receipt.model };
        } finally { await bridge.dispose(); }
      });
    },
  };
  const claude = {
    async select() {
      try {
        const route = await readClaudeRoute(env, home);
        if (!route) return null;
        const [executable, query] = await Promise.all([findClaude({ env, home }), loadClaude()]);
        if (!executable || typeof query !== 'function') return null;
        const auth = await readClaudeAuth(executable, env, AbortSignal.timeout(5_000));
        if (!auth.loggedIn || prohibited.test(String(auth.apiProvider ?? ''))) return null;
        return { ...route, executable, authMethod: auth.authMethod, apiProvider: auth.apiProvider };
      } catch { return null; }
    },
    async invoke({ selection, system, prompt, signal }) {
      signal.throwIfAborted();
      const current = await claude.select();
      signal.throwIfAborted();
      if (!current) throw claudeUnavailable();
      if (!selection || ['executable', 'route', 'model', 'authMethod', 'apiProvider'].some(key => current[key] !== selection[key])) {
        throw hallError(409, 'Claude Code 的本机连接已变化，请重新指派。');
      }
      return inEphemeralWorkspace(async cwd => {
        const abort = new AbortController();
        const cancel = () => abort.abort(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        const query = await loadClaude();
        let begin, end, sendPrompt = false, session;
        const ready = new Promise(resolve => { begin = resolve; });
        const done = new Promise(resolve => { end = resolve; });
        // The first model turn starts only after native SDK initialization
        // confirms that no MCP server is available to this session.
        const input = (async function* () {
          await ready;
          if (!sendPrompt) return;
          yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' };
          await done;
        })();
        try {
          signal.throwIfAborted();
          session = query({ prompt: input, options: {
            cwd, env, pathToClaudeCodeExecutable: current.executable,
            ...(current.requestedModel ? { model: current.requestedModel } : {}),
            settingSources: ['user'], systemPrompt: system, tools: [], allowedTools: [],
            mcpServers: {}, strictMcpConfig: true, plugins: [], maxTurns: 1, persistSession: false,
            permissionMode: 'dontAsk', abortController: abort,
            settings: { disableAllHooks: true, disableClaudeAiConnectors: true, fallbackModel: [] },
            extraArgs: { 'safe-mode': null, 'disable-slash-commands': null, 'no-chrome': null, 'prompt-suggestions': 'false' },
            canUseTool: async () => ({ behavior: 'deny', message: '此任务只接收文本回执。' }),
          } });
          await session.initializationResult();
          if ((await session.mcpServerStatus()).length !== 0) throw claudeResultError();
          signal.throwIfAborted();
          sendPrompt = true;
          begin();
          let model, initializedModel, result;
          for await (const message of session) {
            signal.throwIfAborted();
            if (message.type === 'system' && message.subtype === 'init') {
              if (!Array.isArray(message.tools) || message.tools.length || message.mcp_servers?.length) throw claudeResultError();
              initializedModel = message.model;
            }
            if (message.type === 'assistant') {
              if (message.error || message.message?.content?.some(block => block.type !== 'text' && block.type !== 'thinking' && block.type !== 'redacted_thinking')) {
                throw claudeResultError();
              }
              const nextModel = message.message?.model;
              if (!modelName(nextModel) || (model && nextModel !== model)) throw claudeResultError();
              model = nextModel;
            }
            if (message.type === 'result') {
              if (message.subtype !== 'success' || message.is_error || message.permission_denials?.length || !validText(message.result) ||
                  !matchesClaudeModel(current.requestedModel, initializedModel, model)) throw claudeResultError();
              result = { text: message.result.trim(), model };
              break;
            }
          }
          if (!result) throw claudeResultError();
          return result;
        } catch (error) {
          signal.throwIfAborted();
          if (error.status) throw error;
          throw claudeResultError();
        } finally {
          begin();
          end();
          abort.abort();
          session?.close();
          signal.removeEventListener('abort', cancel);
        }
      });
    },
  };
  return { codex, claude };
}
