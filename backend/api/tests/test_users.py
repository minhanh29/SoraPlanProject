from unittest.mock import MagicMock, patch


def test_get_current_user_profile(client):
    response = client.get(
        "/v1/users/me",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "usr_test123"
    assert data["email"] == "test@soraplan.com"
    assert data["displayName"] == "Test User"


def test_update_current_user_profile(client):
    with patch("app.services.user_service.get_auth") as mock_get_auth:
        mock_auth = MagicMock()
        mock_get_auth.return_value = mock_auth

        response = client.patch(
            "/v1/users/me",
            json={
                "displayName": "Updated Name",
                "photoUrl": "https://example.com/new_photo.png",
            },
            headers={"Authorization": "Bearer valid_token"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["displayName"] == "Updated Name"
        assert data["photoUrl"] == "https://example.com/new_photo.png"

        # Verify that profile update was synced with Firebase Auth
        mock_auth.update_user.assert_called_once_with(
            "usr_test123",
            display_name="Updated Name",
            photo_url="https://example.com/new_photo.png",
        )


def test_get_current_user_quota(client):
    response = client.get(
        "/v1/users/me/quota",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "usr_test123"
    assert data["plan"] == "free"
    assert data["quota"]["projects"] == 5
    assert data["quota"]["rendersFinal"] == 20
    assert data["quota"]["rendersDraft"] == 100
    assert data["quota"]["assets3d"] == 10
    assert data["quota"]["planParses"] == 20


def test_get_user_by_uid(client):
    response = client.get(
        "/v1/users/usr_test123",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "usr_test123"
    assert data["role"] == "user"


def test_admin_user_profile(admin_client):
    response = admin_client.get(
        "/v1/users/me",
        headers={"Authorization": "Bearer admin_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "tPST7GIKXTQaTiBOQH4hl7zIHxS2"
    assert data["role"] == "admin"


def test_get_admin_user_by_uid(client):
    response = client.get(
        "/v1/users/tPST7GIKXTQaTiBOQH4hl7zIHxS2",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "tPST7GIKXTQaTiBOQH4hl7zIHxS2"
    assert data["role"] == "admin"

