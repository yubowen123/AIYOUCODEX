#!/bin/zsh
set -eu
THEME_DIR="${0:A:h}"
AIYOU_ROOT="${1:-${AIYOU_ROOT:-$HOME/Library/Application Support/Codex Sidebar Enhancer}}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -f "$AIYOU_ROOT/scripts/install-theme.mjs" ]]; then
  print -u2 '请更新 AIYOUcodex，或将源码仓库目录作为第一个参数传入。'
  exit 1
fi
"$NODE_BIN" "$AIYOU_ROOT/scripts/install-theme.mjs" --package "$THEME_DIR" --dry-run
"$NODE_BIN" "$AIYOU_ROOT/scripts/install-theme.mjs" --package "$THEME_DIR" --install-dir "$AIYOU_ROOT"
print '主题已注册，请在主题与动效中选择并保存。'
