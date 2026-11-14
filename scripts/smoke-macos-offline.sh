#!/bin/bash
set -euo pipefail

[[ $# == 2 && ( "$2" == "arm64" || "$2" == "x64" ) ]] || {
  printf 'Usage: %s PACKAGE_DIRECTORY arm64|x64\n' "$0" >&2; exit 2;
}
package="$(cd "$1" && pwd)"
target="$2"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
profile="$fixture/home"
installed="$profile/Library/Application Support/Codex Sidebar Enhancer"
mkdir -p "$profile/.codex/sessions" "$fixture/tmp"
printf 'preserve\n' > "$profile/.codex/sessions/fixture"

run_isolated() {
  /usr/bin/env -i HOME="$profile" CODEX_HOME="$profile/.codex" TMPDIR="$fixture/tmp" \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
    CODEX_SIDEBAR_SKIP_LAUNCHCTL=1 CODEX_SIDEBAR_SKIP_OPEN=1 \
    AIYOU_INSTALL_NONINTERACTIVE=1 AIYOU_INSTALL_TEST_MODE=1 "$@"
}

run_isolated /bin/bash "$package/安装 AIYOUcodex.command"
node="$installed/runtime/node/bin/node"
[[ "$("$node" -p 'process.platform + "/" + process.arch')" == "darwin/$target" ]]
run_isolated "$installed/node_modules/@anthropic-ai/claude-agent-sdk-darwin-$target/claude" --version
launcher="$profile/Applications/AIYOUcodex.app/Contents"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$launcher/Info.plist")"
[[ -x "$launcher/MacOS/$executable" ]]
launch="$profile/Library/LaunchAgents/com.yubowen.codex-sidebar-enhancer.plist"
/usr/bin/plutil -lint "$launch" "$profile/Library/LaunchAgents/com.yubowen.aiyoucodex-login.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$launch")" == "$node" ]]
run_isolated /bin/bash "$package/卸载 AIYOUcodex.command"
[[ ! -e "$installed" && ! -e "$launch" && ! -e "$profile/Applications/AIYOUcodex.app" ]]
[[ "$(cat "$profile/.codex/sessions/fixture")" == "preserve" ]]
printf 'Offline install and uninstall passed for macOS %s.\n' "$target"
