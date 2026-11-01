#!/usr/bin/env bash
# 把移动变体的 web 产物同步进鸿蒙壳的 rawfile（构建产物，不入库）。
#
# 用法：
#   ./tools/sync-web-dist.sh                      # 默认取仓库根的 dist/web-mobile
#   ./tools/sync-web-dist.sh <dist 目录>          # 显式指定
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(cd ../.. && pwd)"
DEFAULT_DIST="$REPO_ROOT/dist/web-mobile"
SRC="${1:-$DEFAULT_DIST}"
DEST="entry/src/main/resources/rawfile/dist"

if [ ! -f "$SRC/index.html" ]; then
  echo "错误：$SRC 里没有 index.html。先构建移动变体：" >&2
  echo "  cd $REPO_ROOT && pnpm run build:web:mobile" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
echo "已同步 $SRC -> $DEST"
find "$DEST" -type f | wc -l | xargs echo "文件数："
