"""三平台启动图标的生成工具。

入口是 ``mobile/tools/sync-icons.sh``（bash），图像处理在这里用 Pillow 做。
"""

from .artwork import Whale, extract_whale, load_source
from .platforms import IconSpec, all_specs, render
from .verify import Report, check_all, inspect

__all__ = [
    "IconSpec",
    "Report",
    "Whale",
    "all_specs",
    "check_all",
    "extract_whale",
    "inspect",
    "load_source",
    "render",
]
