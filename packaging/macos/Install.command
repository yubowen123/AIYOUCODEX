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
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { printf '本包适用于 Apple Silicon Mac（M1/M2/M3/M4 等），不是 Intel/Windows 安装包。\n'; exit 1; }
AIYOU_OS_VERSION="$(/usr/bin/sw_vers -productVersion)"
AIYOU_OS_MAJOR="${AIYOU_OS_VERSION%%.*}"
AIYOU_OS_MINOR="${AIYOU_OS_VERSION#*.}"; AIYOU_OS_MINOR="${AIYOU_OS_MINOR%%.*}"
if [[ "$AIYOU_OS_MAJOR" -lt 13 || ( "$AIYOU_OS_MAJOR" -eq 13 && "$AIYOU_OS_MINOR" -lt 5 ) ]]; then
  printf '本包需要 macOS 13.5 或更新系统。\n'; exit 1
fi
if [[ "${AIYOU_INSTALL_TEST_MODE:-0}" != "1" && ! -d /Applications/ChatGPT.app && ! -d /Applications/Codex.app ]]; then
  printf '请先安装并登录 OpenAI 官方 Codex/ChatGPT 桌面应用，然后重新双击本安装入口。\n'
  printf '官方入口：https://openai.com/index/introducing-the-codex-app/\n'
  exit 1
fi
printf 'AIYOUcodex · 与更强的你，一起构建可能\n正在校验完整安装包…\n'
(cd "${AIYOU_PAYLOAD}" && /usr/bin/shasum -a 256 -c SHA256SUMS >/dev/null)
export CODEX_SIDEBAR_SOURCE_DIR="${AIYOU_PAYLOAD}"
export CODEX_SIDEBAR_NODE="${AIYOU_PAYLOAD}/runtime/node/bin/node"
export CODEX_SIDEBAR_PREBUNDLED=1
/bin/bash "${AIYOU_PAYLOAD}/install.sh"
printf '\n安装成功。以后从「AIYOUcodex」启动，重启后后台自动恢复。\n'
