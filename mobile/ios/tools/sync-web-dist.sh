#!/usr/bin/env bash
# 同步移动变体的 web 产物到壳内（构建产物，不入库）。
#
# 用法：
#   ./tools/sync-web-dist.sh            # 默认取 ../../dist/web-mobile
#   ./tools/sync-web-dist.sh <dist 目录>
#
# 产物来自仓库根的 `pnpm run build:web:mobile`（官方树 + 移动补丁集）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$IOS_DIR/../.." && pwd)"

SOURCE="${1:-$ROOT/dist/web-mobile}"
DEST="$IOS_DIR/DshMobile/Resources/dist"

if [ ! -d "$SOURCE" ]; then
  echo "找不到移动变体产物：$SOURCE" >&2
  echo "先在仓库根跑：pnpm run build:web:mobile" >&2
  exit 1
fi

mkdir -p "$DEST"
# 先清空再拷：产物里的旧文件必须跟着消失，否则壳里会留着上一版的资源。
find "$DEST" -mindepth 1 -not -name '.gitkeep' -delete
cp -R "$SOURCE/." "$DEST/"

echo "已同步移动变体产物：$SOURCE → $DEST"
