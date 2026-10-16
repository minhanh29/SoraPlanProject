import pytest

from app.config import get_settings


@pytest.fixture
def prod_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "TASKS_INVOKER_SA", "soraplan-tasks-invoker@soraplan.iam.gserviceaccount.com")
    monkeypatch.setattr(s, "API_PUBLIC_URL", "https://api.example.run.app")
    return s


def test_poll_requires_a_token(client, prod_settings):
    res = client.post("/internal/assets/abc/poll", json={"attempt": 0})
    assert res.status_code == 401


def test_poll_rejects_invalid_token(client, prod_settings, monkeypatch):
    def bad(*a, **k):
        raise ValueError("bad signature")

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", bad)
    res = client.post("/internal/assets/abc/poll", json={"attempt": 0}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 401


def test_poll_rejects_other_service_accounts(client, prod_settings, monkeypatch):
    seen = {}

    def verify(token, request, audience):
        seen["audience"] = audience
        return {"email": "someone@else.iam.gserviceaccount.com", "email_verified": True}

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", verify)
    res = client.post("/internal/assets/abc/poll", json={"attempt": 0}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 403
    assert seen["audience"] == "https://api.example.run.app"


def test_poll_accepts_the_tasks_invoker(client, prod_settings, monkeypatch):
    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token",
                        lambda t, r, audience: {"email": prod_settings.TASKS_INVOKER_SA, "email_verified": True})
    res = client.post("/internal/assets/unknown/poll", json={"attempt": 0}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 200 and res.json() == {"running": False}


def test_internal_disabled_in_production_without_config(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ENV", "production")
    monkeypatch.setattr(s, "TASKS_INVOKER_SA", None)
    res = client.post("/internal/assets/abc/poll", json={"attempt": 0})
    assert res.status_code == 403
