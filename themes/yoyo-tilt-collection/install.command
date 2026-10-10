#!/bin/bash
set -euo pipefail
AIYOU_THEME_PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AIYOU_THEME_NODE="${CODEX_SIDEBAR_NODE:-}"
if [[ -z "${AIYOU_THEME_NODE}" ]] && command -v node >/dev/null 2>&1; then
  AIYOU_THEME_NODE="$(command -v node)"
fi
if [[ -z "${AIYOU_THEME_NODE}" ]]; then
  for AIYOU_THEME_CANDIDATE in \
    "${HOME}/Library/Application Support/Codex Sidebar Enhancer/runtime/node/bin/node" \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
    if [[ -x "${AIYOU_THEME_CANDIDATE}" ]]; then AIYOU_THEME_NODE="${AIYOU_THEME_CANDIDATE}"; break; fi
  done
fi
if [[ ! -x "${AIYOU_THEME_NODE}" ]]; then
  printf '%s\n' '找不到 Node.js 22.5+。请将 CODEX_SIDEBAR_NODE 设为可执行文件的绝对路径。' >&2
  exit 1
fi
exec "${AIYOU_THEME_NODE}" "${AIYOU_THEME_PACKAGE_DIR}/install.mjs" "$@"
