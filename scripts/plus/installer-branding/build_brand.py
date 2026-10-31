#!/usr/bin/env python3
"""Compose the installer welcome/progress brand bitmaps (DSH Desktop Plus).

Slot geometry is measured from the official installer art and is fixed by
`installer/theme.nsh` + `installer/window-frame.cpp`: the bitmap canvas is
600x196 (2x: 1200x392) and the slot stretches it across the FULL window
width, so the lockup must sit centered on a transparent canvas — content
never spans the canvas.

Official-measured geometry (1x pixels, all values scale by `scale`):
  badge      120x123  pasted at (240, 16)          — official mark, reused verbatim
  wordmark   126x24   baseline row y=164           — official "deepseek", reused verbatim
  gap        6        between wordmark and pill
  pill       h=19 (y 167..185), radius 9, side padding 9
  light      pill #0F1115 / text #FFFFFF
  dark       pill #F9FAFB / text #0F1115

Sources live in `sources/` (crops from the official bitmaps). Outputs land in
`upstream/apps/desktop/installer/assets/` and are carried to upstream by
`scripts/plus/hooks/0003-installer-plus-branding.patch`.
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'sources')
DEFAULT_TARGET = os.path.join(HERE, '..', '..', '..', 'upstream', 'apps', 'desktop', 'installer', 'assets')

FONT_CANDIDATES = (
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
)

CANVAS_W, CANVAS_H = 600, 196
BADGE_X, BADGE_Y = 240, 16
WORDMARK_Y = 164
WORDMARK_W, WORDMARK_H = 126, 24
GAP = 6
PILL_Y0, PILL_H, PILL_RADIUS, PILL_PAD = 167, 19, 9, 9
TEXT_SIZE, TRACKING = 12, 1
LABEL = 'DESKTOP PLUS'

THEMES = {
    'light': {'pill': (15, 17, 21, 255), 'text': (255, 255, 255, 255), 'wordmark': 'wordmark-light'},
    'dark': {'pill': (249, 250, 251, 255), 'text': (15, 17, 21, 255), 'wordmark': 'wordmark-dark'},
}


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise RuntimeError('no bold sans font found; extend FONT_CANDIDATES')


def text_width(font: ImageFont.FreeTypeFont, label: str, tracking: int) -> float:
    return sum(font.getlength(ch) for ch in label) + tracking * (len(label) - 1)


def draw_label(draw: ImageDraw.ImageDraw, pos: tuple[int, int], font: ImageFont.FreeTypeFont,
               label: str, tracking: int, color: tuple[int, int, int, int]) -> None:
    x, y = pos
    for ch in label:
        draw.text((x, y), ch, font=font, fill=color, anchor='lm')
        x += font.getlength(ch) + tracking


def build(theme: str, scale: int, target_dir: str) -> str:
    s = scale
    spec = THEMES[theme]
    canvas = Image.new('RGBA', (CANVAS_W * s, CANVAS_H * s), (0, 0, 0, 0))

    badge = Image.open(os.path.join(SOURCES, f'badge-{s}x.png')).convert('RGBA')
    canvas.paste(badge, (BADGE_X * s, BADGE_Y * s), badge)

    wordmark = Image.open(os.path.join(SOURCES, f"{spec['wordmark']}-{s}x.png")).convert('RGBA')
    font = load_font(TEXT_SIZE * s)
    label_w = round(text_width(font, LABEL, TRACKING * s))
    pill_w = label_w + 2 * PILL_PAD * s
    total_w = WORDMARK_W * s + GAP * s + pill_w
    x0 = (CANVAS_W * s - total_w) // 2

    canvas.paste(wordmark, (x0, WORDMARK_Y * s), wordmark)

    draw = ImageDraw.Draw(canvas)
    pill_x0 = x0 + WORDMARK_W * s + GAP * s
    pill_y0, pill_y1 = PILL_Y0 * s, (PILL_Y0 + PILL_H) * s
    draw.rounded_rectangle((pill_x0, pill_y0, pill_x0 + pill_w, pill_y1), radius=PILL_RADIUS * s,
                           fill=spec['pill'])
    draw_label(draw, (pill_x0 + PILL_PAD * s, (pill_y0 + pill_y1) // 2), font, LABEL,
               TRACKING * s, spec['text'])

    out = os.path.join(target_dir, f'brand{"-dark" if theme == "dark" else ""}{"" if s == 1 else "-2x"}.png')
    canvas.save(out)
    return out


def main() -> None:
    target = os.path.abspath(DEFAULT_TARGET)
    for theme in THEMES:
        for scale in (1, 2):
            path = build(theme, scale, target)
            print(f'wrote {path}')


if __name__ == '__main__':
    main()
