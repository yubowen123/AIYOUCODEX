#!/bin/bash
set -euo pipefail
AIYOU_LAUNCHER="${HOME}/Applications/AIYOUcodex.app"
if [[ ! -d "${AIYOU_LAUNCHER}" ]]; then
  printf '请先双击「安装 AIYOUcodex.command」。\n'; exit 1
fi
/usr/bin/open "${AIYOU_LAUNCHER}"
