import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

// launchd keeps a disabled flag separately from the plist and can take a
// moment to finish bootout. Reinstallation must handle both states.
export async function activateLaunchAgent({domain, label, plistPath, launchctlPath = "launchctl", replace = true, run = spawnSync, wait = delay}) {
  const call = args => run(launchctlPath, args, {encoding: "utf8"});
  const requireSuccess = result => { if (result.status !== 0) throw new Error(result.stderr || "launchctl activation failed"); };
  const service = `${domain}/${label}`;
  requireSuccess(call(["enable", service]));
  if (replace) call(["bootout", domain, plistPath]);
  if (replace || call(["print", service]).status !== 0) {
    let result;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      result = call(["bootstrap", domain, plistPath]);
      if (result.status === 0) break;
      if (attempt < 4) await wait(500);
    }
    requireSuccess(result);
  }
  requireSuccess(call(["kickstart", ...(replace ? ["-k"] : []), service]));
}
