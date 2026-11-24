"""Description-aware placement of complete models over one or more parsed symbols."""
import logging
import math
import re
from typing import Callable, Dict, List, Optional, Sequence

from .asset_mapper import box_center, candidate_categories, is_l_kitchen, plan_boxes, refit_entry, room_of
from .geometry import distance_to_segment, plan_scale

logger = logging.getLogger("api.asset_matching")
MatchFn = Callable[[dict, List[dict]], List[dict]]


def release_group(mapping: Dict[str, dict], component_id: str) -> None:
    """Changing a composite restores its parts so they can be matched independently."""
    entry = mapping[component_id]
    for cid in entry.get("componentIds") or []:
        if cid in mapping and mapping[cid].get("includedIn") == component_id:
            mapping[cid] = {k: v for k, v in mapping[cid].items() if k != "includedIn"}
    mapping[component_id] = {k: v for k, v in entry.items() if k not in ("componentIds", "placementBox", "cornerOrientation")}


def _bounds(box: dict) -> tuple:
    cx, cy = box_center(box)
    r = math.radians(float(box.get("rotation") or 0))
    w, h = float(box["width"]), float(box["height"])
    hw = (abs(math.cos(r)) * w + abs(math.sin(r)) * h) / 2
    hh = (abs(math.sin(r)) * w + abs(math.cos(r)) * h) / 2
    return cx - hw, cy - hh, cx + hw, cy + hh


def _connected(boxes: List[dict], gap: float) -> bool:
    bounds = [_bounds(b) for b in boxes]
    seen = {0}
    while True:
        added = {j for j, b in enumerate(bounds) if j not in seen and any(
            math.hypot(max(a[0] - b[2], b[0] - a[2], 0), max(a[1] - b[3], b[1] - a[3], 0)) <= gap
            for i, a in enumerate(bounds) if i in seen)}
        if not added:
            return len(seen) == len(boxes)
        seen.update(added)


def _kitchen_corner(boxes: List[dict], tolerance: float) -> Optional[str]:
    """Identify the two occupied edge strips of an L; a third peninsula strip does not fit."""
    if len(boxes) < 2 or any(abs(float(b.get("rotation") or 0) % 90) > 1e-6 for b in boxes):
        return None
    bounds = [_bounds(b) for b in boxes]
    x0, y0 = min(b[0] for b in bounds), min(b[1] for b in bounds)
    x1, y1 = max(b[2] for b in bounds), max(b[3] for b in bounds)
    depth = max(min(b[2] - b[0], b[3] - b[1]) for b in bounds)
    if min(x1 - x0, y1 - y0) <= 2 * depth + tolerance:
        return None
    for corner in ("top-left", "top-right", "bottom-left", "bottom-right"):
        horizontal = [b[3] <= y0 + depth + tolerance if corner.startswith("top")
                      else b[1] >= y1 - depth - tolerance for b in bounds]
        vertical = [b[2] <= x0 + depth + tolerance if corner.endswith("left")
                    else b[0] >= x1 - depth - tolerance for b in bounds]
        if all(h or v for h, v in zip(horizontal, vertical)) and any(
            h and not v for h, v in zip(horizontal, vertical)) and any(
            v and not h for h, v in zip(horizontal, vertical)):
            return corner
    return None


def _wall_kitchens(plan: dict, boxes: Dict[str, dict], rooms: Dict[str, Optional[str]]) -> List[List[str]]:
    """Find the two wall runs, excluding a peninsula even when it touches the L's free end."""
    k = plan_scale(plan)
    gap = 0.4 / k
    walls = plan.get("walls") or []
    horizontal = [w for w in walls if abs(float(w["y2"]) - float(w["y1"])) < 0.02 / k]
    vertical = [w for w in walls if abs(float(w["x2"]) - float(w["x1"])) < 0.02 / k]

    def kind(box):
        value = str(box.get("fixtureType") or box.get("furnitureType") or "").lower()
        label = str(box.get("label") or "").lower()
        if value == "counter" or re.search(r"\b(counter|worktop)\b", label):
            return "counter"
        if value == "sink" or "kitchen sink" in label:
            return "sink"
        if value in ("stove", "oven") or re.search(r"\b(stove|cooktop|hob)\b", label):
            return "stove"
        if value == "refrigerator" or re.search(r"\b(ref|refrigerator|fridge)\b", label):
            return "fridge"
        return None

    kinds = {cid: kind(b) for cid, b in boxes.items()}

    def endpoints(wall):
        return [(float(wall["x1"]), float(wall["y1"])), (float(wall["x2"]), float(wall["y2"]))]

    def beside(box, wall):
        a, b = endpoints(wall)
        bounds = _bounds(box)
        half_depth = min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2
        return distance_to_segment(box_center(box), a, b) <= half_depth + float(wall.get("thickness") or 0) / 2 + 0.25 / k

    groups, used = [], set()
    for h in horizontal:
        for v in vertical:
            if min(math.dist(a, b) for a in endpoints(h) for b in endpoints(v)) > gap:
                continue
            nearby = [cid for cid, b in boxes.items() if kinds[cid] and cid not in used and (beside(b, h) or beside(b, v))]
            for room_id in dict.fromkeys(rooms[cid] for cid in nearby):
                pending = [cid for cid in nearby if rooms[cid] == room_id and cid not in used]
                while pending:
                    connected = [pending.pop(0)]
                    while True:
                        added = [cid for cid in pending if any(_connected([boxes[cid], boxes[other]], gap) for other in connected)]
                        if not added:
                            break
                        connected.extend(added)
                        pending = [cid for cid in pending if cid not in added]
                    types = [kinds[cid] for cid in connected]
                    if types.count("counter") < 2 or not {"sink", "stove", "fridge"}.issubset(types):
                        continue
                    if not _kitchen_corner([boxes[cid] for cid in connected], 0.15 / k):
                        continue
                    primary = next(cid for cid in connected if kinds[cid] == "counter")
                    ids = [primary] + [cid for cid in connected if cid != primary]
                    groups.append(ids)
                    used.update(ids)
    return groups


def _complete_l_kitchen(asset: dict) -> bool:
    if not is_l_kitchen(asset):
        return False
    description = asset.get("description") or ""
    for part in (r"sink", r"stove|cooktop|hob", r"ref|fridge|refrigerator"):
        if not re.search(rf"\b({part})\b", description, re.I):
            return False
        if re.search(rf"\b(no|without|excluding|separate|standalone)\s+(?:a\s+|an\s+)?({part})\b", description, re.I):
            return False
        if re.search(rf"\b({part})\b[^.;]{{0,40}}\b(separate|excluded|not included)\b", description, re.I):
            return False
    return True


def refine_mapping(
    plan: dict, style: str, assets: Sequence[dict], mapping: Dict[str, dict],
    match: Optional[MatchFn], user_uid: Optional[str] = None,
    required_component_id: Optional[str] = None,
) -> Dict[str, dict]:
    """Apply validated semantic matches; retain the deterministic mapping if the model fails.

    Composite children stay in the source plan and are marked includedIn, never deleted or user-skipped.
    Only the primary entry produces a model, fitted to the combined bounds of the parsed parts.
    """
    all_assets = {a["id"]: a for a in assets}
    selected_id = (mapping.get(required_component_id) or {}).get("assetId") if required_component_id else None
    candidates = [a for a in assets if (a.get("description") or "").strip()
                  and (not required_component_id or a["id"] == selected_id)
                  and (a.get("status", "ready") == "ready" or required_component_id)
                  and (a.get("isSystem") and (a.get("style") == style or required_component_id)
                       or user_uid and a.get("ownerUid") == user_uid)]
    boxes = {b["id"]: b for b in plan_boxes(plan)}
    rooms = {cid: (room_of(plan, *box_center(b)) or {}).get("id") for cid, b in boxes.items()}

    def protected(cid):
        entry = mapping.get(cid) or {}
        selected = all_assets.get(entry.get("assetId")) or {}
        private_selection = user_uid is not None and selected.get("ownerUid") == user_uid and not selected.get("isSystem")
        return entry.get("skipped") or entry.get("includedIn") or private_selection

    mandatory = _wall_kitchens(plan, boxes, rooms)
    mandatory = [ids for ids in mandatory if not any(protected(cid) for cid in ids)]
    if required_component_id:
        mandatory = [[required_component_id] + [cid for cid in ids if cid != required_component_id]
                     for ids in mandatory if required_component_id in ids]
    if not mandatory and (not candidates or not match):
        return mapping
    by_asset = {a["id"]: a for a in candidates}
    objects = []
    for cid, b in boxes.items():
        room = room_of(plan, *box_center(b)) or {}
        entry = mapping.get(cid) or {}
        objects.append({**b, "roomId": rooms[cid], "roomName": room.get("name", ""),
                        "categories": candidate_categories(b, room.get("name", ""), style) or [],
                        "currentAssetId": entry.get("assetId"), "skipped": bool(entry.get("skipped"))})
    context = {"units": plan.get("units"), "objects": objects, "rooms": plan.get("rooms") or [],
               "walls": plan.get("walls") or [], "requiredComponentId": required_component_id,
               "kitchenComposites": [{"componentIds": ids, "cornerOrientation": _kitchen_corner(
                   [boxes[cid] for cid in ids], 0.15 / plan_scale(plan))} for ids in mandatory]}
    catalog = [{k: a.get(k) for k in ("id", "name", "category", "description", "dims", "frontAxis")}
               for a in candidates]
    try:
        proposals = match(context, catalog) if match and candidates else []
    except Exception as e:
        logger.warning("Description-aware asset matching failed; applying deterministic mapping: %s", e)
        if not mandatory:
            return mapping
        proposals = []
    if not isinstance(proposals, list):
        if not mandatory:
            return mapping
        proposals = []

    # The corner rule takes priority over per-symbol suggestions, including when the model is unavailable.
    for ids in mandatory:
        compatible = [a for a in candidates if _complete_l_kitchen(a)]
        proposed = next((p.get("assetId") for p in proposals if isinstance(p, dict)
                         and isinstance(p.get("componentIds"), list) and len(p["componentIds"]) == len(ids)
                         and all(isinstance(cid, str) for cid in p["componentIds"]) and set(p["componentIds"]) == set(ids)
                         and isinstance(p.get("assetId"), str)
                         and p.get("assetId") in {a["id"] for a in compatible}), None)
        selected = next((a for a in compatible if a["id"] == proposed), None)
        if selected is None and compatible:
            selected = min(compatible, key=lambda a: a["id"])
        proposals = [p for p in proposals if not isinstance(p, dict) or not isinstance(p.get("componentIds"), list)
                     or not any(cid in ids for cid in p["componentIds"])]
        proposals = ([{"componentIds": ids, "assetId": selected["id"]}] if selected else [
            {"componentIds": [cid], "assetId": None} for cid in ids]) + proposals

    result = {cid: dict(entry) for cid, entry in mapping.items()}
    used = set()
    k = plan_scale(plan)
    for proposal in proposals:
        if not isinstance(proposal, dict) or "assetId" not in proposal:
            continue
        ids = proposal.get("componentIds")
        if not isinstance(ids, list) or not ids or not all(isinstance(cid, str) for cid in ids):
            continue
        if len(set(ids)) != len(ids) or any(cid not in boxes or cid not in result or cid in used for cid in ids):
            continue
        root = ids[0]
        if required_component_id and root != required_component_id:
            continue
        if result[root].get("componentIds"):
            continue
        if any(result[cid].get("skipped") or result[cid].get("includedIn") for cid in ids):
            continue
        aid = proposal.get("assetId")
        asset = by_asset.get(aid) if isinstance(aid, str) else None
        if aid is not None and asset is None:
            continue
        # A deliberate upload selection survives restyling, and cannot be swallowed by another group.
        pinned = [cid for cid in ids if (all_assets.get(result[cid].get("assetId")) or {}).get("ownerUid") == user_uid
                  and user_uid is not None and not (all_assets.get(result[cid].get("assetId")) or {}).get("isSystem")]
        if pinned and (pinned != [root] or result[root].get("assetId") != aid):
            continue
        if asset is None:
            if len(ids) != 1 or required_component_id:
                continue
            release_group(result, root)
            result[root].update({"assetId": None, "dims": None, "autoDims": None, "dimsSource": "auto"})
            used.add(root)
            continue
        cats = candidate_categories(boxes[root], (room_of(plan, *box_center(boxes[root])) or {}).get("name", ""), style)
        # A classifier can supply a category for objects not covered by the keyword table.
        cats = cats or ([result[root]["category"]] if result[root].get("category") else [])
        if cats and asset.get("category") not in cats:
            continue
        members = [boxes[cid] for cid in ids]
        corner = _kitchen_corner(members, 0.15 / k) if is_l_kitchen(asset) else None
        if is_l_kitchen(asset) and corner is None:
            continue  # A straight counter or a three-sided kitchen cannot be replaced by one L-shaped asset.
        if len(ids) > 1:
            if len({rooms[cid] for cid in ids}) > 1 or not _connected(members, 0.4 / k):
                continue
            if any(result[cid].get("componentIds") for cid in ids):
                continue
        entry = dict(result[root])
        if len(ids) > 1:
            bounds = [_bounds(b) for b in members]
            x0, y0 = min(b[0] for b in bounds), min(b[1] for b in bounds)
            x1, y1 = max(b[2] for b in bounds), max(b[3] for b in bounds)
            entry.update({"componentIds": ids, "placementBox": {"x": x0, "y": y0, "width": x1 - x0,
                                                                  "height": y1 - y0, "rotation": 0.0},
                          "label": asset.get("name") or entry.get("label")})
            if corner:
                entry["cornerOrientation"] = corner
        entry.update({"assetId": asset["id"], "category": asset["category"], "skipped": False})
        result[root] = refit_entry(plan, root, entry, asset, result)
        for cid in ids[1:]:
            result[cid] = {**result[cid], "assetId": None, "dims": None, "autoDims": None,
                           "dimsSource": "auto", "includedIn": root}
        used.update(ids)
    return result
