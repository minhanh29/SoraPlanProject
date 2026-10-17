"""Generate the web app's art (web/public/art/*.webp) with Nano Banana 2 (gemini-3.1-flash-image).

Every image is listed in ART below with its prompt. Raw PNGs are cached in scripts/art/.raw/ so a
re-run only calls the API for images that are missing; delete a raw PNG to regenerate it.

Kinds:
  gen     text-to-image
  edit    image-to-image from another entry ("src"), used for pixel-aligned day/dusk pairs
  line    white line art on black -> white strokes with luminance alpha
  key     object on flat green -> chroma-keyed cut-out
  sketch  pencil drawing derived from another entry (no API call; stays pixel-aligned)
  avatar  square crop of another entry

Usage:  GEMINI_API_KEY=... python3 scripts/art/generate.py [name ...]
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(__file__).resolve().parent / ".raw"
OUT = ROOT / "web" / "public" / "art"
MODEL = "gemini-3.1-flash-image"

PHOTO = "Shot on medium format, natural, realistic, cinematic, no people, no text, no watermark."
LINE = "fine single-weight white strokes on a pure solid black background, no fill, no shading, no text, no labels."
OBJECT = ("three-quarter view, soft natural shadowless lighting, isolated on a perfectly flat solid pure green "
          "background (#00FF00), no shadow on the background, no floor, no text.")
TO_DUSK = ("Keep the exact same scene, camera, composition and objects, pixel aligned. Change only the time of day to "
           "blue hour: deep blue dusk sky, warm amber interior lamps on, calm and realistic. No text.")

ART = {
    # Login
    "hero-dusk": dict(kind="gen", aspect="16:9", prompt=
        "Architectural photograph at blue hour: a minimal white concrete house with large glass windows glowing warm "
        "amber from interior lamps, set on a quiet hillside with tall dry grass and a few pine trees, deep blue dusk sky "
        "with soft gradient, the house sits in the right half of the frame leaving calm empty sky and dark landscape on "
        "the left for text. " + PHOTO),
    "hero-day": dict(kind="edit", src="hero-dusk", prompt=
        "Keep the exact same scene, camera, composition, house and landscape. Change only the time of day to a clear "
        "bright late morning: soft pale blue sky, gentle sunlight, interior lights off, windows reflect the sky. "
        "Photorealistic, no text."),
    "hero-sketch": dict(kind="sketch", src="hero-day"),
    "avatar-day": dict(kind="avatar", src="hero-day", box=(0.6, 0.3, 0.94, 0.72)),
    "avatar-dusk": dict(kind="avatar", src="hero-dusk", box=(0.6, 0.3, 0.94, 0.72)),
    # Workflow backdrops: desk (upload, crop) -> lift (new project, parsing) -> model (review, style) -> room (ready)
    "desk-day": dict(kind="gen", aspect="16:9", prompt=
        "Photograph of a printed apartment floor plan in fine dark navy lines on clean white paper, lying on a pale oak "
        "desk by a window in soft late-morning daylight, a pencil and a metal scale ruler beside it, shallow depth of "
        "field, calm empty desk area on the left side. " + PHOTO),
    "desk-dusk": dict(kind="edit", src="desk-day", prompt=TO_DUSK + " A warm desk lamp lights the paper."),
    "lift-dusk": dict(kind="gen", aspect="16:9", prompt=
        "Top-down view of a floor plan drawing on dark navy paper, fine white architectural lines for walls, doors and "
        "furniture outlines, at the right side the lines rise up and transform into a translucent 3D white wireframe of "
        "the same rooms, soft blue dusk light, subtle warm glow where the 3D begins, calm empty dark area on the left, "
        "no text, no labels, realistic photographic, cinematic."),
    "lift-day": dict(kind="gen", aspect="16:9", prompt=
        "Architectural photograph in soft late-morning daylight: a white architectural cut-away model of an apartment "
        "floor, walls about knee height with no roof so the rooms and tiny pale furniture are visible, made of matte "
        "white board, standing on a large sheet of smooth warm-white paper. The model sits in the right third of the "
        "frame seen from a high three-quarter angle, long soft window shadows fall across the paper. The left two "
        "thirds of the frame are calm empty paper with a gentle light gradient, no lines, no objects. Minimal, quiet, "
        "premium, muted palette of white, pale grey and a hint of warm sunlight. Shot on medium format, shallow depth "
        "of field, no people, no text."),
    "model-day": dict(kind="gen", aspect="16:9", prompt=
        "Photograph of a white architectural study model of a modern two-storey house made of foam board and basswood, "
        "with cut-out windows and tiny furniture visible inside, standing on a large sheet of drafting paper on a pale "
        "oak table, soft late-morning daylight from a side window, the model sits in the right half of the frame, calm "
        "empty table on the left. " + PHOTO),
    "model-dusk": dict(kind="edit", src="model-day", prompt=TO_DUSK + " A small warm light glows inside the model."),
    "room-dusk": dict(kind="gen", aspect="16:9", prompt=
        "Architectural interior photograph at blue hour: a calm minimalist living room with floor-to-ceiling windows "
        "showing a deep blue dusk sky and dark hills, warm amber floor lamp and low sofa, pale oak floor, white plaster "
        "walls, soft realistic light, large calm empty wall area on the left side. " + PHOTO),
    "room-day": dict(kind="edit", src="room-dusk", prompt=
        "Keep the exact same room, camera, composition, furniture and windows, pixel aligned. Change only the time of "
        "day to a bright soft late morning: pale blue sky and sunlit green hills outside, gentle daylight filling the "
        "room, floor lamp switched off, airy and calm. Photorealistic, no text."),
    # Line art (white on transparent; tinted navy by CSS in light theme)
    "line-plan": dict(kind="line", aspect="1:1", size=700, prompt=
        "Thin white architectural floor plan line drawing of a two-bedroom apartment seen from directly above, walls as "
        "double lines, door swings as arcs, simple furniture outlines, " + LINE),
    "line-house": dict(kind="line", aspect="1:1", size=700, prompt=
        "Thin white technical line drawing of a small modern two-storey house in isometric perspective, architect's "
        "construction lines and faint extension lines, " + LINE),
    # Cut-out objects
    "obj-chair": dict(kind="key", aspect="1:1", size=600, prompt=
        "Studio product render of a single modern lounge chair in pale oak and off-white boucle fabric, " + OBJECT),
    "obj-sofa": dict(kind="key", aspect="1:1", size=700, prompt=
        "Studio product render of a single low modern three-seat sofa in warm off-white linen with pale oak legs, " + OBJECT),
    "obj-lamp": dict(kind="key", aspect="1:1", size=500, prompt=
        "Studio product render of a single modern floor lamp with an amber glass shade and a slim brass stem, " + OBJECT),
    "obj-plant": dict(kind="key", aspect="1:1", size=500, prompt=
        "Studio product render of a single olive tree in a matte white ceramic planter, " + OBJECT),
    "obj-plans": dict(kind="key", aspect="1:1", size=500, prompt=
        "Studio product render of a few rolled architectural blueprint sheets of white paper tied loosely, one partly "
        "unrolled showing fine navy plan lines, " + OBJECT),
}


def call(parts, aspect):
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={os.environ['GEMINI_API_KEY']}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    res = json.load(urllib.request.urlopen(req, timeout=240))
    for p in res["candidates"][0]["content"]["parts"]:
        if "inlineData" in p:
            return base64.b64decode(p["inlineData"]["data"])
    raise RuntimeError(json.dumps(res)[:400])


def raw(name):
    """Return the cached raw PNG for an API-backed entry, generating it if missing."""
    path = RAW / f"{name}.png"
    if path.exists():
        return path
    spec = ART[name]
    if spec["kind"] == "edit":
        src = base64.b64encode(raw(spec["src"]).read_bytes()).decode()
        data = call([{"inlineData": {"mimeType": "image/png", "data": src}}, {"text": spec["prompt"]}], "16:9")
    else:
        data = call([{"text": spec["prompt"]}], spec.get("aspect", "16:9"))
    RAW.mkdir(exist_ok=True)
    path.write_bytes(data)
    print("generated", name)
    return path


def webp(src, dst, quality=72, alpha=False):
    args = ["cwebp", "-quiet", "-q", str(quality)] + (["-alpha_q", "90"] if alpha else []) + [str(src), "-o", str(dst)]
    subprocess.run(args, check=True)


def build(name):
    spec = ART[name]
    kind = spec["kind"]
    dst = OUT / f"{name}.webp"
    tmp = RAW / f"{name}.out.png"
    if kind in ("gen", "edit"):
        webp(raw(name), dst)
    elif kind == "sketch":
        im = Image.open(raw(spec["src"])).convert("L")
        g = np.asarray(im).astype(np.float32)
        blur = np.asarray(ImageOps.invert(im).filter(ImageFilter.GaussianBlur(5))).astype(np.float32)
        d = 255 - np.clip(g * 255 / np.maximum(1, 255 - blur), 0, 255)
        d = np.clip((d - 12) * 1.5, 0, 255)[..., None] / 255
        paper, ink = np.array([244, 246, 249.0]), np.array([22, 36, 62.0])
        Image.fromarray((paper * (1 - d) + ink * d).astype(np.uint8)).save(tmp)
        webp(tmp, dst)
    elif kind == "avatar":
        im = Image.open(raw(spec["src"])).convert("RGB")
        w, h = im.size
        x0, y0, x1, y1 = spec["box"]
        side = min((x1 - x0) * w, (y1 - y0) * h)
        cx, cy = (x0 + x1) / 2 * w, (y0 + y1) / 2 * h
        im = im.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))).resize((96, 96), Image.LANCZOS)
        im.save(tmp)
        webp(tmp, dst, 80)
    else:
        a = np.asarray(Image.open(raw(name)).convert("RGB")).astype(np.float32)
        if kind == "line":
            lum = a.mean(axis=2)
            alpha = np.clip((lum - 18) * 1.4, 0, 255)
            out = np.dstack([np.full_like(lum, 255)] * 3 + [alpha])
        else:
            r, g, b = a[..., 0], a[..., 1], a[..., 2]
            green = g - np.maximum(r, b)
            alpha = np.clip(255 - (green - 30) * 4, 0, 255)
            a[..., 1] = np.where(green > 0, np.maximum(r, b) + green * 0.15, g)  # despill
            out = np.dstack([a[..., 0], a[..., 1], a[..., 2], alpha])
        o = Image.fromarray(out.astype(np.uint8), "RGBA")
        o = o.crop(o.getbbox())
        o.thumbnail((spec["size"], spec["size"]), Image.LANCZOS)
        o.save(tmp)
        webp(tmp, dst, 80, alpha=True)
    print("wrote", dst.relative_to(ROOT))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(exist_ok=True)
    for n in sys.argv[1:] or ART:
        build(n)
