from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from firebase_admin import auth as fb_auth

from app.errors import ConflictException


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "api_user"


def test_signup_validation_error(client):
    # Password too short (< 6 characters)
    response = client.post(
        "/v1/auth/signup",
        json={"email": "invalid@test.com", "password": "123"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "VALIDATION_ERROR"
    assert "password" in data["detail"]


@patch("app.services.auth_service.get_auth")
def test_signup_email_already_exists(mock_get_auth, client):
    mock_auth = MagicMock()
    mock_get_auth.return_value = mock_auth

    # Mock user already exists in Firebase Auth
    mock_auth.get_user_by_email.return_value = MagicMock(uid="existing_123")

    response = client.post(
        "/v1/auth/signup",
        json={"email": "existing@soraplan.com", "password": "securepassword123"},
    )
    assert response.status_code == 409
    data = response.json()
    assert data["code"] == "EMAIL_EXISTS"
    assert "already exists" in data["detail"]


@patch("app.services.auth_service.get_auth")
def test_signup_success(mock_get_auth, client, mock_firestore):
    mock_auth = MagicMock()
    mock_get_auth.return_value = mock_auth

    # Email does not exist
    mock_auth.get_user_by_email.side_effect = fb_auth.UserNotFoundError("User not found")
    mock_auth.create_user.return_value = MagicMock(uid="new_usr_999")

    # Mock _sign_in_with_password
    with patch.object(
        client.app.dependency_overrides.get(type(None), MagicMock),
        "",
        create=True,
    ):
        with patch(
            "app.services.auth_service.AuthService._sign_in_with_password",
            new_callable=AsyncMock,
        ) as mock_sign_in:
            mock_sign_in.return_value = {
                "idToken": "fake_id_token_123",
                "refreshToken": "fake_refresh_token_123",
                "expiresIn": "3600",
                "localId": "new_usr_999",
            }

            response = client.post(
                "/v1/auth/signup",
                json={
                    "email": "newuser@soraplan.com",
                    "password": "strongPassword123!",
                    "displayName": "New Architect",
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["idToken"] == "fake_id_token_123"
            assert data["refreshToken"] == "fake_refresh_token_123"
            assert data["expiresIn"] == 3600
            assert data["user"]["uid"] == "new_usr_999"
            assert data["user"]["email"] == "newuser@soraplan.com"
            assert data["user"]["plan"] == "free"
            assert data["user"]["quota"]["projects"] == 5


def test_login_success(client):
    with patch(
        "app.services.auth_service.AuthService._sign_in_with_password",
        new_callable=AsyncMock,
    ) as mock_sign_in:
        mock_sign_in.return_value = {
            "idToken": "login_id_token",
            "refreshToken": "login_refresh_token",
            "expiresIn": "3600",
            "localId": "usr_test123",
            "displayName": "Test User",
            "emailVerified": True,
        }

        response = client.post(
            "/v1/auth/login",
            json={"email": "test@soraplan.com", "password": "validPassword123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["idToken"] == "login_id_token"
        assert data["refreshToken"] == "login_refresh_token"
        assert data["user"]["uid"] == "usr_test123"


def test_login_invalid_credentials(client):
    with patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.json.return_value = {
            "error": {
                "message": "INVALID_LOGIN_CREDENTIALS",
                "code": 400,
            }
        }
        mock_post.return_value = mock_response

        response = client.post(
            "/v1/auth/login",
            json={"email": "wrong@soraplan.com", "password": "wrongPassword"},
        )

        assert response.status_code == 401
        data = response.json()
        assert data["code"] == "INVALID_CREDENTIALS"
        assert "Invalid email or password" in data["detail"]


@patch("app.services.auth_service.get_auth")
def test_google_auth(mock_get_auth, client):
    mock_auth = MagicMock()
    mock_get_auth.return_value = mock_auth

    mock_auth.verify_id_token.return_value = {
        "uid": "google_usr_456",
        "email": "google.user@gmail.com",
        "name": "Google User",
        "picture": "https://lh3.googleusercontent.com/photo.jpg",
        "email_verified": True,
    }

    response = client.post(
        "/v1/auth/google",
        json={"idToken": "google_id_token_xyz"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["idToken"] == "google_id_token_xyz"
    assert data["user"]["uid"] == "google_usr_456"
    assert data["user"]["email"] == "google.user@gmail.com"


def test_refresh_token_success(client):
    with patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id_token": "new_refreshed_id_token",
            "refresh_token": "new_refresh_token",
            "expires_in": "3600",
        }
        mock_post.return_value = mock_response

        response = client.post(
            "/v1/auth/refresh",
            json={"refreshToken": "old_refresh_token"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["idToken"] == "new_refreshed_id_token"
        assert data["refreshToken"] == "new_refresh_token"


def test_get_me_authenticated(client):
    response = client.get(
        "/v1/auth/me",
        headers={"Authorization": "Bearer mock_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "usr_test123"
    assert data["email"] == "test@soraplan.com"
    assert data["plan"] == "free"
    assert "quota" in data


@patch("app.services.auth_service.get_auth")
def test_logout_success(mock_get_auth, client):
    mock_auth = MagicMock()
    mock_get_auth.return_value = mock_auth

    response = client.post(
        "/v1/auth/logout",
        headers={"Authorization": "Bearer mock_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    mock_auth.revoke_refresh_tokens.assert_called_once_with("usr_test123")
