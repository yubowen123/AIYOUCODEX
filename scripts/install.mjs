#!/usr/bin/env node

import { createInstallPlan, LEGACY_TASKBOARD_LABELS } from "../lib/install-config.mjs";
import { access, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { activateLaunchAgent } from "../lib/launch-agent.mjs";
import { installResetMonitorService } from "../lib/reset-monitor-service.mjs";
import { installBundledThemes } from "../lib/bundled-theme-install.mjs";

function parseArgs(argv) {
  const options = { dryRun: false, activate: false, skipLaunchctl: false, launchctlPath: "launchctl" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--activate") options.activate = true;
    else if (argument === "--skip-launchctl") options.skipLaunchctl = true;
    else if (argument === "--home") options.home = argv[++index];
    else if (argument === "--install-dir") options.installDir = argv[++index];
    else if (argument === "--node-path") options.nodePath = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--launchctl-path") options.launchctlPath = argv[++index];
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = createInstallPlan(options);

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else if (options.activate) {
  await access(path.join(plan.installDir, "scripts", "runtime.mjs"));
  await access(path.join(plan.installDir, "vendor", "codex-taskboard", "dist", "web", "index.html"));
  await mkdir(plan.launchAgentsDir, { recursive: true });
  await mkdir(plan.logsDir, { recursive: true });
  await mkdir(path.dirname(plan.launcherExecutablePath), { recursive: true });
  await writeFile(plan.plistPath, plan.plist, { mode: 0o644 });
  await writeFile(plan.loginPlistPath, plan.loginPlist, { mode: 0o644 });
  await writeFile(path.join(plan.launcherContentsDir, "Info.plist"), plan.launcherInfoPlist, { mode: 0o644 });
  await writeFile(plan.launcherExecutablePath, plan.launcherScript, { mode: 0o755 });
  const themes = await installBundledThemes({ home: plan.home, installDir: plan.installDir, nodePath: plan.nodePath });
  const resetMonitor = await installResetMonitorService({ ...options, home: plan.home, installDir: plan.installDir, nodePath: plan.nodePath });
  const legacyPlistPath = path.join(plan.launchAgentsDir, "com.yubowen.codex-conversation-preview.plist");
  if (!options.skipLaunchctl) {
    const domain = `gui/${process.getuid()}`;
    const disabledLegacyLabels = [];
    for (const legacyLabel of LEGACY_TASKBOARD_LABELS) {
      const legacyPlistPath = path.join(plan.launchAgentsDir, `${legacyLabel}.plist`);
      try {
        await access(legacyPlistPath);
        spawnSync(options.launchctlPath, ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
        const disabled = spawnSync(options.launchctlPath, ["disable", `${domain}/${legacyLabel}`], { encoding: "utf8" });
        if (disabled.status === 0) disabledLegacyLabels.push(legacyLabel);
      } catch {}
    }
    if (disabledLegacyLabels.length > 0) {
      await writeFile(plan.legacyCompatibilityMarker, `${disabledLegacyLabels.join("\n")}\n`, { mode: 0o600 });
    }
    await activateLaunchAgent({domain, label: plan.label, plistPath: plan.plistPath, launchctlPath: options.launchctlPath});
    await activateLaunchAgent({domain, label: "com.yubowen.aiyoucodex-login", plistPath: plan.loginPlistPath, launchctlPath: options.launchctlPath});
    const themePlist = path.join(plan.launchAgentsDir, "com.aiyoucodex.theme-runtime.plist");
    try {
      await access(themePlist);
      await activateLaunchAgent({domain, label: "com.aiyoucodex.theme-runtime", plistPath: themePlist, launchctlPath: options.launchctlPath, replace: false});
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    spawnSync(options.launchctlPath, ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
  }
  try { await unlink(legacyPlistPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const legacyLauncherPath of plan.legacyLauncherPaths) {
    if (legacyLauncherPath !== plan.launcherPath) {
      await rm(legacyLauncherPath, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({
    activated: true,
    themes,
    resetMonitor,
    launchctlSkipped: options.skipLaunchctl,
    label: plan.label,
    plistPath: plan.plistPath,
    loginPlistPath: plan.loginPlistPath,
    logsDir: plan.logsDir,
    launcherPath: plan.launcherPath,
  })}\n`);
} else {
  throw new Error("Choose --dry-run or --activate");
}
