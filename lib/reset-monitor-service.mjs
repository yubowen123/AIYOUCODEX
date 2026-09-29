import os from "node:os";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export const RESET_SERVICE_LABEL = "com.yubowen.aiyoucodex-reset-monitor";
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

// Dedicated macOS background module: no app launch, renderer or chat required.
export function createResetMonitorServicePlan({ home = os.homedir(),
  installDir = path.join(home, "Library/Application Support/Codex Sidebar Enhancer"), nodePath = process.execPath } = {}) {
  const label = RESET_SERVICE_LABEL;
  const logsDir = path.join(home, "Library/Logs/CodexSidebarEnhancer");
  const scriptPath = path.join(installDir, "scripts/reset-monitor-worker.mjs");
  const plistPath = path.join(home, "Library/LaunchAgents", `${label}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(scriptPath)}</string></array>
<key>WorkingDirectory</key><string>${xml(installDir)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(logsDir, 'reset-monitor.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logsDir, 'reset-monitor.error.log'))}</string>
</dict></plist>\n`;
  return { label, logsDir, scriptPath, plistPath, plist };
}

export async function installResetMonitorService(options = {}) {
  const plan = createResetMonitorServicePlan(options);
  await access(plan.scriptPath);
  await mkdir(path.dirname(plan.plistPath), { recursive: true });
  await mkdir(plan.logsDir, { recursive: true });
  await writeFile(plan.plistPath, plan.plist, { mode: 0o600 });
  if (!options.skipLaunchctl) {
    const domain = `gui/${process.getuid()}`;
    const launchctl = options.launchctlPath || "launchctl";
    spawnSync(launchctl, ['bootout', `${domain}/${plan.label}`], { stdio: 'ignore' });
    for (const args of [['bootstrap', domain, plan.plistPath], ['kickstart', `${domain}/${plan.label}`]]) {
      const result = spawnSync(launchctl, args, { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Reset monitor service failed to start');
    }
  }
  return { label: plan.label, plistPath: plan.plistPath, launchctlSkipped: Boolean(options.skipLaunchctl) };
}
