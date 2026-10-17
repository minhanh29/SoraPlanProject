"""Regressions for the integration review (busy flags, undo result, plan fields, asset ownership, system history)."""
from app.services.workflow import sanitize_plan

from .conftest import AUTH
from .fakes import call, say
from .flow import create_and_upload, to_scene
from .helpers import load_plan


def test_agent_confirm_crop_keeps_parsing_busy(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = create_and_upload(client, fake_storage)
    fake_gemini.script = [call("confirm_crop"), say("Reading it now.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "done"}, headers=AUTH)
    conv = fake_db.doc(f"conversations/{cid}")
    assert conv["busy"] is True and conv["busyReason"] == "parsing"


def test_undo_card_not_marked_when_newer_edits_exist(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    fake_gemini.script = [call("move_item", itemId="itm_fur_002", dx=0.3), say("Moved.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "move the sofa"}, headers=AUTH)
    change = fake_db.messages(cid)[-1]
    scene = fake_db.doc(f"scenes/{cid}")
    client.post(f"/v1/projects/{cid}/scene/ops", json={"baseVersion": scene["version"],
                "ops": [{"op": "item.rotate", "id": "itm_fur_001", "rotationY": 1.0}]}, headers=AUTH)
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "undo_last_change",
                      "args": {"batchIds": change["payload"]["batchIds"], "messageId": change["id"]}}, headers=AUTH)
    assert res.status_code == 409 and res.json()["code"] == "HISTORY_CONFLICT"
    assert not fake_db.messages(cid)[-1]["payload"].get("undone")


def test_ui_ops_cannot_place_other_users_assets(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    fake_db.collection("assets").document("theirs").set({"ownerUid": "someone_else", "isSystem": False, "status": "ready"})
    v = fake_db.doc(f"scenes/{cid}")["version"]
    res = client.post(f"/v1/projects/{cid}/scene/ops", json={"baseVersion": v,
                      "ops": [{"op": "item.replace", "id": "itm_fur_002", "assetId": "theirs"}]}, headers=AUTH)
    assert res.status_code == 404


def test_system_batches_stay_out_of_user_history(client, fake_db, fake_storage, worker_calls):
    from app.services.scene_ops import SceneService

    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    SceneService(fake_db).apply_batch(cid, "usr_test123", [{"op": "item.rotate", "id": "itm_fur_002", "rotationY": 0.5}], origin="system")
    assert fake_db.doc(f"scenes/{cid}")["undoStack"] == []


def test_sanitize_keeps_label_position_and_swing():
    plan = load_plan()
    plan["rooms"][0]["labelPosition"] = {"x": 30, "y": 6}
    plan["doors"] = [{"id": "d1", "x": 1, "y": 0, "width": 3, "swing": "left"}]
    out = sanitize_plan(plan)
    assert out["rooms"][0]["labelPosition"] == {"x": 30.0, "y": 6.0}
    assert out["doors"][0]["swing"] == "left"
