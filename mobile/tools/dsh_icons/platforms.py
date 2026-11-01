"""三平台启动图标的规格与合成。

规格里的「内容占比」统一指鲸鱼字形的**宽度** ÷ 画布边长：鲸鱼是横长的，
按宽度换算最贴近人眼对「大小」的感受，高度按原比例缩放后居中。

三平台为什么不烤圆角：

* iOS —— 系统统一把图标遮罩成圆角矩形，自己再烤一层会叠出双层边；
* Android 自适应图标 —— 系统按前景/背景分层遮罩，圆角由系统给；
* Android legacy 与 HarmonyOS —— 这两个平台不替普通图标遮罩，缺圆角就是
  直角方块，所以圆角必须烤进图片里。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from .artwork import Whale

# 圆角底板用 4 倍超采样再缩小，得到抗锯齿的圆角边。
SUPERSAMPLE = 4

WHITE = (255, 255, 255, 255)


@dataclass(frozen=True)
class IconSpec:
    """一张图标的生成规格。"""

    platform: str
    label: str
    size: int
    """画布边长（正方形）。"""

    content_ratio: float
    """鲸鱼字形宽度占画布宽度的比例。"""

    output: Path
    """产物路径。"""

    corner_ratio: float = 0.0
    """圆角半径 ÷ 画布边长；0 表示不烤圆角。"""

    plate: tuple[int, int, int, int] | None = None
    """底板颜色；None 表示画布透明（前景层与 iOS）。"""


def rounded_plate(size: int, radius: int, color: tuple[int, int, int, int]) -> Image.Image:
    """一张圆角底板，圆角之外透明。"""
    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=radius * SUPERSAMPLE, fill=255
    )
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    plate = Image.new("RGBA", (size, size), color)
    plate.putalpha(mask)
    return plate


def render(whale: Whale, spec: IconSpec) -> Image.Image:
    """按规格生成一张图标。"""
    canvas = Image.new("RGBA", (spec.size, spec.size), (0, 0, 0, 0))
    if spec.plate is not None:
        radius = round(spec.size * spec.corner_ratio)
        canvas = rounded_plate(spec.size, radius, spec.plate)

    target_width = max(1, round(spec.size * spec.content_ratio))
    source_width, source_height = whale.size
    target_height = max(1, round(source_height * target_width / source_width))
    scaled = whale.image.resize((target_width, target_height), Image.Resampling.LANCZOS)

    offset = ((spec.size - target_width) // 2, (spec.size - target_height) // 2)
    canvas.alpha_composite(scaled, offset)
    return canvas


# --------------------------------------------------------------------------
# 平台规格
# --------------------------------------------------------------------------

# Android 自适应图标的画布是 108dp，可见内容要落在中心的 66dp 安全区里
# （66/108 ≈ 61%）；前景层取 60%，给系统遮罩留一点余量。
ANDROID_DENSITIES = (
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
)

# iOS：App Store 图标安全区留白约 10%，鲸鱼取画布的 72%。
IOS_CONTENT_RATIO = 0.72

# Android legacy：系统不遮罩，烤圆角（半径 = 边长 22%），鲸鱼取 80%。
ANDROID_LEGACY_CONTENT_RATIO = 0.80
ANDROID_LEGACY_CORNER_RATIO = 0.22

# HarmonyOS：512 方图，烤圆角（半径 = 边长 22.5%，对齐华为桌面观感），
# 鲸鱼取 66%。
HARMONY_SIZE = 512
HARMONY_CONTENT_RATIO = 0.66
HARMONY_CORNER_RATIO = 0.225


def ios_specs(repo_root: Path) -> list[IconSpec]:
    iconset = (
        repo_root
        / "mobile/ios/DshMobile/Resources/Assets.xcassets/AppIcon.appiconset"
    )
    return [
        IconSpec(
            platform="iOS",
            label="AppIcon-1024（不烤圆角，iOS 系统遮罩；白底不透明）",
            size=1024,
            content_ratio=IOS_CONTENT_RATIO,
            plate=WHITE,
            output=iconset / "AppIcon-1024.png",
        )
    ]


def android_specs(repo_root: Path) -> list[IconSpec]:
    res = repo_root / "mobile/android/app/src/main/res"
    specs: list[IconSpec] = []
    for density, legacy_size in ANDROID_DENSITIES:
        foreground_size = round(legacy_size * 108 / 48)
        specs.append(
            IconSpec(
                platform="Android",
                label=f"{density} legacy（烤圆角，白底）",
                size=legacy_size,
                content_ratio=ANDROID_LEGACY_CONTENT_RATIO,
                corner_ratio=ANDROID_LEGACY_CORNER_RATIO,
                plate=WHITE,
                output=res / f"mipmap-{density}/ic_launcher.png",
            )
        )
        specs.append(
            IconSpec(
                platform="Android",
                label=f"{density} adaptive 前景（透明底）",
                size=foreground_size,
                content_ratio=0.60,
                output=res / f"mipmap-{density}/ic_launcher_foreground.png",
            )
        )
    return specs


def harmony_specs(repo_root: Path) -> list[IconSpec]:
    harmony = repo_root / "mobile/harmony"
    outputs = (
        harmony / "AppScope/resources/base/media/app_icon.png",
        harmony / "entry/src/main/resources/base/media/app_icon.png",
    )
    return [
        IconSpec(
            platform="HarmonyOS",
            label=f"app_icon.png（{output.relative_to(repo_root)}）",
            size=HARMONY_SIZE,
            content_ratio=HARMONY_CONTENT_RATIO,
            corner_ratio=HARMONY_CORNER_RATIO,
            plate=WHITE,
            output=output,
        )
        for output in outputs
    ]


def all_specs(repo_root: Path) -> list[IconSpec]:
    return ios_specs(repo_root) + android_specs(repo_root) + harmony_specs(repo_root)
