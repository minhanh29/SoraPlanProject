import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.errors import AppException
from app.services import storage_service
from app.services.storage_service import StorageService

from .conftest import AUTH


def service(credentials):
    blob = Mock()
    blob.generate_signed_url.return_value = "https://storage.example/upload?X-Goog-Signature=signed"
    client = Mock()
    client._credentials = credentials
    client.bucket.return_value.blob.return_value = blob
    storage = StorageService(client=client, bucket_name="private-uploads")
    return storage, blob


def test_private_key_credentials_sign_directly(monkeypatch):
    storage, blob = service(SimpleNamespace(sign_bytes=lambda value: value))
    signing = Mock(side_effect=AssertionError("IAM should not be called for a private key"))
    monkeypatch.setattr(storage_service, "_iam_signing_kwargs", signing)
    result = storage.generate_signed_upload_url("user/plan.png", "image/png")
    assert "X-Goog-Signature=" in result
    blob.generate_signed_url.assert_called_once_with(version="v4", expiration=datetime.timedelta(seconds=900), method="PUT", content_type="image/png")
    signing.assert_not_called()


def test_local_user_adc_signs_as_configured_account(monkeypatch):
    credentials = SimpleNamespace(valid=True, token="test-access-token")
    monkeypatch.setattr(storage_service, "_iam_credentials", credentials)
    storage, blob = service(credentials)
    storage.settings = SimpleNamespace(GCS_SIGNING_SERVICE_ACCOUNT="signer@example.iam.gserviceaccount.com")
    storage.generate_signed_upload_url("user/plan.png", "image/png")
    args = blob.generate_signed_url.call_args.kwargs
    assert args["service_account_email"] == "signer@example.iam.gserviceaccount.com"
    assert args["access_token"] == "test-access-token"
    assert args["content_type"] == "image/png"


def test_runtime_identity_can_sign_without_local_override(monkeypatch):
    credentials = SimpleNamespace(valid=True, token="test-access-token", service_account_email="runtime@example.iam.gserviceaccount.com")
    monkeypatch.setattr(storage_service, "_iam_credentials", credentials)
    assert storage_service._iam_signing_kwargs()["service_account_email"] == credentials.service_account_email


def test_user_adc_without_signer_explains_the_configuration(monkeypatch):
    monkeypatch.setattr(storage_service, "_iam_credentials", SimpleNamespace(valid=True, token="test-access-token"))
    with pytest.raises(RuntimeError, match="GCS_SIGNING_SERVICE_ACCOUNT"):
        storage_service._iam_signing_kwargs()


@pytest.mark.parametrize("environment", ["development", "testing", "production"])
def test_upload_signing_never_returns_an_unsigned_private_bucket_url(environment):
    storage, blob = service(SimpleNamespace(sign_bytes=lambda value: value))
    storage.settings = SimpleNamespace(ENV=environment)
    blob.generate_signed_url.side_effect = RuntimeError("signing unavailable")
    with pytest.raises(AppException) as error:
        storage.generate_signed_upload_url("user/plan.png", "image/png")
    assert error.value.status_code == 503
    assert error.value.code == "UPLOAD_SIGNING_UNAVAILABLE"


def test_failed_signing_does_not_leave_an_empty_project(client, fake_db, fake_storage, monkeypatch):
    before = set(fake_db.docs)

    def fail(*args, **kwargs):
        raise AppException(status_code=503, code="UPLOAD_SIGNING_UNAVAILABLE", detail="File uploads are temporarily unavailable.")

    monkeypatch.setattr(fake_storage, "generate_signed_upload_url", fail)
    response = client.post("/v1/conversations", json={"fileName": "plan.png", "contentType": "image/png", "sizeBytes": 100}, headers=AUTH)
    assert response.status_code == 503
    assert response.json()["code"] == "UPLOAD_SIGNING_UNAVAILABLE"
    assert set(fake_db.docs) == before
