#!/usr/bin/env bash
# 壳的数据面自检（票 #64）。
#
# 为什么有它：这台构建机**没有安装任何 iOS 模拟器运行时**，
# 「模拟器安装启动 → 连真实 lane」这条验证路径跑不起来。本脚本把壳的
# **原生数据面**（HTTP 客户端 / 引导载荷 / 直连令牌 / 降级链 / Keychain /
# 配对链接解析）在 macOS 上跑起来——编译的是壳的真实源码，不是复制品。
#
# 用法：
#   ./tools/selftest.sh                  # 自检 + 假 lane；真实 lane 若在 3093 端口也一起测
#   ./tools/selftest.sh 8092 3093        # 显式指定假 lane 端口 / 真实 lane 端口
#   REAL_LANE_PORT=0 ./tools/selftest.sh # 只测假 lane
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$HERE/.." && pwd)"
SOURCES_DIR="$IOS_DIR/DshMobile/Sources"

MOCK_PORT="${1:-8092}"
REAL_PORT="${2:-${REAL_LANE_PORT:-3093}}"
OUT_DIR="${TMPDIR:-/tmp}/dsh-ios-selftest"
BIN="$OUT_DIR/selftest"

mkdir -p "$OUT_DIR"

# 1) 编译壳的真实源码（只用与 UIKit/WebKit 无关的那一半：Shell/**）。
#    page/** 与 bridge/** 依赖 WebKit（只在 iOS 上编译），不进本自检。
SOURCES=(
  "$SOURCES_DIR/Shell/ShellSettings.swift"
  "$SOURCES_DIR/Shell/ShellLog.swift"
  "$SOURCES_DIR/Shell/host/HostEntry.swift"
  "$SOURCES_DIR/Shell/host/HostForm.swift"
  "$SOURCES_DIR/Shell/host/HostStatus.swift"
  "$SOURCES_DIR/Shell/host/HostRegistry.swift"
  "$SOURCES_DIR/Shell/host/HostCandidates.swift"
  "$SOURCES_DIR/Shell/host/OriginAddress.swift"
  "$SOURCES_DIR/Shell/host/SecureHostRegistry.swift"
  "$SOURCES_DIR/Shell/store/KeyValueStore.swift"
  "$SOURCES_DIR/Shell/store/KeychainStore.swift"
  "$SOURCES_DIR/Shell/store/ShellPreferences.swift"
  "$SOURCES_DIR/Shell/store/HostRecord.swift"
  "$SOURCES_DIR/Shell/net/LaneEndpoint.swift"
  "$SOURCES_DIR/Shell/net/LaneHttpClient.swift"
  "$SOURCES_DIR/Shell/boot/BootPayload.swift"
  "$SOURCES_DIR/Shell/boot/BootPayloadStore.swift"
  "$SOURCES_DIR/Shell/boot/InjectionRow.swift"
  "$SOURCES_DIR/Shell/boot/LaneIndexParser.swift"
  "$SOURCES_DIR/Shell/boot/BootPayloadProvider.swift"
  "$SOURCES_DIR/Shell/pair/PairLink.swift"
  "$SOURCES_DIR/Shell/pair/PairFailure.swift"
  "$SOURCES_DIR/Shell/pair/PairingService.swift"
  "$SOURCES_DIR/Shell/pair/LanePairingClient.swift"
  "$SOURCES_DIR/Shell/connect/HostConnector.swift"
  "$SOURCES_DIR/Shell/connect/HostProbe.swift"
  "$SOURCES_DIR/Shell/connect/ReachabilityProbe.swift"
  "$SOURCES_DIR/Shell/discover/LaneDiscovery.swift"
  "$SOURCES_DIR/Shell/lock/LockController.swift"
  "$SOURCES_DIR/Shell/lock/BiometricGate.swift"
  "$SOURCES_DIR/Shell/update/UpdateNotice.swift"
  "$SOURCES_DIR/Shell/update/ShellVersion.swift"
)

echo "编译自检程序（${#SOURCES[@]} 个壳源码文件）…"
swiftc -swift-version 5 -O -o "$BIN" "${SOURCES[@]}" "$HERE/selftest/main.swift"

# 2) 起假 lane（同一份 lane 契约）。
python3 "$HERE/mock-lane.py" "$MOCK_PORT" >"$OUT_DIR/mock-lane.log" 2>&1 &
MOCK_PID=$!
cleanup() {
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if nc -z 127.0.0.1 "$MOCK_PORT" 2>/dev/null; then break; fi
  sleep 0.1
done

# 3) 跑自检。
if [ "$REAL_PORT" = "0" ]; then
  "$BIN" "$MOCK_PORT" 0
else
  "$BIN" "$MOCK_PORT" "$REAL_PORT"
fi
