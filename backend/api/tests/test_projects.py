import base64
import datetime

from .conftest import AUTH, USER_UID
from .flow import create_and_upload, to_reviewing, to_scene
from .helpers import png_bytes


def test_list_and_get_projects(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage)
    projects = client.get("/v1/projects", headers=AUTH).json()
    assert [p["id"] for p in projects] == [cid]
    res = client.get(f"/v1/projects/{cid}", headers=AUTH)
    assert res.status_code == 200 and res.json()["ownerUid"] == USER_UID


def test_get_missing_project(client):
    res = client.get("/v1/projects/nope", headers=AUTH)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


def test_get_plan(client, fake_db, fake_storage, worker_calls):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    res = client.get(f"/v1/projects/{cid}/plan", headers=AUTH)
    assert res.status_code == 200 and res.json()["units"] == "ft"


def test_no_project_limit(client, fake_db, fake_storage):
    for _ in range(6):
        create_and_upload(client, fake_storage)
    res = client.post("/v1/conversations", json={"fileName": "x.png", "contentType": "image/png", "sizeBytes": 10}, headers=AUTH)
    assert res.status_code < 300


def test_stale_parse_job_fails_and_resets_the_conversation(client, fake_db, fake_storage, worker_calls):
    cid = create_and_upload(client, fake_storage)
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_crop"}, headers=AUTH)
    job_id = fake_db.messages(cid)[-1]["payload"]["jobId"]
    fake_db.docs[f"jobs/{job_id}"]["updatedAt"] = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
    res = client.get(f"/v1/jobs/{job_id}", headers=AUTH)
    assert res.json()["status"] == "failed"
    conv = fake_db.doc(f"conversations/{cid}")
    assert conv["stage"] == "cropping" and conv["busy"] is False
    assert fake_db.messages(cid)[-1]["kind"] == "plan_failed"


def test_scene_thumbnail_is_a_generated_photo_of_the_home(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    assert fake_db.doc(f"conversations/{cid}")["thumbnailStale"] is True
    image = base64.b64encode(png_bytes(512, 512)).decode()
    res = client.post(f"/v1/projects/{cid}/thumbnail", json={"image": image}, headers=AUTH)
    assert res.status_code == 200, res.text
    conv = fake_db.doc(f"conversations/{cid}")
    assert conv["thumbnailKind"] == "scene" and conv["thumbnailStale"] is False
    assert conv["thumbnailUrl"] == res.json()["thumbnailUrl"]
    path = fake_db.doc(f"projects/{cid}")["thumbnailPath"]
    assert "/home-" in path and path in fake_storage.blobs
    call = next(c for c in fake_gemini.calls if "home_photo_prompt" in c)
    assert "Japandi" in call["home_photo_prompt"] and call["reference_bytes"] > 0


def test_scene_thumbnail_keeps_the_plan_when_generation_fails(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    fake_gemini.photo_error = RuntimeError("model down")
    image = base64.b64encode(png_bytes(512, 512)).decode()
    res = client.post(f"/v1/projects/{cid}/thumbnail", json={"image": image}, headers=AUTH)
    assert res.status_code == 502 and res.json()["code"] == "THUMBNAIL_FAILED"
    conv = fake_db.doc(f"conversations/{cid}")
    assert conv.get("thumbnailKind") != "scene" and conv["thumbnailStale"] is True


def test_scene_thumbnail_needs_a_built_scene(client, fake_db, fake_storage, worker_calls):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    image = base64.b64encode(png_bytes()).decode()
    res = client.post(f"/v1/projects/{cid}/thumbnail", json={"image": image}, headers=AUTH)
    assert res.status_code == 409 and res.json()["code"] == "SCENE_NOT_READY"


def test_scene_thumbnail_rejects_bad_data(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    res = client.post(f"/v1/projects/{cid}/thumbnail", json={"image": "not base64 at all!!"}, headers=AUTH)
    assert res.status_code == 400
