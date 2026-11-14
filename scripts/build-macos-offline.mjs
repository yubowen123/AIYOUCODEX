#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoPrivateConfigPaths, assertNoPrivateContent } from "./verify-public-boundary.mjs";
import { findNpmCli } from "./setup-claude-dependencies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), value = key => {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
};
if (["--output", "--node-runtime", "--node-license"].some(key => !value(key) || value(key).startsWith("--"))) {
  throw new Error("Provide --output NEW_DIRECTORY --node-runtime NODE_BINARY --node-license LICENSE_FILE [--arch arm64|x64] [--online]");
}
const arch = args.includes("--arch") ? value("--arch") : process.arch;
if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch)) throw new Error("Build on macOS for arm64 or x64");
const cpu = arch === "x64" ? "x86_64" : arch;
const runtime = path.resolve(value("--node-runtime"));
const verifyBinary = (binary, name) => {
  const actual = execFileSync("/usr/bin/lipo", ["-archs", binary], { encoding: "utf8" }).trim();
  if (actual !== cpu) throw new Error(`${name}: expected ${cpu}, found ${actual}`);
};
const runTarget = (binary, args, options) => execFileSync("/usr/bin/arch", [`-${cpu}`, binary, ...args], options);
verifyBinary(runtime, "Node");
const runtimeInfo = JSON.parse(runTarget(runtime, ["-p", "JSON.stringify({ arch: process.arch, platform: process.platform, version: process.version })"], { encoding: "utf8" }));
const [nodeMajor, nodeMinor] = runtimeInfo.version.slice(1).split(".").map(Number);
if (runtimeInfo.arch !== arch || runtimeInfo.platform !== "darwin" || nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  throw new Error("Bundle requires a matching macOS Node 22.5 or newer runtime");
}
const nodeVersion = runtimeInfo.version;
const destination = path.resolve(value("--output")), payload = path.join(destination, "payload");
try { await access(destination); throw new Error("Output already exists; use a new build directory"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const paths = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached"], { cwd: root }).toString().split("\0").filter(Boolean))]
  .filter(name => !name.startsWith(".github/") && !name.startsWith(".githooks/") && !name.endsWith(".log"));
assertNoPrivateConfigPaths(paths, "Offline source");
assertNoPrivateContent(root, paths, "Offline source");
await mkdir(payload, { recursive: true });
for (const name of paths) {
  const source = path.join(root, name); let info;
  try { info = await stat(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (!info.isFile()) continue;
  const target = path.join(payload, name); await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target); await chmod(target, info.mode & 0o777);
}
const npm = (await findNpmCli({ nodePath: runtime })) ?? (await findNpmCli());
if (!npm) throw new Error("Build requires npm; end-user installation does not");
runTarget(runtime, [npm, "ci", ...(args.includes("--online") ? [] : ["--offline"]), "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: payload, stdio: "inherit" });
verifyBinary(path.join(payload, "node_modules", `@anthropic-ai/claude-agent-sdk-darwin-${arch}`, "claude"), "Claude CLI");
const nodeDir = path.join(payload, "runtime/node"), node = path.join(nodeDir, "bin/node");
await mkdir(path.dirname(node), { recursive: true });
await copyFile(runtime, node); await chmod(node, 0o755);
await copyFile(value("--node-license"), path.join(nodeDir, "LICENSE"));
await writeFile(path.join(nodeDir, "ARCH"), arch + "\n");
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const versions = {};
for (const name of ["@anthropic-ai/claude-agent-sdk", "smol-toml"]) {
  versions[name] = JSON.parse(await readFile(path.join(payload, "node_modules", name, "package.json"), "utf8")).version;
}
await writeFile(path.join(payload, "bundled-dependencies.json"), JSON.stringify({ platform: "darwin", arch, versions,
  nodeVersion, lockSha256: sha(await readFile(path.join(payload, "package-lock.json"))) }, null, 2));
await writeFile(path.join(nodeDir, "SOURCE.json"), JSON.stringify({ version: nodeVersion, platform: "darwin", arch,
  sha256: sha(await readFile(node)), license: "LICENSE", linkedLibraries: "macOS system frameworks only" }, null, 2));
for (const [source, target] of [["Install.command", "安装 AIYOUcodex.command"], ["Launch.command", "启动 AIYOUcodex.command"], ["Uninstall.command", "卸载 AIYOUcodex.command"]]) {
  const to = path.join(destination, target); await copyFile(path.join(root, "packaging/macos", source), to); await chmod(to, 0o755);
}
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.isFile()) files.push(path.relative(payload, full));
    else if (!item.isSymbolicLink()) throw new Error("Unsupported bundle entry " + full);
  }
}
await walk(payload);
const sums = [];
for (const name of files.sort()) {
  if (name.includes("\n") || name.includes("\\")) throw new Error("Invalid checksum filename");
  sums.push(`${sha(await readFile(path.join(payload, name)))}  ${name}`);
}
await writeFile(path.join(payload, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(JSON.stringify({ destination, version: packageJson.version, arch, nodeVersion, fileCount: files.length, offline: true }));
