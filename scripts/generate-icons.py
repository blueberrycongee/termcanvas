#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
DOCS_DIR = ROOT / "docs"

CANVAS_SIZE = 1024
BG_MARGIN = 72
BG_RADIUS = 224
SYMBOL_COLOR = (39, 39, 39, 255)
CARD_COLOR = (250, 249, 246, 255)
SHADOW_COLOR = (0, 0, 0, 36)

OUTER_X0 = 208
OUTER_Y0 = 188
OUTER_X1 = 816
OUTER_Y1 = 872
INNER_X0 = 316
INNER_Y0 = 296
INNER_X1 = 708
INNER_Y1 = 764
BAR_X0 = 461
BAR_Y0 = 376
BAR_X1 = 563
BAR_Y1 = 684


def ensure_dirs() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)


def build_master_png() -> Image.Image:
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (
            BG_MARGIN,
            BG_MARGIN + 18,
            CANVAS_SIZE - BG_MARGIN,
            CANVAS_SIZE - BG_MARGIN + 18,
        ),
        radius=BG_RADIUS,
        fill=SHADOW_COLOR,
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))

    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (BG_MARGIN, BG_MARGIN, CANVAS_SIZE - BG_MARGIN, CANVAS_SIZE - BG_MARGIN),
        radius=BG_RADIUS,
        fill=CARD_COLOR,
    )
    draw.rectangle((OUTER_X0, OUTER_Y0, OUTER_X1, OUTER_Y1), fill=SYMBOL_COLOR)
    draw.rectangle((INNER_X0, INNER_Y0, INNER_X1, INNER_Y1), fill=CARD_COLOR)
    draw.rectangle((BAR_X0, BAR_Y0, BAR_X1, BAR_Y1), fill=SYMBOL_COLOR)
    return canvas


def write_svg() -> None:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_SIZE}" height="{CANVAS_SIZE}" viewBox="0 0 {CANVAS_SIZE} {CANVAS_SIZE}" fill="none">
  <defs>
    <filter id="shadow" x="0" y="0" width="{CANVAS_SIZE}" height="{CANVAS_SIZE}" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000000" flood-opacity="0.14"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="{BG_MARGIN}" y="{BG_MARGIN}" width="{CANVAS_SIZE - BG_MARGIN * 2}" height="{CANVAS_SIZE - BG_MARGIN * 2}" rx="{BG_RADIUS}" fill="#FAF9F6"/>
  </g>
  <path d="M {OUTER_X0} {OUTER_Y0} H {OUTER_X1} V {OUTER_Y1} H {OUTER_X0} Z M {INNER_X0} {INNER_Y0} V {INNER_Y1} H {INNER_X1} V {INNER_Y0} Z" fill="#272727" fill-rule="evenodd" clip-rule="evenodd"/>
  <rect x="{BAR_X0}" y="{BAR_Y0}" width="{BAR_X1 - BAR_X0}" height="{BAR_Y1 - BAR_Y0}" fill="#272727"/>
</svg>
"""
    (BUILD_DIR / "icon.svg").write_text(svg, encoding="utf-8")


def write_pngs(master: Image.Image) -> None:
    master.save(BUILD_DIR / "icon.png")
    master.resize((256, 256), Image.LANCZOS).save(DOCS_DIR / "icon.png")


def write_ico(master: Image.Image) -> None:
    icon_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(BUILD_DIR / "icon.ico", sizes=icon_sizes)


def write_icns(master: Image.Image) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        iconset = Path(temp_dir) / "icon.iconset"
        iconset.mkdir()
        sizes = [16, 32, 128, 256, 512]
        for size in sizes:
            resized = master.resize((size, size), Image.LANCZOS)
            resized.save(iconset / f"icon_{size}x{size}.png")
            if size != 512:
                retina = master.resize((size * 2, size * 2), Image.LANCZOS)
                retina.save(iconset / f"icon_{size}x{size}@2x.png")
        master.save(iconset / "icon_512x512@2x.png")
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD_DIR / "icon.icns")],
            check=True,
        )


def main() -> None:
    ensure_dirs()
    master = build_master_png()
    write_svg()
    write_pngs(master)
    write_ico(master)
    write_icns(master)


if __name__ == "__main__":
    main()
