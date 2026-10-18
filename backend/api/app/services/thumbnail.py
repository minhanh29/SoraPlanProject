"""Small WebP thumbnails for asset cards and pickers (the original photo stays the Meshy input)."""
import io

from PIL import Image, ImageOps

THUMB_MAX_SIDE = 512
THUMB_CONTENT_TYPE = "image/webp"


def make_thumbnail(data: bytes, max_side: int = THUMB_MAX_SIDE) -> bytes:
    """WebP, longest side <= max_side, alpha kept (cut-out photos stay transparent)."""
    with Image.open(io.BytesIO(data)) as src:
        im = ImageOps.exif_transpose(src)
        has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if has_alpha else "RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        buf = io.BytesIO()
        # exact=True keeps the colour under transparent pixels, so edges don't get dark fringes
        im.save(buf, format="WEBP", quality=82, method=6, exact=has_alpha)
        return buf.getvalue()
