import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipelineError } from './pipeline.mjs';
import { pipelinePrompt, pipelineSystem } from './pipeline-prompt.mjs';

async function defaultModel(options) {
  const { createCanvasLlm } = await import('../../../lib/canvas-llm.mjs');
  return createCanvasLlm(options);
}

export function createCodexPipelineRunner({ resolveWorkspace, createModel = defaultModel }) {
  const unavailable = () => pipelineError(503, '请检查本机 Codex CLI 登录与默认模型。');
  async function workspacePath(workspace) {
    try {
      const current = await resolveWorkspace(workspace.id);
      const cwd = await realpath(current.workspacePath);
      if (!(await stat(cwd)).isDirectory() || !path.isAbsolute(cwd)) throw Error();
      return cwd;
    } catch { throw pipelineError(409, '请先为这个项目绑定有效的本机工作区。'); }
  }
  return {
    async select({ workspace, signal }) {
      const cwd = await workspacePath(workspace);
      const model = await createModel({});
      try {
        const info = await model.capabilities();
        signal.throwIfAborted();
        if (!info.available || !info.selected?.model) throw unavailable();
        return { cwd, provider: info.selected.provider, model: info.selected.model };
      } finally { await model.dispose(); }
    },
    async invoke({ workspace, selection, run, stage, signal }) {
      if (await workspacePath(workspace) !== selection.cwd) throw pipelineError(409, '项目工作区已变化，请重新发起流水线。');
      signal.throwIfAborted();
      // Use the same LLM-only transport as Canvas: isolated ephemeral session,
      // read-only, no tools, MCP, user chat, or approval handling.
      const model = await createModel({ resolveContext: id => id === run.id
        ? { threadId: run.id, projectPath: selection.cwd } : null });
      try {
        const result = await model({ system: pipelineSystem, prompt: pipelinePrompt({ run, stage }),
          tool_choice: 'none' }, { sessionId: run.id, runScope: run.id, signal, pinnedSelection: selection });
        if (result.finishReason !== 'stop' || result.toolCalls?.length) throw pipelineError(502, 'Codex 未返回可用的文字回执。');
        return { text: result.text, usage: result.usage };
      } finally { await model.dispose(); }
    },
  };
}
