"""Switch a finished home's collection without rebuilding its edited layout."""
import math
import re
from typing import List, Optional, Tuple

from .asset_mapper import is_l_kitchen
from .common import load_styles


def style_category(category: Optional[str]) -> Optional[str]:
    # The bundled Japandi double vanity is tagged "Sink", while its Industrial
    # counterpart is "Bathroom Vanity". Kitchen sinks remain a separate family.
    return "Bathroom Vanity" if category == "Sink" else category


def style_ops(graph: dict, style: str, assets: List[dict]) -> Tuple[List[dict], int]:
    palette = load_styles()[style]["palette"]
    ops = [
        {"op": "scene.style", "style": style},
        {"op": "surface.material", "target": {"allWalls": True}, "material": {"tint": palette["wall"]}},
        {"op": "surface.material", "target": {"allFloors": True}, "material": {"tint": palette["floor"]}},
    ]
    by_id = {a["id"]: a for a in assets}
    catalog = [a for a in assets if a.get("isSystem") and a.get("style") == style and a.get("status") == "ready"]
    retained = 0

    def words(name: str):
        return set(re.findall(r"[a-z]+", name.lower())) - {"japandi", "industrial"}

    for level in (graph.get("levels") or [])[:1]:
        for item in level.get("items") or []:
            current = by_id.get(item.get("assetId"))
            if not item.get("assetId"):
                retained += 1
                continue
            # Keep personal uploads, missing/deleted asset references, and already-matching models.
            if item.get("assetId") and (not current or not current.get("isSystem") or current.get("style") == style):
                continue
            # Prefer the actual model's category over older scene metadata.
            category = style_category((current or {}).get("category") or item.get("category"))
            options = [a for a in catalog if style_category(a.get("category")) == category and is_l_kitchen(a) == bool(current and is_l_kitchen(current))]
            if not options:
                retained += 1
                continue
            name = words((current or {}).get("name") or item.get("label") or "")
            dims = item["dims"]

            def score(asset):
                native = asset.get("dims") or dims
                aspect = abs(math.log(max(native.get("w", 1), 0.001) / max(native.get("d", 1), 0.001)) -
                             math.log(max(dims["w"], 0.001) / max(dims["d"], 0.001)))
                tokens = words(asset.get("name") or "")
                return (int(("master" in tokens) != ("master" in name)), -len(tokens & name), aspect, asset["id"])

            chosen = min(options, key=score)
            # Explicit dimensions prevent item.replace from refitting a model and changing the user's size.
            ops.append({"op": "item.replace", "id": item["id"], "assetId": chosen["id"], "dims": dict(dims)})
    return ops, retained
