import io

import pytest
from PIL import Image

from app.errors import AppException
from app.services import crop_service

from .helpers import pdf_bytes, png_bytes


def test_pdf_first_page_renders_to_png():
    png = crop_service.pdf_first_page_to_png(pdf_bytes(), dpi=144)
    img = Image.open(io.BytesIO(png))
    assert img.format == "PNG" and img.size == (600, 400)


def test_invalid_pdf():
    with pytest.raises(AppException):
        crop_service.pdf_first_page_to_png(b"%PDF-nope")


def test_crop_and_clamp():
    rect = crop_service.clamp_crop({"x": 300, "y": -5, "width": 500, "height": 100}, 400, 300)
    assert rect == {"x": 300, "y": 0, "width": 100, "height": 100}  # clamped to the image
    rect = crop_service.clamp_crop({"x": 10.4, "y": 20.6, "width": 200, "height": 150}, 400, 300)
    assert rect == {"x": 10, "y": 21, "width": 200, "height": 150}
    out = Image.open(io.BytesIO(crop_service.crop_image(png_bytes(400, 300), rect)))
    assert out.size == (200, 150)


def test_crop_too_small():
    with pytest.raises(AppException) as e:
        crop_service.clamp_crop({"x": 380, "y": 0, "width": 100, "height": 100}, 400, 300)
    assert e.value.code == "CROP_TOO_SMALL"


def test_exif_rotation_is_applied():
    img = Image.new("RGB", (40, 20), "white")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    _, w, h = crop_service.normalize_upload(buf.getvalue())
    assert (w, h) == (20, 40)


def test_thumbnail():
    thumb = Image.open(io.BytesIO(crop_service.thumbnail(png_bytes(400, 300))))
    assert max(thumb.size) == 96 and thumb.format == "JPEG"
