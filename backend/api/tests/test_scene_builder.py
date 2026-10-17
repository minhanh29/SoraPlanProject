import json
import math
import os

import pytest

from app.services.asset_mapper import map_plan
from app.services.scene_builder import build_scene, room_type

from .helpers import FIXTURES, catalog_assets, load_plan

GOLDEN = os.path.join(FIXTURES, "floorplan_1.scene.json")


def _scene(style="Japandi"):
    plan = load_plan()
    mapping, _ = map_plan(plan, style, catalog_assets())
    return build_scene("proj_1", plan, style, mapping)


def test_golden_scene_graph():
    graph = _scene()
    if os.environ.get("UPDATE_GOLDEN") or not os.path.exists(GOLDEN):
        with open(GOLDEN, "w") as f:
            json.dump(graph, f, indent=1, sort_keys=True)
    with open(GOLDEN) as f:
        assert graph == json.load(f)


def test_units_and_axes():
    graph = _scene()
    level = graph["levels"][0]
    k = 0.3048
    wall = next(w for w in level["walls"] if w["id"] == "wall_003")
    assert wall["start"] == [pytest.approx(40 * k), 0.0]
    assert wall["end"] == [pytest.approx(40 * k), pytest.approx(30 * k)]
    assert wall["height"] == 2.7
    assert 0.08 <= wall["thickness"] <= 0.3
    bed = next(i for i in level["items"] if i["componentId"] == "fur_001")
    assert bed["position"][0] == pytest.approx((28 + 3.25) * k, abs=1e-3)
    assert bed["position"][2] == pytest.approx((1 + 3.5) * k, abs=1e-3)
    assert bed["position"][1] == 0.0
    assert bed["roomId"] == "rom_001"
    assert graph["meta"]["bounds"]["maxX"] == pytest.approx(40 * k, abs=1e-3)
    assert graph["meta"]["palette"]["wall"] == "#EFE8DD"


def test_rotation_sign_and_skipped_items():
    plan = load_plan()
    plan["furniture"][1]["rotation"] = 90
    mapping, _ = map_plan(plan, "Japandi", catalog_assets())
    mapping["fur_003"]["skipped"] = True
    graph = build_scene("p", plan, "Japandi", mapping)
    items = {i["componentId"]: i for i in graph["levels"][0]["items"]}
    assert "fur_003" not in items
    sofa = items["fur_002"]
    expected = -math.radians(90) + mapping["fur_002"]["rotationOffset"]
    assert sofa["rotationY"] == pytest.approx(expected, abs=1e-4)


def test_rooms_and_openings():
    plan = load_plan()
    plan["doors"] = [{"id": "d1", "type": "door", "x": 7, "y": 0.1, "width": 3, "rotation": 0}]
    graph = build_scene("p", plan, "Industrial", {})
    level = graph["levels"][0]
    assert level["items"] == []
    door = level["openings"][0]
    assert door["wallId"] == "wall_001"
    assert door["sillHeight"] == 0.0 and door["height"] == 2.1
    living = next(r for r in level["rooms"] if r["name"] == "Living Room")
    assert living["type"] == "living"
    assert living["area"] == pytest.approx(22 * 17 * 0.3048 ** 2, rel=1e-3)
    assert living["polygon"][0] == {"x": 0.0, "z": pytest.approx(13 * 0.3048, abs=1e-3)}


@pytest.mark.parametrize("name,t", [("Master Bedroom", "bedroom"), ("WC", "bathroom"), ("Kitchen", "kitchen"), ("Foyer", "hallway"), ("Gym", "other")])
def test_room_types(name, t):
    assert room_type(name) == t
