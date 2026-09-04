import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MANAGED_SHORTCUTS_ENV = "CODEX_SIDEBAR_MANAGED_SHORTCUTS_PATH";
export const MANAGED_SHORTCUTS_SCHEMA_VERSION = 1;

const ALLOWED_ICONS = new Set([
  "link",
  "book",
  "sparkle",
  "play",
  "chart",
  "code",
  "skills",
  "assets",
]);
const ALLOWED_OPEN_MODES = new Set(["internal", "browser"]);
const CONFIG_KEYS = new Set(["schemaVersion", "shortcuts"]);
const SHORTCUT_KEYS = new Set(["id", "name", "url", "icon", "openMode"]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported field: ${unknown[0]}`);
}

function normalizeShortcut(raw, index) {
  const label = `managed shortcut at index ${index}`;
  assertPlainObject(raw, label);
  assertKnownKeys(raw, SHORTCUT_KEYS, label);

  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(raw.id)) {
    throw new TypeError(`${label}.id must be a lowercase portable identifier`);
  }
  if (
    typeof raw.name !== "string"
    || raw.name !== raw.name.trim()
    || !raw.name
    || raw.name.length > 24
    || /[\u0000-\u001f\u007f]/u.test(raw.name)
  ) {
    throw new TypeError(`${label}.name must be a trimmed string between 1 and 24 characters`);
  }
  if (!ALLOWED_ICONS.has(raw.icon)) {
    throw new TypeError(`${label}.icon is not supported`);
  }
  if (!ALLOWED_OPEN_MODES.has(raw.openMode)) {
    throw new TypeError(`${label}.openMode must be internal or browser`);
  }

  let url;
  if (typeof raw.url !== "string" || raw.url !== raw.url.trim() || !raw.url) {
    throw new TypeError(`${label}.url must be an absolute HTTP(S) URL`);
  }
  try {
    url = new URL(raw.url);
  } catch {
    throw new TypeError(`${label}.url must be an absolute HTTP(S) URL`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new TypeError(`${label}.url must be an absolute HTTP(S) URL without credentials`);
  }

  return Object.freeze({
    id: raw.id,
    name: raw.name,
    url: url.href,
    icon: raw.icon,
    openMode: raw.openMode,
  });
}

export function managedShortcutsPath({
  platform = process.platform,
  homeDir = os.homedir(),
  env = process.env,
} = {}) {
  const configuredPath = String(env?.[MANAGED_SHORTCUTS_ENV] || "").trim();
  const pathApi = platform === "win32" ? path.win32 : path;
  if (configuredPath) return pathApi.resolve(configuredPath);

  if (platform === "win32") {
    const localAppData = String(env?.LOCALAPPDATA || "").trim()
      || path.win32.join(homeDir, "AppData", "Local");
    return path.win32.join(localAppData, "CodexSidebarEnhancer", "Data", "managed-shortcuts.json");
  }
  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      "Codex Sidebar Enhancer Data",
      "managed-shortcuts.json",
    );
  }

  const configHome = String(env?.XDG_CONFIG_HOME || "").trim() || path.join(homeDir, ".config");
  return path.join(configHome, "codex-sidebar-enhancer", "managed-shortcuts.json");
}

export function normalizeManagedShortcuts(value) {
  assertPlainObject(value, "managed shortcuts configuration");
  assertKnownKeys(value, CONFIG_KEYS, "managed shortcuts configuration");
  if (value.schemaVersion !== MANAGED_SHORTCUTS_SCHEMA_VERSION) {
    throw new TypeError(`managed shortcuts configuration.schemaVersion must be ${MANAGED_SHORTCUTS_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.shortcuts)) {
    throw new TypeError("managed shortcuts configuration.shortcuts must be an array");
  }
  if (value.shortcuts.length > 24) {
    throw new TypeError("managed shortcuts configuration supports at most 24 entries");
  }

  const shortcuts = value.shortcuts.map(normalizeShortcut);
  const ids = new Set();
  for (const shortcut of shortcuts) {
    if (ids.has(shortcut.id)) throw new TypeError(`managed shortcut id is duplicated: ${shortcut.id}`);
    ids.add(shortcut.id);
  }
  return Object.freeze(shortcuts);
}

export async function readManagedShortcuts({ filePath, ...pathOptions } = {}) {
  const resolvedPath = filePath || managedShortcutsPath(pathOptions);
  let source;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(source.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new SyntaxError(`managed shortcuts configuration is not valid JSON: ${error.message}`);
  }
  return normalizeManagedShortcuts(parsed);
}
