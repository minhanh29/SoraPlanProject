"""Drive a project through the stages with the fakes (shared by API tests)."""
from app.services.common import SERVER_TIMESTAMP

from .conftest import AUTH, USER_UID
from .helpers import load_plan, png_bytes


def create_and_upload(client, storage, data: bytes = None, name="floorplan_1.png", ctype="image/png") -> str:
    data = data or png_bytes()
    res = client.post("/v1/conversations", json={"fileName": name, "contentType": ctype, "sizeBytes": len(data)}, headers=AUTH)
    assert res.status_code == 201, res.text
    body = res.json()
    path = body["signedUploadUrl"].split("/upload/")[1]
    storage.blobs[path] = data
    res = client.post(f"/v1/conversations/{body['conversationId']}/upload-complete", headers=AUTH)
    assert res.status_code == 200, res.text
    return body["conversationId"]


def finish_parse(db, cid: str, plan=None) -> None:
    """What the worker does on success (see plan_parsing_worker parser_service._notify_ready)."""
    plan = plan or load_plan()
    db.collection("projects").document(cid).update({"floorPlan": plan, "floorPlanVersion": 1, "status": "completed"})
    db.collection("conversations").document(cid).collection("messages").document().set(
        {"role": "system", "kind": "plan_ready", "text": "", "payload": {"stats": {"rooms": 4}}, "status": "done", "createdAt": SERVER_TIMESTAMP}
    )
    db.collection("conversations").document(cid).update({"stage": "reviewing_plan", "busy": False, "busyReason": None})


def to_reviewing(client, db, storage, worker_calls) -> str:
    cid = create_and_upload(client, storage)
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_crop", "args": {"crop": {"x": 10, "y": 10, "width": 300, "height": 200}}}, headers=AUTH)
    assert res.status_code == 200, res.text
    finish_parse(db, cid)
    return cid


def to_scene(client, db, storage, worker_calls, style="Japandi") -> str:
    cid = to_reviewing(client, db, storage, worker_calls)
    assert client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_plan"}, headers=AUTH).status_code == 200
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "select_style", "args": {"style": style}}, headers=AUTH)
    assert res.status_code == 200, res.text
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "continue"}, headers=AUTH)
    assert res.status_code == 200, res.text
    assert db.doc(f"conversations/{cid}")["stage"] == "scene_ready"
    return cid


__all__ = ["create_and_upload", "finish_parse", "to_reviewing", "to_scene", "USER_UID"]
