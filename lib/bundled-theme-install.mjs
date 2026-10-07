import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildThemePackage } from "./theme-build.mjs";
import { registerThemePackage } from "./theme-catalog.mjs";

const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// Register shipped themes without losing custom packages or browser preferences.
// Activation belongs to the caller, so staging never starts a service.
export async function installBundledThemes({ home, installDir, nodePath }) {
  const themeDir = path.join(installDir, "themes");
  const installed = [];
  for (const id of ["mecha-control", "pink-candy", "beach-vacation"]) {
    const source = path.join(themeDir, id);
    try { await access(path.join(source, "manifest.json")); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const built = await buildThemePackage(source);
    await registerThemePackage(themeDir, { id: built.manifest.id, name: built.manifest.name,
      prefKey: built.prefKey, source: built.compiled, frameSource: built.frameSource });
    installed.push(id);
  }
  if (!installed.length) return { installed };
  await copyFile(path.join(themeDir, "runtime", "theme-worker.mjs"), path.join(themeDir, "theme-worker.mjs"));
  const plistPath = path.join(home, "Library", "LaunchAgents", "com.aiyoucodex.theme-runtime.plist");
  await mkdir(path.dirname(plistPath), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>com.aiyoucodex.theme-runtime</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(path.join(themeDir, "theme-worker.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(installDir)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${xml(path.join(home, "Library/Logs/CodexSidebarEnhancer/theme.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(home, "Library/Logs/CodexSidebarEnhancer/theme.error.log"))}</string>
</dict></plist>\n`;
  await writeFile(plistPath, plist, { mode: 0o644 });
  return { installed, plistPath };
}
