import json
import struct

import pytest

from .conftest import AUTH, USER_UID
from .flow import to_reviewing
from .helpers import png_bytes


def glb(minv=(-1, 0, -0.5), maxv=(1, 0.8, 0.5)) -> bytes:
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"mesh": 0, "scale": [2, 2, 2]}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
           "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3", "min": list(minv), "max": list(maxv)}]}
    js = json.dumps(doc).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    return struct.pack("<4sII", b"glTF", 2, 20 + len(js)) + struct.pack("<II", len(js), 0x4E4F534A) + js


def upload(client, storage, **confirm):
    res = client.post("/v1/assets/upload-url", json={"fileName": "sofa.jpg", "contentType": "image/jpeg", "sizeBytes": 100}, headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    storage.blobs[body["signedUploadUrl"].split("/upload/")[1]] = png_bytes(64, 64)
    body_confirm = {"name": "My sofa", "category": "Sofa", **confirm}
    res = client.post(f"/v1/assets/{body['assetId']}/confirm", json=body_confirm, headers=AUTH)
    assert res.status_code == 201, res.text
    return res.json()


def test_glb_dims_reads_accessors_and_node_scale():
    from app.services.glb import glb_dims

    assert glb_dims(glb()) == {"w": 4.0, "d": 2.0, "h": 1.6}
    assert glb_dims(b"not a glb") is None


def test_upload_starts_meshy_and_poll_finalizes(client, fake_db, fake_storage, fake_meshy, monkeypatch):
    asset = upload(client, fake_storage)
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["ownerUid"] == USER_UID and doc["isSystem"] is False
    assert doc["status"] == "generating_3d" and doc["meshyTaskId"] == "task_1"
    assert fake_meshy.created[0].startswith("data:image/jpeg;base64,")
    assert "links" not in asset and "meshyTaskId" not in asset  # internal fields hidden

    res = client.post(f"/internal/assets/{asset['id']}/poll", json={"attempt": 0})
    assert res.json() == {"running": True}

    class R:
        content = glb()

        def raise_for_status(self):
            pass

    monkeypatch.setattr("app.services.asset_service.requests.get", lambda url, timeout: R())
    fake_meshy.status["task_1"] = {"status": "SUCCEEDED", "progress": 100, "model_urls": {"glb": "https://meshy/x.glb"}}
    assert client.post(f"/internal/assets/{asset['id']}/poll", json={"attempt": 1}).json() == {"running": False}
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["status"] == "ready" and doc["progress"] == 100
    assert doc["dims"] == {"w": 4.0, "d": 2.0, "h": 1.6}
    assert doc["glbUrl"].startswith("https://signed.example/") and fake_storage.blobs[doc["glbPath"]][:4] == b"glTF"


def test_poll_gives_up_after_max_attempts(client, fake_db, fake_storage):
    asset = upload(client, fake_storage)
    client.post(f"/internal/assets/{asset['id']}/poll", json={"attempt": 999})
    assert fake_db.doc(f"assets/{asset['id']}")["status"] == "failed"


def test_upload_from_a_missing_box_fills_it(client, fake_db, fake_storage, worker_calls, fake_meshy, monkeypatch):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_plan"}, headers=AUTH)
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "select_style", "args": {"style": "Japandi"}}, headers=AUTH)
    asset = upload(client, fake_storage, name="Desk", category="Dining Table", projectId=cid, componentId="fur_008")
    project = fake_db.doc(f"projects/{cid}")
    assert project["mapping"]["fur_008"]["assetId"] == asset["id"]
    assert "fur_008" not in {m["componentId"] for m in project["missing"]}

    # continue to 3D while it is still generating: the item is a placeholder sized like the box
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "continue"}, headers=AUTH)
    item = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["componentId"] == "fur_008")
    assert item["assetId"] == asset["id"]

    class R:
        content = glb()

        def raise_for_status(self):
            pass

    monkeypatch.setattr("app.services.asset_service.requests.get", lambda url, timeout: R())
    fake_meshy.status["task_1"] = {"status": "SUCCEEDED", "model_urls": {"glb": "https://meshy/x.glb"}}
    client.post(f"/internal/assets/{asset['id']}/poll", json={"attempt": 3})
    entry = fake_db.doc(f"projects/{cid}")["mapping"]["fur_008"]
    assert entry["autoDims"] and entry["dims"] == entry["autoDims"]
    item = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["componentId"] == "fur_008")
    assert item["dims"] == entry["dims"]  # placeholder resized to the real model


def test_list_scopes(client, fake_db, fake_storage):
    system = client.get("/v1/assets?scope=system", headers=AUTH).json()
    assert len(system) == 41 and all(a["isSystem"] for a in system)  # bundled catalog when Firestore is empty
    assert system[0]["glbWebUrl"].startswith("https://storage.googleapis.com/soraplan-catalog/assets-web/")
    upload(client, fake_storage)
    mine = client.get("/v1/assets?scope=mine", headers=AUTH).json()
    assert [a["name"] for a in mine] == ["My sofa"]


def test_rename_and_delete_own_asset(client, fake_db, fake_storage):
    asset = upload(client, fake_storage)
    res = client.patch(f"/v1/assets/{asset['id']}", json={"name": "Grey sofa", "category": "Armchair"}, headers=AUTH)
    assert res.status_code == 200 and res.json()["name"] == "Grey sofa"
    assert client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": True}, headers=AUTH).status_code == 403
    assert client.delete(f"/v1/assets/{asset['id']}", headers=AUTH).status_code == 204
    assert fake_db.doc(f"assets/{asset['id']}") is None
    assert not [k for k in fake_storage.blobs if f"/assets/{asset['id']}/" in k]


def test_admin_promotion_requires_style_category_and_ready_model(admin_client, fake_db, fake_storage):
    asset = upload(admin_client, fake_storage)
    res = admin_client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": True}, headers=AUTH)
    assert res.status_code == 400 and res.json()["code"] == "STYLE_AND_CATEGORY_REQUIRED"
    res = admin_client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": True, "style": "Japandi", "category": "Sofa"}, headers=AUTH)
    assert res.status_code == 409  # not ready yet
    fake_db.docs[f"assets/{asset['id']}"].update({"status": "ready", "glbPath": "x/model.glb"})
    fake_storage.blobs["x/model.glb"] = b"glTF"
    res = admin_client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": True, "style": "Japandi", "category": "Sofa"}, headers=AUTH)
    assert res.status_code == 200, res.text
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["isSystem"] is True and doc["style"] == "Japandi"
    assert doc["glbUrl"] == f"https://storage.googleapis.com/soraplan-catalog/assets/Japandi/user_{asset['id']}.glb"


@pytest.mark.parametrize("ctype", ["image/gif", "application/pdf"])
def test_photo_types(client, ctype):
    res = client.post("/v1/assets/upload-url", json={"fileName": "x", "contentType": ctype, "sizeBytes": 1}, headers=AUTH)
    assert res.status_code == 400
