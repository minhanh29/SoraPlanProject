"""Whole-asset placement regressions (model replies are stubbed; no external calls)."""
import copy
import math

import pytest

from app.services.asset_mapper import map_plan, refit_entry, unresolved
from app.services.asset_matching import refine_mapping, release_group
from app.services.scene_builder import build_scene


def kitchen_plan():
    def fixture(cid, kind, x, y, w, h):
        return {"id": cid, "fixtureType": kind, "label": kind.title(), "x": x, "y": y,
                "width": w, "height": h, "rotation": 0}

    return {"units": "m", "width": 10, "height": 10, "walls": [], "furniture": [], "rooms": [
        {"id": "kitchen", "name": "Kitchen", "polygon": [
            {"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10}]}],
        "fixtures": [fixture("run1", "counter", 1, 1, 3, 0.6), fixture("run2", "counter", 1, 1.6, 0.6, 2.4),
                     fixture("sink", "sink", 2, 1, 0.6, 0.6), fixture("stove", "stove", 3, 1, 0.6, 0.6),
                     fixture("fridge", "refrigerator", 1, 4, 0.6, 0.6),
                     fixture("separate", "refrigerator", 8, 8, 0.6, 0.6)]}


def kitchen_asset(**fields):
    return {"id": "whole_kitchen", "name": "L-shaped kitchen", "category": "Kitchen Counter", "style": "Japandi",
            "description": "L-shaped kitchen counter with sink, stove and fridge already included. One complete model.",
            "isSystem": True, "ownerUid": None, "status": "ready", "dims": {"w": 3, "d": 3.6, "h": 2}, **fields}


def group_reply(context, assets):
    return [{"componentIds": ["run1", "run2", "sink", "stove", "fridge"], "assetId": assets[0]["id"]}]


def wall_kitchen_plan():
    plan = kitchen_plan()
    plan["walls"] = [
        {"id": "top", "x1": 1, "y1": 1, "x2": 5, "y2": 1, "thickness": 0.1},
        {"id": "left", "x1": 1, "y1": 1, "x2": 1, "y2": 5, "thickness": 0.1},
    ]
    # Real parser output has separate counter blocks on either side of an inset sink/stove.
    plan["fixtures"][0].update(width=0.8)
    plan["fixtures"][2].update(x=1.8, label="Kitchen sink")
    plan["fixtures"].extend([
        {"id": "middle", "fixtureType": "counter", "label": "Counter", "x": 2.4, "y": 1,
         "width": 0.6, "height": 0.6, "rotation": 0},
        {"id": "end", "fixtureType": "counter", "label": "Counter", "x": 3.6, "y": 1,
         "width": 0.4, "height": 0.6, "rotation": 0},
        # This third parallel run touches the free end, but is not against either corner wall.
        {"id": "peninsula", "fixtureType": "counter", "label": "Counter", "x": 1.6, "y": 4,
         "width": 3, "height": 0.6, "rotation": 0},
    ])
    plan["fixtures"][4].update(fixtureType="unknown", label="Ref.")
    return plan


def standalone_counter():
    return {"id": "straight", "name": "Straight counter", "category": "Kitchen Counter", "style": "Japandi",
            "description": "Straight standalone rectangular counter with base cupboards and a worktop.",
            "isSystem": True, "ownerUid": None, "status": "ready", "dims": {"w": 3, "d": 0.6, "h": 0.9}}


@pytest.mark.parametrize("flip_x,flip_y,corner,yaw", [
    (False, False, "top-left", 0), (True, False, "top-right", -math.pi / 2),
    (False, True, "bottom-left", math.pi / 2), (True, True, "bottom-right", -math.pi),
])
def test_wall_corner_is_one_kitchen_and_touching_peninsula_stays_separate(flip_x, flip_y, corner, yaw):
    plan = wall_kitchen_plan()
    for box in plan["fixtures"]:
        if flip_x:
            box["x"] = 10 - box["x"] - box["width"]
        if flip_y:
            box["y"] = 10 - box["y"] - box["height"]
    for wall in plan["walls"]:
        for endpoint in (1, 2):
            if flip_x:
                wall[f"x{endpoint}"] = 10 - wall[f"x{endpoint}"]
            if flip_y:
                wall[f"y{endpoint}"] = 10 - wall[f"y{endpoint}"]
    original = copy.deepcopy(plan)
    seen = []

    def individual_suggestions(context, catalog):
        seen.append(context)
        # The mandatory corner rule overrides suggestions that split the assembly.
        return [{"componentIds": [o["id"]], "assetId": "straight"} for o in context["objects"]]

    mapping, missing = map_plan(plan, "Japandi", [kitchen_asset(), standalone_counter()], match=individual_suggestions)
    root = mapping["run1"]
    assert root["assetId"] == "whole_kitchen"
    assert root["cornerOrientation"] == corner
    assert root["rotationOffset"] == pytest.approx(yaw)
    assert root["placementBox"] == pytest.approx({
        "x": 6 if flip_x else 1, "y": 5.4 if flip_y else 1, "width": 3, "height": 3.6, "rotation": 0})
    parts = {"run1", "run2", "sink", "stove", "fridge", "middle", "end"}
    assert set(root["componentIds"]) == parts
    assert all(mapping[cid]["includedIn"] == "run1" for cid in parts - {"run1"})
    assert mapping["peninsula"]["assetId"] == "straight"
    assert "includedIn" not in mapping["peninsula"]
    assert {m["componentId"] for m in missing} == {"separate"}
    assert seen[0]["kitchenComposites"][0]["cornerOrientation"] == corner
    items = build_scene("p", plan, "Japandi", mapping)["levels"][0]["items"]
    assert {i["componentId"] for i in items} == {"run1", "peninsula"}
    kitchen = next(i for i in items if i["componentId"] == "run1")
    assert kitchen["rotationY"] == pytest.approx(yaw, abs=0.001)
    assert refit_entry(plan, "run1", root, kitchen_asset(), mapping)["rotationOffset"] == pytest.approx(yaw)
    assert plan == original


@pytest.mark.parametrize("match", [None, lambda p, a: []])
def test_wall_corner_rule_also_applies_without_semantic_suggestions(match):
    mapping, _ = map_plan(wall_kitchen_plan(), "Japandi", [kitchen_asset(), standalone_counter()], match=match)
    assert mapping["run1"]["assetId"] == "whole_kitchen"
    assert mapping["sink"]["includedIn"] == "run1"
    assert mapping["peninsula"]["assetId"] == "straight"


def test_corner_without_complete_asset_is_not_split_between_individual_assets():
    mapping, _ = map_plan(wall_kitchen_plan(), "Japandi", [standalone_counter()])
    assert all(mapping[cid]["assetId"] is None for cid in ("run1", "run2", "sink", "stove", "fridge", "middle", "end"))
    assert mapping["peninsula"]["assetId"] == "straight"


def test_l_shaped_model_cannot_be_assigned_to_a_single_straight_counter():
    plan = kitchen_plan()
    mapping, _ = map_plan(plan, "Japandi", [kitchen_asset()], match=lambda p, a: [
        {"componentIds": ["run1"], "assetId": "whole_kitchen"}])
    assert mapping["run1"]["assetId"] is None


def test_peninsula_is_excluded_even_when_matcher_tries_to_absorb_it():
    plan = wall_kitchen_plan()
    mapping, _ = map_plan(plan, "Japandi", [kitchen_asset(), standalone_counter()], match=lambda p, a: [
        {"componentIds": ["run1", "run2", "sink", "stove", "fridge", "middle", "end", "peninsula"],
         "assetId": "whole_kitchen"}])
    assert "peninsula" not in mapping["run1"]["componentIds"]
    assert mapping["peninsula"]["assetId"] == "straight"


def test_replacing_corner_asset_clears_its_corner_orientation():
    mapping, _ = map_plan(wall_kitchen_plan(), "Japandi", [kitchen_asset(), standalone_counter()])
    release_group(mapping, "run1")
    assert "cornerOrientation" not in mapping["run1"]
    assert "includedIn" not in mapping["sink"]


@pytest.mark.parametrize("asset_id", ["Szt6o4XyN1TB5LkM9q18", "tAm3K9iRKIGYr1kmHAso"])
def test_catalog_kitchen_uses_its_verified_native_model_corner(asset_id):
    from app.services.asset_service import AssetService

    asset = AssetService._with_description(kitchen_asset(id=asset_id))
    assert asset["cornerOrientation"] == "top-right"
    mapping, _ = map_plan(wall_kitchen_plan(), "Japandi", [asset, standalone_counter()])
    assert mapping["run1"]["cornerOrientation"] == "top-left"
    assert mapping["run1"]["rotationOffset"] == pytest.approx(math.pi / 2)


@pytest.mark.parametrize("units,factor", [("ft", 1 / 0.3048), ("normalized", 100)])
def test_kitchen_grouping_uses_physical_tolerances_in_any_plan_units(units, factor):
    plan = wall_kitchen_plan()
    plan.update(units=units, width=10 * factor, height=10 * factor)
    for box in plan["fixtures"]:
        for key in ("x", "y", "width", "height"):
            box[key] *= factor
    for wall in plan["walls"]:
        for key in ("x1", "y1", "x2", "y2", "thickness"):
            wall[key] *= factor
    for point in plan["rooms"][0]["polygon"]:
        point["x"] *= factor
        point["y"] *= factor
    mapping, _ = map_plan(plan, "Japandi", [kitchen_asset(), standalone_counter()])
    assert mapping["run1"]["dims"] == pytest.approx({"w": 3, "d": 3.6, "h": 2})
    assert mapping["run1"]["cornerOrientation"] == "top-left"
    assert "includedIn" not in mapping["peninsula"]


def test_kitchen_rule_preserves_skipped_parts_and_selected_private_assets():
    plan = wall_kitchen_plan()
    assets = [kitchen_asset(), standalone_counter()]
    previous, _ = map_plan(plan, "Japandi", [standalone_counter()])
    previous["sink"]["skipped"] = True
    mapping, _ = map_plan(plan, "Japandi", assets, previous=previous)
    assert mapping["sink"]["skipped"]
    assert "componentIds" not in mapping["run1"]

    private = {**standalone_counter(), "id": "private", "isSystem": False, "ownerUid": "u"}
    previous["sink"]["skipped"] = False
    previous["run1"].update(assetId="private")
    mapping, _ = map_plan(plan, "Japandi", [*assets, private], previous=previous, user_uid="u")
    assert mapping["run1"]["assetId"] == "private"
    assert "componentIds" not in mapping["run1"]


def test_a_kitchen_that_excludes_the_fridge_cannot_absorb_it():
    incomplete = kitchen_asset(description="L-shaped kitchen with sink and stove. Refrigerator is separate.")
    mapping, _ = map_plan(wall_kitchen_plan(), "Japandi", [incomplete, standalone_counter()])
    assert mapping["run1"]["assetId"] is None
    assert "includedIn" not in mapping["fridge"]


def test_composite_is_fitted_and_placed_once_without_duplicate_parts():
    plan = kitchen_plan()
    original = copy.deepcopy(plan)
    calls = []

    def match(context, assets):
        calls.append((context, assets))
        return group_reply(context, assets)

    mapping, missing = map_plan(plan, "Japandi", [kitchen_asset()], match=match)
    assert calls[0][1][0]["description"].startswith("L-shaped")
    assert calls[0][0]["objects"][0]["categories"] == ["Kitchen Counter"]
    assert mapping["run1"]["placementBox"] == pytest.approx({"x": 1, "y": 1, "width": 3, "height": 3.6, "rotation": 0})
    assert mapping["run1"]["dims"]["w"] == pytest.approx(3)
    assert mapping["run1"]["dims"]["d"] == pytest.approx(3.6)
    assert all(mapping[cid]["includedIn"] == "run1" for cid in ["run2", "sink", "stove", "fridge"])
    assert {m["componentId"] for m in missing} == {"separate"}
    scene = build_scene("p", plan, "Japandi", mapping)
    assert len(scene["levels"][0]["items"]) == 1
    item = scene["levels"][0]["items"][0]
    assert item["position"] == [2.5, 0, 2.8]
    assert item["assetId"] == "whole_kitchen"
    assert plan == original  # grouping must preserve editable source symbols


def test_restyle_keeps_a_selected_user_composite_even_if_matching_is_unavailable():
    plan, asset = kitchen_plan(), kitchen_asset(isSystem=False, ownerUid="u")
    first, _ = map_plan(plan, "Japandi", [asset], match=group_reply, user_uid="u")
    second, missing = map_plan(plan, "Industrial", [asset], previous=first, user_uid="u")
    assert second["run1"]["assetId"] == asset["id"]
    assert second["run1"]["placementBox"] == first["run1"]["placementBox"]
    assert second["sink"]["includedIn"] == "run1"
    assert {m["componentId"] for m in missing} == {"separate"}


@pytest.mark.parametrize("reply", [
    [{"componentIds": ["run1", "does_not_exist"], "assetId": "whole_kitchen"}],
    [{"componentIds": ["run1", "run1"], "assetId": "whole_kitchen"}],
    [{"componentIds": ["run1", "separate"], "assetId": "whole_kitchen"}],  # disconnected
    [{"componentIds": ["sink"], "assetId": "whole_kitchen"}],  # wrong primary category
    [{"componentIds": ["run1"], "assetId": "invented_asset"}],
    [{"componentIds": ["run1"], "assetId": []}],
    [{"componentIds": ["run1", "run2"], "assetId": None}],
    [{"componentIds": "run1", "assetId": "whole_kitchen"}],
    [{"componentIds": ["run1"]}],
    [None, "bad", {}], None, {},
])
def test_invalid_matches_leave_the_mapping_intact(reply):
    plan, assets = kitchen_plan(), [kitchen_asset()]
    baseline, _ = map_plan(plan, "Japandi", assets)
    actual, _ = map_plan(plan, "Japandi", assets, match=lambda p, a: reply)
    assert actual == baseline


def test_matching_failure_retains_the_category_fallback():
    def fail(plan, assets):
        raise TimeoutError("offline")

    plan, assets = kitchen_plan(), [kitchen_asset()]
    assert map_plan(plan, "Japandi", assets, match=fail) == map_plan(plan, "Japandi", assets)


def test_skipping_a_complete_asset_keeps_all_its_parts_out_on_restyle():
    plan, asset = kitchen_plan(), kitchen_asset()
    mapping, _ = map_plan(plan, "Japandi", [asset], match=group_reply)
    mapping["run1"]["skipped"] = True
    second, missing = map_plan(plan, "Industrial", [asset], previous=mapping, match=group_reply)
    assert second["run1"]["skipped"]
    assert {m["componentId"] for m in missing} == {"separate"}
    assert not build_scene("p", plan, "Industrial", second)["levels"][0]["items"]


def test_incompatible_shape_can_be_left_missing_instead_of_using_wrong_asset():
    plan, assets = kitchen_plan(), [kitchen_asset()]
    mapping, missing = map_plan(plan, "Japandi", assets, match=lambda p, a: [
        {"componentIds": ["run1"], "assetId": None}])
    assert mapping["run1"]["assetId"] is None
    assert "run1" in {m["componentId"] for m in missing}


def test_groups_cannot_cross_rooms_or_consume_skipped_objects():
    plan, assets = kitchen_plan(), [kitchen_asset()]
    first, _ = map_plan(plan, "Japandi", assets)
    first["sink"]["skipped"] = True
    mapped, _ = map_plan(plan, "Japandi", assets, previous=first, match=group_reply)
    assert "componentIds" not in mapped["run1"]
    assert mapped["sink"]["skipped"]
    # Close neighbors on either side of a partition must remain separate.
    plan["rooms"][0]["polygon"] = [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 2}, {"x": 0, "y": 2}]
    plan["rooms"].append({"id": "other", "name": "Utility", "polygon": [
        {"x": 0, "y": 2}, {"x": 10, "y": 2}, {"x": 10, "y": 10}, {"x": 0, "y": 10}]})
    mapped, _ = map_plan(plan, "Japandi", assets, match=group_reply)
    assert "componentIds" not in mapped["run1"]


def test_private_assets_and_other_styles_are_not_sent_to_the_model():
    seen = []
    assets = [kitchen_asset(), kitchen_asset(id="private", isSystem=False, ownerUid="other"),
              kitchen_asset(id="wrong_style", style="Industrial"), kitchen_asset(id="pending", status="generating_3d")]
    map_plan(kitchen_plan(), "Japandi", assets, match=lambda p, a: seen.extend(a) or [], user_uid="u")
    assert [a["id"] for a in seen] == ["whole_kitchen"]


def test_manual_replacement_releases_group_and_refits_merged_footprint():
    plan, asset = kitchen_plan(), kitchen_asset()
    mapping, _ = map_plan(plan, "Japandi", [asset], match=group_reply)
    refitted = refit_entry(plan, "run1", mapping["run1"], asset, mapping)
    assert refitted["autoDims"] == mapping["run1"]["autoDims"]
    release_group(mapping, "run1")
    assert "placementBox" not in mapping["run1"]
    assert "includedIn" not in mapping["sink"]
    assert "sink" in {m["componentId"] for m in unresolved(mapping)}
    # A manually selected model can group its own parts while still generating.
    mapping = refine_mapping(plan, "Japandi", [kitchen_asset(status="generating_3d")], mapping,
                             group_reply, required_component_id="run1")
    assert mapping["sink"]["includedIn"] == "run1"
