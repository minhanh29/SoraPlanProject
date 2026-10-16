from unittest.mock import MagicMock, patch
import pytest

try:
    from test_frontend_upload import (
        DEFAULT_SIGNED_URL,
        MINIMAL_JPEG_BYTES,
        parse_signed_url_info,
        upload_file_as_frontend,
    )
except ImportError:
    from backend.api.test_frontend_upload import (
        DEFAULT_SIGNED_URL,
        MINIMAL_JPEG_BYTES,
        parse_signed_url_info,
        upload_file_as_frontend,
    )


def test_parse_signed_url_info():
    """Verify that GCS V4 signed URL parameters are accurately parsed."""
    info = parse_signed_url_info(DEFAULT_SIGNED_URL)
    assert info["bucket"] == "soraplan-assest-dev"
    assert info["object_name"] == "projects/bP6qbDm3qTSkNfg0DPXgWCODZqN2/WAGyYunfsmcEiusN00ZP.jpg"
    assert info["signed_headers"] == "content-type;host"
    assert info["date_str"] == "20261003T161226Z"
    assert info["expires_sec"] == "900"
    assert info["is_expired"] is True


def test_upload_file_as_frontend_success():
    """Simulate successful HTTP PUT upload returning 200 OK."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.reason = "OK"
    mock_response.headers = {
        "ETag": '"test-etag-12345"',
        "x-goog-generation": "1791045892225364",
        "x-goog-stored-content-length": str(len(MINIMAL_JPEG_BYTES)),
    }
    mock_response.__enter__.return_value = mock_response

    with patch("urllib.request.urlopen", return_value=mock_response):
        result = upload_file_as_frontend(
            signed_url="https://storage.googleapis.com/test-bucket/test.jpg?signed=true",
            file_bytes=MINIMAL_JPEG_BYTES,
            content_type="image/jpeg",
        )

        assert result["success"] is True
        assert result["status_code"] == 200
        assert result["etag"] == '"test-etag-12345"'
        assert result["generation"] == "1791045892225364"
