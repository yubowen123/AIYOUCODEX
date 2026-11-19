import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { readOptionalThemeSource } from "../lib/theme-package.mjs";

test("doctor confirms the pinned package without requiring Codex to be running", () => {
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--json", "--port", "65534"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_TASKBOARD_PORT: "65533",
      CODEX_ASSET_CONSOLE_PORT: "65532",
      CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: "/missing/codex-sidebar-runtime.json",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.package.ready, true);
  assert.equal(report.package.taskboardVersion, "0.2.0-codexoptimiz.20260831");
  assert.equal(report.node.supported, true);
  assert.equal(report.codex.reachable, false);
  assert.equal(report.taskboard.reachable, false);
  assert.equal(report.assetConsole.packaged, true);
  assert.equal(report.assetConsole.reachable, false);
});

test("doctor uses the AIYOUcodex product name in human-readable output", () => {
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--port", "65534"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_TASKBOARD_PORT: "65533",
      CODEX_ASSET_CONSOLE_PORT: "65532",
      CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: "/missing/codex-sidebar-runtime.json",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^AIYOUcodex package: ready$/m);
});

test("strict doctor fails when package exists but runtime services are offline", () => {
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--strict", "--json", "--port", "65534"], {
    encoding: "utf8",
    env: { ...process.env, CODEX_TASKBOARD_PORT: "65533", CODEX_ASSET_CONSOLE_PORT: "65532",
      CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: "/missing/codex-sidebar-runtime.json" },
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.package.ready, true);
  assert.equal(report.runtimeReady, false);
  assert.deepEqual(report.renderers, []);
});

test("strict doctor accepts the complete live renderer source and rejects a stale source", async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const profile = await mkdtemp(path.join(os.tmpdir(), "aiyou-doctor-"));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const files = ["conversation-preview", "claude-code", "agent-workspace", "openchatcut"];
  const scripts = await Promise.all(files.map(name => readFile(path.join(root, "inject", `${name}.user.js`), "utf8")));
  const script = [...scripts, await readOptionalThemeSource(root)].join("\n");
  const installedHash = createHash("sha256").update(script).update("[]").digest("hex");
  const epoch = "fixture-document";
  const snapshot = {
    alive: true,
    sourceHash: installedHash,
    documentEpoch: epoch,
    health: {
      ready: true,
      documentEpoch: epoch,
      runtimeVersion: "fixture",
      components: { sidebar: "ready", header: "ready", shortcuts: "ready" },
    },
  };
  const server = createServer((request, response) => {
    if (request.url === "/json") {
      const { port } = server.address();
      response.end(JSON.stringify([{
        id: "fixture-renderer",
        type: "page",
        url: "app://-/index.html",
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/renderer`,
      }]));
    } else if (["/json/version", "/health", "/"].includes(request.url)) {
      response.end("{}");
    } else {
      response.writeHead(404).end();
    }
  });
  const sockets = new WebSocketServer({ server, path: "/renderer" });
  sockets.on("connection", socket => socket.on("message", request => {
    const { id } = JSON.parse(request.toString());
    socket.send(JSON.stringify({ id, result: { result: { value: snapshot } } }));
  }));
  t.after(() => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    return new Promise(resolve => server.close(resolve));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = String(server.address().port);
  const env = {
    ...process.env,
    CODEX_TASKBOARD_PORT: port,
    CODEX_ASSET_CONSOLE_PORT: port,
    CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: path.join(profile, "runtime.json"),
    CODEX_SIDEBAR_MANAGED_SHORTCUTS_PATH: path.join(profile, "shortcuts.json"),
  };
  const runDoctor = () => new Promise(resolve => {
    execFile(process.execPath, ["scripts/doctor.mjs", "--strict", "--json", "--port", port], {
      cwd: root, env, timeout: 10_000,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });

  const current = await runDoctor();
  assert.equal(current.error, null, current.stderr || current.stdout);
  assert.equal(JSON.parse(current.stdout).runtimeReady, true);

  snapshot.sourceHash = "0".repeat(64);
  const stale = await runDoctor();
  assert.equal(stale.error?.code, 1, stale.stderr);
  const report = JSON.parse(stale.stdout);
  assert.equal(report.runtimeReady, false);
  assert.deepEqual(report.renderers[0].failures, ["renderer-source-stale-or-unverified"]);
});
