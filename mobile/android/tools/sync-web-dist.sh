#!/usr/bin/env bash
# 把移动变体的 web 产物同步进安卓壳的 assets（构建产物，不入库）。
#
# 移动补丁集当前为空（切换器已改为原生浮层实现）：壳内产物与官方 dist
# 字节一致，移动端不再向 upstream 注入任何 UI。
#
# 用法：
#   ./tools/sync-web-dist.sh                      # 默认取仓库内的 dist/web-mobile
#   ./tools/sync-web-dist.sh <dist 目录>          # 显式指定
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(cd ../.. && pwd)"
DEFAULT_DIST="$REPO_ROOT/dist/web-mobile"
SRC="${1:-$DEFAULT_DIST}"
DEST="app/src/main/assets/dist"

if [ ! -f "$SRC/index.html" ]; then
  echo "错误：$SRC 里没有 index.html。先构建：" >&2
  echo "  pnpm run build:web:mobile" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
echo "已同步 $SRC -> $DEST"
find "$DEST" -type f | wc -l | xargs echo "文件数："
