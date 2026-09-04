import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../inject/conversation-preview.user.js", import.meta.url),
  "utf8",
);

const apiNames = [
  "canonicalShortcutLabel",
  "canonicalSectionLabel",
  "isPinActionLabel",
  "isProjectActionsLabel",
  "isFolderCreateLabel",
  "isShowMoreLabel",
];

function runtimeFunctionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the active userscript`);
  const next = source.indexOf("\n  function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function loadNativeLabelApi() {
  const sentinelAssignment = "  window[SENTINEL] = {";
  assert.ok(
    source.includes(sentinelAssignment),
    "conversation preview source must retain its public API assignment",
  );
  for (const name of apiNames) {
    assert.ok(
      new RegExp(`function\\s+${name}\\s*\\(`).test(source),
      `${name} must be implemented as a runtime function`,
    );
  }

  const instrumented = source.replace(
    sentinelAssignment,
    `  window.__nativeSidebarLabelTestApi__ = { ${apiNames.join(", ")} };\n${sentinelAssignment}`,
  );
  const storage = new Map();
  const sandbox = {
    console,
    document: {
      readyState: "loading",
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return storage.get(String(key)) ?? null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
      removeItem(key) { storage.delete(String(key)); },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(instrumented, sandbox, {
    filename: "conversation-preview.user.js",
  });
  return sandbox.__nativeSidebarLabelTestApi__;
}

const labels = loadNativeLabelApi();

test("native shortcut labels canonicalize current English and legacy Chinese DOM", () => {
  const cases = [
    ["新对话", "新对话"],
    ["New chat", "新对话"],
    ["  NEW   CHAT  ", "新对话"],
    ["Ｎｅｗ　ｃｈａｔ", "新对话"],
    ["拉取请求", "拉取请求"],
    ["Pull Request", "拉取请求"],
    ["Pull requests", "拉取请求"],
    ["站点", "站点"],
    ["Sites", "站点"],
    ["已安排", "已安排"],
    ["Scheduled", "已安排"],
    ["插件", "插件"],
    ["Plugins", "插件"],
    ["更多", "更多"],
    ["Explore", "更多"],
    ["More", "更多"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(labels.canonicalShortcutLabel(input), expected, input);
  }
  assert.equal(
    labels.canonicalShortcutLabel("  Custom   Ｔool  "),
    "Custom   Ｔool",
    "unknown native entries retain their trimmed display label",
  );
});

test("native section labels canonicalize English headings without changing internal keys", () => {
  const cases = [
    ["置顶", "置顶"],
    ["Pinned", "置顶"],
    ["  PINNED  ", "置顶"],
    ["Ｐｉｎｎｅｄ", "置顶"],
    ["项目", "项目"],
    ["Projects", "项目"],
    ["最近", "最近"],
    ["Recents", "最近"],
    ["优先级", "优先级"],
    ["Priority", "优先级"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(labels.canonicalSectionLabel(input), expected, input);
  }
  assert.equal(
    labels.canonicalSectionLabel("  Ａrchive   group  "),
    "Ａrchive   group",
    "unknown native sections retain their trimmed display label",
  );
});

test("native pin labels accept both locales and reject unrelated actions", () => {
  for (const input of [
    "置顶聊天",
    "取消置顶聊天",
    "Pin chat",
    "Unpin chat",
    "  UNPIN   CHAT  ",
    "Ｐｉｎ　ｃｈａｔ",
  ]) {
    assert.equal(labels.isPinActionLabel(input), true, input);
  }
  for (const input of ["", "Archive chat", "Pin project", "置顶项目"]) {
    assert.equal(labels.isPinActionLabel(input), false, input);
  }
});

test("native project action labels match the intended folder in both locales", () => {
  const folder = "为创新而生";
  for (const input of [
    `${folder} 的项目操作`,
    `Project actions for ${folder}`,
    `  PROJECT   ACTIONS  FOR   ${folder}  `,
    "Ｐｒｏｊｅｃｔ　ａｃｔｉｏｎｓ　ｆｏｒ　为创新而生",
  ]) {
    assert.equal(labels.isProjectActionsLabel(input, folder), true, input);
  }
  assert.equal(labels.isProjectActionsLabel("Project actions for 管理优化", folder), false);
  assert.equal(labels.isProjectActionsLabel("Project actions", folder), false);
});

test("native folder-create labels match the intended folder in both locales", () => {
  const folder = "为创新而生";
  for (const input of [
    `在 ${folder} 中开始新聊天`,
    `Start new chat in ${folder}`,
    `  START   NEW CHAT IN   ${folder}  `,
    "Ｓｔａｒｔ　ｎｅｗ　ｃｈａｔ　ｉｎ　为创新而生",
  ]) {
    assert.equal(labels.isFolderCreateLabel(input, folder), true, input);
  }
  assert.equal(labels.isFolderCreateLabel("Start new chat in 管理优化", folder), false);
  assert.equal(labels.isFolderCreateLabel("New chat", folder), false);
});

test("native expand labels accept Show more but remain fail-closed", () => {
  for (const input of ["展开显示", "Show more", "  SHOW   MORE  ", "Ｓｈｏｗ　ｍｏｒｅ"]) {
    assert.equal(labels.isShowMoreLabel(input), true, input);
  }
  for (const input of ["", "Show less", "展开全部", "More options"]) {
    assert.equal(labels.isShowMoreLabel(input), false, input);
  }
});

test("canonical helpers are wired into every native DOM discovery and action path", () => {
  assert.match(runtimeFunctionSource("shortcutLabel"), /canonicalShortcutLabel/);
  assert.match(runtimeFunctionSource("findNativeShortcutButton"), /canonicalShortcutLabel/);
  assert.match(runtimeFunctionSource("sectionLabel"), /canonicalSectionLabel/);
  assert.match(runtimeFunctionSource("nativeSectionSource"), /canonicalSectionLabel/);
  assert.match(runtimeFunctionSource("nativePrioritySource"), /canonicalSectionLabel/);
  assert.match(runtimeFunctionSource("handlePinDocumentClick"), /isPinActionLabel/);
  assert.match(runtimeFunctionSource("nativeFolderSources"), /isProjectActionsLabel/);
  assert.match(runtimeFunctionSource("nativeFolderCreateButton"), /isFolderCreateLabel/);
  assert.match(runtimeFunctionSource("requestCompleteNativeFolderList"), /isShowMoreLabel/);
  assert.match(runtimeFunctionSource("revealFolderSearchMatch"), /isShowMoreLabel/);
});
