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


def test_thumbnail_is_small_webp_and_keeps_alpha():
    import io
    from PIL import Image
    from app.services.thumbnail import make_thumbnail

    src = Image.new("RGBA", (2000, 1000), (0, 0, 0, 0))
    src.paste((200, 100, 50, 255), (500, 250, 1500, 750))
    buf = io.BytesIO()
    src.save(buf, format="PNG")
    thumb = Image.open(io.BytesIO(make_thumbnail(buf.getvalue())))
    assert thumb.format == "WEBP" and thumb.size == (512, 256) and thumb.mode == "RGBA"
    assert thumb.getpixel((0, 0))[3] == 0 and thumb.getpixel((256, 128))[3] == 255

    jpeg = io.BytesIO()
    Image.new("RGB", (300, 400), "white").save(jpeg, format="JPEG")
    thumb = Image.open(io.BytesIO(make_thumbnail(jpeg.getvalue())))
    assert thumb.size == (300, 400) and thumb.mode == "RGB"  # never upscaled


def test_upload_starts_meshy_and_poll_finalizes(client, fake_db, fake_storage, fake_meshy, monkeypatch):
    asset = upload(client, fake_storage)
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["ownerUid"] == USER_UID and doc["isSystem"] is False
    assert doc["status"] == "generating_3d" and doc["meshyTaskId"] == "task_1"
    assert fake_meshy.created[0].startswith("data:image/jpeg;base64,")
    assert "links" not in asset and "meshyTaskId" not in asset  # internal fields hidden
    assert doc["thumbPath"] == f"{USER_UID}/assets/{asset['id']}/thumb.webp"
    assert fake_storage.blobs[doc["thumbPath"]][8:12] == b"WEBP" and asset["thumbUrl"].startswith("https://signed.example/")

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
    assert all(a["description"] for a in system)
    upload(client, fake_storage)
    mine = client.get("/v1/assets?scope=mine", headers=AUTH).json()
    assert [a["name"] for a in mine] == ["My sofa"]


def test_asset_descriptions_are_saved_edited_and_validated(client, fake_db, fake_storage):
    description = "L-shaped kitchen counter with sink, stove and fridge already included."
    asset = upload(client, fake_storage, description=f"  {description}  ", category="Kitchen Counter")
    assert asset["description"] == description
    assert fake_db.doc(f"assets/{asset['id']}")["description"] == description
    response = client.patch(f"/v1/assets/{asset['id']}", json={"description": "Straight counter, sink only."}, headers=AUTH)
    assert response.status_code == 200 and response.json()["description"] == "Straight counter, sink only."
    assert client.get("/v1/assets?scope=mine", headers=AUTH).json()[0]["description"] == "Straight counter, sink only."
    assert client.patch(f"/v1/assets/{asset['id']}", json={"description": "x" * 2001}, headers=AUTH).status_code == 422
    response = client.patch(f"/v1/assets/{asset['id']}", json={"description": ""}, headers=AUTH)
    assert response.status_code == 200 and response.json()["description"] == ""


def test_seeded_system_descriptions_fall_back_and_respect_admin_edits(admin_client, fake_db):
    from app.services.common import load_system_catalog

    preset = load_system_catalog()[0]
    fake_db.collection("assets").document(preset["id"]).set({"isSystem": True, "name": preset["name"]})
    assert admin_client.get("/v1/assets?scope=system", headers=AUTH).json()[0]["description"] == preset["description"]
    response = admin_client.patch(f"/v1/assets/{preset['id']}", json={"description": "Custom complete model."}, headers=AUTH)
    assert response.status_code == 200
    assert admin_client.get("/v1/assets?scope=system", headers=AUTH).json()[0]["description"] == "Custom complete model."


def test_upload_composite_groups_parts_and_replacement_releases_them(
    client, fake_db, fake_storage, fake_gemini, fake_meshy, worker_calls, monkeypatch,
):
    from app.services.asset_mapper import map_plan
    from .test_asset_matching import group_reply, kitchen_plan

    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    plan = kitchen_plan()
    mapping, missing = map_plan(plan, "Japandi", [])
    fake_db.docs[f"projects/{cid}"].update({"floorPlan": plan, "mapping": mapping, "missing": missing, "style": "Japandi"})
    fake_db.docs[f"conversations/{cid}"]["stage"] = "resolving_missing"
    fake_gemini.match_assets = group_reply
    asset = upload(client, fake_storage, name="My complete kitchen", category="Kitchen Counter",
                   description="L-shaped kitchen counter with sink, stove and fridge already included.",
                   projectId=cid, componentId="run1")
    project = fake_db.doc(f"projects/{cid}")
    assert project["mapping"]["sink"]["includedIn"] == "run1"
    assert project["mapping"]["run1"]["assetId"] == asset["id"]
    assert [m["componentId"] for m in project["missing"]] == ["separate"]
    assert client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "sink", "restore": True}, headers=AUTH).status_code == 409

    # Replacing with a standalone model restores independent symbols to the missing list.
    fake_db.collection("assets").document("standalone").set({"id": "standalone", "isSystem": True, "name": "Counter",
        "category": "Kitchen Counter", "style": "Japandi", "description": "", "status": "ready", "dims": None})
    response = client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "run1", "assetId": "standalone"}, headers=AUTH)
    assert response.status_code == 200, response.text
    assert "includedIn" not in response.json()["mapping"]["sink"]
    assert "placementBox" not in response.json()["mapping"]["run1"]
    assert "sink" in {m["componentId"] for m in fake_db.doc(f"projects/{cid}")["missing"]}

    # Selecting the user's complete asset again groups the same parts through the mapping API.
    response = client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "run1", "assetId": asset["id"]}, headers=AUTH)
    assert response.status_code == 200, response.text
    assert response.json()["mapping"]["sink"]["includedIn"] == "run1"
    response = client.post(f"/v1/conversations/{cid}/actions", json={"type": "continue"}, headers=AUTH)
    assert response.status_code == 200, response.text
    items = fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"]
    assert len(items) == 1 and items[0]["assetId"] == asset["id"]
    assert items[0]["position"] == [2.5, 0, 2.8]
    # Completion refits the one placeholder to the merged footprint, rather than its first straight run.
    class Response:
        content = glb()

        def raise_for_status(self):
            pass

    monkeypatch.setattr("app.services.asset_service.requests.get", lambda url, timeout: Response())
    fake_meshy.status["task_1"] = {"status": "SUCCEEDED", "model_urls": {"glb": "https://meshy/x.glb"}}
    assert client.post(f"/internal/assets/{asset['id']}/poll", json={"attempt": 1}).json() == {"running": False}
    items = fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"]
    assert len(items) == 1 and items[0]["position"] == [2.5, 0, 2.8]
    assert items[0]["dims"] == fake_db.doc(f"projects/{cid}")["mapping"]["run1"]["autoDims"]


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
    # moved, not copied: the private originals are gone
    assert "x/model.glb" not in fake_storage.blobs and not [k for k in fake_storage.blobs if f"/assets/{asset['id']}/" in k]
    assert f"assets/Japandi/user_{asset['id']}.glb" in fake_storage.catalog
    assert doc["thumbUrl"] == f"https://storage.googleapis.com/soraplan-catalog/assets-web/Japandi/user_{asset['id']}_thumb.webp"

    # demoting moves the files back into the owner's private folder
    res = admin_client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": False}, headers=AUTH)
    assert res.status_code == 200, res.text
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["isSystem"] is False and doc["glbPath"].endswith(f"/assets/{asset['id']}/model.glb")
    assert doc["glbPath"] in fake_storage.blobs and doc["imagePath"] in fake_storage.blobs and doc["thumbPath"] in fake_storage.blobs
    assert doc["glbUrl"].startswith("https://signed.example/")
    assert not fake_storage.catalog


def test_legacy_system_asset_in_private_bucket_moves_on_save(admin_client, fake_db, fake_storage):
    asset = upload(admin_client, fake_storage)
    fake_db.docs[f"assets/{asset['id']}"].update({"status": "ready", "glbPath": "x/model.glb", "isSystem": True})
    fake_storage.blobs["x/model.glb"] = b"glTF"
    res = admin_client.patch(f"/v1/assets/{asset['id']}", json={"isSystem": True, "style": "Industrial", "category": "Sofa"}, headers=AUTH)
    assert res.status_code == 200, res.text
    doc = fake_db.doc(f"assets/{asset['id']}")
    assert doc["glbPath"] == f"assets/Industrial/user_{asset['id']}.glb" and "x/model.glb" not in fake_storage.blobs


@pytest.mark.parametrize("ctype", ["image/gif", "application/pdf"])
def test_photo_types(client, ctype):
    res = client.post("/v1/assets/upload-url", json={"fileName": "x", "contentType": ctype, "sizeBytes": 1}, headers=AUTH)
    assert res.status_code == 400
