"""生成三平台启动图标的入口。

用法：``python3 sync_icons.py [--root REPO_ROOT]``

脚本是幂等的：每次都从上游源图重新生成全部图标，再逐张自检。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dsh_icons import all_specs, check_all, extract_whale, load_source, render
from dsh_icons.artwork import Whale

SOURCE = Path("upstream/apps/desktop/resources/icon.png")


def repo_root(argument: str | None) -> Path:
    """脚本所在目录的上上级就是仓库根。"""
    if argument:
        return Path(argument).resolve()
    return Path(__file__).resolve().parent.parent.parent


def build(root: Path) -> list:
    """从源图生成全部图标，返回自检报告。"""
    source = load_source(root / SOURCE)
    whale = extract_whale(source)
    print(
        f"鲸鱼字形：{whale.size[0]}×{whale.size[1]} px"
        f"（长宽比 {whale.aspect:.3f}），源图 {source.size[0]}×{source.size[1]} px"
    )

    specs = all_specs(root)
    for spec in specs:
        image = render(whale, spec)
        spec.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(spec.output, format="PNG", optimize=True)
        print(f"  {spec.platform:<9} {spec.output.relative_to(root)}  {spec.label}")

    return check_all(specs)


def report(reports: list) -> int:
    """打印自检结果；有不合格项就返回非零。"""
    print()
    failures = 0
    for item in reports:
        relative = item.spec.output
        if item.ok:
            print(
                f"  ✓ {relative.name:<28} {item.size[0]}×{item.size[1]}"
                f"  内容 {item.content_ratio:.0%}"
                 f"  角合格 {'是' if item.corner_ok else '否'}"
            )
        else:
            failures += 1
            print(f"  ✗ {relative.name:<28} {'；'.join(item.failures)}")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成三平台启动图标")
    parser.add_argument("--root", help="仓库根目录（默认按脚本位置推断）")
    options = parser.parse_args(argv)

    root = repo_root(options.root)
    reports = build(root)
    failures = report(reports)
    if failures:
        print(f"\n{failures} 张图标不符合规格。")
        return 1
    print(f"\n全部 {len(reports)} 张图标符合规格。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
