"""Sample projects copied into new accounts (POST /v1/users/me/samples)."""
import pytest

from app.deps import get_current_token_payload, get_current_user, get_sample_service
from app.main import app
from app.services.sample_service import SampleService

from .conftest import ADMIN_UID, AUTH, USER_UID, _profile
from .flow import to_scene
from .test_assets import upload


@pytest.fixture
def sample(admin_client, fake_db, fake_storage, worker_calls):
    """A finished project of the admin: scene, chat, parse job, thumbnail and a private 3D model in the scene."""
    src = to_scene(admin_client, fake_db, fake_storage, worker_calls)
    asset = upload(admin_client, fake_storage)
    fake_db.docs[f"assets/{asset['id']}"].update({
        "status": "ready", "glbPath": f"{ADMIN_UID}/assets/{asset['id']}/model.glb",
        "links": [{"projectId": src, "componentId": "fur_001"}, {"projectId": "other", "componentId": "x"}],
    })
    fake_storage.blobs[f"{ADMIN_UID}/assets/{asset['id']}/model.glb"] = b"glTF"
    scene = fake_db.docs[f"scenes/{src}"]
    scene["graph"]["levels"][0]["items"][0]["assetId"] = asset["id"]
    fake_db.collection("scenes").document(src).collection("ops").document("b1").set({"label": "Moved Sofa"})
    thumb = f"{ADMIN_UID}/{src}/home-1.jpg"
    fake_storage.blobs[thumb] = b"jpg"
    fake_db.docs[f"projects/{src}"]["thumbnailPath"] = thumb
    fake_db.collection("jobs").document("job1").set({"id": "job1", "projectId": src, "ownerUid": ADMIN_UID,
                                                     "input": {"signedUrl": "https://old", "gcsPath": f"{ADMIN_UID}/{src}/plan_1.png"}})
    app.dependency_overrides[get_sample_service] = lambda: SampleService(fake_db, fake_storage, [src, "missing_project"])
    # admin_client and client share app.dependency_overrides: requests from here on are the regular user's again
    user = _profile(USER_UID, "user")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_token_payload] = lambda: {"uid": user.uid, "email": user.email}
    return {"id": src, "asset": asset["id"]}


def _pending(fake_db):
    fake_db.docs[f"users/{USER_UID}"]["samples"] = "pending"


def _everything_of(fake_db, uid):
    return [p for p, d in fake_db.docs.items() if isinstance(d, dict) and d.get("ownerUid") == uid]


def test_new_user_doc_starts_pending(fake_db):
    from app.services.user_service import UserService

    UserService(db=fake_db).create_user_profile(uid="new_user", email="n@x.com")
    assert fake_db.doc("users/new_user")["samples"] == "pending"


def test_copies_the_whole_project_as_the_users_own(client, fake_db, fake_storage, sample):
    _pending(fake_db)
    res = client.post("/v1/users/me/samples", headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "done" and len(body["projectIds"]) == 1  # the missing sample is skipped
    new = body["projectIds"][0]
    assert new != sample["id"]

    project = fake_db.doc(f"projects/{new}")
    assert project["ownerUid"] == USER_UID and project["id"] == new and project["sampleOf"] == sample["id"]
    assert project["planImageOriginal"]["storagePath"].startswith(f"{USER_UID}/{new}/")
    assert project["planImageOriginal"]["storagePath"] in fake_storage.blobs
    assert project["thumbnailPath"] == f"{USER_UID}/{new}/home-1.jpg" and project["thumbnailPath"] in fake_storage.blobs

    conv = fake_db.doc(f"conversations/{new}")
    assert conv["ownerUid"] == USER_UID and conv["stage"] == "scene_ready" and conv["busy"] is False
    assert conv["thumbnailUrl"].startswith(f"https://signed.example/{USER_UID}/{new}/home-1.jpg")
    assert len(fake_db.messages(new)) == len(fake_db.messages(sample["id"])) > 0

    scene = fake_db.doc(f"scenes/{new}")
    assert scene["ownerUid"] == USER_UID and scene["graph"]["projectId"] == new
    assert fake_db.doc(f"scenes/{new}/ops/b1") == {"label": "Moved Sofa"}

    # the private model is copied too and the scene / links point at the copy
    new_asset = scene["graph"]["levels"][0]["items"][0]["assetId"]
    asset = fake_db.doc(f"assets/{new_asset}")
    assert new_asset != sample["asset"] and asset["ownerUid"] == USER_UID
    assert asset["glbPath"] == f"{USER_UID}/assets/{new_asset}/model.glb" and asset["glbPath"] in fake_storage.blobs
    assert asset["glbUrl"].startswith(f"https://signed.example/{USER_UID}/")
    assert asset["links"] == [{"projectId": new, "componentId": "fur_001"}]

    job = next(d for p, d in fake_db.docs.items() if p.startswith("jobs/") and d.get("projectId") == new)
    assert job["ownerUid"] == USER_UID and job["input"]["signedUrl"] is None
    assert job["input"]["gcsPath"] == f"{USER_UID}/{new}/plan_1.png"

    # nothing the user now owns still names the sample author, and the original is untouched
    for path in _everything_of(fake_db, USER_UID):
        doc = {k: v for k, v in fake_db.docs[path].items() if k != "sampleOf"}  # the one intended back-reference
        assert ADMIN_UID not in repr(doc) and sample["id"] not in repr(doc), path
    assert fake_db.doc(f"projects/{sample['id']}")["ownerUid"] == ADMIN_UID
    assert fake_db.doc(f"users/{USER_UID}")["samples"] == "done"
    app.dependency_overrides.pop(get_sample_service, None)


def test_runs_once_and_never_for_existing_accounts(client, fake_db, fake_storage, sample):
    assert client.post("/v1/users/me/samples", headers=AUTH).json()["status"] == "none"  # account from before samples
    assert not [p for p in fake_db.docs if p.startswith("projects/") and fake_db.docs[p]["ownerUid"] == USER_UID]

    _pending(fake_db)
    first = client.post("/v1/users/me/samples", headers=AUTH).json()
    owned = sorted(_everything_of(fake_db, USER_UID))
    again = client.post("/v1/users/me/samples", headers=AUTH).json()
    assert again == first and sorted(_everything_of(fake_db, USER_UID)) == owned
    app.dependency_overrides.pop(get_sample_service, None)


def test_retry_after_a_failure_does_not_duplicate(client, fake_db, fake_storage, sample, monkeypatch):
    _pending(fake_db)
    real = SampleService._copy_asset

    def boom(*a, **k):
        raise RuntimeError("storage down")

    monkeypatch.setattr(SampleService, "_copy_asset", boom)
    assert client.post("/v1/users/me/samples", headers=AUTH).status_code == 500
    assert fake_db.doc(f"users/{USER_UID}")["samples"] == "pending"

    monkeypatch.setattr(SampleService, "_copy_asset", real)
    body = client.post("/v1/users/me/samples", headers=AUTH).json()
    assert body["status"] == "done"
    projects = [p for p in fake_db.docs if p.startswith("projects/") and "/" not in p[9:] and fake_db.docs[p]["ownerUid"] == USER_UID]
    assert projects == [f"projects/{body['projectIds'][0]}"]
    app.dependency_overrides.pop(get_sample_service, None)
