import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replaceFileAtomically } from "../vendor/codex-workspace-enhancer/asset-browser/atomic-file-replace.js";

test("Windows atomic config replacement tolerates short reader locks without removing the old file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aiyou-atomic-replace-"));
  const source = path.join(root, "config.tmp"), target = path.join(root, "config.json");
  try {
    await writeFile(source, "new"); await writeFile(target, "old");
    const pauses = [], attempts = [];
    await replaceFileAtomically(source, target, { platform: "win32",
      wait: async (ms) => { pauses.push(ms); assert.equal(await readFile(target, "utf8"), "old"); },
      rename: async (from, to) => {
        attempts.push([from, to]);
        if (attempts.length <= 3) throw Object.assign(new Error("temporarily busy"), { code: ["EPERM", "EACCES", "EBUSY"][attempts.length - 1] });
        await rename(from, to);
      },
    });
    assert.deepEqual(pauses, [25, 50, 100]);
    assert.deepEqual(attempts, Array.from({ length: 4 }, () => [source, target]));
    assert.equal(await readFile(target, "utf8"), "new");
    await assert.rejects(readFile(source), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replacement failures remain bounded and do not retry unrelated errors or platforms", async () => {
  for (const [platform, code, expectedAttempts] of [["win32", "EPERM", 6], ["win32", "ENOENT", 1], ["darwin", "EPERM", 1]]) {
    const failure = Object.assign(new Error("replace failed"), { code });
    let attempts = 0;
    const pauses = [];
    await assert.rejects(replaceFileAtomically("pending.tmp", "config.json", { platform,
      rename: async () => { attempts++; throw failure; }, wait: async (ms) => pauses.push(ms),
    }), (error) => error === failure);
    assert.equal(attempts, expectedAttempts);
    assert.ok(pauses.reduce((sum, ms) => sum + ms, 0) <= 775);
    assert.equal(pauses.length, expectedAttempts - 1);
  }
});
