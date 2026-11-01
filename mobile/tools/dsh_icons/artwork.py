"""从上游桌面图标里取出鲸鱼字形。

上游资源 ``upstream/apps/desktop/resources/icon.png`` 是 1104×1104 的成品图：
一张 1024×1024 的近白卡片（``#FBFBFB`` 底 + 两层浅蓝灰渐变），卡片上叠着深色
鲸鱼（``#1C2434`` → ``#0F1115`` 渐变），卡片外圈是一圈半透明投影。

移动端图标要把鲸鱼单独放进平台指定的画布，所以这里把鲸鱼从卡片里剥出来：

1. 卡片区域 = 全透明通道里 alpha 满值的像素包围盒（投影是半透明的，不会满值）；
2. 卡片区域内按亮度取墨迹 —— 鲸鱼是暗色（亮度 ≤ 70），卡片与投影都是亮色
   （卡片 ≥ 230，投影 216~221），两者之间留出干净的间隔；
3. 鲸鱼身上的镂空（腹部、眼睛）在原图里是「透出卡片」，这里按卡片原色填实，
   得到一张自带底色的鲸鱼字形 —— 叠到白底、透明底或任意底色上都成立。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps

# 亮度分档：鲸鱼实心 / 鲸鱼边缘 / 非鲸鱼（卡片与投影）。
# 卡片最暗处（#D4DBE9 渐变叠加）亮度约 230，投影约 216，两者都落在 CLEAR 之上。
INK_SOLID_MAX = 150
INK_CLEAR_MIN = 205


@dataclass(frozen=True)
class Whale:
    """从成品图里剥出来的鲸鱼字形。"""

    image: Image.Image
    """紧致裁剪后的 RGBA 鲸鱼（透明底，身上的镂空已填实）。"""

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size

    @property
    def aspect(self) -> float:
        width, height = self.image.size
        return width / height


def load_source(path: Path) -> Image.Image:
    """读入上游成品图，转成 RGBA。"""
    with Image.open(path) as raw:
        return raw.convert("RGBA")


def card_region(source: Image.Image) -> Image.Image:
    """裁出卡片本身（不含外圈投影）。

    卡片是完全不透明的正方形；投影只有 5%~9% 的 alpha，所以「alpha 满值」的
    像素包围盒正好是卡片。
    """
    alpha = source.getchannel("A")
    solid = alpha.point([255 if value >= 255 else 0 for value in range(256)])
    bbox = solid.getbbox()
    if bbox is None:
        raise ValueError("源图里找不到不透明的卡片区域")
    return source.crop(bbox)


def _ink_alpha(region: Image.Image) -> Image.Image:
    """按亮度把鲸鱼从卡片上取出来（带抗锯齿的软边）。"""
    luma = region.convert("L")
    span = INK_CLEAR_MIN - INK_SOLID_MAX
    ramp = []
    for value in range(256):
        if value <= INK_SOLID_MAX:
            ramp.append(255)
        elif value >= INK_CLEAR_MIN:
            ramp.append(0)
        else:
            ramp.append(round(255 * (INK_CLEAR_MIN - value) / span))
    return luma.point(ramp)


def _enclosed_holes(alpha: Image.Image) -> Image.Image:
    """找出被墨迹完全包围的镂空（腹部、眼睛）。

    从画布角落漫灌背景，灌不到的区域就是被鲸鱼围住的洞。
    """
    background = ImageOps.invert(alpha)
    flooded = background.copy()
    ImageDraw.floodfill(flooded, (0, 0), 128)
    # 漫灌之后：与画布相连的背景变成 128，被围住的洞仍是 255，墨迹是 0。
    return flooded.point([255 if value == 255 else 0 for value in range(256)])

def extract_whale(source: Image.Image) -> Whale:
    """把成品图拆成「透明底的鲸鱼字形」。"""
    region = card_region(source)
    alpha = _ink_alpha(region)
    # 镂空按卡片原色填实：alpha 置满，RGB 保持源图（即卡片色）。
    alpha = ImageChops.lighter(alpha, _enclosed_holes(alpha))

    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("源图里没取到鲸鱼")

    # 卡片本身是不透明的，alpha 要换成墨迹掩码，裁剪后才能得到透明底的字形。
    whale = region.copy()
    whale.putalpha(alpha)
    return Whale(image=whale.crop(bbox))
