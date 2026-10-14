import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("public package contains every managed runtime and excludes local-only output", () => {
  const packageMetadata = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageMetadata.name, "aiyoucodex");
  assert.match(packageMetadata.description, /^AIYOUcodex\b/);
  const result = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }))[0];
  const files = new Set(result.files.map((entry) => entry.path));
  const taskboardIndex = readFileSync(path.join(root, "vendor/codex-taskboard/dist/web/index.html"), "utf8");
  const taskboardEntry = taskboardIndex.match(/src="(?:\.\/|\/)assets\/([^"]+\.js)"/)?.[1];
  assert.ok(taskboardEntry, "built Taskboard entry script must be referenced by index.html");
  const required = [
    "inject/conversation-preview.user.js",
    "inject/openchatcut.user.js",
    "lib/app-lifecycle.mjs",
    "lib/laya-document-search.mjs",
    "lib/skill-search.mjs",
    "lib/renderer-source.mjs",
    "lib/codex-model-proxy.mjs",
    "lib/codex-model-router.mjs",
    "lib/deepseek-settings.mjs",
    "lib/deepseek-config.mjs",
    "models/deepseek-flash.json",
    "scripts/deepseek-auth.mjs",
    "scripts/codex-model-proxy.mjs",
    "scripts/laya-search-worker.py",
    "vendor/codex-workspace-enhancer/asset-browser/asset-library-search.js",
    "lib/openchatcut-background.mjs",
    "lib/openchatcut-process.mjs",
    "inject/agent-workspace.user.js",
    "docs/AGENT-WORKSPACE.md",
    ...["discovery", "conversations", "session-import", "workspace"].map(name => `lib/agent-${name}.mjs`),
    "lib/openchatcut-controller.mjs",
    "lib/openchatcut-install.mjs",
    "lib/openchatcut-import.mjs",
    "lib/openchatcut-mcp.mjs",
    "lib/openchatcut-embed.mjs",
    "lib/openchatcut-settings.mjs",
    "lib/openchatcut-routing-hook.mjs",
    "lib/bundled-plugin-install.mjs",
    "scripts/install-bundled-plugins.mjs",
    "plugins/.agents/plugins/marketplace.json",
    "plugins/openchatcut/.codex-plugin/plugin.json",
    "plugins/openchatcut/.mcp.json",
    "plugins/openchatcut/server/index.mjs",
    "plugins/openchatcut/server/controller-client.mjs",
    "plugins/openchatcut/skills/edit-video/SKILL.md",
    "plugins/openchatcut/skills/edit-video/references/workflows.md",
    "scripts/runtime.mjs",
    "scripts/reset-announcements.mjs",
    "lib/reset-announcements.mjs",
    "lib/reset-monitor.mjs",
    "lib/reset-monitor-store.mjs",
    "lib/reset-monitor-worker.mjs",
    "lib/reset-monitor-service.mjs",
    "lib/reset-classifier.mjs",
    "scripts/reset-monitor-worker.mjs",
    "scripts/install-reset-monitor.mjs",
    "lib/reset-rss.mjs",
    "docs/RESET-MONITOR.md",
    ...["index.html", "app.js", "style.css"].map(name => `model-arena/public/${name}`),
    ...["catalog", "providers", "local-extension", "media", "service", "http"].map(name => `lib/model-arena/${name}.mjs`),
    "vendor/codex-taskboard/VERSION.json",
    "vendor/codex-taskboard/dist/web/index.html",
    `vendor/codex-taskboard/dist/web/assets/${taskboardEntry}`,
    "vendor/codex-workspace-enhancer/asset-browser/asset-library-filter.js",
    "vendor/codex-workspace-enhancer/asset-browser/image-dimensions.js",
    "vendor/codex-workspace-enhancer/asset-browser/asset-scan-coordinator.js",
    "vendor/codex-workspace-enhancer/asset-browser/persistent-asset-index.js",
    "vendor/codex-workspace-enhancer/asset-browser/codex-prompt-associations.js",
    "vendor/codex-workspace-enhancer/asset-browser/codex-production-project-sync.js",
    "vendor/codex-workspace-enhancer/asset-browser/server.js",
    "vendor/codex-workspace-enhancer/asset-console/public/index.html",
    "vendor/codex-workspace-enhancer/asset-console/public/asset-metadata-ui.js",
    "install.sh",
    "install.ps1",
    "uninstall.sh",
    "uninstall.ps1",
  ];

  assert.deepEqual(required.filter((entry) => !files.has(entry)), []);
  assert.equal([...files].some((entry) => entry.startsWith("output/")), false);
  assert.equal([...files].some((entry) => entry.includes("node_modules/")), false);
});
