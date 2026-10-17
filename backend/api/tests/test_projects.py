import datetime

from .conftest import AUTH, USER_UID
from .flow import create_and_upload, to_reviewing


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


def test_project_quota(client, fake_db, fake_storage):
    for _ in range(5):
        create_and_upload(client, fake_storage)
    res = client.post("/v1/conversations", json={"fileName": "x.png", "contentType": "image/png", "sizeBytes": 10}, headers=AUTH)
    assert res.status_code == 429 and res.json()["code"] == "QUOTA_EXCEEDED"


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
