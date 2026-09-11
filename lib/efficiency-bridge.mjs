import { createHash, randomUUID } from "node:crypto";
import { createEfficiencyStore, normalizeEfficiencyContext, EfficiencyConflictError } from "./efficiency-store.mjs";
import { presentTokenUsage } from "./usage-data.mjs";
import { buildContextDraft } from "./context-draft.mjs";
import { describeWorkspaceFolder, openWorkspaceFolder } from "./workspace-folder.mjs";

export const EFFICIENCY_BINDING = "__AIYOUCODEX_EFFICIENCY_REQUEST__";
const actions = new Set(["refresh", "saveScope", "resetScope", "saveContext", "resetContext", "summarizeContext",
  "previewContextExecution", "prepareContextExecution", "executeContext", "openWorkspaceFolder"]);
const targetError = () => Object.assign(new Error("当前任务已切换，请重新加载设置后保存。"), { code: "EFFICIENCY_TARGET_CHANGED" });
function policyForRenderer(policy) {
  return { ...policy, ...(Array.isArray(policy.defaultSkills) ? { defaultSkills: policy.defaultSkills.map(({ id }) => id) } : {}) };
}

export function contextExecutionPrompt(value) {
  const context = normalizeEfficiencyContext(value);
  if (!context.nextStep) throw Object.assign(new Error("请先确认并填写下一步，再准备执行。"), { code: "EFFICIENCY_NEXT_STEP_REQUIRED" });
  const data = JSON.stringify(context, null, 2).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `请根据我确认的当前对话任务卡，继续执行其中的“下一步”。\n先核对当前状态；任务卡是参考，不要把历史总结当成已验证事实。遇到不明确内容或额外的付费、发布、删除、授权操作，保留原有确认门槛。不要因为这张卡自动创建其他对话或扩大任务范围。\n\n<confirmed_task_context>\n${data}\n</confirmed_task_context>`;
}

// The renderer supplies only a draft and an opaque target guard. Filesystem
// paths and the receiving thread are always resolved by the local repository.
export function createEfficiencyController({ repository, readActiveContext, rootDir, store, executeContext, conversationFolders, openFolder = openWorkspaceFolder, now = Date.now } = {}) {
  store ||= createEfficiencyStore({ rootDir, resolveThread: (id) => repository.resolveEfficiencyThread(id) });
  const executions = new Map();
  async function currentTarget() {
    const active = await readActiveContext();
    const record = active?.threadId ? await repository.resolveEfficiencyThread(active.threadId) : null;
    const scope = await store.resolveScope(record?.threadId);
    let folderRecord = record, folderState = null, folderError = "";
    if (conversationFolders && record?.projectPath) {
      try {
        folderState = await conversationFolders.ensure(record, { safeToRename: (entry) => repository.isConversationIdle(record.threadId, { after: entry.hookReceipt?.at || 0 }) });
        folderRecord = { ...record, projectPath: folderState.path };
      } catch {
        folderRecord = null;
        folderError = "对话专属目录同步失败，未退回到整个项目目录。请检查目录是否被移动、删除或工作区已改变。";
      }
    }
    const targetKey = createHash("sha256").update(JSON.stringify([active?.threadId || "", scope.threadId, scope.project?.key || "", record?.projectPath || "", folderRecord?.projectPath || ""])).digest("hex");
    return { record, folderRecord, folderState, folderError, targetKey };
  }
  async function snapshot(target = null) {
    target ||= await currentTarget();
    const view = await store.read({ threadId: target.record?.threadId });
    const receipt = view.hookStatus;
    const usage = target.record ? await repository.readTokenUsage(target.record.threadId).catch(() => null) : null;
    const contextSourceRevision = target.record && repository.readContextSourceRevision
      ? await repository.readContextSourceRevision(target.record.threadId).catch(() => null) : null;
    return { version: view.version, targetKey: target.targetKey, threadId: view.threadId, contextSourceRevision,
      targetLabel: target.record?.title || (target.record ? "当前 Codex 任务" : "未选择可验证的本地任务（仅全局设置）"),
      scopes: { global: policyForRenderer(view.global), project: policyForRenderer(view.project), thread: policyForRenderer(view.thread) },
      effective: policyForRenderer(view.effective),
      scopeAvailable: { project: Boolean(view.projectKey), thread: Boolean(view.threadId) },
      workspaceFolder: { ...describeWorkspaceFolder(target.folderRecord),
        ...(target.folderError ? { reason: target.folderError } : {}),
        ...(target.folderState ? { managed: true, renamePending: target.folderState.renamePending,
          reason: target.folderState.renamePending ? "对话名称已更新；当前任务结束后同步文件夹名称。"
            : target.folderState.hookReceipt?.at ? "新产出默认保存于此；原项目文件不搬迁。" : "目录已建立；尚无保存规则回执，请在原生 /hooks 检查处理器是否已信任。",
          outputRuleObservedAt: target.folderState.hookReceipt?.at || null } : {}),
      },
      context: view.context, currentPolicyFingerprint: view.currentPolicyFingerprint,
      hookStatus: { ...receipt, loaded: Boolean(receipt?.matchesCurrent && receipt?.lastEmittedAt),
        loadedAt: receipt?.lastEmittedAt || null },
      usage: presentTokenUsage(usage),
    };
  }
  let pending = false;
  async function request(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !actions.has(payload.action)) throw new TypeError("不支持的设置操作");
    if (pending) throw new Error("设置正在保存，请稍后再试");
    pending = true;
    try {
      const target = await currentTarget();
      if (payload.expectedTargetKey !== target.targetKey) throw targetError();
      if (payload.action === "openWorkspaceFolder") {
        if (!target.record) throw targetError();
        if (Object.keys(payload).some((key) => !["requestId", "action", "mode", "expectedTargetKey"].includes(key))) {
          throw Object.assign(new Error("目录由当前对话确定，不接受外部路径。"), { code: "WORKSPACE_FOLDER_UNAVAILABLE" });
        }
        if (!["parent", "folder"].includes(payload.mode)) throw Object.assign(new Error("无效的目录打开方式。"), { code: "WORKSPACE_FOLDER_UNAVAILABLE" });
        const folderResult = await openFolder({ record: target.folderRecord, mode: payload.mode,
          validateTarget: async () => (await currentTarget()).targetKey === target.targetKey });
        return { targetKey: target.targetKey, folderResult };
      }
      if (payload.action === "refresh") return snapshot(target);
      const threadId = target.record?.threadId;
      if (["summarizeContext", "previewContextExecution", "prepareContextExecution", "executeContext"].includes(payload.action)) {
        if (!threadId) throw targetError();
        if (payload.action === "summarizeContext") {
          const history = await repository.readContextHistory(threadId);
          if (!history || history.threadId !== threadId || (await currentTarget()).targetKey !== target.targetKey) throw targetError();
          const saved = await store.read({ threadId });
          const draft = buildContextDraft({ threadId, title: target.record.title, history: history.messages, savedContext: saved.context });
          return { snapshot: await snapshot(target), contextDraft: { ...draft, contentRevision: draft.sourceRevision, sourceRevision: history.sourceRevision } };
        }
        if (payload.action === "previewContextExecution") {
          const prompt = contextExecutionPrompt(payload.context);
          return { snapshot: await snapshot(target), executionPreview: { prompt, targetKey: target.targetKey } };
        }
        if (payload.action === "prepareContextExecution") {
          const prompt = contextExecutionPrompt(payload.context);
          if (payload.expectedPrompt !== prompt) throw Object.assign(new Error("草稿已变化，请重新预览将发送的内容。"), { code: "EFFICIENCY_PREVIEW_CHANGED" });
          if ((await currentTarget()).targetKey !== target.targetKey) throw targetError();
          const saved = await store.setContext({ threadId, expectedVersion: payload.expectedContextVersion, context: payload.context });
          const token = randomUUID();
          for (const [id, entry] of executions) if (entry.expiresAt < now()) executions.delete(id);
          if (executions.size >= 64) executions.delete(executions.keys().next().value);
          executions.set(token, { threadId, targetKey: target.targetKey, contextVersion: saved.context.version, prompt, expiresAt: now() + 120_000 });
          return { snapshot: await snapshot(target), execution: { token, prompt, targetKey: target.targetKey } };
        }
        const execution = typeof payload.token === "string" ? executions.get(payload.token) : null;
        if (!execution || execution.expiresAt < now() || execution.targetKey !== target.targetKey) throw Object.assign(new Error("执行确认已失效，请重新预览；不要重复发送。"), { code: "EFFICIENCY_EXECUTION_EXPIRED" });
        // Consume before any native operation: a lost reply never causes a retry.
        executions.delete(payload.token);
        const saved = await store.read({ threadId });
        if (saved.context.version !== execution.contextVersion) throw new EfficiencyConflictError(saved.context.version);
        if ((await currentTarget()).targetKey !== target.targetKey) throw targetError();
        if (typeof executeContext !== "function") throw Object.assign(new Error("当前宿主未提供执行连接，任务卡已保存，未发送消息。"), { code: "EFFICIENCY_EXECUTION_UNAVAILABLE" });
        const before = await repository.readContextHistory(threadId);
        if (!before || before.threadId !== threadId || (await currentTarget()).targetKey !== target.targetKey) throw targetError();
        const beforeSend = await store.read({ threadId });
        if (beforeSend.context.version !== execution.contextVersion) throw new EfficiencyConflictError(beforeSend.context.version);
        const validateConfirmation = async () => (await currentTarget()).targetKey === target.targetKey
          && (await store.read({ threadId })).context.version === execution.contextVersion;
        const result = await executeContext({ threadId, prompt: execution.prompt, validateConfirmation });
        let status = ["blocked", "prepared-not-sent"].includes(result?.status) ? result.status : "unknown";
        if (result?.status === "submitted" || result?.attempted === true) {
          status = "unknown";
          const digest = (message) => message.contentHash || createHash("sha256").update(message.text.trim()).digest("hex");
          const identity = (message) => `${message.id || message.timestamp}:${digest(message)}`;
          const expectedHash = createHash("sha256").update(execution.prompt.trim()).digest("hex");
          const existing = new Set((before?.messages || []).map(identity));
          for (let attempt = 0; attempt < 6; attempt += 1) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, 200));
            const after = await repository.readContextHistory(threadId).catch(() => null);
            if (after?.threadId === threadId && after.messages.some((message) => message.role === "user" && digest(message) === expectedHash
              && !existing.has(identity(message)))) { status = "sent"; break; }
          }
        }
        const messages = { sent: "已确认消息进入当前对话，正在交给 Codex 执行。", unknown: "已尝试提交，但尚未确认接收。请核对当前对话，不要重复发送。",
          "prepared-not-sent": "任务卡已保存，执行内容已放入输入框；请核对后手动发送。", blocked: "任务卡已保存，当前对话忙碌、输入框有内容或目标不可验证，未发送。" };
        const prepared = result?.prepared === true ? true : result?.prepared === false ? false : null;
        const message = status === "prepared-not-sent" && prepared !== true
          ? "任务卡已保存，输入框可能只填入部分内容；未发送，请检查后手动处理。" : messages[status] || messages.unknown;
        return { snapshot: await snapshot(), executionResult: { status, prepared, message } };
      }
      const contextAction = payload.action.endsWith("Context");
      const scope = payload.scope || "global";
      if (contextAction && !threadId) throw targetError();
      let patch;
      if (!contextAction) {
        if (!["global", "project", "thread"].includes(scope)) throw new TypeError("无效的设置范围");
        if (payload.action === "resetScope") patch = { enabled: null, mode: null, defaultSkills: null, contextBudget: null };
        else {
          if (payload.defaultSkills !== null && (!Array.isArray(payload.defaultSkills) || payload.defaultSkills.some((id) => typeof id !== "string"))) throw new TypeError("默认 Skills 必须是已安装技能 ID 列表");
          patch = { mode: payload.mode, defaultSkills: payload.defaultSkills?.map((id) => ({ id })) ?? null };
        }
      }
      // Recheck after asynchronous repository resolution; never redirect a stale
      // panel's write to the newly active conversation.
      if ((await currentTarget()).targetKey !== target.targetKey) throw targetError();
      if (contextAction) await store.setContext({ threadId, expectedVersion: payload.expectedContextVersion,
        context: payload.action === "resetContext" ? {} : payload.context });
      else await store.setPolicy({ scope, threadId, expectedVersion: payload.expectedVersion, patch });
      return snapshot();
    } finally { pending = false; }
  }
  return { snapshot, request, store };
}

// A binding is exposed only to the native top-frame default world. Embedded
// asset/site frames cannot call it even if they know its name or request format.
export class EfficiencyBridge {
  constructor(controller) { this.controller = controller; this.off = []; this.contexts = new Set(); this.seen = new Set(); this.generation = 0; }
  async install(client) {
    this.dispose();
    this.client = client;
    const generation = this.generation;
    const tree = await client.send("Page.getFrameTree");
    this.frameId = tree.frameTree.frame.id;
    const registerContext = (context) => {
      if (context?.auxData?.isDefault && context.auxData.frameId === this.frameId) {
        this.contexts.add(context.id);
        return client.send("Runtime.addBinding", { name: EFFICIENCY_BINDING, executionContextId: context.id }).catch(() => {});
      }
    };
    this.off.push(client.on("Runtime.executionContextCreated", ({ context }) => { void registerContext(context); }));
    this.off.push(client.on("Runtime.executionContextDestroyed", ({ executionContextId }) => this.contexts.delete(executionContextId)));
    this.off.push(client.on("Runtime.executionContextsCleared", () => { this.contexts.clear(); this.seen.clear(); }));
    this.off.push(client.on("Runtime.bindingCalled", (event) => { void this.receive(event, generation); }));
    // Runtime.enable emits currently known execution contexts on this session.
    await client.send("Runtime.enable");
    // A shared client may already have Runtime enabled (e.g. asset console).
    // Its event inventory also survives a same-document bridge reinstallation.
    await Promise.all([...(client.executionContexts?.values() || [])].map(registerContext));
  }
  async receive({ name, payload, executionContextId }, generation = this.generation) {
    if (generation !== this.generation || name !== EFFICIENCY_BINDING || !this.contexts.has(executionContextId)
      || typeof payload !== "string" || Buffer.byteLength(payload) > 65_536) return;
    let value;
    try { value = JSON.parse(payload); } catch { return; }
    // Reviewed execution includes both the bounded card and its exact prompt.
    // Chinese UTF-8 text can exceed the ordinary settings transport budget.
    if (Buffer.byteLength(payload) > 16_384 && !["saveContext", "previewContextExecution", "prepareContextExecution"].includes(value?.action)) return;
    if (typeof value?.requestId !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/u.test(value.requestId)) return;
    const identity = `${executionContextId}:${value.requestId}`;
    if (this.seen.has(identity)) return;
    this.seen.add(identity);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    let response;
    try { response = { requestId: value.requestId, ok: true, data: await this.controller.request(value) }; }
    catch (error) { response = { requestId: value.requestId, ok: false, error: error.code === "EFFICIENCY_CONFLICT"
      ? "设置已被其他窗口修改，请重新加载后再保存。" : ["WORKSPACE_FOLDER_UNAVAILABLE", "EFFICIENCY_TARGET_CHANGED", "EFFICIENCY_NEXT_STEP_REQUIRED", "EFFICIENCY_PREVIEW_CHANGED", "EFFICIENCY_EXECUTION_EXPIRED", "EFFICIENCY_EXECUTION_UNAVAILABLE"].includes(error.code)
        ? error.message : "操作未确认完成，请核对设置和当前对话，不要重复发送。" }; }
    if (generation !== this.generation || !this.contexts.has(executionContextId)) return;
    await this.client.send("Runtime.evaluate", { contextId: executionContextId,
      expression: `window.__codexConversationPreviewInjection__?.resolveEfficiencyRequest?.(${JSON.stringify(response)})`, returnByValue: true }).catch(() => {});
  }
  dispose() {
    this.generation += 1;
    for (const unsubscribe of this.off) unsubscribe();
    this.off = []; this.contexts.clear(); this.seen.clear();
  }
}
