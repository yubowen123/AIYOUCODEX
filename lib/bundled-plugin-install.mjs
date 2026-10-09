import { access, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execute = promisify(execFile);
export const BUNDLED_MARKETPLACE = "aiyoucodex-bundled";

// Use the host installer rather than changing its cache or OAuth credentials.
export async function installBundledPlugins({ installDir, home, codexPath, remove = false, run = execute } = {}) {
  const source = path.join(installDir, "plugins");
  try { await access(path.join(source, ".agents", "plugins", "marketplace.json")); }
  catch (error) { if (error.code === "ENOENT") return { installed: [], status: "not-bundled" }; throw error; }
  const candidates = codexPath ? [codexPath] : [process.env.CODEX_CLI_PATH, "codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"].filter(Boolean);
  // For a custom installation home, constrain host configuration to that profile.
  const env = { ...process.env, ...(home ? { CODEX_HOME: home !== os.homedir()
    ? path.join(home, ".codex") : process.env.CODEX_HOME || path.join(home, ".codex") } : {}) };
  if (env.CODEX_HOME) await mkdir(env.CODEX_HOME, { recursive: true, mode: 0o700 });
  let executable;
  for (const candidate of candidates) {
    try { await run(candidate, ["plugin", "--help"], { env, timeout: 15000 }); executable = candidate; break; }
    catch (error) { if (codexPath) throw error; }
  }
  if (!executable) return { installed: [], status: "requires-codex-cli", message: "Install a Codex CLI with plugin support, then run scripts/install-bundled-plugins.mjs" };
  const invoke = async args => JSON.parse((await run(executable, args, { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const markets = await invoke(["plugin", "marketplace", "list", "--json"]);
  const existing = markets.marketplaces.find(m => m.name === BUNDLED_MARKETPLACE);
  if (remove) {
    if (!existing || path.resolve(existing.root) !== path.resolve(source)) return { installed: [], status: "not-owned" };
    const plugins = await invoke(["plugin", "list", "--marketplace", BUNDLED_MARKETPLACE, "--json"]);
    if (plugins.installed.some(p => p.name === "moke-aigc")) {
      await invoke(["plugin", "remove", `moke-aigc@${BUNDLED_MARKETPLACE}`, "--json"]);
    }
    await invoke(["plugin", "marketplace", "remove", BUNDLED_MARKETPLACE, "--json"]);
    return { installed: [], status: "removed", preserved: "native-mcp-and-other-plugins" };
  }
  // Only migrate this integration's named source; unrelated marketplaces are untouched.
  const sourceChanged = existing && path.resolve(existing.root) !== path.resolve(source);
  if (sourceChanged) {
    await run(executable, ["plugin", "marketplace", "remove", BUNDLED_MARKETPLACE], { env, timeout: 30000 });
  }
  if (!existing || sourceChanged) await invoke(["plugin", "marketplace", "add", source, "--json"]);
  const before = await invoke(["plugin", "list", "--marketplace", BUNDLED_MARKETPLACE, "--json"]);
  const manifest = JSON.parse(await readFile(path.join(source, "moke-aigc", "plugin.json"), "utf8"));
  const current = before.installed.find(p => p.name === manifest.name);
  if (!current || current.version !== manifest.version) {
    // Preserve the user's explicit disabled preference during package upgrades.
    if (current?.enabled === false) return { installed: [current.pluginId], status: "disabled-by-user" };
    if (existing && !sourceChanged) await invoke(["plugin", "marketplace", "add", source, "--json"]);
    await invoke(["plugin", "add", `${manifest.name}@${BUNDLED_MARKETPLACE}`, "--json"]);
  }
  const after = await invoke(["plugin", "list", "--marketplace", BUNDLED_MARKETPLACE, "--json"]);
  const verified = after.installed.find(p => p.name === manifest.name && p.version === manifest.version);
  if (!verified) throw new Error("Bundled MOKE plugin installation was not confirmed by Codex");
  return { installed: [verified.pluginId], version: verified.version, enabled: verified.enabled, status: verified.enabled ? "installed" : "disabled-by-user", authentication: "host-oauth-required" };
}
