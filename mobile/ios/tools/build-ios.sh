#!/usr/bin/env bash
# 构建 iOS 壳：同步移动变体产物 → 推导版本号 → xcodebuild。
#
# 用法：
#   ./tools/build-ios.sh                          # 模拟器构建
#   ./tools/build-ios.sh 'platform=iOS Simulator,name=iPhone 17 Pro'
#   PLUS_VERSION=0.2.2-alpha.2.plus.9 ./tools/build-ios.sh
#   ./tools/build-ios.sh --archive                # 出 ipa（侧载用）
#
# 版本号：plus 版本 → CFBundleVersion / CFBundleShortVersionString，
# 公式见 scripts/plus/mobile-version.mjs（票 #58）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$IOS_DIR/../.." && pwd)"

ARCHIVE=0
DESTINATION=""
for argument in "$@"; do
  case "$argument" in
    --archive) ARCHIVE=1 ;;
    -*) ;;
    *) DESTINATION="$argument" ;;
  esac
done

# 1) 壳内的 web 产物（构建产物，不入库）。
"$HERE/sync-web-dist.sh"

# 2) 版本号。
PLUS_VERSION="${PLUS_VERSION:-$(node "$ROOT/scripts/plus/version.mjs" --print)}"
BUNDLE_VERSION="$(node --input-type=module -e "
import { mobileBundleVersion } from 'file://$ROOT/scripts/plus/mobile-version.mjs';
console.log(mobileBundleVersion(process.argv[1]));
" "$PLUS_VERSION")"
echo "版本：plus=$PLUS_VERSION → CFBundleVersion=$BUNDLE_VERSION"

# 3) 工程文件：xcodegen 生成（工程本身入库，生成器只是省手工维护）。
if command -v xcodegen >/dev/null 2>&1; then
  (cd "$IOS_DIR" && xcodegen generate --quiet)
else
  echo "未安装 xcodegen：使用仓库里已生成的 DshMobile.xcodeproj" >&2
fi

COMMON=(
  -project "$IOS_DIR/DshMobile.xcodeproj"
  -scheme DshMobile
  -configuration Release
  MARKETING_VERSION="$PLUS_VERSION"
  CURRENT_PROJECT_VERSION="$BUNDLE_VERSION"
)

if [ "$ARCHIVE" -eq 1 ]; then
  # 侧载用 ipa：个人签 7 天有效（真机验证遗留项，见 README）。
  xcodebuild archive "${COMMON[@]}" \
    -destination 'generic/platform=iOS' \
    -archivePath "$IOS_DIR/build/DshMobile.xcarchive" \
    CODE_SIGN_IDENTITY="-" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO
  APP="$(find "$IOS_DIR/build/DshMobile.xcarchive/Products/Applications" -maxdepth 1 -name '*.app' | head -1)"
  mkdir -p "$IOS_DIR/build/ipa"
  cp -R "$APP" "$IOS_DIR/build/ipa/"
  # ipa = Payload/<App>.app 的 zip：归档出来的是 .app 目录，侧载工具（SideStore /
  # AltStore）认的是 ipa，这里就地打成 ipa（未签名，重签由侧载工具做）。
  STAGE="$IOS_DIR/build/ipa-stage"
  rm -rf "$STAGE"
  mkdir -p "$STAGE/Payload"
  cp -R "$APP" "$STAGE/Payload/"
  # -y：保留 bundle 里的符号链接（framework 软链），跟官方 ipa 的做法一致。
  (cd "$STAGE" && zip -qry "$IOS_DIR/build/DshMobile.ipa" Payload)
  rm -rf "$STAGE"
  echo "已出包（未签名，需自行签名后侧载）：$IOS_DIR/build/ipa"
  echo "已出 ipa（未签名）：$IOS_DIR/build/DshMobile.ipa"
  exit 0
fi

if [ -z "$DESTINATION" ]; then
  DESTINATION='generic/platform=iOS Simulator'
fi
xcodebuild build "${COMMON[@]}" -destination "$DESTINATION"
