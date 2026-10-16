"""Plan image processing: PDF page 1 → PNG, size probe, crop, sidebar thumbnail (Pillow + PyMuPDF)."""
import io
from typing import Dict, Tuple

from PIL import Image, ImageOps

from ..errors import AppException

MAX_RENDER_PX = 4000
MIN_CROP_PX = 64


def pdf_first_page_to_png(pdf_bytes: bytes, dpi: int = 200) -> bytes:
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise AppException(status_code=400, code="INVALID_PDF", detail=f"Could not open the PDF: {e}")
    if doc.page_count < 1:
        raise AppException(status_code=400, code="INVALID_PDF", detail="The PDF has no pages")
    page = doc.load_page(0)
    zoom = dpi / 72.0
    longest = max(page.rect.width, page.rect.height) * zoom
    if longest > MAX_RENDER_PX:
        zoom *= MAX_RENDER_PX / longest
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


def _open(image_bytes: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)  # phone photos
        img.load()
        return img
    except Exception as e:
        raise AppException(status_code=400, code="INVALID_IMAGE", detail=f"Could not read the image: {e}")


def image_size(image_bytes: bytes) -> Tuple[int, int]:
    return _open(image_bytes).size


def normalize_upload(image_bytes: bytes) -> Tuple[bytes, int, int]:
    """Apply EXIF orientation and re-encode as PNG so crop pixels match what the browser shows."""
    img = _open(image_bytes)
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), img.width, img.height


def clamp_crop(crop: Dict[str, float], width: int, height: int) -> Dict[str, int]:
    x = max(0, min(int(round(crop.get("x", 0))), width - 1))
    y = max(0, min(int(round(crop.get("y", 0))), height - 1))
    w = max(1, min(int(round(crop.get("width", width))), width - x))
    h = max(1, min(int(round(crop.get("height", height))), height - y))
    if w < MIN_CROP_PX or h < MIN_CROP_PX:
        raise AppException(status_code=400, code="CROP_TOO_SMALL", detail=f"The crop must be at least {MIN_CROP_PX} px on each side")
    return {"x": x, "y": y, "width": w, "height": h}


def crop_image(image_bytes: bytes, crop: Dict[str, int]) -> bytes:
    img = _open(image_bytes)
    box = (crop["x"], crop["y"], crop["x"] + crop["width"], crop["y"] + crop["height"])
    out = img.crop(box)
    if out.mode not in ("RGB", "RGBA", "L"):
        out = out.convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def thumbnail(image_bytes: bytes, size: int = 96) -> bytes:
    img = _open(image_bytes).convert("RGB")
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    return buf.getvalue()
