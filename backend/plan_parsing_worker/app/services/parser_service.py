import base64
import io
import json
import logging
import math
import re
import statistics
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
import httpx
import importlib

try:
    Image = importlib.import_module("PIL.Image")
    HAS_PIL = True
except Exception:
    Image = None  # type: ignore
    HAS_PIL = False

from firebase_admin import firestore

from ..config import get_settings
from ..firebase import get_firestore_client, get_storage_client
from ..models.floorplan import (
    Door,
    Fixture,
    FloorPlan,
    Furniture,
    Point2D,
    Room,
    RoomCorners,
    SourceImage,
    StatedDimensions,
    Wall,
    Window,
)
from ..models.task import ParsePlanTaskRequest

logger = logging.getLogger("plan_parsing_worker.service")


class _SkipCorners(Exception):
    """Control flow: cropped uploads skip the corner-detection pass."""

SYSTEM_INSTRUCTION = """You are an architectural floor-plan digitisation engine.
Analyse the supplied floor-plan image and reconstruct its editable 2D geometry as structured JSON.
Your job is not to describe the image. Your job is to locate every meaningful architectural component precisely.

0. COORDINATES (READ CAREFULLY):
- Report ALL geometry in normalized image coordinates: integers from 0 to 1000, where [0, 0] is the top-left
  corner of the WHOLE image and [1000, 1000] is its bottom-right corner, independent of the image aspect ratio.
- Boxes are [ymin, xmin, ymax, xmax]. Points are [y, x]. Lines are [y1, x1, y2, x2].
- Do NOT convert anything to feet or meters; the server does that from "footprint_box_2d" and the real-world size.

1. FOOTPRINT & SCALE:
- "footprint_box_2d": the tight box around the OUTER faces of the exterior walls of the building.
- "width" / "height": the real-world size of that footprint, read from the overall dimension strings
  (e.g. 57'-0"). If only chained dimensions are given, add them up. If none are visible, estimate from standard
  sizes (interior doors ~3 ft / 0.9 m, queen bed ~5 x 6.7 ft). "units": "ft" or "m".

2. WALLS:
- Add all exterior walls ("exterior": true) and all interior partition walls ("exterior": false).
- "line" runs along the wall's CENTERLINE. Horizontal walls keep y1 == y2; vertical walls keep x1 == x2.
- "thickness" is the drawn wall thickness on the same 0-1000 scale, measured along the image width.
- Do NOT create door or window objects. Wherever a wall has a door or window opening, SPLIT the wall into
  separate segments before and after the opening and leave the opening as a blank gap.
- Connected walls must share endpoints exactly (corners and T-junctions meet).
- Only the thick drawn wall lines are walls. Cabinets, closets, shelving, counters and furniture outlines are
  NOT walls, even when drawn as small rectangles against a wall.

3. FURNITURE & FIXTURES:
- One entry per symbol actually DRAWN on the plan (each dining chair, each nightstand separately). Never one box
  around a group, and never invent items that are not drawn. Room names and dimension text are not objects.
- "box_2d" is the TIGHT box around the drawn symbol's outline as it appears in the image: its true drawn size,
  not a standard size, and excluding text labels, door swing arcs and nearby objects.
- L-shaped or U-shaped counters and sectional sofas: one box per straight run, so no box covers empty floor.
- A rectangle drawn around a room name is a text frame, not furniture. Rugs are not furniture.
- Closets and wardrobes (drawn as a rail with zig-zag hanger lines) are "wardrobe" furniture: one box per run.
- "angle" is 0 for every object drawn parallel to the walls, whichever way it faces (the box already gives its
  extent). Only for objects drawn diagonally give the clockwise angle in degrees; box_2d is still the tight
  axis-aligned box around the drawn symbol.
- Every object lies inside the footprint.
- Objects never overlap: no two boxes on the same spot and no box on top of or inside another. A sink or stove
  set into a counter splits the counter into separate runs on either side of it.

4. ROOMS:
- "polygon": the room's inner wall faces as [y, x] points, clockwise. "name" comes from the plan label.
- "statedDimensions": the room's written size (e.g. 18' x 10') in real-world units when shown, else null.

If an object is uncertain, include it with a lower confidence score.

Return ONLY a valid JSON object matching this exact schema:
{
  "units": "ft" or "m",
  "width": <number>,
  "height": <number>,
  "footprint_box_2d": [ymin, xmin, ymax, xmax],
  "scaleConfidence": <number 0-1>,
  "rooms": [
    {"name": "...", "polygon": [[y, x], ...], "statedDimensions": {"width": <number>, "height": <number>} or null, "confidence": <number>}
  ],
  "walls": [
    {"line": [y1, x1, y2, x2], "thickness": <number>, "exterior": true/false, "confidence": <number>}
  ],
  "furniture": [
    {
      "furnitureType": "bed" | "sofa" | "chair" | "armchair" | "table" | "coffee_table" | "dining_table" | "desk" | "nightstand" | "wardrobe" | "cabinet" | "kitchen_island" | "unknown",
      "label": "...",
      "box_2d": [ymin, xmin, ymax, xmax],
      "angle": <degrees>,
      "confidence": <number>
    }
  ],
  "fixtures": [
    {
      "fixtureType": "sink" | "toilet" | "bathtub" | "shower" | "stove" | "oven" | "refrigerator" | "washer" | "dryer" | "counter" | "unknown",
      "label": "...",
      "box_2d": [ymin, xmin, ymax, xmax],
      "angle": <degrees>,
      "confidence": <number>
    }
  ]
}
"""

CROPPED_INSTRUCTION = """
The user cropped the image around the plan, but margins with dimension lines may remain: footprint_box_2d is
still the box around the exterior walls only.
"""

CORNERS_INSTRUCTION = """
The building footprint was already measured: footprint_box_2d = {box} and its real-world size is
{w} x {h} {units}. Use exactly these values for "footprint_box_2d", "width", "height" and "units".
"""

CORNER_DETECTION_INSTRUCTION = """You are an architectural vision system specializing in floor plan geometric calibration.
Find the main building footprint in this floor plan image and its real-world size.
Rules:
1. Ignore outer margins, dimension lines/arrows (e.g. 40'-0"), title blocks, legends and labels like 'FLOOR PLAN'.
2. "footprint_box_2d" is the tight box around the OUTER faces of the exterior walls, as [ymin, xmin, ymax, xmax]
   in normalized image coordinates: integers 0-1000, where [0, 0] is the image's top-left corner and
   [1000, 1000] its bottom-right, independent of the aspect ratio.
3. Read the overall dimension annotations for the footprint's width and height (add up chained dimensions if
   needed). If none are visible, estimate from standard residential sizes.
4. Return ONLY a valid JSON object matching this schema:
{
  "footprint_box_2d": [ymin, xmin, ymax, xmax],
  "statedDimensions": {"width": <number>, "height": <number>, "units": "ft" or "m"},
  "confidence": <number between 0 and 1>
}
"""

REVIEW_INSTRUCTION = """You are the quality reviewer of a floor-plan digitisation engine.
Image 1 is the original floor plan. Image 2 is the same plan with the current parse drawn on top:
red lines = walls, blue boxes = furniture, green boxes = fixtures, purple outlines = rooms, orange box = footprint.
Every item is tagged with its id. The current parse is also given as JSON below.

All coordinates are normalized image coordinates: integers 0-1000 over the WHOLE image, [0, 0] top-left,
[1000, 1000] bottom-right. Boxes are [ymin, xmin, ymax, xmax], points [y, x], lines [y1, x1, y2, x2].

Compare the two images carefully and fix every mistake:
1. Each furniture/fixture symbol DRAWN in image 1 has exactly one box that tightly covers its drawn outline.
   Move or resize boxes that are offset, too big or too small. Add missing ones; delete duplicates.
2. Delete boxes that sit on text labels, dimension strings, door swings, empty floor or outside the building,
   and boxes for things that are not drawn.
3. "angle" is 0 for objects drawn parallel to the walls (whichever way they face). Only diagonally drawn objects
   get their clockwise angle in degrees, with box_2d still the tight axis-aligned box around them.
4. Fix wrong types and labels (e.g. a nightstand typed as a chair).
   A box that covers mostly empty floor is wrong: split L-shaped counters/sofas into one box per straight run.
   A rectangle framing a room name is a text frame and rugs are not furniture: delete those boxes.
   Closets drawn with zig-zag hanger lines are "wardrobe" furniture: add any that are missing.
   Boxes never overlap: where two boxes share a spot or one sits on top of / inside another, keep the one that
   matches the drawing and delete or shrink the other (split a counter around a sink or stove set into it).
5. Walls lie on the drawn walls' centerlines, connected walls share endpoints, and door/window openings stay as
   gaps between wall segments. Cabinets, closets, shelving and counters are NOT walls: delete walls drawn on
   them. Fix, add or delete walls accordingly.
6. Room outlines follow the inner wall faces and carry the plan's room names.
7. The footprint box covers the outer faces of the exterior walls, and width/height/units match the overall
   dimension strings. Correct them with "set_footprint" if not.
Go through EVERY id in the JSON one by one before answering; do not stop at the first few problems.
Only change what is wrong. If everything is right, return no edits and "done": true.

Return ONLY a valid JSON object:
{
  "edits": [
    {"op": "update", "id": "<id>", <only the fields to change: box_2d, angle, label, furnitureType, fixtureType, line, thickness, exterior, polygon, name>},
    {"op": "delete", "id": "<id>"},
    {"op": "add", "kind": "furniture" | "fixture" | "wall" | "room", <the item's fields, same schema as the JSON>},
    {"op": "set_footprint", "footprint_box_2d": [ymin, xmin, ymax, xmax], "width": <number>, "height": <number>, "units": "ft" or "m"}
  ],
  "done": true/false,
  "summary": "<one sentence on what you changed>"
}

Current parse:
"""

ITEM_KEYS = {"walls": "w", "furniture": "f", "fixtures": "x", "rooms": "r"}
KIND_LIST = {"wall": "walls", "furniture": "furniture", "fixture": "fixtures", "room": "rooms"}


def _pos(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 and math.isfinite(f) else None


def _box_px(box: Any, img_w: int, img_h: int) -> Optional[Tuple[float, float, float, float]]:
    """Normalized [ymin, xmin, ymax, xmax] (0-1000) -> pixel (x0, y0, x1, y1), or None if unusable."""
    if not (isinstance(box, list) and len(box) == 4):
        return None
    try:
        y0, x0, y1, x1 = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    x0, y0, x1, y1 = (max(0.0, min(1000.0, v)) for v in (x0, y0, x1, y1))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return (x0 / 1000 * img_w, y0 / 1000 * img_h, x1 / 1000 * img_w, y1 / 1000 * img_h)


# Long side of common symbols, in feet: the sanity check for a plan's stated dimensions
REFERENCE_LONG_SIDE_FT = {"bed": 6.75, "bathtub": 5.0, "toilet": 2.4}


def _reference_scale(data: Dict[str, Any], img_w: int, img_h: int) -> Optional[float]:
    """Feet per image pixel implied by standard-size symbols (beds, bathtubs, toilets), or None."""
    est = []
    for key, type_key in (("furniture", "furnitureType"), ("fixtures", "fixtureType")):
        for o in data.get(key) or []:
            ref = REFERENCE_LONG_SIDE_FT.get(str(o.get(type_key)))
            b = _box_px(o.get("box_2d"), img_w, img_h)
            if ref and b and not float(o.get("angle") or 0) % 90:
                est.append(ref / max(b[2] - b[0], b[3] - b[1]))
    return statistics.median(est) if est else None


def _dedupe(items: List[Dict[str, Any]], kind_key: str, iou_limit: float = 0.6) -> List[Dict[str, Any]]:
    """Drop a box that mostly overlaps a more confident box of the same type (the model sometimes repeats one)."""
    kept: List[Dict[str, Any]] = []
    for o in sorted(items, key=lambda o: -float(o.get("confidence") or 0)):
        ax0, ay0, ax1, ay1 = o["x"], o["y"], o["x"] + o["width"], o["y"] + o["height"]
        dup = False
        for k in kept:
            if k.get(kind_key) != o.get(kind_key):
                continue
            bx0, by0, bx1, by1 = k["x"], k["y"], k["x"] + k["width"], k["y"] + k["height"]
            iw, ih = min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)
            if iw <= 0 or ih <= 0:
                continue
            inter = iw * ih
            if inter / (o["width"] * o["height"] + k["width"] * k["height"] - inter) > iou_limit:
                dup = True
                break
        if not dup:
            kept.append(o)
    return kept



OVERLAP_EPS = 0.02  # plan units; boxes that just touch (after rounding) do not overlap


def _aabb(o: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """Axis-aligned bounds of a plan box (x/y/width/height is the unrotated box, rotation in degrees about its center)."""
    cx, cy = o["x"] + o["width"] / 2, o["y"] + o["height"] / 2
    r = math.radians(float(o.get("rotation") or 0))
    hw = (abs(math.cos(r)) * o["width"] + abs(math.sin(r)) * o["height"]) / 2
    hh = (abs(math.sin(r)) * o["width"] + abs(math.cos(r)) * o["height"]) / 2
    return cx - hw, cy - hh, cx + hw, cy + hh


def _straight(o: Dict[str, Any]) -> bool:
    """Its x/y/width/height is also its axis-aligned footprint (so it can be trimmed or split)."""
    return float(o.get("rotation") or 0) % 180 == 0


def _carve(outer: Dict[str, Any], inner: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """Split a long run (counter, wardrobe, bench) around an object set into it: the pieces on either side.
    None when `outer` is not a run that `inner` cuts across."""
    if not (_straight(outer) and _straight(inner)):
        return None
    horiz = outer["width"] >= outer["height"]
    long_, short = (outer["width"], outer["height"]) if horiz else (outer["height"], outer["width"])
    if long_ < 1.8 * short:
        return None
    a0, a1 = (outer["x"], outer["x"] + outer["width"]) if horiz else (outer["y"], outer["y"] + outer["height"])
    i0, i1 = (inner["x"], inner["x"] + inner["width"]) if horiz else (inner["y"], inner["y"] + inner["height"])
    s0, s1 = (outer["y"], outer["y"] + outer["height"]) if horiz else (outer["x"], outer["x"] + outer["width"])
    j0, j1 = (inner["y"], inner["y"] + inner["height"]) if horiz else (inner["x"], inner["x"] + inner["width"])
    if min(s1, j1) - max(s0, j0) < 0.6 * short:
        return None  # the inner box does not cut across the run's depth
    pieces = []
    for lo, hi in ((a0, min(i0, a1)), (max(i1, a0), a1)):
        if hi - lo >= 0.5 * short:
            pieces.append({**outer, "x": lo, "width": hi - lo} if horiz else {**outer, "y": lo, "height": hi - lo})
    return pieces


def _resolve_overlaps(items: List[Dict[str, Any]], contain_limit: float = 0.4, min_keep: float = 0.4) -> List[Dict[str, Any]]:
    """Plan objects never share floor (furniture and fixtures together, in plan units).

    The more confident box wins. Where one box sits on the same spot / on top of / inside another (overlap above
    `contain_limit` of the smaller one), the less confident one is dropped, except that a long run (counter,
    wardrobe) is split around an object set into it. A partial overlap trims the less confident box along the
    shallower axis so the two just touch; one trimmed below `min_keep` of its size is dropped instead.
    """
    area = lambda o: o["width"] * o["height"]
    kept: List[Dict[str, Any]] = []
    pending = sorted((dict(o) for o in items), key=lambda o: (-float(o.get("confidence") or 0), -area(o)))
    pending.reverse()  # pop() takes the most confident first
    while pending:
        o = pending.pop()
        orig_w, orig_h = o["width"], o["height"]
        alive, i = True, 0
        while alive and i < len(kept):
            k = kept[i]
            ax0, ay0, ax1, ay1 = _aabb(o)
            bx0, by0, bx1, by1 = _aabb(k)
            px, py = min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)
            if px <= OVERLAP_EPS or py <= OVERLAP_EPS:
                i += 1
                continue
            if px * py > contain_limit * min(area(o), area(k)):
                if area(k) >= area(o) and (pieces := _carve(k, o)) is not None:
                    kept[i:i + 1] = pieces  # pieces lie inside k: they cannot touch the other kept boxes
                    i += len(pieces)
                    continue
                if area(o) > area(k) and (pieces := _carve(o, k)) is not None:
                    pending.extend(pieces)  # each piece is checked on its own
                alive = False
                break
            if not (_straight(o) and _straight(k)):
                alive = False  # a diagonal box cannot be trimmed square: the less confident one goes
                break
            if px <= py:
                if (ax0 + ax1) < (bx0 + bx1):
                    o["width"] = bx0 - o["x"]
                else:
                    o["width"], o["x"] = o["x"] + o["width"] - bx1, bx1
            else:
                if (ay0 + ay1) < (by0 + by1):
                    o["height"] = by0 - o["y"]
                else:
                    o["height"], o["y"] = o["y"] + o["height"] - by1, by1
            if o["width"] < min_keep * orig_w or o["height"] < min_keep * orig_h:
                alive = False
                break
            i = 0  # trimming moved an edge: check against every kept box again
        if alive:
            kept.append(o)
    return kept


def _assign_ids(data: Dict[str, Any]) -> None:
    """Give every raw item a short id (w1, f3, ...) the reviewer can refer to."""
    for key, prefix in ITEM_KEYS.items():
        items = [o for o in (data.get(key) or []) if isinstance(o, dict)]
        data[key] = items
        for i, o in enumerate(items, 1):
            o["id"] = f"{prefix}{i}"


def _is_box(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 4 and all(isinstance(n, (int, float)) for n in v)


def _is_poly(v: Any) -> bool:
    return isinstance(v, list) and len(v) >= 3 and all(
        isinstance(p, list) and len(p) == 2 and all(isinstance(n, (int, float)) for n in p) for p in v
    )


REVIEW_FIELDS = {
    "walls": {"line": _is_box, "thickness": lambda v: isinstance(v, (int, float)) and v > 0,
              "exterior": lambda v: isinstance(v, bool)},
    "furniture": {"box_2d": _is_box, "angle": lambda v: isinstance(v, (int, float)), "label": lambda v: isinstance(v, str),
                  "furnitureType": lambda v: isinstance(v, str)},
    "fixtures": {"box_2d": _is_box, "angle": lambda v: isinstance(v, (int, float)), "label": lambda v: isinstance(v, str),
                 "fixtureType": lambda v: isinstance(v, str)},
    "rooms": {"polygon": _is_poly, "name": lambda v: isinstance(v, str)},
}
REQUIRED_FIELD = {"walls": "line", "furniture": "box_2d", "fixtures": "box_2d", "rooms": "polygon"}


def _apply_edits(data: Dict[str, Any], edits: Any) -> Dict[str, int]:
    """Apply the reviewer's edits to the raw (normalized) parse in place. Invalid edits are skipped."""
    counts = {"update": 0, "delete": 0, "add": 0, "set_footprint": 0, "skipped": 0}
    index = {o["id"]: (key, o) for key in ITEM_KEYS for o in data.get(key) or []}
    deleted = set()
    next_n = {key: len(data.get(key) or []) for key in ITEM_KEYS}
    for e in edits if isinstance(edits, list) else []:
        op = e.get("op") if isinstance(e, dict) else None
        if op in ("update", "delete"):
            hit = index.get(str(e.get("id")))
            if not hit or hit[1]["id"] in deleted:
                counts["skipped"] += 1
                continue
            key, item = hit
            if op == "delete":
                deleted.add(item["id"])
            else:
                changes = {f: v for f, v in e.items() if f in REVIEW_FIELDS[key] and REVIEW_FIELDS[key][f](v)}
                if not changes:
                    counts["skipped"] += 1
                    continue
                item.update(changes)
            counts[op] += 1
        elif op == "add":
            key = KIND_LIST.get(str(e.get("kind")))
            if not key or not REVIEW_FIELDS[key][REQUIRED_FIELD[key]](e.get(REQUIRED_FIELD[key])):
                counts["skipped"] += 1
                continue
            item = {f: v for f, v in e.items() if f in REVIEW_FIELDS[key] and REVIEW_FIELDS[key][f](v)}
            next_n[key] += 1
            item["id"] = f"{ITEM_KEYS[key]}{next_n[key]}"
            item["confidence"] = 0.8
            data.setdefault(key, []).append(item)
            index[item["id"]] = (key, item)
            counts["add"] += 1
        elif op == "set_footprint":
            if _is_box(e.get("footprint_box_2d")):
                data["footprint_box_2d"] = e["footprint_box_2d"]
            for f in ("width", "height"):
                if _pos(e.get(f)):
                    data[f] = float(e[f])
            if e.get("units") in ("ft", "m"):
                data["units"] = e["units"]
            counts["set_footprint"] += 1
        else:
            counts["skipped"] += 1
    for key in ITEM_KEYS:
        data[key] = [o for o in data.get(key) or [] if o["id"] not in deleted]
    return counts


def render_overlay(image_bytes: bytes, data: Dict[str, Any]) -> bytes:
    """Draw the raw parse (normalized coords) with ids on top of the plan image, as PNG bytes."""
    from PIL import ImageDraw, ImageFont

    base = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_w, img_h = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.load_default(size=max(12, img_w // 110))
    line_w = max(2, img_w // 600)

    def p(y: float, x: float) -> Tuple[float, float]:
        return (float(x) / 1000 * img_w, float(y) / 1000 * img_h)

    def tag(xy: Tuple[float, float], text: str, color: Tuple[int, int, int]) -> None:
        l, t, r, b = draw.textbbox(xy, text, font=font)
        draw.rectangle((l - 2, t - 1, r + 2, b + 1), fill=(255, 255, 255, 230))
        draw.text(xy, text, fill=color + (255,), font=font)

    fb = data.get("footprint_box_2d")
    if _is_box(fb):
        draw.rectangle((*p(fb[0], fb[1]), *p(fb[2], fb[3])), outline=(255, 140, 0, 200), width=line_w)
    for r in data.get("rooms") or []:
        if _is_poly(r.get("polygon")):
            pts = [p(*pt) for pt in r["polygon"]]
            draw.line(pts + [pts[0]], fill=(150, 60, 200, 200), width=line_w)
            cx, cy = sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)
            tag((cx, cy), f'{r["id"]} {r.get("name", "")}', (150, 60, 200))
    for w in data.get("walls") or []:
        if _is_box(w.get("line")):
            a, b = p(w["line"][0], w["line"][1]), p(w["line"][2], w["line"][3])
            draw.line((a, b), fill=(230, 30, 30, 200), width=line_w * 2)
            tag(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), w["id"], (230, 30, 30))
    for key, color in (("furniture", (30, 80, 230)), ("fixtures", (20, 150, 60))):
        for o in data.get(key) or []:
            b = o.get("box_2d")
            if not _is_box(b):
                continue
            (x0, y0), (x1, y1) = p(min(b[0], b[2]), min(b[1], b[3])), p(max(b[0], b[2]), max(b[1], b[3]))
            draw.rectangle((x0, y0, x1, y1), outline=color + (255,), fill=color + (40,), width=line_w)
            angle = float(o.get("angle") or 0)
            tag((x0 + 2, y0 + 2), f'{o["id"]} {o.get("label", "")}' + (f" {angle:.0f}°" if angle % 90 else ""), color)
    out = io.BytesIO()
    Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB").save(out, format="PNG")
    return out.getvalue()


class PlanParserService:
    """Service to parse floor plan images with Gemini and normalize geometry."""

    def __init__(self):
        self.settings = get_settings()
        self._genai_client = None

    @property
    def genai_client(self):
        """Vertex AI with the worker's service account (Application Default Credentials locally)."""
        if self._genai_client is None:
            from google import genai

            self._genai_client = genai.Client(
                vertexai=True,
                project=self.settings.FIREBASE_PROJECT_ID,
                location=self.settings.GEMINI_LOCATION,
            )
        return self._genai_client

    def _generate_json(
        self,
        instruction: str,
        image_bytes: bytes,
        media_type: str,
        timeout_s: int,
        extra_images: Sequence[Tuple[bytes, str]] = (),
    ) -> str:
        """One Gemini call: instruction + plan image (+ extra images) -> JSON text."""
        from google.genai import types

        model = self.settings.GEMINI_PARSER_MODEL
        started = time.monotonic()
        resp = self.genai_client.models.generate_content(
            model=model,
            contents=[types.Content(role="user", parts=[
                types.Part.from_text(text=instruction),
                types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                *(types.Part.from_bytes(data=b, mime_type=m) for b, m in extra_images),
            ])],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
                http_options=types.HttpOptions(timeout=timeout_s * 1000),
            ),
        )
        um = resp.usage_metadata
        logger.info(json.dumps({
            "event": "gemini_plan_call", "model": model, "latencyMs": int((time.monotonic() - started) * 1000),
            "tokens": {"prompt": um.prompt_token_count or 0, "output": um.candidates_token_count or 0} if um else {},
        }))
        return resp.text or ""

    def detect_room_corners(self, image_bytes: bytes, mime_type: str = "image/png") -> RoomCorners:
        """Step 1 (Pre-parsing Step): Detect 4 exact corners of room footprint & physical scale."""
        # 1. Analyze image dimensions
        img_w, img_h = 2048, 1536
        if HAS_PIL and Image:
            try:
                pil_img = Image.open(io.BytesIO(image_bytes))
                img_w, img_h = pil_img.size
            except Exception as e:
                logger.warning("Could not inspect image dimensions: %s", e)

        # Normalize media type
        if "png" in mime_type.lower():
            media_type = "image/png"
        elif "jpeg" in mime_type.lower() or "jpg" in mime_type.lower():
            media_type = "image/jpeg"
        elif "webp" in mime_type.lower():
            media_type = "image/webp"
        else:
            media_type = "image/png"

        instruction = CORNER_DETECTION_INSTRUCTION

        logger.info("Step 1: Calling Gemini (%s) to detect the building footprint...", self.settings.GEMINI_PARSER_MODEL)
        try:
            raw_text = self._generate_json(instruction, image_bytes, media_type, timeout_s=60)
        except Exception as e:
            logger.error("Failed to detect room corners with Gemini: %s", e)
            crop_w = int(img_w * 0.75)
            crop_h = int(img_h * 0.75)
            crop_x = int((img_w - crop_w) / 2)
            crop_y = int((img_h - crop_h) / 2)
            return RoomCorners(
                topLeft=Point2D(x=crop_x, y=crop_y),
                topRight=Point2D(x=crop_x + crop_w, y=crop_y),
                bottomRight=Point2D(x=crop_x + crop_w, y=crop_y + crop_h),
                bottomLeft=Point2D(x=crop_x, y=crop_y + crop_h),
                cropX=crop_x,
                cropY=crop_y,
                cropWidth=crop_w,
                cropHeight=crop_h,
                planWidth=40.0,
                planHeight=30.0,
                units="ft",
                confidence=0.5,
            )

        data = self._extract_json(raw_text)
        box = _box_px(data.get("footprint_box_2d"), img_w, img_h) or (0.0, 0.0, float(img_w), float(img_h))
        x0, y0, x1, y1 = box
        stated = data.get("statedDimensions") or {}
        plan_w = float(stated.get("width") or 40.0)
        plan_h = float(stated.get("height") or 30.0)
        units = str(stated.get("units") or "ft")
        conf = float(data.get("confidence") or 0.9)

        logger.info(
            "Detected footprint px=(%.0f,%.0f)-(%.0f,%.0f), stated size=%.1fx%.1f %s",
            x0, y0, x1, y1, plan_w, plan_h, units,
        )

        return RoomCorners(
            topLeft=Point2D(x=x0, y=y0),
            topRight=Point2D(x=x1, y=y0),
            bottomRight=Point2D(x=x1, y=y1),
            bottomLeft=Point2D(x=x0, y=y1),
            cropX=x0,
            cropY=y0,
            cropWidth=x1 - x0,
            cropHeight=y1 - y0,
            planWidth=plan_w,
            planHeight=plan_h,
            units="m" if units == "m" else "ft",
            confidence=max(0.0, min(1.0, conf)),
        )

    def parse_image_bytes(
        self,
        image_bytes: bytes,
        mime_type: str = "image/png",
        room_corners: Optional[RoomCorners] = None,
        cropped: bool = False,
        on_review: Optional[Callable[[], None]] = None,
    ) -> FloorPlan:
        """Call Gemini to parse the floor plan image, calibrated to room footprint."""
        # 1. Analyze input image dimensions with PIL if available
        img_w, img_h = 2048, 1536
        if HAS_PIL and Image:
            try:
                pil_img = Image.open(io.BytesIO(image_bytes))
                img_w, img_h = pil_img.size
                img_format = pil_img.format or "PNG"
                logger.info("Loaded floor plan image: %dx%d (%s, %d bytes)", img_w, img_h, img_format, len(image_bytes))
            except Exception as e:
                logger.warning("Could not inspect image with PIL: %s", e)
                img_w, img_h = 2048, 1536

        # Normalize MIME type
        if "png" in mime_type.lower():
            media_type = "image/png"
        elif "jpeg" in mime_type.lower() or "jpg" in mime_type.lower():
            media_type = "image/jpeg"
        elif "webp" in mime_type.lower():
            media_type = "image/webp"
        else:
            media_type = "image/png"

        # 2. Formulate calibrated system instruction
        active_instruction = SYSTEM_INSTRUCTION
        if cropped and not room_corners:
            active_instruction += CROPPED_INSTRUCTION
        if room_corners:
            box = [
                round(room_corners.cropY / img_h * 1000), round(room_corners.cropX / img_w * 1000),
                round((room_corners.cropY + room_corners.cropHeight) / img_h * 1000),
                round((room_corners.cropX + room_corners.cropWidth) / img_w * 1000),
            ]
            active_instruction += CORNERS_INSTRUCTION.format(
                box=box, w=room_corners.planWidth, h=room_corners.planHeight, units=room_corners.units,
            )

        # 3. Invoke Gemini
        logger.info("Calling Gemini with model: %s...", self.settings.GEMINI_PARSER_MODEL)
        try:
            raw_text = self._generate_json(active_instruction, image_bytes, media_type, timeout_s=120)
        except Exception as e:
            logger.error("Gemini API call failed: %s", e)
            raise RuntimeError(f"Gemini API error: {e}")

        if not raw_text:
            raise RuntimeError("No structured output received from Gemini model.")

        # 4. Parse JSON from output text, then let Gemini check its own parse against the image
        parsed_json = self._extract_json(raw_text)
        _assign_ids(parsed_json)
        if self.settings.PLAN_REVIEW_ROUNDS > 0:
            if on_review:
                on_review()
            parsed_json["_review"] = self.review_parse(parsed_json, image_bytes, media_type, room_corners=room_corners)

        # 5. Image coordinates -> plan units, then normalize and validate geometry
        plan_json = self.to_plan_units(parsed_json, img_w, img_h, room_corners=room_corners)
        floor_plan = self.normalize_floor_plan(plan_json, img_w, img_h, room_corners=room_corners)
        return floor_plan

    def review_parse(
        self,
        data: Dict[str, Any],
        image_bytes: bytes,
        media_type: str,
        room_corners: Optional[RoomCorners] = None,
    ) -> Dict[str, Any]:
        """Validation & adjustment phase: Gemini compares the drawn parse with the plan and edits it in place.

        Runs up to PLAN_REVIEW_ROUNDS rounds, stopping when the reviewer has nothing left to fix. A failed
        round keeps the parse as it was: the review can only improve a plan, never fail the job.
        """
        report: Dict[str, Any] = {"rounds": 0, "edits": {}, "summaries": []}
        for round_no in range(1, self.settings.PLAN_REVIEW_ROUNDS + 1):
            current = {k: data.get(k) for k in ("units", "width", "height", "footprint_box_2d", *ITEM_KEYS)}
            if room_corners:
                current.pop("footprint_box_2d", None)  # the corner pass owns the footprint and scale
            try:
                overlay = render_overlay(image_bytes, data)
                raw = self._generate_json(
                    REVIEW_INSTRUCTION + json.dumps(current, separators=(",", ":")),
                    image_bytes, media_type, timeout_s=120, extra_images=[(overlay, "image/png")],
                )
                answer = self._extract_json(raw)
            except Exception as e:
                logger.warning("Plan review round %d failed, keeping the parse as is: %s", round_no, e)
                break
            edits = answer.get("edits") or []
            if room_corners:
                edits = [e for e in edits if not (isinstance(e, dict) and e.get("op") == "set_footprint")]
            counts = _apply_edits(data, edits)
            report["rounds"] = round_no
            for k, v in counts.items():
                report["edits"][k] = report["edits"].get(k, 0) + v
            report["summaries"].append(str(answer.get("summary") or "")[:300])
            logger.info("Plan review round %d: %s (%s)", round_no, counts, answer.get("summary"))
            if answer.get("done") or not any(counts[k] for k in ("update", "delete", "add", "set_footprint")):
                break
        return report

    def to_plan_units(
        self,
        data: Dict[str, Any],
        img_w: int,
        img_h: int,
        room_corners: Optional[RoomCorners] = None,
    ) -> Dict[str, Any]:
        """Map the model's normalized 0-1000 image geometry onto the plan's real-world frame.

        The plan frame is the footprint crop: (0, 0) is its top-left, (width, height) its bottom-right, which is
        how the editor overlays the plan on `sourceImage`. Boxes are clipped to the plan, near-axis walls are
        snapped straight and duplicate boxes are dropped.
        """
        units = "m" if data.get("units") == "m" else "ft"
        if room_corners and room_corners.cropWidth > 0 and room_corners.cropHeight > 0:
            cx, cy, cw, ch = room_corners.cropX, room_corners.cropY, room_corners.cropWidth, room_corners.cropHeight
            width, height, units = float(room_corners.planWidth), float(room_corners.planHeight), room_corners.units
            sx, sy = width / cw, height / ch
        else:
            fb = _box_px(data.get("footprint_box_2d"), img_w, img_h)
            if not fb or (fb[2] - fb[0]) * (fb[3] - fb[1]) < 0.2 * img_w * img_h:
                fb = (0.0, 0.0, float(img_w), float(img_h))
            cx, cy, cw, ch = fb[0], fb[1], fb[2] - fb[0], fb[3] - fb[1]
            sw, sh = _pos(data.get("width")), _pos(data.get("height"))
            # One isotropic scale: an uneven x/y scale would squash every object
            scales = [v for v in (sw / cw if sw else None, sh / ch if sh else None) if v]
            s = sum(scales) / len(scales) if scales else 40.0 / cw
            sx = sy = s
            width, height = cw * s, ch * s

        # Plans can carry wrong or contradictory dimension strings: trust standard objects when they disagree
        scale_note: Dict[str, Any] = {"source": "stated"}
        ref = _reference_scale(data, img_w, img_h)
        if ref:
            ref = ref * (0.3048 if units == "m" else 1.0)
            stated = (sx + sy) / 2
            if not 0.67 <= stated / ref <= 1.5:
                logger.warning("Stated plan size is off by x%.2f against standard objects; using their scale", stated / ref)
                scale_note = {"source": "reference_objects", "statedWidth": round(width, 2), "statedHeight": round(height, 2)}
                sx = sy = ref
                width, height = cw * ref, ch * ref

        def pt(ny: Any, nx: Any) -> Tuple[float, float]:
            return ((float(nx) / 1000 * img_w - cx) * sx, (float(ny) / 1000 * img_h - cy) * sy)

        walls = []
        max_t = 2.0 if units == "ft" else 0.6
        for w in data.get("walls") or []:
            line = w.get("line")
            if not (isinstance(line, list) and len(line) == 4):
                continue
            try:
                x1, y1 = pt(line[0], line[1])
                x2, y2 = pt(line[2], line[3])
            except (TypeError, ValueError):
                continue
            if abs(y2 - y1) <= abs(x2 - x1) * 0.05:
                y1 = y2 = (y1 + y2) / 2
            elif abs(x2 - x1) <= abs(y2 - y1) * 0.05:
                x1 = x2 = (x1 + x2) / 2
            if math.hypot(x2 - x1, y2 - y1) < 0.05:
                continue
            t = _pos(w.get("thickness"))
            thick = t / 1000 * img_w * sx if t else (0.5 if units == "ft" else 0.15)
            walls.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "thickness": min(max(thick, max_t / 20), max_t),
                "exterior": bool(w.get("exterior")), "confidence": w.get("confidence", 0.9),
            })

        def boxes(items: Any, kind_key: str) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            for o in items or []:
                b = o.get("box_2d")
                if not (isinstance(b, list) and len(b) == 4):
                    continue
                try:
                    x0, y0 = pt(min(b[0], b[2]), min(b[1], b[3]))
                    x1, y1 = pt(max(b[0], b[2]), max(b[1], b[3]))
                    angle = float(o.get("angle") or 0) % 360
                except (TypeError, ValueError):
                    continue
                # Clip to the plan; drop boxes that are mostly outside it
                area = (x1 - x0) * (y1 - y0)
                cx0, cy0, cx1, cy1 = max(x0, 0.0), max(y0, 0.0), min(x1, width), min(y1, height)
                if area <= 0 or cx1 <= cx0 or cy1 <= cy0 or (cx1 - cx0) * (cy1 - cy0) < 0.5 * area:
                    continue
                bw, bh = cx1 - cx0, cy1 - cy0
                off = angle % 90
                if min(off, 90 - off) < 10:
                    rot, w_, h_ = 0.0, bw, bh  # parallel to the walls: the box is the footprint
                else:
                    # Diagonal: shrink the axis-aligned bounds back to the object's own size (exact for squares)
                    r = math.radians(angle)
                    k = abs(math.cos(r)) + abs(math.sin(r))
                    rot, w_, h_ = angle, bw / k, bh / k
                mx, my = (cx0 + cx1) / 2, (cy0 + cy1) / 2
                out.append({
                    **{k_: v for k_, v in o.items() if k_ not in ("box_2d", "angle", "id")},
                    "x": mx - w_ / 2, "y": my - h_ / 2, "width": w_, "height": h_, "rotation": rot,
                })
            return _dedupe(out, kind_key)

        rooms = []
        for r in data.get("rooms") or []:
            poly = []
            for p in r.get("polygon") or []:
                if isinstance(p, list) and len(p) == 2:
                    try:
                        x, y = pt(p[0], p[1])
                    except (TypeError, ValueError):
                        continue
                    poly.append({"x": min(max(x, 0.0), width), "y": min(max(y, 0.0), height)})
            if len(poly) >= 3:
                rooms.append({**{k: v for k, v in r.items() if k != "id"}, "polygon": poly})

        # Furniture and fixtures share the floor: nothing on the same spot or on top of another object
        objects = [{**o, "_kind": "furniture"} for o in boxes(data.get("furniture"), "furnitureType")]
        objects += [{**o, "_kind": "fixtures"} for o in boxes(data.get("fixtures"), "fixtureType")]
        objects = _resolve_overlaps(objects)
        placed = {kind: [{k: v for k, v in o.items() if k != "_kind"} for o in objects if o["_kind"] == kind]
                  for kind in ("furniture", "fixtures")}

        return {
            "units": units,
            "width": width,
            "height": height,
            "scaleConfidence": data.get("scaleConfidence", 0.9) if scale_note["source"] == "stated" else 0.5,
            "sourceImage": {"width": img_w, "height": img_h, "cropX": cx, "cropY": cy, "cropWidth": cw, "cropHeight": ch},
            "rooms": rooms,
            "walls": walls,
            "furniture": placed["furniture"],
            "fixtures": placed["fixtures"],
            "_review": data.get("_review"),
            "_scale": scale_note,
        }

    def normalize_floor_plan(
        self,
        data: Dict[str, Any],
        img_w: int,
        img_h: int,
        room_corners: Optional[RoomCorners] = None,
    ) -> FloorPlan:
        """Validate and normalize floor plan geometry according to docs/plan-parser.md rules."""
        fp_id = data.get("id") or "fp_001"
        units = data.get("units", "ft")
        if units not in ("ft", "m", "normalized"):
            units = "ft"

        # Plan bounds - use room_corners if available to enforce precise scale matching
        if room_corners and room_corners.planWidth > 0 and room_corners.planHeight > 0 and not data.get("width"):
            width = float(room_corners.planWidth)
            height = float(room_corners.planHeight)
            units = room_corners.units
        else:
            try:
                width = float(data.get("width") or 40.0)
                height = float(data.get("height") or 30.0)
            except Exception:
                width, height = 40.0, 30.0

        if width <= 0 or not math.isfinite(width):
            width = 40.0
        if height <= 0 or not math.isfinite(height):
            height = 30.0

        scale_conf = float(data.get("scaleConfidence") or 0.9)
        scale_conf = max(0.0, min(1.0, scale_conf))

        # Source image metadata & crop bounds
        src_meta = data.get("sourceImage") or {}
        crop_x = float(src_meta.get("cropX") if src_meta.get("cropX") is not None else (room_corners.cropX if room_corners else 0))
        crop_y = float(src_meta.get("cropY") if src_meta.get("cropY") is not None else (room_corners.cropY if room_corners else 0))
        crop_w = float(src_meta.get("cropWidth") if src_meta.get("cropWidth") is not None else (room_corners.cropWidth if room_corners else img_w))
        crop_h = float(src_meta.get("cropHeight") if src_meta.get("cropHeight") is not None else (room_corners.cropHeight if room_corners else img_h))

        corners_map = None
        if room_corners:
            corners_map = {
                "topLeft": room_corners.topLeft,
                "topRight": room_corners.topRight,
                "bottomRight": room_corners.bottomRight,
                "bottomLeft": room_corners.bottomLeft,
            }

        source_image = SourceImage(
            width=int(src_meta.get("width") or img_w),
            height=int(src_meta.get("height") or img_h),
            cropX=crop_x,
            cropY=crop_y,
            cropWidth=crop_w,
            cropHeight=crop_h,
            corners=corners_map,
        )

        # Normalize Walls
        walls: List[Wall] = []
        raw_walls = data.get("walls", [])
        for i, w in enumerate(raw_walls):
            try:
                w_id = str(w.get("id") or f"wall_{i+1:03d}")
                x1 = float(w.get("x1", 0))
                y1 = float(w.get("y1", 0))
                x2 = float(w.get("x2", 0))
                y2 = float(w.get("y2", 0))
                thick = float(w.get("thickness", 0.55))
                ext = bool(w.get("exterior", False))
                conf = max(0.0, min(1.0, float(w.get("confidence", 0.9))))

                # Basic sanity check
                if math.isfinite(x1) and math.isfinite(y1) and math.isfinite(x2) and math.isfinite(y2):
                    walls.append(Wall(
                        id=w_id,
                        type="wall",
                        x1=round(x1, 2),
                        y1=round(y1, 2),
                        x2=round(x2, 2),
                        y2=round(y2, 2),
                        thickness=round(thick, 2) if thick > 0 else 0.55,
                        exterior=ext,
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid wall: %s (%s)", w, e)

        # Normalize Doors
        # Doors and windows are omitted per requirement (not created)
        doors: List[Door] = []
        windows: List[Window] = []

        # Normalize Furniture
        valid_furn_types = {
            "bed", "sofa", "chair", "armchair", "table", "coffee_table",
            "dining_table", "desk", "nightstand", "wardrobe", "cabinet",
            "kitchen_island", "unknown",
        }
        furniture: List[Furniture] = []
        raw_furn = data.get("furniture", [])
        for i, f in enumerate(raw_furn):
            try:
                f_id = str(f.get("id") or f"fur_{i+1:03d}")
                f_type = f.get("furnitureType", "unknown").lower().replace(" ", "_")
                if f_type not in valid_furn_types:
                    f_type = "unknown"
                label = str(f.get("label") or f_type.replace("_", " ").title())
                x = float(f.get("x", 0))
                y = float(f.get("y", 0))
                w_val = float(f.get("width", 3.0))
                h_val = float(f.get("height", 3.0))
                rot = float(f.get("rotation", 0)) % 360
                conf = max(0.0, min(1.0, float(f.get("confidence", 0.9))))

                if math.isfinite(x) and math.isfinite(y) and w_val > 0 and h_val > 0:
                    furniture.append(Furniture(
                        id=f_id,
                        type="furniture",
                        furnitureType=f_type,
                        label=label,
                        x=round(x, 2),
                        y=round(y, 2),
                        width=round(w_val, 2),
                        height=round(h_val, 2),
                        rotation=round(rot, 1),
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid furniture: %s (%s)", f, e)

        # Normalize Fixtures
        valid_fix_types = {
            "sink", "toilet", "bathtub", "shower", "stove", "oven",
            "refrigerator", "washer", "dryer", "counter", "unknown",
        }
        fixtures: List[Fixture] = []
        raw_fix = data.get("fixtures", [])
        for i, fix in enumerate(raw_fix):
            try:
                fix_id = str(fix.get("id") or f"fix_{i+1:03d}")
                fix_type = fix.get("fixtureType", "unknown").lower().replace(" ", "_")
                if fix_type not in valid_fix_types:
                    fix_type = "unknown"
                label = str(fix.get("label") or fix_type.replace("_", " ").title())
                x = float(fix.get("x", 0))
                y = float(fix.get("y", 0))
                w_val = float(fix.get("width", 2.0))
                h_val = float(fix.get("height", 2.0))
                rot = float(fix.get("rotation", 0)) % 360
                conf = max(0.0, min(1.0, float(fix.get("confidence", 0.9))))

                if math.isfinite(x) and math.isfinite(y) and w_val > 0 and h_val > 0:
                    fixtures.append(Fixture(
                        id=fix_id,
                        type="fixture",
                        fixtureType=fix_type,
                        label=label,
                        x=round(x, 2),
                        y=round(y, 2),
                        width=round(w_val, 2),
                        height=round(h_val, 2),
                        rotation=round(rot, 1),
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid fixture: %s (%s)", fix, e)

        # Normalize Rooms
        rooms: List[Room] = []
        raw_rooms = data.get("rooms", [])
        for i, r in enumerate(raw_rooms):
            try:
                r_id = str(r.get("id") or f"rom_{i+1:03d}")
                name = str(r.get("name") or f"Room {i+1}")
                raw_poly = r.get("polygon", [])
                poly: List[Point2D] = []
                for pt in raw_poly:
                    if isinstance(pt, dict) and "x" in pt and "y" in pt:
                        poly.append(Point2D(x=round(float(pt["x"]), 2), y=round(float(pt["y"]), 2)))

                stated = None
                raw_stated = r.get("statedDimensions")
                if isinstance(raw_stated, dict):
                    stated = StatedDimensions(
                        width=float(raw_stated["width"]) if "width" in raw_stated and raw_stated["width"] is not None else None,
                        height=float(raw_stated["height"]) if "height" in raw_stated and raw_stated["height"] is not None else None,
                    )

                conf = max(0.0, min(1.0, float(r.get("confidence", 0.9))))
                rooms.append(Room(
                    id=r_id,
                    name=name,
                    polygon=poly,
                    statedDimensions=stated,
                    confidence=conf,
                ))
            except Exception as e:
                logger.warning("Skipping invalid room: %s (%s)", r, e)

        return FloorPlan(
            id=fp_id,
            units=units,
            width=round(width, 2),
            height=round(height, 2),
            sourceImage=source_image,
            scaleConfidence=scale_conf,
            rooms=rooms,
            walls=walls,
            doors=doors,
            windows=windows,
            furniture=furniture,
            fixtures=fixtures,
            metadata={"parsedBy": self.settings.GEMINI_PARSER_MODEL, "parserVersion": "2.1", "review": data.get("_review"), "scale": data.get("_scale")},
        )

    def execute_plan_parsing_job(self, task: ParsePlanTaskRequest) -> FloorPlan:
        """Full job workflow: fetch image -> analyze -> normalize -> save to Firestore."""
        db = get_firestore_client()
        job_ref = db.collection("jobs").document(task.jobId)
        project_ref = db.collection("projects").document(task.projectId)

        logger.info("Executing plan parsing job %s for project %s", task.jobId, task.projectId)

        # 1. Update job to running
        job_ref.set({
            "id": task.jobId,
            "type": "plan_parse",
            "projectId": task.projectId,
            "ownerUid": task.ownerUid,
            "status": "running",
            "stage": "downloading_image",
            "progress": 20,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)

        project_ref.update({
            "status": "processing",
            "currentJobId": task.jobId,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        image_bytes: Optional[bytes] = None

        # 2. Retrieve image bytes from signed URL or GCS
        try:
            if task.signedUrl:
                logger.info("Downloading plan image from signedUrl...")
                with httpx.Client(timeout=60.0) as client:
                    resp = client.get(task.signedUrl)
                    if resp.status_code == 200:
                        image_bytes = resp.content

            if not image_bytes and task.gcsPath:
                logger.info("Downloading plan image from GCS: %s", task.gcsPath)
                storage_client = get_storage_client()
                bucket = storage_client.bucket(self.settings.GCS_BUCKET_NAME)
                blob = bucket.blob(task.gcsPath)
                image_bytes = blob.download_as_bytes()

            if not image_bytes:
                # Look up project's planImage in Firestore
                proj_doc = project_ref.get()
                if proj_doc.exists:
                    p_data = proj_doc.to_dict() or {}
                    p_plan = p_data.get("planImage") or {}
                    storage_path = p_plan.get("storagePath")
                    if storage_path:
                        storage_client = get_storage_client()
                        bucket = storage_client.bucket(self.settings.GCS_BUCKET_NAME)
                        blob = bucket.blob(storage_path)
                        image_bytes = blob.download_as_bytes()

            if not image_bytes:
                raise ValueError("Could not find or download floor plan image for parsing.")

        except Exception as e:
            logger.error("Failed downloading image for job %s: %s", task.jobId, e)
            job_ref.update({
                "status": "failed",
                "error": f"Failed to retrieve floor plan image: {str(e)}",
                "stage": "failed",
                "progress": 100,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "status": "failed",
                "lastError": str(e),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            self._notify_failed(db, task, f"Could not download the plan image: {e}")
            raise

        # 3A. Pre-parsing Step: Detect exactly 4 angles/corners of the room & match scale
        logger.info("Pre-parsing step: Detecting 4 room corners and matching scale for job %s...", task.jobId)
        job_ref.update({
            "stage": "detecting_room_corners",
            "progress": 35,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        project_ref.update({
            "stage": "detecting_room_corners",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        room_corners: Optional[RoomCorners] = None
        try:
            if task.cropped:
                raise _SkipCorners()
            room_corners = self.detect_room_corners(image_bytes, mime_type=task.contentType or "image/png")
            corners_dict = room_corners.model_dump()
            logger.info("Successfully detected 4 room angles: %s", corners_dict)
            job_ref.update({
                "roomCorners": corners_dict,
                "progress": 50,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "roomCorners": corners_dict,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        except _SkipCorners:
            logger.info("Cropped upload for job %s: skipping corner detection", task.jobId)
        except Exception as e:
            logger.warning("Room corner detection encountered warning: %s. Continuing with default scale.", e)

        # 3B. Full vision parsing calibrated to room footprint
        job_ref.update({
            "stage": "analyzing_with_ai",
            "progress": 65,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        try:
            floor_plan = self.parse_image_bytes(
                image_bytes,
                mime_type=task.contentType or "image/png",
                room_corners=room_corners,
                cropped=task.cropped,
                on_review=lambda: job_ref.update({
                    "stage": "reviewing_with_ai",
                    "progress": 80,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }),
            )
        except Exception as e:
            logger.error("Error during Gemini analysis for job %s: %s", task.jobId, e)
            job_ref.update({
                "status": "failed",
                "error": f"AI Parsing failed: {str(e)}",
                "stage": "failed",
                "progress": 100,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "status": "failed",
                "lastError": str(e),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            self._notify_failed(db, task, str(e))
            raise

        # 4. Save results to Firestore
        job_ref.update({
            "stage": "saving_results",
            "progress": 90,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        plan_dict = floor_plan.model_dump()

        if self._superseded(project_ref, task):
            job_ref.update({"status": "failed", "stage": "failed", "error": "Superseded by a newer parse",
                            "progress": 100, "updatedAt": firestore.SERVER_TIMESTAMP})
            logger.info("Job %s superseded; not saving its plan", task.jobId)
            return floor_plan

        # Update Project in Firestore
        project_ref.update({
            "status": "completed",
            "hasPlanParsed": True,
            "floorPlan": plan_dict,
            "floorPlanVersion": firestore.Increment(1),
            "mapping": {},
            "missing": [],
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        # Save to subcollection projects/{projectId}/floorPlans/{planId}
        project_ref.collection("floorPlans").document(floor_plan.id).set({
            **plan_dict,
            "jobId": task.jobId,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })

        # Update Job in Firestore to completed
        job_ref.update({
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "result": plan_dict,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        self._notify_ready(db, task, floor_plan)
        logger.info("Successfully completed plan parsing job %s for project %s", task.jobId, task.projectId)
        return floor_plan

    @staticmethod
    def _post(db, conversation_id: str, kind: str, payload: Dict[str, Any], stage: str, preview: str) -> None:
        """Append a predefined system message and move the chat to `stage` (the browser listens live)."""
        conv_ref = db.collection("conversations").document(conversation_id)
        conv_ref.collection("messages").document().set({
            "role": "system",
            "kind": kind,
            "text": "",
            "payload": payload,
            "status": "done",
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        conv_ref.update({
            "stage": stage,
            "busy": False,
            "busyReason": None,
            "lastMessageAt": firestore.SERVER_TIMESTAMP,
            "lastMessagePreview": preview,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

    def _notify_ready(self, db, task: ParsePlanTaskRequest, plan: FloorPlan) -> None:
        if not task.conversationId:
            return
        stats = {"rooms": len(plan.rooms), "walls": len(plan.walls), "items": len(plan.furniture) + len(plan.fixtures)}
        try:
            self._post(db, task.conversationId, "plan_ready", {"stats": stats, "jobId": task.jobId}, "reviewing_plan", "Your plan is ready")
        except Exception as e:
            logger.error("Could not notify conversation %s: %s", task.conversationId, e)

    @staticmethod
    def _superseded(project_ref, task: ParsePlanTaskRequest) -> bool:
        """True when the project has since started another parse (re-crop / retry)."""
        snap = project_ref.get()
        current = (snap.to_dict() or {}).get("currentJobId") if snap.exists else None
        return bool(current and current != task.jobId)

    def _notify_failed(self, db, task: ParsePlanTaskRequest, error: str) -> None:
        if not task.conversationId:
            return
        if self._superseded(db.collection("projects").document(task.projectId), task):
            return
        try:
            self._post(db, task.conversationId, "plan_failed", {"error": error[:500], "jobId": task.jobId}, "cropping",
                       "We couldn't read the plan")
        except Exception as e:
            logger.error("Could not notify conversation %s: %s", task.conversationId, e)

    @staticmethod
    def _extract_json(text: str) -> Dict[str, Any]:
        """Strip markdown fences and parse JSON object from string."""
        cleaned = text.strip()
        # Remove ```json and ``` if present
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        # Search for first { and last } if extra text exists
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]

        return json.loads(cleaned)

    def isolate_furniture_transparent_background(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        furniture_name: str = "furniture",
    ) -> Dict[str, Any]:
        """
        Calls the OpenAI Images edit endpoint with prompt '{uploaded_furniture} transparent background'
        (1024x1024, transparent PNG). Returns data URI with a transparent background PNG.
        """
        clean_name = (furniture_name or "furniture").strip()
        prompt = f"{clean_name} transparent background"
        model = self.settings.OPENAI_IMAGE_MODEL

        media_type = mime_type if mime_type in ("image/png", "image/jpeg", "image/webp") else "image/jpeg"
        ext = media_type.split("/")[1]

        # The output is a 1024x1024 square: shrink and pad the photo to a centered square first so a wide
        # object is not cropped (also keeps the upload small).
        if HAS_PIL:
            try:
                src = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
                src.thumbnail((1024, 1024))
                side = max(src.size)
                square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
                square.paste(src, ((side - src.width) // 2, (side - src.height) // 2))
                buf = io.BytesIO()
                square.save(buf, format="PNG")
                image_bytes, media_type, ext = buf.getvalue(), "image/png", "png"
            except Exception as e:
                logger.warning("Could not pad the photo to a square, sending it as is: %s", e)

        logger.info("Calling OpenAI Images edit (%s) to generate transparent background for: '%s'", model, prompt)
        try:
            resp = httpx.post(
                "https://api.openai.com/v1/images/edits",
                headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                data={
                    "model": model,
                    "prompt": prompt,
                    "size": "1024x1024",
                    "background": "transparent",
                    "output_format": "png",
                },
                files={"image": (f"furniture.{ext}", image_bytes, media_type)},
                timeout=120,
            )
        except httpx.HTTPError as e:
            logger.error("Failed to call OpenAI API: %s", e)
            raise RuntimeError(f"Failed to communicate with OpenAI API: {str(e)}")
        if resp.status_code != 200:
            logger.error("OpenAI API HTTPError %d: %s", resp.status_code, resp.text)
            raise RuntimeError(f"OpenAI API error ({resp.status_code}): {resp.text}")

        data = resp.json().get("data") or []
        result_b64 = data[0].get("b64_json") if data else None
        if not result_b64:
            logger.error("OpenAI images edit response did not contain an image: %s", resp.text[:500])
            raise RuntimeError("No image returned from OpenAI model for transparent background.")

        # Post-process with alpha channel if PIL is available
        if HAS_PIL and result_b64:
            try:
                raw_bytes = base64.b64decode(result_b64)
                im = Image.open(io.BytesIO(raw_bytes))
                im_trans = self._make_alpha_transparent(im)
                buf = io.BytesIO()
                im_trans.save(buf, format="PNG")
                result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Alpha transparency post-processing failed, using raw output: %s", e)

        return {
            "status": "success",
            "furnitureName": clean_name,
            "prompt": prompt,
            "model": model,
            "mimeType": "image/png",
            "dataUri": f"data:image/png;base64,{result_b64}",
            "result": result_b64,
        }

    def _make_alpha_transparent(self, im: Any) -> Any:
        """Converts checkerboard or outer light background into clean RGBA alpha transparency."""
        if not HAS_PIL:
            return im
        im = im.convert("RGBA")
        w, h = im.size
        pixels = im.load()

        alpha_extrema = im.split()[-1].getextrema()
        if alpha_extrema[0] < 128:
            return im

        corner_colors = [pixels[0, 0][:3], pixels[w - 1, 0][:3], pixels[0, h - 1][:3], pixels[w - 1, h - 1][:3]]
        avg_corner = sum(sum(c) / 3 for c in corner_colors) / 4
        if avg_corner < 180:
            return im

        def is_bg(r: int, g: int, b: int) -> bool:
            diff = max(abs(r - g), abs(g - b), abs(r - b))
            if diff <= 8:
                if (234 <= r <= 248) or (249 <= r <= 255):
                    return True
            return False

        import collections
        visited = set()
        queue = collections.deque()
        for x in range(w):
            if is_bg(*pixels[x, 0][:3]):
                queue.append((x, 0))
            if is_bg(*pixels[x, h - 1][:3]):
                queue.append((x, h - 1))
        for y in range(h):
            if is_bg(*pixels[0, y][:3]):
                queue.append((0, y))
            if is_bg(*pixels[w - 1, y][:3]):
                queue.append((w - 1, y))

        while queue:
            x, y = queue.popleft()
            if (x, y) in visited:
                continue
            visited.add((x, y))

            r, g, b, a = pixels[x, y]
            if is_bg(r, g, b):
                pixels[x, y] = (0, 0, 0, 0)
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                        queue.append((nx, ny))

        return im
