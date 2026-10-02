import { access, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function findNpmCli({ nodePath = process.execPath, env = process.env } = {}) {
  const bin = path.dirname(nodePath);
  const candidates = [env.npm_execpath,
    path.join(bin, "node_modules/npm/bin/npm-cli.js"),
    path.resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js")];
  for (const directory of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of ["npm", "npm.cmd"]) {
      try {
        const resolved = await realpath(path.join(directory, name));
        candidates.push(resolved.endsWith("npm-cli.js") ? resolved : path.join(path.dirname(resolved), "node_modules/npm/bin/npm-cli.js"));
      } catch {}
    }
  }
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate); if (candidate.endsWith("npm-cli.js")) return candidate; } catch {}
  }
  return null;
}

export async function installClaudeDependencies({ root, nodePath = process.execPath, env = process.env, run = spawnSync } = {}) {
  const npm = await findNpmCli({ nodePath, env });
  if (!npm) return false; // Core enhancement remains usable with the host's Node-only runtime.
  const result = run(nodePath, [npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: root, env, stdio: "ignore", timeout: 120000, windowsHide: true });
  if (result.status !== 0) throw new Error("Claude dependencies could not be installed; previous runtime preserved. Check npm/network and retry.");
  await access(path.join(root, "node_modules/@anthropic-ai/claude-agent-sdk/package.json"));
  await access(path.join(root, "node_modules/smol-toml/package.json"));
  return true;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => "") === fileURLToPath(import.meta.url)) {
  try {
    const installed = await installClaudeDependencies({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
    console.log(installed ? "Claude bridge dependencies installed." : "npm unavailable: core installed without Claude bridge dependencies. Install Node.js with npm, then rerun the installer.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
