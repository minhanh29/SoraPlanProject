import copy

import pytest

from app.services.common import load_styles
from app.services.scene_ops import OpError, apply_ops
from app.services.scene_style import style_ops
from app.services.asset_service import AssetService

from .conftest import AUTH, USER_UID
from .flow import to_scene
from .helpers import catalog_assets


def _switch(client, cid, style, version):
    return client.post(f"/v1/projects/{cid}/scene/style", json={"style": style, "baseVersion": version}, headers=AUTH)


def test_switch_styles_preserves_layout_uploads_and_shared_history(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    scene = fake_db.doc(f"scenes/{cid}")
    sofa = next(i for i in scene["graph"]["levels"][0]["items"] if i["category"] == "Sofa")
    custom = {**catalog_assets()[0], "id": "my_model", "isSystem": False, "ownerUid": USER_UID}
    fake_db.collection("assets").document(custom["id"]).set(custom)
    upload = {**copy.deepcopy(sofa), "id": "itm_my_model", "assetId": custom["id"], "componentId": None, "addedBy": "user"}
    response = client.post(f"/v1/projects/{cid}/scene/ops", json={"baseVersion": scene["version"], "ops": [
        {"op": "item.move", "id": sofa["id"], "position": [1.5, 0.2, 4]},
        {"op": "item.resize", "id": sofa["id"], "dims": {"w": 2.3, "d": 1.1, "h": 0.9}},
        {"op": "item.rotate", "id": sofa["id"], "rotationY": 1.2},
        {"op": "item.add", "item": upload},
        {"op": "surface.material", "target": {"wallId": scene["graph"]["levels"][0]["walls"][0]["id"]}, "material": {"tint": "#112233"}},
    ]}, headers=AUTH)
    assert response.status_code == 200, response.text
    before = fake_db.doc(f"scenes/{cid}")
    plan_before = fake_db.doc(f"projects/{cid}")["floorPlan"]
    response = _switch(client, cid, "Industrial", before["version"])
    assert response.status_code == 200, response.text
    after = fake_db.doc(f"scenes/{cid}")
    assert response.json()["newVersion"] == after["version"] == before["version"] + 1
    assert response.json()["scene"]["graph"] == after["graph"]
    assert response.json()["scene"]["undoStack"] == after["undoStack"]
    assert after["graph"]["meta"]["style"] == "Industrial"
    assert after["graph"]["meta"]["palette"] == load_styles()["Industrial"]["palette"]
    assert fake_db.doc(f"projects/{cid}")["style"] == "Industrial"
    assert fake_db.doc(f"projects/{cid}")["floorPlan"] == plan_before
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "scene_ready"
    assert fake_db.doc(f"conversations/{cid}")["thumbnailStale"] is True
    old_items = {i["id"]: i for i in before["graph"]["levels"][0]["items"]}
    for item in after["graph"]["levels"][0]["items"]:
        old = old_items[item["id"]]
        for key in ("position", "dims", "rotationY", "componentId", "addedBy"):
            assert item.get(key) == old.get(key)
        if item["id"] == upload["id"]:
            assert item["assetId"] == custom["id"]
    new_sofa = next(i for i in after["graph"]["levels"][0]["items"] if i["id"] == sofa["id"])
    assert new_sofa["assetId"] != sofa["assetId"]
    assert len(after["undoStack"]) == len(before["undoStack"]) + 1
    assert client.post(f"/v1/projects/{cid}/scene/undo", headers=AUTH).status_code == 200
    restored = fake_db.doc(f"scenes/{cid}")["graph"]
    assert restored["meta"] == before["graph"]["meta"]
    assert restored["levels"] == before["graph"]["levels"]
    assert fake_db.doc(f"projects/{cid}")["style"] == "Japandi"
    assert client.post(f"/v1/projects/{cid}/scene/redo", headers=AUTH).status_code == 200
    assert fake_db.doc(f"scenes/{cid}")["graph"]["levels"] == after["graph"]["levels"]
    current = fake_db.doc(f"scenes/{cid}")
    assert _switch(client, cid, "Japandi", current["version"]).status_code == 200
    assert fake_db.doc(f"scenes/{cid}")["graph"]["meta"]["style"] == "Japandi"


def test_style_switch_validates_version_busy_state_and_noop(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    before = fake_db.doc(f"scenes/{cid}")
    assert _switch(client, cid, "Industrial", before["version"] + 1).status_code == 409
    assert _switch(client, cid, "Unknown", before["version"]).status_code == 422
    assert _switch(client, cid, "Japandi", before["version"]).status_code == 200
    assert fake_db.doc(f"scenes/{cid}")["version"] == before["version"]
    assert fake_db.doc(f"scenes/{cid}")["undoStack"] == before["undoStack"]
    fake_db.collection("conversations").document(cid).update({"busy": True})
    response = _switch(client, cid, "Industrial", before["version"])
    assert response.status_code == 409 and response.json()["code"] == "PROJECT_BUSY"
    fake_db.collection("conversations").document(cid).update({"busy": False})
    fake_db.collection("projects").document(cid).update({"ownerUid": "someone_else"})
    assert _switch(client, cid, "Industrial", before["version"]).status_code == 403


def test_style_ops_keep_missing_counterparts_and_ignore_unready_models():
    current = {"id": "old", "name": "Japandi Chair", "category": "Chair", "isSystem": True, "style": "Japandi", "status": "ready"}
    graph = {"meta": {"style": "Japandi", "palette": load_styles()["Japandi"]["palette"]}, "levels": [{"walls": [], "rooms": [], "items": [
        {"id": "item", "assetId": "old", "category": "Chair", "dims": {"w": 1, "d": 1, "h": 1}, "position": [1, 0, 1]},
    ]}]}
    unready = {**current, "id": "new", "style": "Industrial", "status": "generating_3d"}
    ops, retained = style_ops(graph, "Industrial", [current, unready])
    changed, inverse, _ = apply_ops(graph, ops)
    assert retained == 1
    assert changed["levels"][0]["items"] == graph["levels"][0]["items"]
    restored, _, _ = apply_ops(changed, inverse)
    # Surface undo records explicit null overrides, as it does for ordinary color edits.
    assert restored["meta"] == graph["meta"]
    assert restored["levels"] == graph["levels"]
    with pytest.raises(OpError):
        apply_ops(graph, [{"op": "scene.style", "style": "Unknown"}])


def test_switch_reuses_loaded_catalog_without_per_item_asset_reads(client, fake_db, fake_storage, worker_calls, monkeypatch):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    before = fake_db.doc(f"scenes/{cid}")
    reads = []
    original = AssetService.get

    def track(service, asset_id):
        reads.append(asset_id)
        return original(service, asset_id)

    monkeypatch.setattr(AssetService, "get", track)
    response = _switch(client, cid, "Industrial", before["version"])
    assert response.status_code == 200, response.text
    assert reads == []
    changed = response.json()["scene"]
    assert changed["version"] == changed["graph"]["version"] == response.json()["newVersion"]
    assert any(a["assetId"] != b["assetId"] for a, b in zip(before["graph"]["levels"][0]["items"], changed["graph"]["levels"][0]["items"]))


def test_batch_reuses_asset_lookup_for_repeated_instances():
    asset = {"id": "target", "category": "Sofa", "dims": {"w": 2, "d": 1, "h": 1}}
    graph = {"levels": [{"items": [
        {"id": f"item-{i}", "assetId": "old", "dims": {"w": 2, "d": 1, "h": 1}} for i in range(44)
    ]}]}
    reads = []

    def lookup(asset_id):
        reads.append(asset_id)
        return asset

    changed, _, _ = apply_ops(graph, [{"op": "item.replace", "id": f"item-{i}", "assetId": "target"} for i in range(44)], lookup)
    assert reads == ["target"]
    assert all(i["assetId"] == "target" for i in changed["levels"][0]["items"])


@pytest.mark.parametrize("source,target,style", [
    ("sys_japandi_Ja_sink", "sys_industrial_In_toilet_sink", "Industrial"),
    ("sys_industrial_In_toilet_sink", "sys_japandi_Ja_sink", "Japandi"),
])
@pytest.mark.parametrize("stored_category", ["Sink", "Bathroom Vanity", "Kitchen Sink"])
def test_bath_sink_counterparts_switch_both_ways_with_legacy_categories(source, target, style, stored_category):
    assets = catalog_assets()
    by_id = {a["id"]: a for a in assets}
    item = {"id": "bath-sink", "assetId": source, "category": stored_category, "label": "Bath sinks",
            "position": [3, 0.1, 2], "rotationY": 1.2, "dims": {"w": 2, "d": 0.6, "h": 0.85}}
    graph = {"meta": {"style": by_id[source]["style"], "palette": load_styles()[by_id[source]["style"]]["palette"]},
             "levels": [{"items": [item], "walls": [], "rooms": []}]}
    ops, retained = style_ops(graph, style, assets)
    changed, inverse, _ = apply_ops(graph, ops, by_id.get)
    sink = changed["levels"][0]["items"][0]
    assert sink["assetId"] == target
    assert retained == 0
    for key in ("position", "rotationY", "dims"):
        assert sink[key] == item[key]
    restored, _, _ = apply_ops(changed, inverse, by_id.get)
    assert restored == graph


def test_bath_sink_is_not_replaced_by_a_kitchen_sink():
    assets = [a for a in catalog_assets() if a["id"] in ("sys_japandi_Ja_sink", "sys_industrial_In_kitchen_sink")]
    graph = {"levels": [{"items": [{"id": "bath-sink", "assetId": "sys_japandi_Ja_sink", "category": "Sink",
                                   "position": [1, 0, 1], "dims": {"w": 2, "d": 0.6, "h": 0.85}}]}]}
    ops, retained = style_ops(graph, "Industrial", assets)
    assert retained == 1
    assert not any(op["op"] == "item.replace" for op in ops)


def test_style_endpoint_replaces_every_bath_sink(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    before = fake_db.doc(f"scenes/{cid}")
    sinks = [i for i in before["graph"]["levels"][0]["items"] if i["assetId"] == "sys_japandi_Ja_sink"]
    assert sinks
    response = _switch(client, cid, "Industrial", before["version"])
    assert response.status_code == 200, response.text
    items = {i["id"]: i for i in response.json()["scene"]["graph"]["levels"][0]["items"]}
    assert all(items[sink["id"]]["assetId"] == "sys_industrial_In_toilet_sink" for sink in sinks)
