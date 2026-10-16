import copy
import io
import json
import os

from PIL import Image

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def load_plan() -> dict:
    with open(os.path.join(FIXTURES, "floorplan_1.plan.json")) as f:
        return json.load(f)


def png_bytes(w: int = 400, h: int = 300) -> bytes:
    img = Image.new("RGB", (w, h), "white")
    for x in range(40, w - 40):
        img.putpixel((x, 40), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def pdf_bytes() -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    page.draw_rect(fitz.Rect(20, 20, 280, 180), color=(0, 0, 0))
    return doc.tobytes()


def catalog_assets() -> list:
    from app.services.asset_service import system_asset_doc
    from app.services.common import load_system_catalog

    return [system_asset_doc(i, "https://storage.googleapis.com/soraplan-catalog") for i in load_system_catalog()]


def clone(x):
    return copy.deepcopy(x)
