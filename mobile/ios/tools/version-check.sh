#!/usr/bin/env bash
# 壳版本号的跨实现对拍（code-review 修复 P1）。
#
# 编译的是**壳的真实源码**（DshMobile/Sources/Shell/update/ShellVersion.swift），
# 向量取自仓库里的共享文件（scripts/plus/test/mobile-version.vectors.json）——
# node / Kotlin / ArkTS 三端跑的是同一份向量。
#
# 用法：
#   ./tools/version-check.sh              # 用仓库默认的向量文件
#   ./tools/version-check.sh <向量文件>   # 指定别的向量文件
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$HERE/.." && pwd)"
REPO_DIR="$(cd "$IOS_DIR/../.." && pwd)"
SOURCES_DIR="$IOS_DIR/DshMobile/Sources"
OUT_DIR="${TMPDIR:-/tmp}/dsh-ios-version-check"
BIN="$OUT_DIR/version-check"

VECTORS="${1:-$REPO_DIR/scripts/plus/test/mobile-version.vectors.json}"

mkdir -p "$OUT_DIR"

echo "编译版本号对拍程序…"
swiftc -swift-version 5 -O -o "$BIN" \
  "$SOURCES_DIR/Shell/update/ShellVersion.swift" \
  "$HERE/version-check/main.swift"

"$BIN" "$VECTORS"
