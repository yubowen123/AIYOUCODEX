#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installBundledPlugins } from "../lib/bundled-plugin-install.mjs";
const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const result = await installBundledPlugins({
  installDir: value("--install-dir") || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  home: value("--home") || os.homedir(), codexPath: value("--codex-path"), remove: args.includes("--remove"),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
