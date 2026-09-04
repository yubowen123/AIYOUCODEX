import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  changeAffectsProject,
  CoalescingPathUpdateQueue,
  createPathPrefixMatcher,
  isIgnoredAssetPath,
  isIgnoredAssetPathWithinRoots,
} from "../vendor/codex-workspace-enhancer/asset-browser/asset-index-update-utils.js";

test("asset changes are routed by project roots without scanning existing assets", () => {
  const project = { id: "story", folders: [path.resolve("/workspace/story")] };
  assert.equal(changeAffectsProject(project, { changedPath: "/workspace/story/角色/hero.png" }), true);
  assert.equal(changeAffectsProject(project, { changedPath: "/workspace/other/hero.png" }), false);
  assert.equal(changeAffectsProject(project, { changedPath: "/external/hero.png" }, {
    [path.resolve("/external/hero.png")]: "story",
  }), true);
});

test("path prefix matcher stays proportional to path depth for large change bursts", () => {
  const prefixes = Array.from({ length: 5000 }, (_, index) => path.resolve(`/workspace/assets/folder-${index}`));
  const matches = createPathPrefixMatcher(prefixes);
  assert.equal(matches(path.resolve("/workspace/assets/folder-4999/角色/hero.png")), true);
  assert.equal(matches(path.resolve("/workspace/assets/unrelated/hero.png")), false);
});

test("watcher updates coalesce into one pending batch while a batch is running", async () => {
  const batches = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new CoalescingPathUpdateQueue(async (paths) => {
    batches.push(paths);
    if (batches.length === 1) await firstBlocked;
    return { paths: paths.length };
  });
  const first = queue.enqueue(["/workspace/first.png"]);
  const pending = Array.from({ length: 5000 }, (_, index) =>
    queue.enqueue([`/workspace/burst-${index}.png`]));
  releaseFirst();
  await Promise.all([first, ...pending]);
  assert.equal(batches.length, 2);
  assert.equal(batches[1].length, 5000);
});

test("generated dependency and cache folders are ignored by scans and watchers", () => {
  assert.equal(isIgnoredAssetPath("/workspace/project/node_modules/pkg/icon.png", "/workspace/project"), true);
  assert.equal(isIgnoredAssetPath("/workspace/project/dist/report/preview.png", "/workspace/project"), true);
  assert.equal(isIgnoredAssetPath("/workspace/project/角色/hero.png", "/workspace/project"), false);
});

test("ignored-directory checks do not reject assets because of system temp ancestors", () => {
  const scanRoot = path.join(path.parse(process.cwd()).root, "Temp", "asset-project");
  const assetPath = path.join(scanRoot, "角色", "hero.png");
  assert.equal(isIgnoredAssetPath(assetPath), true, "the old absolute-path check reproduces the Windows Temp false positive");
  assert.equal(isIgnoredAssetPathWithinRoots(assetPath, [scanRoot]), false);
  assert.equal(isIgnoredAssetPathWithinRoots(path.join(scanRoot, "node_modules", "pkg", "icon.png"), [scanRoot]), true);
});
