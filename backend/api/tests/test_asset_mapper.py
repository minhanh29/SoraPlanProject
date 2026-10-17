import math

import pytest

from app.services.asset_mapper import candidate_categories, fit_asset, map_plan, unresolved

from .helpers import catalog_assets, load_plan


def _box(kind="furniture", **kw):
    b = {"id": "b1", "type": kind, "label": kw.pop("label", ""), "x": 0, "y": 0, "width": 2, "height": 1, "rotation": 0}
    b.update(kw)
    return b


@pytest.mark.parametrize(
    "box,room,style,expected",
    [
        (_box(furnitureType="bed"), "Bedroom", "Japandi", ["Bed"]),
        (_box(furnitureType="sofa"), "Living", "Industrial", ["Sofa"]),
        (_box(furnitureType="chair", label="Bar stool"), "Kitchen", "Industrial", ["Stool"]),
        (_box(furnitureType="chair", label="Bar stool"), "Kitchen", "Japandi", ["Dining Chair"]),
        (_box(furnitureType="table"), "Living Room", "Japandi", ["Coffee Table"]),
        (_box(furnitureType="table"), "Kitchen", "Japandi", ["Dining Table"]),
        (_box(furnitureType="cabinet", label="TV unit"), "Living", "Japandi", ["TV Stand"]),
        (_box(furnitureType="wardrobe"), "Bedroom", "Japandi", ["Wardrobe & Storage"]),
        (_box(furnitureType="kitchen_island"), "Kitchen", "Japandi", ["Kitchen Counter"]),
        (_box("fixture", fixtureType="sink"), "Bathroom", "Industrial", ["Bathroom Vanity", "Sink"]),
        (_box("fixture", fixtureType="sink"), "Kitchen", "Industrial", ["Kitchen Sink", "Sink"]),
        (_box("fixture", fixtureType="refrigerator"), "Kitchen", "Japandi", ["Kitchen Appliance"]),
        (_box("fixture", fixtureType="washer"), "Laundry", "Japandi", ["Appliance"]),
        (_box(furnitureType="unknown", label="Couch"), "", "Japandi", ["Sofa"]),
        (_box(furnitureType="desk", label="Desk"), "Office", "Japandi", None),
        (_box("fixture", fixtureType="shower", label="Shower"), "Bath", "Japandi", None),
        (_box(furnitureType="unknown", category="Armchair", label="Reading chair"), "", "Japandi", ["Armchair"]),
    ],
)
def test_category_table(box, room, style, expected):
    assert candidate_categories(box, room, style) == expected


def test_map_plan_japandi_matches_and_reports_missing():
    plan = load_plan()
    asked = []

    def classify(items, cats):
        asked.extend(i["label"] for i in items)
        return {i["id"]: None for i in items}

    mapping, missing = map_plan(plan, "Japandi", catalog_assets(), classify=classify)
    assert set(asked) == {"Desk", "Shower"}  # only what the table cannot place
    assert mapping["fur_001"]["assetId"] == "sys_japandi_Ja_master_bed"  # bed in the master room
    assert mapping["fur_002"]["assetId"] == "sys_japandi_Ja_sofa"
    assert mapping["fur_009"]["assetId"] == "sys_japandi_Ja_nightstand"
    assert mapping["fix_003"]["assetId"] == "sys_japandi_Ja_sink"  # bathroom sink → Sink (no vanity in Japandi)
    assert mapping["fix_004"]["assetId"] == "sys_japandi_Ja_kitchen_sink"
    # both chairs use the same model (apply-to-all in the inspector)
    assert mapping["fur_006"]["assetId"] == mapping["fur_007"]["assetId"]
    assert {m["componentId"] for m in missing} == {"fur_008", "fix_006"}
    assert unresolved(mapping) == missing


def test_map_plan_industrial_has_no_nightstand():
    mapping, missing = map_plan(load_plan(), "Industrial", catalog_assets())
    assert mapping["fur_009"]["assetId"] is None
    assert "fur_009" in {m["componentId"] for m in missing}
    assert mapping["fix_003"]["assetId"] == "sys_industrial_In_toilet_sink"  # Bathroom Vanity


def test_gemini_classification_fills_unknowns():
    mapping, missing = map_plan(load_plan(), "Japandi", catalog_assets(), classify=lambda items, cats: {
        i["id"]: ("Dining Table" if i["label"] == "Desk" else None) for i in items})
    assert mapping["fur_008"]["category"] == "Dining Table"
    assert mapping["fur_008"]["assetId"]
    assert [m["componentId"] for m in missing] == ["fix_006"]


def test_footprint_fills_the_box_with_bounded_stretch():
    asset = {"dims": {"w": 2.0, "d": 1.0, "h": 0.8}, "frontAxis": "+z"}
    # box is 3:1, model 2:1 -> long side stretches at most 20% past the uniform fit (d = 1.0 -> w = 2.4)
    dims, off = fit_asset(3.0, 1.0, 0.0, (5, 5), asset, "Sofa", [])
    assert dims["d"] == pytest.approx(1.0)
    assert dims["w"] == pytest.approx(2.4)
    assert dims["w"] <= 3.0 and dims["d"] <= 1.0 + 1e-6
    assert off in (0.0, math.pi)
    # a box with the model's own proportions is filled exactly
    dims, _ = fit_asset(2.2, 1.1, 0.0, (5, 5), asset, "Sofa", [])
    assert (dims["w"], dims["d"]) == (pytest.approx(2.2), pytest.approx(1.1))


def test_height_is_pulled_into_the_category_range():
    # a squat chair model in a small box: footprint fit alone would make it 0.38 m tall
    chair = {"dims": {"w": 1.6, "d": 1.4, "h": 1.3}, "frontAxis": "+z"}
    dims, _ = fit_asset(0.46, 0.46, 0.0, (5, 5), chair, "Dining Chair", [])
    assert 0.75 - 1e-3 <= dims["h"] <= 1.05
    # a flat bathtub model is stretched up, not left at 0.25 m
    tub = {"dims": {"w": 1.9, "d": 0.86, "h": 0.32}, "frontAxis": "+z"}
    dims, _ = fit_asset(1.52, 0.76, 0.0, (5, 5), tub, "Bathtub", [])
    assert dims["h"] >= 0.4 - 1e-3
    assert dims["w"] <= 1.52 + 1e-6


def test_fit_rotates_to_match_box_orientation_and_faces_away_from_wall():
    asset = {"dims": {"w": 2.0, "d": 0.9, "h": 0.8}, "frontAxis": "+z"}
    # sofa box against the left wall (x = 0), long side along z
    wall = ((0.0, 0.0), (0.0, 10.0))
    dims, off = fit_asset(0.9, 2.2, 0.0, (0.6, 5.0), asset, "Sofa", [wall])
    assert abs(abs(off) - math.pi / 2) < 1e-6
    front = (math.sin(off), math.cos(off))
    assert front[0] > 0.9  # faces +x, away from the wall
    assert dims["d"] == pytest.approx(0.9)


def test_back_goes_to_the_wall_behind_not_the_nearest_side_wall():
    # bed in a corner: the side wall (x = 0) is closer than the head wall (z = 0), but only the head wall
    # lies along the bed's long axis, so the headboard (-z) goes there.
    bed = {"dims": {"w": 1.5, "d": 2.0, "h": 0.8}, "frontAxis": "+z"}
    walls = [((0.0, 0.0), (0.0, 10.0)), ((0.0, 0.0), (10.0, 0.0)), ((0.0, 10.0), (10.0, 10.0))]
    _, off = fit_asset(1.5, 2.0, 0.0, (0.85, 1.6), bed, "Bed", walls)
    assert off == 0.0  # front +z, headboard against z = 0
    _, off = fit_asset(1.5, 2.0, 0.0, (0.85, 8.4), bed, "Bed", walls)
    assert off == pytest.approx(math.pi)  # same bed at the bottom wall turns around


def test_chairs_face_the_table():
    chair = {"dims": {"w": 0.5, "d": 0.5, "h": 0.9}, "frontAxis": "+z"}
    walls = [((0.0, 0.0), (10.0, 0.0))]
    table = [("Dining Table", (5.0, 3.0))]
    # chair north of the table (smaller z) with a wall right behind the table side: still faces the table
    _, off = fit_asset(0.46, 0.46, 0.0, (5.0, 2.3), chair, "Dining Chair", walls, table)
    assert math.cos(off) > 0.9  # front +z, toward the table
    _, off = fit_asset(0.46, 0.46, 0.0, (5.0, 3.7), chair, "Dining Chair", walls, table)
    assert math.cos(off) < -0.9  # south chair faces -z
    _, off = fit_asset(0.46, 0.46, 0.0, (6.0, 3.0), chair, "Dining Chair", walls, table)
    assert math.sin(off) < -0.9  # east chair faces -x


def test_sofa_against_a_wall_ignores_the_coffee_table_behind_it():
    sofa = {"dims": {"w": 2.0, "d": 0.9, "h": 0.8}, "frontAxis": "+z"}
    walls = [((0.0, 0.0), (10.0, 0.0))]
    # coffee table is on the wall side (odd plan); the sofa keeps its back to the wall
    _, off = fit_asset(2.2, 0.9, 0.0, (5.0, 0.6), sofa, "Sofa", walls, [("Coffee Table", (5.0, 0.2))])
    assert math.cos(off) > 0.9


def test_real_dims_uses_typical_size_and_height():
    from app.services.asset_mapper import real_dims
    dims = real_dims({"dims": {"w": 1.9, "d": 0.97, "h": 0.65}}, "Sofa")
    assert dims["w"] == pytest.approx(2.1)
    assert 0.7 - 1e-3 <= dims["h"] <= 1.0
    assert real_dims(None, "Bed") == {"w": 0.8, "d": 0.8, "h": 0.9}


def test_user_dims_survive_restyle_for_same_category():
    plan = load_plan()
    first, _ = map_plan(plan, "Japandi", catalog_assets())
    first["fur_002"]["dims"] = {"w": 2.4, "d": 1.0, "h": 0.9}
    first["fur_002"]["dimsSource"] = "user"
    second, _ = map_plan(plan, "Industrial", catalog_assets(), previous=first)
    assert second["fur_002"]["assetId"] == "sys_industrial_In_sofa"
    assert second["fur_002"]["dims"] == {"w": 2.4, "d": 1.0, "h": 0.9}
    assert second["fur_002"]["dimsSource"] == "user"


def test_skipped_and_user_uploads_are_kept_across_styles():
    plan = load_plan()
    first, _ = map_plan(plan, "Japandi", catalog_assets())
    first["fix_006"]["skipped"] = True
    first["fur_008"].update({"assetId": "ast_mine", "category": "Dining Table"})
    mine = {"id": "ast_mine", "ownerUid": "u1", "isSystem": False, "category": "Dining Table", "status": "ready", "dims": None}
    second, missing = map_plan(plan, "Industrial", catalog_assets() + [mine], previous=first, user_uid="u1")
    assert second["fix_006"]["skipped"] is True
    assert second["fur_008"]["assetId"] == "ast_mine"
    assert "fix_006" not in {m["componentId"] for m in missing}
