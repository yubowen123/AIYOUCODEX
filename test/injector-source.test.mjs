import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");

test("TV host binding is restored for every renderer execution context", () => {
  assert.match(source, /Runtime\.enable/);
  assert.match(source, /Runtime\.executionContextCreated/);
  assert.match(source, /Runtime\.addBinding/);
  assert.match(source, /executionContextId/);
  assert.match(source, /Page\.setBypassCSP/);
  assert.match(source, /request\.url !== TV_URL/);
});

test("renderer source and TV host requests are protected by a per-process token", () => {
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /request\?\.token !== expectedToken/);
  assert.match(source, /if \(window\.top === window\)/);
});
