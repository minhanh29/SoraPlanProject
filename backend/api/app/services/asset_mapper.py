"""FloorPlan furniture/fixtures → catalog assets for a style (docs/10-chat-refactor-plan.md §5.4).

Pure and deterministic except for the optional `classify` callback (Gemini) used for labels the
table cannot place. Output is stored on projects/{id}.mapping and .missing.
"""
import logging
import math
import re
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .geometry import nearest_wall_direction, front_vector, plan_scale, point_in_polygon

logger = logging.getLogger("api.asset_mapper")

# Height (m) used when an asset's own proportions are unknown, and for sizing added items.
CATEGORY_HEIGHT_M: Dict[str, float] = {
    "Sofa": 0.85,
    "Armchair": 0.85,
    "Coffee Table": 0.45,
    "TV Stand": 0.55,
    "Dining Table": 0.75,
    "Dining Chair": 0.9,
    "Dining Bench": 0.45,
    "Stool": 0.65,
    "Bed": 0.5,
    "Nightstand": 0.55,
    "Wardrobe & Storage": 2.0,
    "Kitchen Counter": 0.9,
    "Kitchen Sink": 0.9,
    "Kitchen Appliance": 1.8,
    "Appliance": 0.85,
    "Bathtub": 0.55,
    "Toilet": 0.75,
    "Bathroom Vanity": 0.85,
    "Sink": 0.85,
    "Lighting": 1.6,
    "Other": 0.8,
}
CATALOG_CATEGORIES: List[str] = list(CATEGORY_HEIGHT_M.keys())

BATHROOM_WORDS = re.compile(r"\b(bath|bathroom|wc|toilet|powder|ensuite|en-suite|shower|restroom|lavatory)\b", re.I)
KITCHEN_WORDS = re.compile(r"\b(kitchen|kitchenette|pantry|galley|cook)", re.I)
LIVING_WORDS = re.compile(r"\b(living|lounge|family|sitting|den)\b", re.I)

# Cheap keyword pass for labels before asking Gemini (first match wins).
LABEL_KEYWORDS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\b(tv|television|media)\b", re.I), "TV Stand"),
    (re.compile(r"\b(sofa|couch|sectional|loveseat)\b", re.I), "Sofa"),
    (re.compile(r"\b(armchair|lounge chair|accent chair|recliner)\b", re.I), "Armchair"),
    (re.compile(r"\bcoffee table\b", re.I), "Coffee Table"),
    (re.compile(r"\b(dining table|kitchen table)\b", re.I), "Dining Table"),
    (re.compile(r"\bbench\b", re.I), "Dining Bench"),
    (re.compile(r"\bstool\b", re.I), "Stool"),
    (re.compile(r"\b(night ?stand|bedside)\b", re.I), "Nightstand"),
    (re.compile(r"\bbed\b", re.I), "Bed"),
    (re.compile(r"\b(wardrobe|closet|dresser|cupboard|armoire|storage|cabinet|shelf|shelves)\b", re.I), "Wardrobe & Storage"),
    (re.compile(r"\b(fridge|refrigerator|freezer)\b", re.I), "Kitchen Appliance"),
    (re.compile(r"\b(washer|dryer|washing|laundry)\b", re.I), "Appliance"),
    (re.compile(r"\b(bathtub|tub)\b", re.I), "Bathtub"),
    (re.compile(r"\b(toilet|wc)\b", re.I), "Toilet"),
    (re.compile(r"\bvanity\b", re.I), "Bathroom Vanity"),
    (re.compile(r"\b(counter|island|worktop)\b", re.I), "Kitchen Counter"),
    (re.compile(r"\b(lamp|light)\b", re.I), "Lighting"),
]

ClassifyFn = Callable[[List[Dict[str, str]], List[str]], Dict[str, Optional[str]]]


def plan_boxes(plan: dict) -> List[dict]:
    """All furniture + fixtures of a plan with their kind ("furniture" | "fixture")."""
    out = []
    for kind, key in (("furniture", "furniture"), ("fixture", "fixtures")):
        for b in plan.get(key) or []:
            if b.get("id") and float(b.get("width") or 0) > 0 and float(b.get("height") or 0) > 0:
                out.append({**b, "type": kind})
    return out


def room_of(plan: dict, x: float, y: float) -> Optional[dict]:
    for r in plan.get("rooms") or []:
        poly = [(float(p["x"]), float(p["y"])) for p in r.get("polygon") or []]
        if len(poly) >= 3 and point_in_polygon((x, y), poly):
            return r
    return None


def box_center(b: dict) -> Tuple[float, float]:
    return float(b["x"]) + float(b["width"]) / 2, float(b["y"]) + float(b["height"]) / 2


def candidate_categories(box: dict, room_name: str, style: str) -> Optional[List[str]]:
    """Ordered catalog categories for a plan box; [] = known but unmappable; None = needs classification."""
    if box.get("category"):
        return [box["category"]]
    label = (box.get("label") or "").lower()
    in_bath = bool(BATHROOM_WORDS.search(room_name) or BATHROOM_WORDS.search(label))
    in_kitchen = bool(KITCHEN_WORDS.search(room_name) or KITCHEN_WORDS.search(label))
    in_living = bool(LIVING_WORDS.search(room_name))

    if box["type"] == "furniture":
        t = (box.get("furnitureType") or "unknown").lower()
        if t == "bed":
            return ["Bed"]
        if t == "sofa":
            return ["Sofa"]
        if t == "armchair":
            return ["Armchair"]
        if t == "chair":
            if "stool" in label and style == "Industrial":
                return ["Stool"]
            return ["Dining Chair"]
        if t == "coffee_table":
            return ["Coffee Table"]
        if t == "dining_table":
            return ["Dining Table"]
        if t == "table":
            return ["Coffee Table"] if in_living and not in_kitchen else ["Dining Table"]
        if t == "nightstand":
            return ["Nightstand"]
        if t in ("wardrobe", "cabinet"):
            return ["TV Stand"] if re.search(r"\btv\b", label) else ["Wardrobe & Storage"]
        if t == "kitchen_island":
            return ["Kitchen Counter"]
    else:
        t = (box.get("fixtureType") or "unknown").lower()
        if t == "sink":
            if in_bath and not in_kitchen:
                return ["Bathroom Vanity", "Sink"]
            return ["Kitchen Sink", "Sink"]
        if t == "toilet":
            return ["Toilet"]
        if t == "bathtub":
            return ["Bathtub"]
        if t == "refrigerator":
            return ["Kitchen Appliance"]
        if t in ("washer", "dryer"):
            return ["Appliance"]
        if t == "counter":
            return ["Kitchen Counter"]

    for pattern, category in LABEL_KEYWORDS:
        if pattern.search(label):
            if category == "Stool" and style != "Industrial":
                return ["Dining Chair"]
            return [category]
    return None  # desk, shower, stove, oven, unknown → Gemini


def _axis_angle(front_axis: str) -> float:
    """Yaw that turns +Z into the model's front axis."""
    return {"+z": 0.0, "+x": math.pi / 2, "-z": math.pi, "-x": -math.pi / 2}.get(front_axis or "+z", 0.0)


def fit_asset(
    box_w: float,
    box_d: float,
    base_rotation_y: float,
    center: Tuple[float, float],
    asset: Optional[dict],
    category: Optional[str],
    walls: Sequence[Tuple[Tuple[float, float], Tuple[float, float]]],
) -> Tuple[Dict[str, float], float]:
    """Uniform footprint fit of a model into a box (meters), and the extra yaw (multiple of 90°).

    The yaw keeps the model's long side along the box's long side and turns its back to the nearest wall.
    Returns (dims {w, d, h} in the raw model frame, rotation_offset radians).
    """
    native = (asset or {}).get("dims") or None
    cat_h = CATEGORY_HEIGHT_M.get(category or "", 0.8)
    if not native or min(native.get("w", 0), native.get("d", 0), native.get("h", 0)) <= 0:
        return {"w": round(box_w, 3), "d": round(box_d, 3), "h": cat_h}, 0.0

    nw, nd, nh = float(native["w"]), float(native["d"]), float(native["h"])
    box_long_x = box_w >= box_d
    model_long_x = nw >= nd
    near_square = max(nw, nd) / min(nw, nd) < 1.15 or max(box_w, box_d) / max(min(box_w, box_d), 1e-6) < 1.15
    if near_square:
        offsets = [0.0, math.pi / 2, math.pi, -math.pi / 2]
    elif box_long_x == model_long_x:
        offsets = [0.0, math.pi]
    else:
        offsets = [math.pi / 2, -math.pi / 2]

    front_axis = _axis_angle((asset or {}).get("frontAxis") or "+z")
    toward_wall = nearest_wall_direction(center, walls)
    best_offset = offsets[0]
    if toward_wall:
        (wx, wz), _ = toward_wall
        best_score = -2.0
        for off in offsets:
            fx, fz = front_vector(base_rotation_y + off + front_axis)
            score = -(fx * wx + fz * wz)  # facing away from the wall
            if score > best_score + 1e-6:
                best_score, best_offset = score, off

    quarter = abs(abs(best_offset) - math.pi / 2) < 1e-6
    if quarter:
        s = min(box_w / nd, box_d / nw)
    else:
        s = min(box_w / nw, box_d / nd)
    dims = {"w": round(nw * s, 3), "d": round(nd * s, 3), "h": round(nh * s, 3)}
    return dims, best_offset


def _aspect_distance(asset: dict, box_w: float, box_d: float) -> float:
    dims = asset.get("dims") or {}
    if not dims.get("w") or not dims.get("d") or box_d <= 0 or box_w <= 0:
        return 0.0
    a = max(dims["w"], dims["d"]) / min(dims["w"], dims["d"])
    b = max(box_w, box_d) / min(box_w, box_d)
    return abs(math.log(a / b))


def map_plan(
    plan: dict,
    style: str,
    assets: Sequence[dict],
    previous: Optional[Dict[str, dict]] = None,
    classify: Optional[ClassifyFn] = None,
    user_uid: Optional[str] = None,
) -> Tuple[Dict[str, dict], List[dict]]:
    """Map every furniture/fixture box to an asset. Returns (mapping, missing)."""
    previous = previous or {}
    k = plan_scale(plan)
    boxes = plan_boxes(plan)
    by_id = {a["id"]: a for a in assets}
    usable = [a for a in assets if a.get("status", "ready") == "ready"]
    walls = [
        ((float(w["x1"]) * k, float(w["y1"]) * k), (float(w["x2"]) * k, float(w["y2"]) * k))
        for w in plan.get("walls") or []
    ]

    # 1. Categories (table, keywords, then one batched Gemini call)
    categories: Dict[str, Optional[List[str]]] = {}
    rooms: Dict[str, str] = {}
    unknown: List[Dict[str, str]] = []
    for b in boxes:
        cx, cy = box_center(b)
        room = room_of(plan, cx, cy)
        room_name = (room or {}).get("name") or ""
        rooms[b["id"]] = room_name
        cats = candidate_categories(b, room_name, style)
        categories[b["id"]] = cats
        if cats is None:
            unknown.append({"id": b["id"], "label": b.get("label") or "", "type": b.get("furnitureType") or b.get("fixtureType") or "unknown", "room": room_name})
    if unknown and classify:
        try:
            guesses = classify(unknown, CATALOG_CATEGORIES)
        except Exception as e:  # classification is best effort; unmatched boxes become "missing"
            logger.warning("Label classification failed: %s", e)
            guesses = {}
        for u in unknown:
            g = guesses.get(u["id"])
            categories[u["id"]] = [g] if g in CATALOG_CATEGORIES and g != "Other" else []

    # 2. Master bed: the box in a "master" room, else the largest bed
    beds = [b for b in boxes if (categories.get(b["id"]) or [None])[0] == "Bed"]
    master_bed_id = None
    for b in beds:
        if "master" in rooms[b["id"]].lower() or "master" in (b.get("label") or "").lower():
            master_bed_id = b["id"]
            break
    if not master_bed_id and len(beds) > 1:
        master_bed_id = max(beds, key=lambda b: float(b["width"]) * float(b["height"]))["id"]

    mapping: Dict[str, dict] = {}
    missing: List[dict] = []
    for b in boxes:
        cid = b["id"]
        label = b.get("label") or (b.get("furnitureType") or b.get("fixtureType") or "Item").replace("_", " ").title()
        prev = previous.get(cid) or {}
        cats = categories.get(cid) or []
        box_w, box_d = float(b["width"]) * k, float(b["height"]) * k
        cx, cy = box_center(b)
        center = (cx * k, cy * k)
        base_rot = -math.radians(float(b.get("rotation") or 0))

        if prev.get("skipped"):
            mapping[cid] = {**prev, "label": label}
            continue

        asset = None
        category = cats[0] if cats else (prev.get("category") or None)
        # A user's own upload stays on its box across style changes
        prev_asset = by_id.get(prev.get("assetId") or "")
        if prev_asset and not prev_asset.get("isSystem") and prev_asset.get("ownerUid") == user_uid:
            asset = prev_asset
            category = prev.get("category") or prev_asset.get("category") or category
        else:
            for cat in cats:
                options = [a for a in usable if a.get("category") == cat and a.get("style") == style]
                if not options:
                    continue
                category = cat
                if cat == "Bed":
                    masters = [a for a in options if "master" in (a["id"] + a.get("name", "")).lower()]
                    others = [a for a in options if a not in masters]
                    options = (masters or options) if cid == master_bed_id else (others or options)
                asset = min(options, key=lambda a: (_aspect_distance(a, box_w, box_d), a["id"]))
                break

        if asset is None:
            mapping[cid] = {
                "assetId": None,
                "category": category,
                "label": label,
                "dims": None,
                "autoDims": None,
                "dimsSource": "auto",
                "rotationOffset": 0.0,
                "skipped": False,
            }
            missing.append({"componentId": cid, "label": label, "category": category})
            continue

        auto_dims, offset = fit_asset(box_w, box_d, base_rot, center, asset, category, walls)
        keep_user = prev.get("dimsSource") == "user" and prev.get("dims") and prev.get("category") == category
        mapping[cid] = {
            "assetId": asset["id"],
            "category": category,
            "label": label,
            "dims": prev["dims"] if keep_user else auto_dims,
            "autoDims": auto_dims,
            "dimsSource": "user" if keep_user else "auto",
            "rotationOffset": offset,
            "skipped": False,
        }
    return mapping, missing


def refit_entry(plan: dict, component_id: str, entry: dict, asset: Optional[dict]) -> dict:
    """Recompute autoDims/rotation for one entry (after its asset changed or became ready)."""
    k = plan_scale(plan)
    box = next((b for b in plan_boxes(plan) if b["id"] == component_id), None)
    if not box:
        return entry
    walls = [
        ((float(w["x1"]) * k, float(w["y1"]) * k), (float(w["x2"]) * k, float(w["y2"]) * k))
        for w in plan.get("walls") or []
    ]
    cx, cy = box_center(box)
    dims, offset = fit_asset(
        float(box["width"]) * k,
        float(box["height"]) * k,
        -math.radians(float(box.get("rotation") or 0)),
        (cx * k, cy * k),
        asset,
        entry.get("category"),
        walls,
    )
    out = {**entry, "autoDims": dims, "rotationOffset": offset}
    if entry.get("dimsSource") != "user" or not entry.get("dims"):
        out["dims"] = dims
        out["dimsSource"] = "auto"
    return out


def unresolved(mapping: Dict[str, dict]) -> List[dict]:
    """Boxes still waiting for an asset (not skipped)."""
    return [
        {"componentId": cid, "label": e.get("label") or cid, "category": e.get("category")}
        for cid, e in mapping.items()
        if not e.get("assetId") and not e.get("skipped")
    ]
