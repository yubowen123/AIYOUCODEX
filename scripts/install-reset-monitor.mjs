#!/usr/bin/env node
import { createResetMonitorServicePlan, installResetMonitorService } from '../lib/reset-monitor-service.mjs';
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') options.dryRun = true;
  else if (args[i] === '--skip-launchctl') options.skipLaunchctl = true;
  else if (args[i] === '--home') options.home = args[++i];
  else if (args[i] === '--install-dir') options.installDir = args[++i];
  else if (args[i] === '--node-path') options.nodePath = args[++i];
  else throw new Error(`Unknown option: ${args[i]}`);
}
if (process.platform !== 'darwin') throw new Error('Use the managed runtime worker on this platform.');
console.log(JSON.stringify(options.dryRun ? createResetMonitorServicePlan(options) : await installResetMonitorService(options)));
