import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExactDuplicateCleaner,
  normalizeDeduplication,
} from "../vendor/codex-workspace-enhancer/asset-browser/duplicate-cleaner.js";

test("automatic whole-library duplicate sweeps are opt-in", () => {
  assert.equal(normalizeDeduplication({}).automaticSweep, false);
  assert.equal(normalizeDeduplication({ automaticSweep: true }).automaticSweep, true);
});

test("duplicate candidate timers have a hard bound during watcher storms", () => {
  const cleaner = new ExactDuplicateCleaner({ ledgerPath: path.join(os.tmpdir(), "duplicate-cleaner-test.json") });
  const project = { id: "story", path: path.resolve("/workspace/story") };
  for (let index = 0; index < 1000; index += 1) {
    cleaner.schedule({
      filePath: path.resolve(`/workspace/story/image-${index}.png`),
      project,
      config: { settleSeconds: 60 },
    });
  }
  assert.equal(cleaner.pending.size, 512);
  for (const timer of cleaner.pending.values()) clearTimeout(timer);
  cleaner.pending.clear();
});
