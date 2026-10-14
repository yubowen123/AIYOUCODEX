import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { accessSync, constants, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {macNativeCodexCandidates} from './install-config.mjs';

import {
  desktopAppLaunchArgs,
  parseDesktopAppProcess,
  parseWindowsDesktopAppProcess,
  windowsDesktopAppLaunchArgs,
} from "./injector-state.mjs";

const defaultExecFileAsync = promisify(execFile);
function executableFile(filename) {
  try {accessSync(filename, constants.X_OK); return statSync(filename).isFile();} catch {return false;}
}

const WINDOWS_PROCESS_QUERY = [
  "$items = Get-CimInstance Win32_Process",
  "| Where-Object { $_.Name -in @('ChatGPT.exe','Codex.exe') -and $_.CommandLine -notmatch '(?:^|\\s)--type=' }",
  "| Select-Object ProcessId,Name,ExecutablePath,CommandLine;",
  "@($items) | ConvertTo-Json -Compress",
].join(" ");

export function createDesktopAppRuntime({
  platform = process.platform,
  home = os.homedir(),
  execFileAsync = defaultExecFileAsync,
  spawnProcess = spawn,
  modelProxyPath = fileURLToPath(new URL('../scripts/codex-model-proxy', import.meta.url)),
  isExecutablePath = executableFile,
} = {}) {
  return {
    async readStartedAt(app) {
      if (platform !== 'darwin' || !app?.pid) return null;
      try {
        const {stdout} = await execFileAsync('/bin/ps', ['-p', String(app.pid), '-o', 'lstart='],
          {env: {...process.env, LC_ALL: 'C'}});
        const value = Date.parse(stdout.trim());
        return Number.isFinite(value) ? value : null;
      } catch { return null; }
    },
    async readProcess() {
      if (platform === "darwin") {
        const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="]);
        return parseDesktopAppProcess(stdout);
      }
      if (platform === "win32") {
        const { stdout } = await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          WINDOWS_PROCESS_QUERY,
        ]);
        return parseWindowsDesktopAppProcess(stdout);
      }
      return null;
    },

    async quit(app) {
      if (platform === "darwin") {
        await execFileAsync("/usr/bin/osascript", [
          "-e",
          `tell application id ${JSON.stringify(app.bundleId)} to quit`,
        ]);
      } else if (platform === "win32") {
        await execFileAsync("taskkill.exe", ["/PID", String(app.pid), "/T"]);
      }
    },

    launch(appPath, port, { codexHome, userDataDir } = {}) {
      const command = platform === "darwin" ? "/usr/bin/open" : appPath;
      const args = platform === "darwin"
        ? desktopAppLaunchArgs(
          appPath,
          port,
          userDataDir || path.posix.join(home, "Library", "Application Support", "Codex"),
        )
        : windowsDesktopAppLaunchArgs(port);
      if (platform === "darwin" && modelProxyPath && isExecutablePath(modelProxyPath)) {
        const nativeBinary = macNativeCodexCandidates(appPath).find(isExecutablePath);
        if (nativeBinary) args.splice(0, 0, '--env', `CODEX_CLI_PATH=${modelProxyPath}`,
          '--env', `AIYOUCODEX_NATIVE_CODEX_BINARY=${nativeBinary}`);
      }
      if (platform === "darwin" && codexHome) args.splice(0, 0, "--env", `CODEX_HOME=${codexHome}`);
      if (platform === "win32" && userDataDir) args.unshift(`--user-data-dir=${userDataDir}`);
      const options = { detached: true, stdio: "ignore" };
      if (platform === "win32" && codexHome) options.env = { ...process.env, CODEX_HOME: codexHome };
      const child = spawnProcess(command, args, options);
      child.unref();
      return child;
    },
  };
}
