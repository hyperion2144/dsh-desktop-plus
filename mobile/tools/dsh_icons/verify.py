"""生成结果的自检：尺寸、内容占比、圆角/透明角。

自检只读产物，不依赖任何外部工具 —— 跑完能立刻知道这一轮图标是不是
符合规格（尺寸对不对、鲸鱼占画布多少、圆角有没有烤进去）。
"""

from __future__ import annotations

from dataclasses import dataclass
from PIL import Image

from .artwork import INK_CLEAR_MIN
from .platforms import IconSpec

# 内容占比允许的误差（画布边长的百分点）。
RATIO_TOLERANCE = 0.02

# 判定「有内容」的 alpha 门限，避开抗锯齿的碎像素。
INK_ALPHA_MIN = 24


def _alpha_at(alpha: Image.Image, xy: tuple[int, int]) -> int:
    """读一个 alpha 像素；取不到标量时按 0 处理。"""
    value = alpha.getpixel(xy)
    return int(value) if isinstance(value, (int, float)) else 0


@dataclass(frozen=True)
class Report:
    """一张图标的检查结果。"""

    spec: IconSpec
    size: tuple[int, int]
    content_ratio: float
    corner_ok: bool
    corner_problem: str
    center_opaque: bool

    @property
    def ok(self) -> bool:
        return (
            self.size == (self.spec.size, self.spec.size)
            and abs(self.content_ratio - self.spec.content_ratio) <= RATIO_TOLERANCE
            and self.corner_ok
            and self.center_opaque
        )

    @property
    def failures(self) -> list[str]:
        problems: list[str] = []
        if self.size != (self.spec.size, self.spec.size):
            problems.append(f"尺寸 {self.size[0]}×{self.size[1]} ≠ {self.spec.size}")
        if abs(self.content_ratio - self.spec.content_ratio) > RATIO_TOLERANCE:
            problems.append(
                f"内容占比 {self.content_ratio:.1%} ≠ {self.spec.content_ratio:.0%}"
            )
        if not self.corner_ok:
            problems.append(self.corner_problem)
        if not self.center_opaque:
            problems.append("中心不透明（底板缺失？）")
        return problems


def _content_bbox(image: Image.Image, plated: bool) -> tuple[int, int, int, int] | None:
    """鲸鱼在图里的包围盒。

    透明画布上靠 alpha 找内容；白底板上 alpha 铺满整块，得靠亮度把鲸鱼挑出来。
    """
    if plated:
        luma = image.convert("L")
        ink = luma.point([255 if value < INK_CLEAR_MIN else 0 for value in range(256)])
        return ink.getbbox()
    alpha = image.getchannel("A")
    ink = alpha.point([255 if value >= INK_ALPHA_MIN else 0 for value in range(256)])
    return ink.getbbox()


def inspect(spec: IconSpec) -> Report:
    """检查一张已生成的图标。"""
    with Image.open(spec.output) as raw:
        image = raw.convert("RGBA")
    width, height = image.size

    bbox = _content_bbox(image, spec.plate is not None)
    ratio = 0.0
    if bbox is not None:
        ratio = (bbox[2] - bbox[0]) / width

    alpha = image.getchannel("A")
    corners = [
        _alpha_at(alpha, (0, 0)),
        _alpha_at(alpha, (width - 1, 0)),
        _alpha_at(alpha, (0, height - 1)),
        _alpha_at(alpha, (width - 1, height - 1)),
    ]
    if spec.plate is not None and spec.corner_ratio == 0:
        # 不烤圆角的白底板（iOS）：底板应铺满整张画布，四角不透明。
        corner_ok = all(value >= 255 for value in corners)
        corner_problem = "四角透明（不烤圆角时底板应铺满画布）"
    else:
        # 烤圆角的底板与透明前景：四角都应透明。
        corner_ok = all(value < 16 for value in corners)
        corner_problem = "四角不透明（圆角没烤进去？）"
    center_opaque = _alpha_at(alpha, (width // 2, height // 2)) >= 255

    return Report(
        spec=spec,
        size=(width, height),
        content_ratio=ratio,
        corner_ok=corner_ok,
        corner_problem=corner_problem,
        center_opaque=center_opaque,
    )


def check_all(specs: list[IconSpec]) -> list[Report]:
    """逐张检查；产物缺失的文件会被跳过（由调用方先保证生成过）。"""
    return [inspect(spec) for spec in specs if spec.output.exists()]
