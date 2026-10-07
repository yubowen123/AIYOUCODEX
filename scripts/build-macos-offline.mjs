#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoPrivateConfigPaths, assertNoPrivateContent } from "./verify-public-boundary.mjs";
import { findNpmCli } from "./setup-claude-dependencies.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
if (!args.includes("--output") || !args.includes("--node-runtime") || !args.includes("--node-license")) {
  throw new Error("Provide --output NEW_DIRECTORY --node-runtime NODE_BINARY --node-license LICENSE_FILE");
}
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build on macOS arm64");
const destination = path.resolve(value("--output")), payload = path.join(destination, "payload");
try { await access(destination); throw new Error("Output already exists; use a new build directory"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const paths = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).toString().split("\0").filter(Boolean))]
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
const npm = await findNpmCli(); if (!npm) throw new Error("Build requires npm; end-user installation does not");
execFileSync(process.execPath, [npm, "ci", "--offline", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: payload, stdio: "inherit" });
const nodeDir = path.join(payload, "runtime/node"), node = path.join(nodeDir, "bin/node");
await mkdir(path.dirname(node), { recursive: true });
await copyFile(value("--node-runtime"), node); await chmod(node, 0o755);
await copyFile(value("--node-license"), path.join(nodeDir, "LICENSE"));
const nodeVersion = execFileSync(node, ["-p", "process.version"], { encoding: "utf8" }).trim();
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const versions = {};
for (const name of ["@anthropic-ai/claude-agent-sdk", "smol-toml"]) {
  versions[name] = JSON.parse(await readFile(path.join(payload, "node_modules", name, "package.json"), "utf8")).version;
}
await writeFile(path.join(payload, "bundled-dependencies.json"), JSON.stringify({ platform: "darwin", arch: "arm64", versions,
  nodeVersion, lockSha256: sha(await readFile(path.join(payload, "package-lock.json"))) }, null, 2));
await writeFile(path.join(nodeDir, "SOURCE.json"), JSON.stringify({ source: value("--node-runtime"), version: nodeVersion,
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
console.log(JSON.stringify({ destination, version: packageJson.version, nodeVersion, fileCount: files.length, offline: true }));
