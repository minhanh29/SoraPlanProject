#!/usr/bin/env python3
"""Generate the good / bad crop example images shown in the chat's crop step.

    backend/api/.venv/bin/python scripts/make_crop_examples.py

Writes web/public/examples/crop-good.png and crop-bad.png from samples/floorplan_1.png.
Good = tight around the outer walls of the plan. Bad = loose (dimension lines, title, margin) and tilted.
"""
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "samples/floorplan_1.png"
OUT = REPO / "web/public/examples"
WIDTH = 640

# Outer wall corners of samples/floorplan_1.png in source pixels (same values the parser calibrates to)
PLAN_BOX = (629, 321, 2150, 1457)


def badge(im: Image.Image, good: bool) -> Image.Image:
    im = im.convert("RGBA")
    r = 22
    cx, cy = im.width - r - 12, r + 12
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    color = (31, 157, 85, 235) if good else (214, 51, 108, 235)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    w = 5
    if good:
        d.line([(cx - 10, cy + 1), (cx - 3, cy + 8), (cx + 11, cy - 8)], fill="white", width=w, joint="curve")
    else:
        d.line([(cx - 8, cy - 8), (cx + 8, cy + 8)], fill="white", width=w)
        d.line([(cx - 8, cy + 8), (cx + 8, cy - 8)], fill="white", width=w)
    return Image.alpha_composite(im, layer)


def save(im: Image.Image, name: str) -> None:
    im = im.convert("RGB")
    h = round(im.height * WIDTH / im.width)
    im = im.resize((WIDTH, h), Image.LANCZOS)
    im = badge(im, good=name.startswith("crop-good"))
    # Line art: a small palette keeps it crisp and well under 150 KB
    im = im.convert("RGB").quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    path = OUT / name
    im.save(path, optimize=True)
    print(f"{path.relative_to(REPO)}: {im.width}x{im.height}, {path.stat().st_size // 1024} KB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGB")

    x1, y1, x2, y2 = PLAN_BOX
    pad = 14
    save(src.crop((x1 - pad, y1 - pad, x2 + pad, y2 + pad)), "crop-good.png")

    # Loose crop with dimension lines and the title, tilted like a hand-held phone photo
    loose = src.crop((300, 60, 2560, 1820))
    tilted = loose.rotate(4.5, resample=Image.BICUBIC, expand=True, fillcolor=(236, 233, 226))
    save(tilted, "crop-bad.png")


if __name__ == "__main__":
    main()
