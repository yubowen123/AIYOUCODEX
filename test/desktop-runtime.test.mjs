import assert from "node:assert/strict";
import test from "node:test";
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";

test('macOS model adapter keeps the existing account and profile while selecting a separate CLI executable', () => {
  const calls = [];
  const proxy = fileURLToPath(new URL('../scripts/codex-model-proxy.mjs', import.meta.url));
  assert.ok(existsSync(proxy));
  const runtime = createDesktopAppRuntime({platform: 'darwin', modelProxyPath: proxy,
    isExecutablePath: candidate => candidate === proxy || candidate === '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    spawnProcess(command, args, options) {calls.push({command, args, options}); return {unref(){}};}});
  runtime.launch('/Applications/ChatGPT.app', 9231, {codexHome: '/original/.codex', userDataDir: '/original/Desktop'});
  assert.ok(calls[0].args.includes('CODEX_CLI_PATH=' + proxy));
  assert.ok(calls[0].args.includes('AIYOUCODEX_NATIVE_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'));
  assert.ok(calls[0].args.includes('CODEX_HOME=/original/.codex'));
  assert.ok(calls[0].args.includes('--user-data-dir=/original/Desktop'));
});

test('macOS recovery binds the CLI belonging to its actual selected app, including a custom location', () => {
  const calls = [];
  const proxy = '/installed/model-proxy';
  const app = '/Volumes/Apps with spaces/Codex.app';
  const selected = app + '/Contents/Resources/codex';
  const otherApp = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const runtime = createDesktopAppRuntime({platform: 'darwin', modelProxyPath: proxy,
    isExecutablePath: candidate => [proxy, selected, otherApp].includes(candidate),
    spawnProcess(command, args) {calls.push({command, args}); return {unref(){}};}});
  runtime.launch(app, 9231);
  assert.ok(calls[0].args.includes(`AIYOUCODEX_NATIVE_CODEX_BINARY=${selected}`));
  assert.ok(calls[0].args.includes(app));
  assert.equal(calls[0].args.some(arg => arg.includes(otherApp)), false);
});

test('macOS does not inject an adapter when the selected app has no runnable CLI', () => {
  const calls = [];
  const runtime = createDesktopAppRuntime({platform: 'darwin', modelProxyPath: '/installed/model-proxy',
    isExecutablePath: candidate => candidate === '/installed/model-proxy'
      || candidate === '/Applications/ChatGPT.app/Contents/Resources/codex',
    spawnProcess(command, args) {calls.push({command, args}); return {unref(){}};}});
  runtime.launch('/other/Codex.app', 9231);
  assert.equal(calls[0].args.some(arg => arg.startsWith('CODEX_CLI_PATH=') || arg.startsWith('AIYOUCODEX_NATIVE_CODEX_BINARY=')), false);
  assert.ok(calls[0].args.includes('/other/Codex.app'));
});

test("Windows runtime reads only the main desktop process and stops it by pid", async () => {
  const calls = [];
  const processList = JSON.stringify({
    ProcessId: 700,
    Name: "Codex.exe",
    ExecutablePath: "C:\\Apps\\Codex.exe",
    CommandLine: '"C:\\Apps\\Codex.exe"',
  });
  const runtime = createDesktopAppRuntime({
    platform: "win32",
    execFileAsync: async (command, args) => {
      calls.push({ command, args });
      if (command === "powershell.exe") return { stdout: processList };
      return { stdout: "" };
    },
    spawnProcess: () => { throw new Error("not used"); },
  });

  assert.deepEqual(await runtime.readProcess(), {
    pid: 700,
    appPath: "C:\\Apps\\Codex.exe",
    appName: "Codex.exe",
  });
  await runtime.quit({ pid: 700 });
  assert.equal(calls[0].command, "powershell.exe");
  assert.deepEqual(calls[1], { command: "taskkill.exe", args: ["/PID", "700", "/T"] });
});

test("Windows runtime launches the discovered executable detached with debugging enabled", () => {
  const calls = [];
  const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const runtime = createDesktopAppRuntime({
    platform: "win32",
    execFileAsync: async () => ({ stdout: "" }),
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  runtime.launch("C:\\Apps\\ChatGPT.exe", 9231);
  assert.deepEqual(calls, [{
    command: "C:\\Apps\\ChatGPT.exe",
    args: [
      "--remote-debugging-port=9231",
      "--remote-allow-origins=http://127.0.0.1:9231",
      "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
    ],
    options: { detached: true, stdio: "ignore" },
  }]);
  assert.equal(child.unrefCalled, true);
});

test("macOS runtime keeps the existing exact process, quit, and open behavior", async () => {
  const calls = [];
  const child = { unref() {} };
  const runtime = createDesktopAppRuntime({
    platform: "darwin",
    home: "/Users/example",
    execFileAsync: async (command, args) => {
      calls.push({ command, args });
      if (command === "/bin/ps") {
        return { stdout: "99 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n" };
      }
      return { stdout: "" };
    },
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  const app = await runtime.readProcess();
  await runtime.quit(app);
  runtime.launch(app.appPath, 9231);
  assert.equal(calls[0].command, "/bin/ps");
  assert.equal(calls[1].command, "/usr/bin/osascript");
  assert.equal(calls[2].command, "/usr/bin/open");
  assert.deepEqual(calls[2].args, [
    "-na",
    "/Applications/ChatGPT.app",
    "--args",
    "--user-data-dir=/Users/example/Library/Application Support/Codex",
    "--remote-debugging-port=9231",
    "--remote-allow-origins=http://127.0.0.1:9231",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ]);
});


test("automatic recovery preserves the selected account home and desktop profile", () => {
  const calls = [];
  const runtime = createDesktopAppRuntime({
    platform: "darwin", home: "/Users/example",
    spawnProcess(command, args) { calls.push({command, args}); return {unref() {}}; },
  });
  runtime.launch("/Applications/ChatGPT.app", 9231, {
    codexHome: "/Users/example/accounts/second/.codex",
    userDataDir: "/Users/example/accounts/second/Desktop profile",
  });
  assert.deepEqual(calls[0].args.slice(0, 2), ["--env", "CODEX_HOME=/Users/example/accounts/second/.codex"]);
  assert.ok(calls[0].args.includes("--user-data-dir=/Users/example/accounts/second/Desktop profile"));
});
