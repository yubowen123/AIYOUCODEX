const THREAD_ID = /^(?:local:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const pendingClients = new WeakSet();
const blocked = (code, message) => ({ status: "blocked", code, message, attempted: false, prepared: false });

// Deliberately self-contained: evaluated only in a verified native top-frame
// default context. No generic host RPC, navigation, clearing, Enter or retries.
function executeContextInPage({ threadId, prompt, phase }) {
  const result = (status, code, message, extra = {}) => ({ status, code, message, attempted: false, prepared: phase === "submit", ...extra });
  const refuse = (code, message) => result(phase === "submit" ? "prepared-not-sent" : "blocked", code, message);
  const visible = (node) => Boolean(node && node.isConnected && node.getClientRects().length);
  const normalizeId = (value) => String(value || "").match(/^(?:local:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu)?.[1]?.toLowerCase() || "";
  // Only normalize platform line endings; user edits to spaces or NBSP must not
  // be silently accepted as the exact confirmed prompt.
  const normalizeText = (value) => String(value || "").replace(/\r\n?/gu, "\n");
  if (window.top !== window || location.protocol !== "app:" || location.hostname !== "-" || location.pathname !== "/index.html") {
    return refuse("native-frame-unavailable", "无法确认 Codex 主窗口，未发送。");
  }
  const rows = Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-id]")).filter((node) => (
    node.getAttribute("data-app-action-sidebar-thread-active") === "true"
    || node.getAttribute("data-app-action-sidebar-thread-selected") === "true"
    || node.getAttribute("aria-current") === "page"
  ));
  const ids = new Set(rows.map((node) => normalizeId(node.getAttribute("data-app-action-sidebar-thread-id"))));
  if (!rows.length || ids.size !== 1 || !ids.has(threadId)
    || rows.some((node) => !["", "local"].includes(node.getAttribute("data-app-action-sidebar-thread-host-id") || ""))) {
    return refuse("target-changed", "无法唯一确认当前本地任务，未发送；请回到原任务。");
  }
  const roots = Array.from(document.querySelectorAll('[data-codex-composer-root][data-composer-placement="thread"]')).filter(visible);
  if (roots.length !== 1) return refuse("composer-unavailable", "无法确认唯一的原生对话输入框，未发送。");
  const root = roots[0];
  const editors = Array.from(root.querySelectorAll('[data-codex-composer="true"][contenteditable="true"]')).filter(visible);
  if (editors.length !== 1) return refuse("composer-unavailable", "原生输入框结构不明确，未发送。");
  const editor = editors[0];
  if (editor.getAttribute("aria-disabled") === "true" || root.getAttribute("aria-busy") === "true"
    || rows.some((node) => node.getAttribute("aria-busy") === "true")) return refuse("task-busy", "当前任务正在执行或输入框不可用，未发送。");
  const buttons = Array.from(root.querySelectorAll("button")).filter(visible);
  const labels = (button) => [button.getAttribute("aria-label"), button.getAttribute("title")].filter(Boolean).map((text) => text.trim());
  if (buttons.some((button) => labels(button).some((label) => /^(?:停止(?:生成|回答)?|中断|stop(?: generating| response)?|interrupt)$/iu.test(label)))) {
    return refuse("task-busy", "当前任务正在执行，未打断，也未发送。");
  }
  const attachments = Array.from(root.querySelectorAll("[data-composer-attachments]"));
  if (attachments.length !== 1) return refuse("attachment-state-unknown", "附件状态无法确认，未发送。");
  const attachment = attachments[0];
  const visibleAttachments = attachment.getAttribute("data-visible-attachments");
  if (attachment.childElementCount > 0 || attachment.textContent.trim()
    || (visibleAttachments != null && !["", "0", "false"].includes(visibleAttachments))
    || root.querySelector('[data-appshot-attachment],[data-appshot-attachment-card],[data-attachment-id],[data-composer-attachments-row]')
    || editor.querySelector('[skill-mention-name],[contenteditable="false"],img,video,audio')) {
    return refuse("composer-has-draft", "输入框已有附件或引用，请保留并手动处理；未发送。");
  }
  const text = normalizeText(editor.innerText ?? editor.textContent);
  const hasDraft = Boolean(String(editor.textContent || "").length || text.trim());
  if (phase === "inspect-empty") return hasDraft
    ? refuse("composer-has-draft", "输入框已有草稿，已保留原文，未发送。")
    : result("ready", "ready", "输入框可安全预填。");
  if (phase === "prepare") {
    if (hasDraft) return refuse("composer-has-draft", "输入框已有草稿，已保留原文，未发送。");
    if (typeof document.execCommand !== "function") return refuse("native-edit-unavailable", "原生文本编辑接口不可用，未发送。");
    editor.focus();
    if (document.activeElement !== editor || !visible(editor)) return refuse("native-edit-unavailable", "原生输入框焦点已变化，未发送。");
    const afterFocus = executeContextInPage({ threadId, prompt, phase: "inspect-empty" });
    if (afterFocus.status !== "ready") return afterFocus;
    const selection = window.getSelection();
    if (!selection) return refuse("native-edit-unavailable", "输入框无法获得编辑焦点，未发送。");
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false); // Empty editor only. Never select or replace an existing draft.
    selection.removeAllRanges();
    selection.addRange(range);
    try { document.execCommand("insertText", false, prompt); }
    catch { return result("prepared-not-sent", "prepare-unverified", "未发送；文本可能部分填入，请检查输入框后手动发送。", { prepared: null }); }
    if (normalizeText(editor.innerText ?? editor.textContent) !== normalizeText(prompt)) {
      return result("prepared-not-sent", "prepare-unverified", "未发送；填入内容未能完整核验，请检查输入框。", { prepared: null });
    }
    return result("prepared-not-sent", "prepared", "建议已填入，尚未发送。", { prepared: true });
  }
  if (phase !== "submit" || text !== normalizeText(prompt)) return refuse("prepared-text-changed", "输入内容已变化，已保留，未自动发送。");
  const sendButtons = buttons.filter((button) => labels(button).some((label) => /^(?:发送|发送消息|send|send message)$/iu.test(label)));
  if (sendButtons.length !== 1 || sendButtons[0].disabled || sendButtons[0].getAttribute("aria-disabled") === "true") {
    return result("prepared-not-sent", "send-control-unavailable", "建议已填入，但原生发送按钮未能唯一确认；请手动点击发送。");
  }
  try { sendButtons[0].click(); }
  catch { return result("unknown", "submission-unverified", "可能已提交，尚未确认；请检查当前任务，勿重复发送。", { attempted: true }); }
  // A click and even an emptied composer are not a delivery acknowledgement.
  // The controller must correlate a new persisted user message before success.
  return result("unknown", "submission-awaiting-receipt", "已触发一次原生发送，等待当前任务的消息回执；不会自动重试。", { attempted: true });
}

async function mainContext(client) {
  const tree = await client.send("Page.getFrameTree");
  const frame = tree?.frameTree?.frame;
  let url;
  try { url = new URL(frame?.url); } catch { return null; }
  if (!frame?.id || url.protocol !== "app:" || url.hostname !== "-" || url.pathname !== "/index.html") return null;
  const observed = new Map();
  const off = typeof client.on === "function" ? client.on("Runtime.executionContextCreated", ({ context }) => {
    if (context) observed.set(context.id, context);
  }) : null;
  try { await client.send("Runtime.enable"); } finally { off?.(); }
  for (const context of client.executionContexts?.values?.() || []) observed.set(context.id, context);
  const matches = [...observed.values()].filter((context) => context.auxData?.isDefault === true
    && context.auxData.frameId === frame.id && Number.isInteger(context.id));
  return matches.length === 1 ? matches[0].id : null;
}

async function evaluatePhase(client, contextId, parameters) {
  const reply = await client.send("Runtime.evaluate", {
    expression: "(" + executeContextInPage.toString() + ")(" + JSON.stringify(parameters) + ")",
    contextId, returnByValue: true, awaitPromise: false,
  });
  if (reply.exceptionDetails || !reply.result?.value) throw new Error("Native composer verification unavailable");
  return reply.result.value;
}

/**
 * Called only after a controller consumes its target/version-bound one-use
 * confirmation token. This adapter never treats the UI click as confirmed sent.
 * A supplied validator must explicitly return true immediately before each
 * native mutation; failures preserve any prepared text and never click Send.
 */
export async function executeConfirmedContext({ client, threadId, prompt, validateConfirmation } = {}) {
  const id = typeof threadId === "string" ? threadId.match(THREAD_ID)?.[1]?.toLowerCase() : null;
  if (!client || typeof client.send !== "function" || !id || typeof prompt !== "string"
    || !prompt.trim() || prompt.length > 16_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)
    || (validateConfirmation !== undefined && typeof validateConfirmation !== "function")) {
    return blocked("invalid-confirmation", "任务或建议内容无效，未发送。");
  }
  if (pendingClients.has(client)) return blocked("execution-pending", "当前窗口已有建议正在处理，未重复发送。");
  pendingClients.add(client);
  let phase = "inspect";
  const confirmationValid = async () => {
    if (!validateConfirmation) return true;
    try { return await validateConfirmation() === true; } catch { return false; }
  };
  try {
    const contextId = await mainContext(client);
    if (contextId == null) return blocked("native-frame-unavailable", "无法确认 Codex 主窗口执行上下文，未发送。");
    if (!await confirmationValid()) return blocked("confirmation-changed", "任务或执行确认已变化，未填入，也未发送；请重新预览确认。");
    phase = "prepare";
    const prepared = await evaluatePhase(client, contextId, { threadId: id, prompt, phase });
    if (prepared.code !== "prepared" || prepared.prepared !== true) return prepared;
    if (!await confirmationValid()) return { status: "prepared-not-sent", code: "confirmation-changed",
      message: "任务或执行确认已变化，已保留填入内容但未发送；请重新核对确认。", attempted: false, prepared: true };
    phase = "submit";
    return await evaluatePhase(client, contextId, { threadId: id, prompt, phase });
  } catch {
    if (phase === "submit") return { status: "unknown", code: "submission-unverified", message: "发送结果尚未确认；请检查当前任务，勿重复发送。", attempted: true, prepared: true };
    if (phase === "prepare") return { status: "prepared-not-sent", code: "prepare-unverified", message: "未发送；输入框可能已填入建议，请检查后手动发送。", attempted: false, prepared: null };
    return blocked("native-frame-unavailable", "无法连接或确认 Codex 主窗口，未发送。");
  } finally { pendingClients.delete(client); }
}
