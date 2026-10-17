import base64
import json

from app.services.gemini_client import GeminiError
from app.services.tour_planner import build_parts, validate

from .conftest import AUTH, USER_UID

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0fakejpeg").decode()


def _req(**kw):
    req = {
        "title": "Test home",
        "style": "Industrial",
        "rooms": [
            {"id": "r_liv", "name": "Living Room", "type": "living", "area": 21, "items": ["Sofa", "Coffee table"], "connectsTo": ["r_kit"]},
            {"id": "r_kit", "name": "Kitchen", "type": "kitchen", "area": 18, "items": ["Fridge"], "connectsTo": ["r_liv"]},
        ],
        "candidates": [
            {"id": "r_liv#1", "roomId": "r_liv", "description": "sofa in view", "score": 3.2, "image": JPEG},
            {"id": "r_liv#2", "roomId": "r_liv", "description": "other angle", "score": 3.0, "image": JPEG},
            {"id": "r_liv#3", "roomId": "r_liv", "description": "third", "score": 2.0},
            {"id": "r_kit#1", "roomId": "r_kit", "description": "counter", "score": 2.5, "image": f"data:image/jpeg;base64,{JPEG}"},
        ],
    }
    req.update(kw)
    return req


def _project(fake_db, owner=USER_UID):
    fake_db.collection("projects").document("p1").set({"id": "p1", "ownerUid": owner, "name": "Test home"})


def test_validate_keeps_known_shots_clamps_and_caps():
    raw = {"shots": [
        {"candidateId": "r_kit#1", "move": "slide_left", "duration": 12, "reason": "nice counter"},
        {"candidateId": "nope", "move": "dolly_in", "duration": 5},  # unknown id
        {"candidateId": "r_liv#1", "move": "spin", "duration": 1},  # bad move, too short
        {"candidateId": "r_liv#1", "move": "dolly_in", "duration": 5},  # duplicate
        {"candidateId": "r_liv#2", "move": "pan_left", "duration": "5"},
        {"candidateId": "r_liv#3", "move": "drift", "duration": 5},  # third shot of one room
        "garbage",
    ]}
    shots = validate(raw, _req())
    assert [s["candidateId"] for s in shots] == ["r_kit#1", "r_liv#1", "r_liv#2"]
    assert shots[0]["duration"] == 7.0 and shots[0]["move"] == "slide_left"
    assert shots[1]["duration"] == 3.5 and shots[1]["move"] == "drift"
    assert validate({"shots": "x"}, _req()) == [] and validate(None, _req()) == []


def test_prompt_interleaves_descriptions_and_images():
    parts = build_parts(_req())
    text = "\n".join(p for p in parts if isinstance(p, str))
    assert "Living Room" in text and "doors to Kitchen" in text and "Candidate r_kit#1" in text
    images = [p for p in parts if isinstance(p, tuple)]
    assert len(images) == 3 and all(m == "image/jpeg" and b.startswith(b"\xff\xd8") for b, m in images)


def test_plan_endpoint_returns_validated_choice(client, fake_db, fake_gemini):
    _project(fake_db)
    fake_gemini.tour_reply = json.dumps({"shots": [
        {"candidateId": "r_liv#1", "move": "dolly_in", "duration": 5, "reason": "best"},
        {"candidateId": "r_kit#1", "move": "slide_right", "duration": 4},
    ]})
    res = client.post("/v1/projects/p1/tour/plan", json=_req(), headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "gemini"
    assert [s["candidateId"] for s in body["shots"]] == ["r_liv#1", "r_kit#1"]
    sent = fake_gemini.calls[-1]["tour_parts"]
    assert sum(isinstance(p, tuple) for p in sent) == 3


def test_plan_endpoint_502_when_gemini_fails_or_returns_nothing(client, fake_db, fake_gemini):
    _project(fake_db)
    fake_gemini.tour_error = GeminiError("unavailable")
    assert client.post("/v1/projects/p1/tour/plan", json=_req(), headers=AUTH).status_code == 502
    fake_gemini.tour_error = None
    fake_gemini.tour_reply = "not json"
    assert client.post("/v1/projects/p1/tour/plan", json=_req(), headers=AUTH).status_code == 502
    fake_gemini.tour_reply = '{"shots": [{"candidateId": "unknown"}]}'
    assert client.post("/v1/projects/p1/tour/plan", json=_req(), headers=AUTH).status_code == 502


def test_plan_endpoint_checks_owner_and_input(client, fake_db):
    _project(fake_db, owner="someone_else")
    assert client.post("/v1/projects/p1/tour/plan", json=_req(), headers=AUTH).status_code == 403
    _project(fake_db)
    bad = _req(candidates=[{"id": "x", "roomId": "r_liv", "image": "%%%notbase64"}])
    assert client.post("/v1/projects/p1/tour/plan", json=bad, headers=AUTH).status_code == 400
    assert client.post("/v1/projects/p1/tour/plan", json=_req(candidates=[]), headers=AUTH).status_code == 422
