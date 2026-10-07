import os from "node:os";
import path from "node:path";

export const LAUNCH_AGENT_LABEL = "com.yubowen.codex-sidebar-enhancer";
export const LOGIN_AGENT_LABEL = "com.yubowen.aiyoucodex-login";
export const PRODUCT_NAME = "AIYOUcodex";
export const LEGACY_PRODUCT_NAME = "Codex Sidebar Enhancer";
export const LEGACY_TASKBOARD_LABELS = [
  "com.yubowen.codex-project-management.injector",
  "com.yubowen.codex-taskboard",
];
export const DEFAULT_DEBUG_PORT = 9231;

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function createInstallPlan({
  home = os.homedir(),
  installDir = path.join(home, "Library", "Application Support", "Codex Sidebar Enhancer"),
  nodePath = process.execPath,
  port = DEFAULT_DEBUG_PORT,
} = {}) {
  const label = LAUNCH_AGENT_LABEL;
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const logsDir = path.join(home, "Library", "Logs", "CodexSidebarEnhancer");
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const legacyCompatibilityMarker = path.join(installDir, ".legacy-taskboard-disabled");
  const launcherPath = path.join(home, "Applications", `${PRODUCT_NAME}.app`);
  const legacyLauncherPaths = [
    path.join(home, "Applications", `${LEGACY_PRODUCT_NAME}.app`),
  ];
  const launcherContentsDir = path.join(launcherPath, "Contents");
  const launcherExecutablePath = path.join(launcherContentsDir, "MacOS", PRODUCT_NAME);
  const injectorPath = path.join(installDir, "scripts", "runtime.mjs");
  const stdoutPath = path.join(logsDir, "injector.log");
  const stderrPath = path.join(logsDir, "injector.error.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(injectorPath)}</string>
    <string>--port</string>
    <string>${xml(port)}</string>
    <string>--watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_SIDEBAR_ALLOW_HOST_RESTART</key>
    <string>1</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(installDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
  const loginPlistPath = path.join(launchAgentsDir, `${LOGIN_AGENT_LABEL}.plist`);
  const loginPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LOGIN_AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>${xml(launcherExecutablePath)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>${xml(path.join(logsDir, 'login.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logsDir, 'login.error.log'))}</string>
</dict></plist>
`;
  const launcherInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.yubowen.codex-sidebar-enhancer.launcher</string>
  <key>CFBundleName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
</dict>
</plist>
`;
  const launcherScript = `#!/bin/zsh
set -eu

PORT=${port}
AIYOU_CODEX_USER_DATA_DIR=${shellQuote(path.join(home, "Library", "Application Support", "Codex"))}
AIYOU_CODEX_HOME=${shellQuote(path.join(home, ".codex"))}

# Start installed helpers without interrupting a healthy running service.
AIYOU_LAUNCH_DOMAIN="gui/$(/usr/bin/id -u)"
ensure_service() {
  local label="$1" plist="$2"
  [[ -f "$plist" ]] || return 0
  /bin/launchctl enable "\${AIYOU_LAUNCH_DOMAIN}/\${label}" >/dev/null 2>&1 || true
  if ! /bin/launchctl print "\${AIYOU_LAUNCH_DOMAIN}/\${label}" >/dev/null 2>&1; then
    /bin/launchctl bootstrap "\${AIYOU_LAUNCH_DOMAIN}" "$plist" >/dev/null 2>&1 || return 0
  fi
  /bin/launchctl kickstart "\${AIYOU_LAUNCH_DOMAIN}/\${label}" >/dev/null 2>&1 || true
}
ensure_service ${shellQuote(label)} ${shellQuote(plistPath)}
ensure_service 'com.aiyoucodex.theme-runtime' ${shellQuote(path.join(launchAgentsDir, "com.aiyoucodex.theme-runtime.plist"))}

if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:\${PORT}/json" >/dev/null 2>&1; then
  /usr/bin/open -a "ChatGPT" 2>/dev/null || /usr/bin/open -a "Codex"
  exit 0
fi

APP_PATH=""
APP_NAME=""
for CANDIDATE in "/Applications/ChatGPT.app" "/Applications/Codex.app"; do
  if [[ -d "\${CANDIDATE}" ]]; then
    APP_PATH="\${CANDIDATE}"
    APP_NAME="\${CANDIDATE:t:r}"
    break
  fi
done

if [[ -z "\${APP_PATH}" ]]; then
  /usr/bin/osascript -e 'display alert "${PRODUCT_NAME}" message "没有找到 ChatGPT.app 或 Codex.app，请先安装 Codex 桌面应用。" as critical'
  exit 1
fi

if /usr/bin/pgrep -x "\${APP_NAME}" >/dev/null 2>&1; then
  # The watcher waits until reply state is known idle before converting an
  # ordinary native launch. Never quit active conversations from the launcher.
  /usr/bin/open -a "\${APP_PATH}"
  exit 0
fi

if [[ -f ${shellQuote(path.join(installDir, "scripts", "active-profile-path.mjs"))} ]]; then
  AIYOU_CODEX_USER_DATA_DIR=$(${shellQuote(nodePath)} ${shellQuote(path.join(installDir, "scripts", "active-profile-path.mjs"))} --kind desktop --home ${shellQuote(home)})
  AIYOU_CODEX_HOME=$(${shellQuote(nodePath)} ${shellQuote(path.join(installDir, "scripts", "active-profile-path.mjs"))} --kind codex --home ${shellQuote(home)})
fi

/usr/bin/open --env "CODEX_HOME=\${AIYOU_CODEX_HOME}" -na "\${APP_PATH}" --args \
  "--user-data-dir=\${AIYOU_CODEX_USER_DATA_DIR}" \
  "--remote-debugging-port=\${PORT}" \
  "--remote-allow-origins=http://127.0.0.1:\${PORT}" \
  "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly"
`;
  return {
    label,
    port,
    home,
    installDir,
    nodePath,
    launchAgentsDir,
    logsDir,
    plistPath,
    loginPlistPath,
    loginPlist,
    legacyCompatibilityMarker,
    plist,
    launcherPath,
    legacyLauncherPaths,
    launcherContentsDir,
    launcherExecutablePath,
    launcherInfoPlist,
    launcherScript,
  };
}
