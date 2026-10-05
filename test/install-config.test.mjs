import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createInstallPlan } from "../lib/install-config.mjs";

const macOnly = { skip: process.platform !== "darwin" };

test("launcher passes the existing profile as one literal shell argument", macOnly, () => {
  const testHome = "/tmp/AIYOU profile 'quotes' $AIYOU_TEST_VALUE";
  const { launcherScript } = createInstallPlan({ home: testHome });
  const assignment = launcherScript.split("\n").find(line => line.startsWith("AIYOU_CODEX_USER_DATA_DIR="));
  const homeAssignment = launcherScript.split("\n").find(line => line.startsWith("AIYOU_CODEX_HOME="));
  const launch = launcherScript.slice(launcherScript.lastIndexOf('/usr/bin/open --env'));
  // Only parse arguments in an isolated shell; never launch, quit or connect
  // to the user's app from this regression test.
  const result = spawnSync("/bin/zsh", ["-c", `PORT=9231\nAPP_PATH=/unused/ChatGPT.app\n${assignment}\n${homeAssignment}\n${launch.replace('/usr/bin/open', '/usr/bin/printf "%s\\n"')}`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const args = result.stdout.trim().split("\n");
  assert.ok(args.includes(`--user-data-dir=${path.join(testHome, "Library", "Application Support", "Codex")}`));
  assert.ok(args.includes("--remote-debugging-port=9231"));
});

test("installer dry-run renders portable user paths and XML-safe launch configuration", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-home-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex & Sidebar");
  try {
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--dry-run",
      "--home", testHome,
      "--install-dir", installDir,
      "--node-path", process.execPath,
    ], { cwd: path.resolve("."), encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.installDir, installDir);
    assert.equal(plan.port, 9231);
    assert.equal(plan.label, "com.yubowen.codex-sidebar-enhancer");
    assert.equal(plan.plistPath, path.join(testHome, "Library", "LaunchAgents", `${plan.label}.plist`));
    assert.equal(plan.launcherPath, path.join(testHome, "Applications", "AIYOUcodex.app"));
    assert.deepEqual(plan.legacyLauncherPaths, [
      path.join(testHome, "Applications", "Codex Sidebar Enhancer.app"),
    ]);
    assert.match(plan.launcherInfoPlist, /<string>AIYOUcodex<\/string>/);
    assert.match(plan.launcherInfoPlist, /com\.yubowen\.codex-sidebar-enhancer\.launcher/);
    assert.match(plan.plist, /Codex &amp; Sidebar/);
    assert.doesNotMatch(plan.plist, /\/Users\/yubowen/);
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("installer activation writes a loadable user LaunchAgent without invoking launchctl in test mode", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-activate-"));
  try {
    const launchAgentsDir = path.join(testHome, "Library", "LaunchAgents");
    const legacyPlistPath = path.join(launchAgentsDir, "com.yubowen.codex-conversation-preview.plist");
    const legacyLauncherPath = path.join(testHome, "Applications", "Codex Sidebar Enhancer.app");
    await mkdir(launchAgentsDir, { recursive: true });
    await writeFile(legacyPlistPath, "legacy");
    await mkdir(legacyLauncherPath, { recursive: true });
    await writeFile(path.join(legacyLauncherPath, "legacy.txt"), "legacy");
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--activate",
      "--skip-launchctl",
      "--home", testHome,
      "--install-dir", path.resolve("."),
      "--node-path", process.execPath,
    ], { cwd: path.resolve("."), encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const activation = JSON.parse(result.stdout);
    assert.equal(activation.activated, true);
    assert.equal(activation.launchctlSkipped, true);
    const plist = await readFile(activation.plistPath, "utf8");
    assert.match(plist, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(plist, /scripts\/runtime\.mjs/);
    assert.equal(activation.launcherPath, path.join(testHome, "Applications", "AIYOUcodex.app"));
    const loginPlist = await readFile(activation.loginPlistPath, "utf8");
    assert.match(loginPlist, /com\.yubowen\.aiyoucodex-login/);
    assert.match(loginPlist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(loginPlist, /<key>KeepAlive<\/key><false\/>/);
    await access(path.join(activation.launcherPath, "Contents", "Info.plist"));
    const launcherInfo = await readFile(path.join(activation.launcherPath, "Contents", "Info.plist"), "utf8");
    assert.match(launcherInfo, /<string>AIYOUcodex<\/string>/);
    assert.match(launcherInfo, /com\.yubowen\.codex-sidebar-enhancer\.launcher/);
    const launcherExecutable = path.join(activation.launcherPath, "Contents", "MacOS", "AIYOUcodex");
    const launcherSource = await readFile(launcherExecutable, "utf8");
    assert.match(launcherSource, /PORT=9231/);
    assert.match(launcherSource, /--remote-debugging-port=\$\{PORT\}/);
    assert.match(launcherSource, /--user-data-dir=\$\{AIYOU_CODEX_USER_DATA_DIR\}/,
      "The user launcher must use the same explicit Codex profile as desktop-runtime");
    assert.ok(launcherSource.includes(path.join(testHome, "Library", "Application Support", "Codex")),
      "Reuse the existing Codex profile, not a new or empty browser profile");
    assert.match(
      launcherSource,
      /--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly/,
    );
    assert.ok((await stat(launcherExecutable)).mode & 0o100, "launcher must be executable by its owner");
    await assert.rejects(access(legacyPlistPath));
    await assert.rejects(access(legacyLauncherPath));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("installer explicitly kickstarts the registered LaunchAgent after bootstrap", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-kickstart-"));
  const fakeLaunchctl = path.join(testHome, "launchctl");
  const launchctlLog = path.join(testHome, "launchctl.log");
  try {
    await writeFile(fakeLaunchctl, "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$CODEX_TEST_LAUNCHCTL_LOG\"\n", { mode: 0o755 });
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--activate",
      "--home", testHome,
      "--install-dir", path.resolve("."),
      "--node-path", process.execPath,
      "--launchctl-path", fakeLaunchctl,
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, CODEX_TEST_LAUNCHCTL_LOG: launchctlLog },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = (await readFile(launchctlLog, "utf8")).trim().split("\n");
    assert.ok(commands.some((command) => command.startsWith("bootstrap gui/")));
    const enable = commands.indexOf(`enable gui/${process.getuid()}/com.yubowen.codex-sidebar-enhancer`);
    const bootstrap = commands.indexOf(`bootstrap gui/${process.getuid()} ${path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist")}`);
    assert.ok(enable >= 0 && enable < bootstrap, "clear disabled override before registering recovery");
    assert.ok(commands.some(command => command === `enable gui/${process.getuid()}/com.yubowen.aiyoucodex-login`));
    assert.ok(commands.some((command) => command === `kickstart -k gui/${process.getuid()}/com.yubowen.codex-sidebar-enhancer`));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});


test("launcher revives missing helpers and focuses an existing native app without quitting it", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "aiyou-startup-"));
  const logPath = path.join(testHome, "commands.log");
  try {
    const plan = createInstallPlan({home: testHome});
    await mkdir(plan.launchAgentsDir, {recursive: true});
    await writeFile(plan.plistPath, plan.plist);
    await writeFile(path.join(plan.launchAgentsDir, "com.aiyoucodex.theme-runtime.plist"), "test");
    const mock = `
function mock_launchctl() { print -r -- "launchctl $*" >> "$AIYOU_TEST_LOG"; [[ "$1" != print ]]; }
function mock_curl() { return 1; }
function mock_pgrep() { return 0; }
function mock_open() { print -r -- "open $*" >> "$AIYOU_TEST_LOG"; }
function mock_osascript() { print -r -- "UNEXPECTED osascript $*" >> "$AIYOU_TEST_LOG"; return 1; }
`;
    const isolatedScript = plan.launcherScript.replaceAll("/bin/launchctl", "mock_launchctl")
      .replaceAll("/usr/bin/curl", "mock_curl").replaceAll("/usr/bin/pgrep", "mock_pgrep")
      .replaceAll("/usr/bin/open", "mock_open").replaceAll("/usr/bin/osascript", "mock_osascript");
    const result = spawnSync("/bin/zsh", ["-c", mock + isolatedScript], {
      encoding: "utf8", env: {...process.env, AIYOU_TEST_LOG: logPath},
    });
    assert.equal(result.status, 0, result.stderr);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /bootstrap gui\//);
    assert.match(log, /kickstart gui\/.*com\.yubowen\.codex-sidebar-enhancer/);
    assert.match(log, /kickstart gui\/.*com\.aiyoucodex\.theme-runtime/);
    assert.match(log, /open -a \/Applications\/(?:ChatGPT|Codex)\.app/);
    assert.doesNotMatch(log, /UNEXPECTED|kickstart -k|open .* -na/);
    assert.match(plan.plist, /CODEX_SIDEBAR_ALLOW_HOST_RESTART<\/key>\s*<string>1<\/string>/);
  } finally { await rm(testHome, {recursive: true, force: true}); }
});
