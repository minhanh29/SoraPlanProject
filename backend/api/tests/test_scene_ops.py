import copy

import pytest

from app.errors import AppException, ConflictException
from app.services.asset_mapper import map_plan
from app.services.scene_builder import build_scene
from app.services.scene_ops import OpError, SceneService, apply_ops, compute_warnings

from .fakes import FakeFirestore
from .helpers import catalog_assets, load_plan


@pytest.fixture
def graph():
    plan = load_plan()
    mapping, _ = map_plan(plan, "Japandi", catalog_assets())
    return build_scene("p1", plan, "Japandi", mapping)


def _lookup(asset_id):
    return next((a for a in catalog_assets() if a["id"] == asset_id), None)


OPS = [
    [{"op": "item.move", "id": "itm_fur_002", "position": [1.0, 0.0, 6.0]}],
    [{"op": "item.rotate", "id": "itm_fur_002", "rotationY": 1.2}],
    [{"op": "item.resize", "id": "itm_fur_002", "dims": {"w": 2.0, "d": 0.9, "h": 0.8}}],
    [{"op": "item.replace", "id": "itm_fur_002", "assetId": "sys_japandi_Ja_living_chair"}],
    [{"op": "item.remove", "id": "itm_fur_002"}],
    [{"op": "item.add", "item": {"id": "itm_new", "assetId": "sys_japandi_Ja_sofa", "label": "Sofa 2",
                                 "position": [3, 0, 3], "dims": {"w": 2, "d": 0.9, "h": 0.8}}}],
    [{"op": "surface.material", "target": {"allWalls": True}, "material": {"tint": "#112233"}}],
    [{"op": "surface.material", "target": {"roomId": "rom_003"}, "material": {"tint": "#445566"}}],
    [{"op": "surface.material", "target": {"wallId": "wall_003"}, "material": {"tint": "#778899"}},
     {"op": "item.move", "id": "itm_fur_001", "position": [9.0, 0.0, 1.5]}],
]


@pytest.mark.parametrize("ops", OPS)
def test_apply_then_inverse_round_trips(graph, ops):
    changed, inverse, _ = apply_ops(graph, ops, _lookup)
    assert changed != graph
    restored, _, _ = apply_ops(changed, inverse, _lookup)
    assert restored == graph


def test_replace_refits_footprint(graph):
    changed, _, applied = apply_ops(graph, OPS[3], _lookup)
    item = next(i for i in changed["levels"][0]["items"] if i["id"] == "itm_fur_002")
    before = next(i for i in graph["levels"][0]["items"] if i["id"] == "itm_fur_002")
    assert item["assetId"] == "sys_japandi_Ja_living_chair"
    assert item["dims"]["w"] <= before["dims"]["w"] + 1e-6 and item["dims"]["d"] <= before["dims"]["d"] + 1e-6
    assert applied[0]["dims"] == item["dims"]


@pytest.mark.parametrize("bad", [
    [{"op": "item.move", "id": "nope", "position": [0, 0, 0]}],
    [{"op": "item.move", "id": "itm_fur_002", "position": [0, 0]}],
    [{"op": "item.resize", "id": "itm_fur_002", "dims": {"w": 0, "d": 1, "h": 1}}],
    [{"op": "surface.material", "target": {"allWalls": True}, "material": {"tint": "red"}}],
    [{"op": "item.explode", "id": "itm_fur_002"}],
])
def test_invalid_ops_are_rejected(graph, bad):
    with pytest.raises(OpError):
        apply_ops(graph, bad, _lookup)


def test_collision_warning(graph):
    sofa = next(i for i in graph["levels"][0]["items"] if i["id"] == "itm_fur_002")
    table = next(i for i in graph["levels"][0]["items"] if i["id"] == "itm_fur_004")
    changed, _, _ = apply_ops(graph, [{"op": "item.move", "id": table["id"], "position": list(sofa["position"])}])
    codes = [w["code"] for w in compute_warnings(changed, [table["id"]])]
    assert "COLLISION" in codes


def _service(graph):
    db = FakeFirestore()
    db.collection("projects").document("p1").set({"ownerUid": "u1"})
    svc = SceneService(db, asset_lookup=_lookup)
    svc.save_built("p1", "u1", graph)
    return svc, db


def test_service_versions_conflict_and_shared_undo(graph):
    svc, db = _service(graph)
    scene = svc.get("p1", "u1")
    assert scene["version"] == 1
    r1 = svc.apply_batch("p1", "u1", OPS[0], origin="ui", base_version=1, label="Move")
    assert r1["newVersion"] == 2
    with pytest.raises(ConflictException):
        svc.apply_batch("p1", "u1", OPS[1], origin="ui", base_version=1)
    svc.apply_batch("p1", "u1", OPS[6], origin="agent")  # AI edit, no base version
    assert svc.get("p1", "u1")["undoStack"] == [r1["batchId"], svc.get("p1", "u1")["undoStack"][1]]
    svc.undo("p1", "u1")  # undoes the AI color change
    assert svc.get("p1", "u1")["graph"]["meta"]["palette"]["wall"] == graph["meta"]["palette"]["wall"]
    svc.undo("p1", "u1")  # undoes the UI move
    g = svc.get("p1", "u1")["graph"]
    assert g["levels"] == graph["levels"]
    svc.redo("p1", "u1")
    moved = next(i for i in svc.get("p1", "u1")["graph"]["levels"][0]["items"] if i["id"] == "itm_fur_002")
    assert moved["position"] == [1.0, 0.0, 6.0]
    svc.redo("p1", "u1")  # the color change again
    with pytest.raises(AppException):
        svc.redo("p1", "u1")  # nothing left


def test_undo_batches_stops_at_foreign_batch(graph):
    svc, _ = _service(graph)
    a = svc.apply_batch("p1", "u1", OPS[0], origin="agent")["batchId"]
    b = svc.apply_batch("p1", "u1", OPS[1], origin="agent")["batchId"]
    svc.apply_batch("p1", "u1", OPS[6], origin="ui")
    assert svc.undo_batches("p1", "u1", [a, b]) == 0  # a UI edit is on top
    svc.undo("p1", "u1")
    assert svc.undo_batches("p1", "u1", [a, b]) == 2
    assert copy.deepcopy(svc.get("p1", "u1")["graph"]["levels"]) == graph["levels"]
