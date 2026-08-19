import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("public package contains every managed runtime and excludes local-only output", () => {
  const result = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }))[0];
  const files = new Set(result.files.map((entry) => entry.path));
  const required = [
    "inject/conversation-preview.user.js",
    "scripts/runtime.mjs",
    "vendor/codex-taskboard/VERSION.json",
    "vendor/codex-taskboard/dist/web/index.html",
    "vendor/codex-taskboard/dist/web/assets/index-D79x4FKE.js",
    "vendor/codex-workspace-enhancer/asset-browser/asset-library-filter.js",
    "vendor/codex-workspace-enhancer/asset-browser/asset-scan-coordinator.js",
    "vendor/codex-workspace-enhancer/asset-browser/server.js",
    "vendor/codex-workspace-enhancer/asset-console/public/index.html",
    "install.sh",
    "install.ps1",
    "uninstall.sh",
    "uninstall.ps1",
  ];

  assert.deepEqual(required.filter((entry) => !files.has(entry)), []);
  assert.equal([...files].some((entry) => entry.startsWith("output/")), false);
  assert.equal([...files].some((entry) => entry.includes("node_modules/")), false);
});
