#!/usr/bin/env bash
# 从桌面应用的官方图标生成三平台的启动图标（产物已入库，本脚本用于复现）。
#
# 源：upstream/apps/desktop/resources/icon.png（官方树，只读引用）。
#     那是一张成品图：近白卡片 + 深色鲸鱼 + 卡片外圈投影。
#     脚本先把鲸鱼从卡片里剥出来（见 dsh_icons/artwork.py），再按各平台规格摆放。
#
# 三平台规格（内容占比 = 鲸鱼字形宽度 ÷ 画布边长；鲸鱼是横长的，按宽度换算）：
#
#   iOS    ios/DshMobile/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
#          1024×1024，鲸鱼占画布 72%（App Store 图标安全区留白），画布透明。
#          不烤圆角 —— iOS 由系统统一遮罩成圆角矩形，自己再烤会叠出双层边。
#
#   Android  android/app/src/main/res/mipmap-<dpi>/ic_launcher_foreground.png
#            自适应图标的前景层，鲸鱼占 108dp 画布的 60%
#            （108dp 画布的 66dp 安全区 ≈ 61%），四周透明；
#            背景层是 colors.xml 里的纯色 @color/ic_launcher_background，不动。
#          android/app/src/main/res/mipmap-<dpi>/ic_launcher.png
#            legacy 方形图标（系统不遮罩，必须自己烤圆角）：
#            圆角半径 = 边长 22%，白底，鲸鱼占画布 80%，圆角外透明。
#
#   HarmonyOS harmony/AppScope/resources/base/media/app_icon.png
#            harmony/entry/src/main/resources/base/media/app_icon.png
#          512×512，烤圆角（半径 = 边长 22.5%，对齐华为桌面观感），白底，
#          鲸鱼占画布 66%，圆角外透明。
#          工程里没有 layered_image 分层（app.json5 / module.json5 都指向单张
#          $media:app_icon），所以只出这一张扁平图标，不额外造前景/背景分层。
#
# 依赖：python3 + Pillow。脚本会自己找一个装了 Pillow 的解释器。
# 不再退回 sips —— sips 只能等比缩放，做不到安全区留白和圆角遮罩，
# 那正是这次返工要解决的问题。
#
# 用法：bash mobile/tools/sync-icons.sh   （幂等，可重复执行）
set -euo pipefail
cd "$(dirname "$0")/../.."   # 仓库根

find_python() {
  # 找一个装了 Pillow 的 python3：先看 PATH 上的，再看常见的绝对路径。
  local candidate
  for candidate in python3 /opt/homebrew/bin/python3 /usr/bin/python3 python3.13 python; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import PIL' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! PYTHON="$(find_python)"; then
  echo "找不到装了 Pillow 的 python3。" >&2
  echo "装一个再重跑：python3 -m pip install --user Pillow" >&2
  exit 1
fi

echo "用 $PYTHON 生成图标。"
"$PYTHON" mobile/tools/sync_icons.py "$@"

# 独立复核：用 macOS 自带的 sips 再抽查三个平台的尺寸（不依赖 Python）。
echo
echo "sips 抽查："
for sample in \
  "mobile/ios/DshMobile/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png" \
  "mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
  "mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png" \
  "mobile/harmony/AppScope/resources/base/media/app_icon.png"
do
  sips -g pixelWidth -g pixelHeight "$sample" | tail -n 2 | tr '\n' ' '
  echo "  $sample"
done
