import assert from "node:assert/strict";
import test from "node:test";

import * as bridge from "../lib/asset-console-bridge.mjs";

test("library scans receive a longer bridge timeout than ordinary requests", () => {
  assert.equal(typeof bridge.assetConsoleTimeoutForRoute, "function", "route timeout policy is not implemented");
  assert.equal(bridge.assetConsoleTimeoutForRoute("/api/library?project=test"), 35_000);
  assert.equal(bridge.assetConsoleTimeoutForRoute("/api/projects"), 15_000);
  assert.equal(bridge.assetConsoleTimeoutForRoute("/"), 15_000);
});
