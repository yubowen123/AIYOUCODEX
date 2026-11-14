#!/bin/bash
set -euo pipefail
AIYOU_PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
AIYOU_PAYLOAD="${AIYOU_PACKAGE_DIR}/payload"
finish() {
  local result=$?
  if [[ "$result" -ne 0 ]]; then printf '\n安装未完成，请按上方提示处理后重新打开安装入口。\n'; fi
  if [[ -t 0 && "${AIYOU_INSTALL_NONINTERACTIVE:-0}" != "1" ]]; then read -r -p '按回车关闭此窗口…' _; fi
  exit "$result"
}
trap finish EXIT
[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || { printf '本包仅适用于 macOS。\n'; exit 1; }
AIYOU_OS_VERSION="$(/usr/bin/sw_vers -productVersion)"
AIYOU_OS_MAJOR="${AIYOU_OS_VERSION%%.*}"
if [[ "$AIYOU_OS_MAJOR" -lt 14 ]]; then
  printf '本包需要 macOS 14 或更新系统。\n'; exit 1
fi
printf 'AIYOUcodex · 与更强的你，一起构建可能\n正在校验完整安装包…\n'
(cd "${AIYOU_PAYLOAD}" && /usr/bin/shasum -a 256 -c SHA256SUMS >/dev/null)
BUNDLE_ARCH="$(cat "${AIYOU_PAYLOAD}/runtime/node/ARCH")"
case "$BUNDLE_ARCH" in
  arm64) BUNDLE_MAC="Apple Silicon Mac" ;;
  x64) BUNDLE_MAC="Intel Mac" ;;
  *) printf '无法识别安装包架构，请重新下载。\n'; exit 1 ;;
esac
case "$(/usr/bin/uname -m)" in
  arm64) MAC_ARCH=arm64 ;;
  x86_64)
    MAC_ARCH=x64
    if [[ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then MAC_ARCH=arm64; fi
    ;;
  *) printf '当前 Mac 的处理器架构不受支持。\n'; exit 1 ;;
esac
[[ "$MAC_ARCH" == "$BUNDLE_ARCH" ]] || { printf '本包适用于 %s，请下载与你的 Mac 芯片匹配的版本。\n' "$BUNDLE_MAC"; exit 1; }
if [[ "${AIYOU_INSTALL_TEST_MODE:-0}" != "1" && ! -d /Applications/ChatGPT.app && ! -d /Applications/Codex.app ]]; then
  printf '请先安装并登录 OpenAI 官方 Codex/ChatGPT 桌面应用，然后重新双击本安装入口。\n'
  printf '官方入口：https://chatgpt.com/download/\n'
  exit 1
fi
export CODEX_SIDEBAR_SOURCE_DIR="${AIYOU_PAYLOAD}"
export CODEX_SIDEBAR_NODE="${AIYOU_PAYLOAD}/runtime/node/bin/node"
export CODEX_SIDEBAR_PREBUNDLED=1
/bin/bash "${AIYOU_PAYLOAD}/install.sh"
printf '\n安装成功。以后从「AIYOUcodex」启动，重启后后台自动恢复。\n'
