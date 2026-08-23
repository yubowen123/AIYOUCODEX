import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../vendor/codex-taskboard/", import.meta.url);

test("vendored Taskboard is the pinned custom project-management snapshot", async () => {
  const manifest = JSON.parse(await readFile(new URL("VERSION.json", root), "utf8"));
  assert.deepEqual(
    {
      version: manifest.version,
      ref: manifest.ref,
      baseCommit: manifest.baseCommit,
      license: manifest.license,
      snapshotSource: manifest.snapshotSource,
    },
    {
      version: "0.1.0-codexoptimiz.20260813",
      ref: "custom-working-tree-2026-08-13",
      baseCommit: "677b544",
      license: "Apache-2.0",
      snapshotSource: "019fe64a-ace1-7793-92aa-4d91195005ec",
    },
  );
  await access(new URL("LICENSE", root));
  await access(new URL("dist/web/index.html", root));
  await access(new URL("web/src/components/ProjectSwimlaneBoard.tsx", root));
});

test("custom Taskboard retains the six-lane project management implementation", async () => {
  const app = await readFile(new URL("web/src/App.tsx", root), "utf8");
  const swimlane = await readFile(new URL("web/src/components/ProjectSwimlaneBoard.tsx", root), "utf8");
  const profilePanel = await readFile(new URL("web/src/components/ProjectProfilePanel.tsx", root), "utf8");
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  assert.match(app, /<ProjectSwimlaneBoard/);
  assert.match(swimlane, /跨项目六泳道看板/);
  assert.match(swimlane, /project-swimlane-resize-handle/);
  assert.match(swimlane, /onMoveTask/);
  assert.match(swimlane, /projectUrgencies/);
  assert.match(app, /project-folder-filter/);
  assert.match(
    app,
    /profile\?\.workspacePath\s*\?\? deviceWorkspacePaths\[codexProjectId\][\s\S]*?\?\? deviceProject\?\.workspacePath[\s\S]*?\?\? project\.workspacePath/,
  );
  assert.match(app, /listDeviceProjects\(signal\)/);
  assert.match(swimlane, /taskGuidance\(task\)/);
  assert.match(app, /saveSelectedProjectProfile/);
  assert.match(profilePanel, /项目描述/);
  assert.match(profilePanel, /下一步规划/);
  assert.match(profilePanel, /匹配 Codex 项目/);
  assert.match(injection, /const ENTRY_LABEL = "项目管理"/);
});

test("custom Taskboard keeps full-workspace embedding and the loopback null-origin fix", async () => {
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  const server = await readFile(new URL("server/app.mjs", root), "utf8");
  assert.match(injection, /codex-taskboard-page/);
  assert.match(injection, /codex-taskboard-frame/);
  assert.match(server, /origin === "null" && isLoopbackAddress/);
  assert.match(server, /access-control-allow-private-network/);
});

test("custom Taskboard finds the plugin entry through Codex contents wrappers", async () => {
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  assert.match(injection, /function directShortcutButtons\(group\)/);
  assert.match(injection, /:scope > button, :scope > \* > button/);
  assert.match(injection, /function shortcutSiblingGroup\(button\)/);
  assert.match(injection, /const pluginGroup = shortcutSiblingGroup\(plugin\)/);
});

test("custom Taskboard watch mode avoids macOS process probes on Windows", async () => {
  const source = await readFile(new URL("scripts/codex-injector.mjs", root), "utf8");
  assert.match(source, /function codexPids\(\) \{\s+if \(process\.platform === "win32"\) return \[\]/);
  assert.match(source, /function codexDebuggingPorts\(preferredPort\)[\s\S]*?process\.platform === "win32"/);
  assert.match(source, /function processCwd\(pid\) \{\s+if \(process\.platform === "win32"\) return null/);
  assert.match(source, /function residentInjectorPids\(port\) \{\s+if \(process\.platform === "win32"\) return \[\]/);
});
