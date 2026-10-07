#!/bin/bash
set -euo pipefail
AIYOU_PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
printf '卸载 AIYOUcodex 增强运行时；保留原生对话、项目任务数据和已安装的主题 Skill。\n'
/bin/bash "${AIYOU_PACKAGE_DIR}/payload/uninstall.sh"
