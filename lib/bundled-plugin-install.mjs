import { access, cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execute = promisify(execFile);
export const BUNDLED_MARKETPLACE = "aiyoucodex-bundled";
export const BUNDLED_PLUGIN_NAMES = Object.freeze(["moke-aigc", "openchatcut"]);
const canonical = async directory => realpath(directory).catch(error => {
  if (error.code === "ENOENT") return path.resolve(directory);
  throw error;
});

// Native stdio plugins inherit the desktop's PATH, which need not contain the
// portable Node used by the installer. Keep resolved commands in an owned,
// private source copy; the published templates remain machine-independent.
async function prepareRuntimeSource(template, source, nodePath) {
  const descriptor = path.join(".agents", "plugins", "marketplace.json");
  const incoming = JSON.parse(await readFile(path.join(template, descriptor), "utf8"));
  let current;
  try { current = JSON.parse(await readFile(path.join(source, descriptor), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await cp(template, source, { recursive: true, filter: file => file !== path.join(template, descriptor) });
  const entries = incoming.plugins.filter(plugin => BUNDLED_PLUGIN_NAMES.includes(plugin.name));
  const marketplace = { ...incoming, plugins: [
    ...entries, ...(current?.plugins || []).filter(plugin => !BUNDLED_PLUGIN_NAMES.includes(plugin.name)),
  ] };
  await writeFile(path.join(source, descriptor), `${JSON.stringify(marketplace, null, 2)}\n`);
  const executable = await realpath(nodePath);
  for (const name of BUNDLED_PLUGIN_NAMES) {
    for (const file of [".mcp.json", "mcp.json"]) {
      const filename = path.join(source, name, file);
      let configuration;
      try { configuration = JSON.parse(await readFile(filename, "utf8")); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      const servers = configuration.mcpServers || configuration;
      for (const server of Object.values(servers)) {
        if (server?.command === "node") {
          // Agent Plugins permits only bare or plugin-contained commands. Supply
          // the portable runtime through its declared environment in that format.
          if (configuration.$schema) server.env = { ...server.env,
            PATH: `${path.dirname(executable)}${path.delimiter}${process.env.PATH || ""}` };
          else server.command = executable;
        }
      }
      await writeFile(filename, `${JSON.stringify(configuration, null, 2)}\n`);
    }
  }
}

async function bundledManifests(source) {
  const marketplace = JSON.parse(await readFile(path.join(source, ".agents", "plugins", "marketplace.json"), "utf8"));
  if (marketplace.name !== BUNDLED_MARKETPLACE || !Array.isArray(marketplace.plugins)) throw new Error("Invalid bundled plugin marketplace");
  const manifests = [];
  for (const entry of marketplace.plugins) {
    if (!BUNDLED_PLUGIN_NAMES.includes(entry.name)) continue;
    if (entry.source?.source !== "local" || typeof entry.source.path !== "string") throw new Error("Bundled plugins must use local sources");
    const directory = path.resolve(source, entry.source.path);
    if (!directory.startsWith(`${path.resolve(source)}${path.sep}`)) throw new Error("Bundled plugin source escapes the package");
    const manifest = JSON.parse(await readFile(path.join(directory, "plugin.json"), "utf8"));
    if (manifest.name !== entry.name || typeof manifest.version !== "string" || !manifest.version) throw new Error("Invalid bundled plugin identity");
    if (manifests.some(plugin => plugin.name === manifest.name)) throw new Error("Duplicate bundled plugin identity");
    manifests.push(manifest);
  }
  return manifests;
}

// Use the host installer rather than changing its cache or OAuth credentials.
export async function installBundledPlugins({ installDir, home, codexPath, nodePath = process.execPath, remove = false, run = execute } = {}) {
  const template = path.join(installDir, "plugins");
  const source = path.join(installDir, ".aiyoucodex-private", "bundled-plugins");
  try { await access(path.join(template, ".agents", "plugins", "marketplace.json")); }
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
  // Atomic runtime replacement temporarily removes the registered local source.
  // Restore its owned descriptor before Codex enumerates registered marketplaces.
  await prepareRuntimeSource(template, source, nodePath);
  const invoke = async args => JSON.parse((await run(executable, args, { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const markets = await invoke(["plugin", "marketplace", "list", "--json"]);
  const existing = markets.marketplaces.find(m => m.name === BUNDLED_MARKETPLACE);
  const before = existing ? await invoke(["plugin", "list", "--marketplace", BUNDLED_MARKETPLACE, "--json"]) : { installed: [] };
  const unrelated = before.installed.filter(plugin => !BUNDLED_PLUGIN_NAMES.includes(plugin.name));
  if (remove) {
    if (!existing || ![await canonical(source), await canonical(template)].includes(await canonical(existing.root))) return { installed: [], status: "not-owned" };
    for (const plugin of before.installed.filter(plugin => BUNDLED_PLUGIN_NAMES.includes(plugin.name))) {
      await invoke(["plugin", "remove", `${plugin.name}@${BUNDLED_MARKETPLACE}`, "--json"]);
    }
    // A shared source may contain user-added plugins. Keep their source registration.
    if (!unrelated.length) await invoke(["plugin", "marketplace", "remove", BUNDLED_MARKETPLACE, "--json"]);
    return { installed: [], status: "removed", preserved: "native-mcp-and-other-plugins", marketplacePreserved: unrelated.length > 0 };
  }
  const manifests = await bundledManifests(template);
  // Only migrate this integration's named source; unrelated marketplaces are untouched.
  const sourceChanged = existing && await canonical(existing.root) !== await canonical(source);
  if (sourceChanged && unrelated.length) return { installed: [], status: "source-conflict", preserved: "native-mcp-and-other-plugins",
    message: "The bundled marketplace also contains user-added plugins; its source was preserved." };
  if (sourceChanged) {
    await invoke(["plugin", "marketplace", "remove", BUNDLED_MARKETPLACE, "--json"]);
  }
  if (!existing || sourceChanged) await invoke(["plugin", "marketplace", "add", source, "--json"]);
  let refreshed = !existing || sourceChanged;
  for (const manifest of manifests) {
    const current = before.installed.find(plugin => plugin.name === manifest.name);
    // Do not reinstall disabled plugins: Codex's add command would enable them.
    // This preference is per plugin and must not prevent other bundled installs.
    if (current?.enabled === false || (current?.version === manifest.version && !sourceChanged)) continue;
    if (!refreshed) {
      await invoke(["plugin", "marketplace", "add", source, "--json"]);
      refreshed = true;
    }
    await invoke(["plugin", "add", `${manifest.name}@${BUNDLED_MARKETPLACE}`, "--json"]);
  }
  const after = await invoke(["plugin", "list", "--marketplace", BUNDLED_MARKETPLACE, "--json"]);
  const verified = manifests.map(manifest => {
    const previous = before.installed.find(plugin => plugin.name === manifest.name);
    const plugin = after.installed.find(plugin => plugin.name === manifest.name);
    if (!plugin || (previous?.enabled === false ? plugin.enabled !== false : plugin.version !== manifest.version || plugin.enabled !== true)) {
      throw new Error(`Bundled ${manifest.name} plugin installation was not confirmed by Codex`);
    }
    return { pluginId: plugin.pluginId, name: plugin.name, version: plugin.version, enabled: plugin.enabled,
      status: plugin.enabled ? "installed" : "disabled-by-user", ...(plugin.name === "moke-aigc" ? { authentication: "host-oauth-required" } : { application: "install-on-demand" }) };
  });
  return { installed: verified.map(plugin => plugin.pluginId), plugins: verified,
    disabled: verified.filter(plugin => !plugin.enabled).map(plugin => plugin.pluginId),
    status: verified.some(plugin => plugin.enabled) ? "installed" : "disabled-by-user" };
}
