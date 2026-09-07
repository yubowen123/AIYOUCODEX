import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { executeConfirmedContext } from "../lib/context-execution.mjs";

const THREAD = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROMPT = "请按照已确认的上下文继续。\n下一步：运行隔离测试。";

function element(attributes = {}) {
  return {
    attributes: { ...attributes }, isConnected: true, hidden: false, disabled: false, childElementCount: 0, textContent: "",
    getAttribute(key) { return this.attributes[key] ?? null; },
    getClientRects() { return this.hidden ? [] : [{}]; },
  };
}

function fixture(options = {}) {
  const state = { writes: 0, clicks: 0, commands: [], phases: 0, focusCalls: 0 };
  const row = element({
    "data-app-action-sidebar-thread-id": "local:" + THREAD,
    "data-app-action-sidebar-thread-host-id": "local",
    "data-app-action-sidebar-thread-active": "true",
  });
  const editor = element({ "data-codex-composer": "true", contenteditable: "true" });
  Object.defineProperty(editor, "innerText", { get() { return this.textContent; } });
  const attachment = element({ "data-composer-attachments": "" });
  const send = element({ "aria-label": "发送" });
  send.click = () => {
    state.clicks += 1;
    options.onClick?.({ state, editor });
  };
  const root = element({ "data-codex-composer-root": "", "data-composer-placement": "thread" });
  const dom = {
    rows: [row], roots: [root], editors: [editor], attachments: [attachment], buttons: [send],
    hasReference: false, hasAttachmentOutside: false,
  };
  editor.querySelector = () => dom.hasReference ? {} : null;
  root.querySelector = () => dom.hasAttachmentOutside ? {} : null;
  root.querySelectorAll = (selector) => {
    if (selector === "button") return dom.buttons;
    if (selector === "[data-composer-attachments]") return dom.attachments;
    if (selector.includes("contenteditable")) return dom.editors;
    throw new Error("Unexpected root query: " + selector);
  };
  const document = {
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === "[data-app-action-sidebar-thread-id]") return dom.rows;
      if (selector.includes("[data-codex-composer-root]")) return dom.roots;
      throw new Error("Unexpected document query: " + selector);
    },
    createRange: () => ({ selectNodeContents(target) { assert.strictEqual(target, editor); }, collapse(end) { assert.equal(end, false); } }),
    execCommand(command, ui, text) {
      state.commands.push(command); state.writes += 1;
      assert.equal(command, "insertText"); assert.equal(ui, false);
      assert.equal(editor.textContent, "", "Existing draft must never be replaced");
      editor.textContent = options.partialInsert ? text.slice(0, 5) : text;
      return true;
    },
  };
  editor.focus = () => { state.focusCalls += 1; document.activeElement = editor; options.onFocus?.({ dom, editor, row }); };
  const selection = { removeAllRanges() {}, addRange() {} };
  const window = { getSelection: () => selection }; window.top = window;
  const location = { protocol: "app:", hostname: "-", pathname: "/index.html" };
  const sandbox = { window, document, location };
  const client = {
    executionContexts: new Map([[1, { id: 1, auxData: { frameId: "main", isDefault: true } }]]),
    calls: [],
    async send(method, params = {}) {
      this.calls.push({ method, params });
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: options.frameUrl || "app://-/index.html" } } };
      if (method === "Runtime.enable") { await options.onRuntimeEnable?.(); return {}; }
      assert.equal(method, "Runtime.evaluate");
      assert.equal(params.contextId, 1);
      assert.equal(params.awaitPromise, false);
      state.phases += 1;
      if (state.phases === 2) options.beforeSubmit?.({ state, dom, row, root, editor, send });
      if (options.failPhase === state.phases) throw new Error("Simulated CDP disconnect");
      const value = vm.runInNewContext(params.expression, sandbox);
      if (state.phases === 1) await options.afterPrepare?.();
      return { result: { value: JSON.parse(JSON.stringify(value)) } };
    },
  };
  return { state, dom, row, root, editor, attachment, send, document, window, location, client };
}

test("confirmed current empty composer gets one native click but never a false sent acknowledgement", async () => {
  const f = fixture({ onClick: ({ editor }) => { editor.textContent = ""; } });
  const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
  assert.equal(result.status, "unknown");
  assert.equal(result.code, "submission-awaiting-receipt");
  assert.equal(result.attempted, true);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.clicks, 1);
  assert.deepEqual(f.state.commands, ["insertText"]);
  assert.equal(f.client.calls.some((call) => /Input\.|navigate|reload|createThread|sendMessageFromView/iu.test(call.method)), false);
});

test("existing text, attachments, references or unknown attachment layout are untouched", async () => {
  for (const mutate of [
    (f) => { f.editor.textContent = "User's draft"; },
    (f) => { f.editor.textContent = " "; },
    (f) => { f.attachment.childElementCount = 1; },
    (f) => { f.attachment.attributes["data-visible-attachments"] = "1"; },
    (f) => { f.dom.hasReference = true; },
    (f) => { f.dom.hasAttachmentOutside = true; },
    (f) => { f.dom.attachments = []; },
  ]) {
    const f = fixture(); mutate(f);
    const original = f.editor.textContent;
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "blocked");
    assert.equal(f.editor.textContent, original);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.clicks, 0);
  }
});

test("busy current task and unavailable or ambiguous native identity block without typing", async () => {
  for (const mutate of [
    (f) => { f.dom.buttons.push(element({ "aria-label": "停止" })); },
    (f) => { f.root.attributes["aria-busy"] = "true"; },
    (f) => { f.row.attributes["data-app-action-sidebar-thread-id"] = "local:" + OTHER; },
    (f) => { f.row.attributes["data-app-action-sidebar-thread-host-id"] = "remote"; },
    (f) => { f.dom.rows.push(element({ "data-app-action-sidebar-thread-id": "local:" + OTHER, "aria-current": "page" })); },
    (f) => { f.dom.rows = []; },
    (f) => { f.dom.roots.push(element()); },
    (f) => { f.dom.editors.push(element()); },
    (f) => { f.editor.attributes["aria-disabled"] = "true"; },
  ]) {
    const f = fixture(); mutate(f);
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "blocked");
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.clicks, 0);
  }
});

test("non-native frames, isolated contexts and child-frame execution are blocked", async () => {
  for (const mutate of [
    (f) => { f.window.top = {}; },
    (f) => { f.location.protocol = "https:"; },
    (f) => { f.client.executionContexts = new Map([[1, { id: 1, auxData: { frameId: "child", isDefault: true } }]]); },
    (f) => { f.client.executionContexts = new Map([[1, { id: 1, auxData: { frameId: "main", isDefault: false } }]]); },
    (f) => { f.client.executionContexts.set(2, { id: 2, auxData: { frameId: "main", isDefault: true } }); },
  ]) {
    const f = fixture(); mutate(f);
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "blocked");
    assert.equal(f.state.writes, 0);
  }
  const f = fixture({ frameUrl: "https://example.invalid/" });
  assert.equal((await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT })).status, "blocked");
});

test("target, busy, attachment and text guards are checked again after preparation before clicking", async () => {
  for (const beforeSubmit of [
    ({ row }) => { row.attributes["data-app-action-sidebar-thread-id"] = "local:" + OTHER; },
    ({ dom }) => { dom.buttons.push(element({ "aria-label": "Stop" })); },
    ({ editor }) => { editor.textContent += " User correction"; },
    ({ editor }) => { editor.textContent += " "; },
    ({ dom }) => { dom.attachments[0].childElementCount = 1; },
  ]) {
    const f = fixture({ beforeSubmit });
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "prepared-not-sent");
    assert.equal(result.attempted, false);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.clicks, 0);
    assert.ok(f.editor.textContent.startsWith(PROMPT));
  }
});

test("missing, disabled, ambiguous or unrecognized send button leaves verified text for manual send", async () => {
  for (const mutate of [
    (f) => { f.dom.buttons = []; },
    (f) => { f.send.disabled = true; },
    (f) => { f.send.attributes["aria-disabled"] = "true"; },
    (f) => { f.dom.buttons.push(element({ "aria-label": "Send message" })); },
    (f) => { f.send.attributes["aria-label"] = "Queue a new task"; },
  ]) {
    const f = fixture(); mutate(f);
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "prepared-not-sent");
    assert.equal(result.code, "send-control-unavailable");
    assert.equal(f.editor.textContent, PROMPT);
    assert.equal(f.state.clicks, 0);
  }
});

test("focus-triggered navigation or drafts are rechecked before any text mutation", async () => {
  for (const onFocus of [
    ({ row }) => { row.attributes["data-app-action-sidebar-thread-id"] = "local:" + OTHER; },
    ({ editor }) => { editor.textContent = "Restored draft"; },
  ]) {
    const f = fixture({ onFocus });
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, "blocked");
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.clicks, 0);
  }
});

test("uncertain preparation or submission never retries and distinguishes possible sends", async () => {
  for (const [options, expectedStatus, attempted] of [
    [{ failPhase: 1 }, "prepared-not-sent", false],
    [{ failPhase: 2 }, "unknown", true],
    [{ partialInsert: true }, "prepared-not-sent", false],
    [{ onClick: () => { throw new Error("after click"); } }, "unknown", true],
  ]) {
    const f = fixture(options);
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.attempted, attempted);
    assert.ok(f.state.writes <= 1);
    assert.ok(f.state.clicks <= 1);
    assert.ok(f.state.phases <= 2);
  }
});

test("concurrent confirmations on one client cannot cause two native clicks", async () => {
  const f = fixture();
  const results = await Promise.all([
    executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT }),
    executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["blocked", "unknown"]);
  assert.equal(results.find((result) => result.status === "blocked").code, "execution-pending");
  assert.equal(f.state.clicks, 1);
});

test("invalid local identity and invalid prompts are rejected before any CDP request", async () => {
  for (const [threadId, prompt] of [
    ["cloud:" + THREAD, PROMPT], ["client-new", PROMPT], [THREAD + "/suffix", PROMPT],
    [THREAD, ""], [THREAD, " ".repeat(10)], [THREAD, "\0unsafe"], [THREAD, "x".repeat(16_001)],
  ]) {
    const f = fixture();
    assert.equal((await executeConfirmedContext({ client: f.client, threadId, prompt })).status, "blocked");
    assert.equal(f.client.calls.length, 0);
  }
});

test("confirmation is revalidated after native context discovery and before any preparation", async () => {
  let version = 1;
  const expectedVersion = version;
  const f = fixture({ onRuntimeEnable: async () => { version += 1; } });
  let validations = 0;
  const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT,
    validateConfirmation: async () => { validations += 1; return version === expectedVersion; } });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "confirmation-changed");
  assert.equal(result.prepared, false);
  assert.equal(result.attempted, false);
  assert.equal(validations, 1);
  assert.equal(f.state.phases, 0);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.clicks, 0);
});

test("a changed confirmation during preparation leaves text intact without invoking submit", async () => {
  let version = 1;
  const expectedVersion = version;
  const f = fixture({ afterPrepare: async () => { version += 1; } });
  const observedPhases = [];
  const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT,
    validateConfirmation: async () => { observedPhases.push(f.state.phases); return version === expectedVersion; } });
  assert.equal(result.status, "prepared-not-sent");
  assert.equal(result.code, "confirmation-changed");
  assert.equal(result.prepared, true);
  assert.equal(result.attempted, false);
  assert.deepEqual(observedPhases, [0, 1]);
  assert.equal(f.state.phases, 1);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.clicks, 0);
  assert.equal(f.editor.textContent, PROMPT);
});

test("confirmation validators fail closed on errors and any non-true response in either phase", async () => {
  for (const failureAt of [1, 2]) {
    for (const failure of [false, undefined, null, "true", "throws"]) {
      const f = fixture();
      let calls = 0;
      const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT,
        validateConfirmation: async () => {
          await Promise.resolve();
          if (++calls !== failureAt) return true;
          if (failure === "throws") throw new Error("Version check unavailable");
          return failure;
        } });
      assert.equal(result.status, failureAt === 1 ? "blocked" : "prepared-not-sent");
      assert.equal(result.code, "confirmation-changed");
      assert.equal(result.prepared, failureAt === 2);
      assert.equal(result.attempted, false);
      assert.equal(calls, failureAt);
      assert.equal(f.state.phases, failureAt - 1);
      assert.equal(f.state.clicks, 0);
      assert.equal(f.editor.textContent, failureAt === 1 ? "" : PROMPT);
    }
  }
});

test("valid confirmation permits one submit and lost submit replies remain unknown", async () => {
  for (const failPhase of [undefined, 2]) {
    const f = fixture({ failPhase });
    const observedPhases = [];
    const result = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT,
      validateConfirmation: async () => { observedPhases.push(f.state.phases); return true; } });
    assert.deepEqual(observedPhases, [0, 1]);
    assert.equal(result.status, "unknown");
    assert.equal(result.attempted, true);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.phases, 2);
    assert.equal(f.state.clicks, failPhase ? 0 : 1);
  }
  const f = fixture();
  const invalid = await executeConfirmedContext({ client: f.client, threadId: THREAD, prompt: PROMPT, validateConfirmation: true });
  assert.equal(invalid.code, "invalid-confirmation");
  assert.equal(f.client.calls.length, 0);
});
