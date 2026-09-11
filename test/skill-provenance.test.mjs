import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile, mkdir, appendFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSkillProvenanceIndex, skillPatchInvocation } from "../lib/skill-provenance.mjs";
import { createSkillOrganizationController } from "../lib/skill-organization.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (type, payload, day = 1) => ({ timestamp: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, type, payload });
const meta = (threadId, cwd) => event("session_meta", { id: threadId, cwd });
function patchEvents(file, { day = 1, kind = "Update", wrapped = false, success = true } = {}) {
  const patch = `*** Begin Patch\n*** ${kind} File: ${file}\n${kind === "Update" ? "@@\n-old\n+new" : "+new"}\n*** End Patch`;
  const call = { type: "custom_tool_call", name: wrapped ? "exec" : "apply_patch", call_id: `call-${day}`, input: wrapped ? `text(await tools.apply_patch(${JSON.stringify(patch)}));` : patch };
  const output = { type: "custom_tool_call_output", call_id: call.call_id, output: wrapped
    ? [{ type: "input_text", text: "Script completed\nOutput:\n" }, { type: "input_text", text: success ? "{}" : "Error: patch rejected" }]
    : success ? `Success. Updated the following files:\n${kind === "Add" ? "A" : "M"} ${file}` : "Failed to find expected lines" };
  return [event("response_item", call, day), event("response_item", output, day)];
}

test("only unconditional patch calls are parsed; text, shell commands and code examples never count", () => {
  const [row] = patchEvents("/test/SKILL.md", { wrapped: true });
  assert.equal(skillPatchInvocation(row.payload).changes[0].kind, "updated");
  for (const payload of [{ name: "exec", input: `if(false){${row.payload.input}}` }, { name: "exec_command", arguments: '{"cmd":"cat /test/SKILL.md"}' }, { name: "read_file", input: "/test/SKILL.md" }]) assert.equal(skillPatchInvocation(payload), null);
});

test("trace returns latest verified modification, ignores usage/failed writes, persists cursors and isolates same-name Skills", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "skill-trace-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsRoot = path.join(root, "skills");
  for (const name of ["a", "b"]) { await mkdir(path.join(skillsRoot, name), { recursive: true }); await writeFile(path.join(skillsRoot, name, "SKILL.md"), "---\nname: same-name\ndescription: fixture\n---\n"); }
  const catalog = await readInstalledSkillCatalog({ roots: [skillsRoot] });
  const [a, b] = catalog;
  const sessions = [];
  const save = async (n, rows) => {
    const filePath = path.join(root, `${n}.jsonl`);
    await writeFile(filePath, [meta(id(n), root), ...rows].map((row) => JSON.stringify(row)).join("\n") + "\n");
    sessions.push({ threadId: id(n), title: `Task ${n}`, filePath }); return filePath;
  };
  await save(1, patchEvents(a.skillFile, { kind: "Add" }));
  const modified = await save(2, patchEvents("skills/a/SKILL.md", { day: 3, wrapped: true }));
  await save(3, [event("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: `I modified ${a.skillFile}` }] }, 9), ...patchEvents(a.skillFile, { day: 9, success: false })]);
  await save(4, patchEvents(b.skillFile, { kind: "Add", day: 4 }));
  const options = { listSessions: async () => sessions, filePath: path.join(root, "state/provenance.json"), byteBudget: 500, maxLineBytes: 2048, timeBudgetMs: 10_000 };
  let index = createSkillProvenanceIndex(options);
  const settle = async (skill) => { let answer; for (let n = 0; n < 40; n++) { answer = await index.trace(skill, catalog); if (answer.status !== "indexing") return answer; } assert.fail("Index did not converge"); };
  let result = await settle(a);
  assert.equal(result.threadId, id(2)); assert.equal(result.kind, "updated"); assert.equal(result.title, "Task 2");
  const state = await readFile(options.filePath, "utf8");
  assert.ok(!state.includes("I modified")); assert.ok(!state.includes("*** Begin Patch"));
  assert.equal((await settle(b)).threadId, id(4));
  index = createSkillProvenanceIndex(options);
  assert.equal((await index.trace(a, catalog)).status, "found", "Unchanged files resume from persisted byte offsets without rescanning");
  // Added helper files are optimization, not a new Skill creation.
  await appendFile(sessions[0].filePath, patchEvents(path.join(a.path, "scripts/new.mjs"), { kind: "Add", day: 10 }).map((row) => JSON.stringify(row)).join("\n") + "\n");
  result = await settle(a); assert.equal(result.threadId, id(1)); assert.equal(result.kind, "updated");
  // Replaced/truncated rollout must lose stale associations.
  await writeFile(modified, JSON.stringify(meta(id(2), root)) + "\n");
  await writeFile(sessions[0].filePath, JSON.stringify(meta(id(1), root)) + "\n");
  assert.equal((await settle(a)).status, "unassociated");
  const controller = createSkillOrganizationController({ readCatalog: async () => catalog, trace: index.trace });
  await assert.rejects(controller.request({ action: "traceSkill", skillId: "same-name" }));
  await assert.rejects(controller.request({ action: "traceSkill", skillId: a.id, threadId: id(4) }));
  assert.equal((await controller.request({ action: "traceSkill", skillId: b.id })).traceResult.threadId, id(4));
});

test("native patch receipts require session identity and success, and oversized histories are disclosed", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "skill-trace-native-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = { id: "skill:" + "a".repeat(64), skillFile: path.join(root, "skill/SKILL.md") };
  const filePath = path.join(root, "history.jsonl");
  const receipt = event("event_msg", { type: "patch_apply_end", success: true, changes: { [skill.skillFile]: { type: "add" } } });
  await writeFile(filePath, [meta(id(1), root), receipt, event("response_item", { type: "message", text: "x".repeat(9000) })].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const index = createSkillProvenanceIndex({ listSessions: async () => [{ threadId: id(1), title: "Creator", filePath }], filePath: path.join(root, "index.json"), maxLineBytes: 1024 });
  const result = await index.trace(skill, [skill]);
  assert.equal(result.threadId, id(1)); assert.equal(result.coverageLimited, true);
});
