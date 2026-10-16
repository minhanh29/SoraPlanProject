import pytest
from unittest.mock import MagicMock


def test_create_project_success(client):
    """Test project creation with Google Cloud auto-generated ID."""
    response = client.post(
        "/v1/projects",
        json={"name": "Downtown Loft Redesign", "description": "3D renovation plan"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    # Google Cloud auto-ID is 20 alphanumeric characters
    assert len(data["id"]) == 20
    assert data["name"] == "Downtown Loft Redesign"
    assert data["description"] == "3D renovation plan"
    assert data["status"] == "created"
    assert data["hasPlan"] is False
    assert data["planImage"] is None
    assert data["ownerUid"] == "usr_test123"


def test_user_can_create_multiple_projects(client):
    """One user can create multiple projects."""
    p1 = client.post(
        "/v1/projects",
        json={"name": "Project Alpha"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    p2 = client.post(
        "/v1/projects",
        json={"name": "Project Beta"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()

    assert p1["id"] != p2["id"]

    list_res = client.get(
        "/v1/projects",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert list_res.status_code == 200
    projects = list_res.json()
    ids = [p["id"] for p in projects]
    assert p1["id"] in ids
    assert p2["id"] in ids


def test_create_project_quota_exceeded(client):
    """User cannot create more projects than their quota limit."""
    # Free tier default allows 5 projects
    # Create 5 projects (or check existing count)
    list_res = client.get("/v1/projects", headers={"Authorization": "Bearer valid_token"}).json()
    current_count = len(list_res)
    for i in range(current_count, 5):
        res = client.post(
            "/v1/projects",
            json={"name": f"Project {i + 1}"},
            headers={"Authorization": "Bearer valid_token"},
        )
        assert res.status_code == 201

    # 6th project must fail with 429
    excess_res = client.post(
        "/v1/projects",
        json={"name": "Excess Project"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert excess_res.status_code == 429
    assert excess_res.json()["code"] == "QUOTA_EXCEEDED"


def test_get_project_by_id(client):
    create_res = client.post(
        "/v1/projects",
        json={"name": "Studio Apt"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = create_res["id"]

    get_res = client.get(
        f"/v1/projects/{project_id}",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Studio Apt"


def test_get_nonexistent_project(client):
    res = client.get(
        "/v1/projects/nonexistent12345678",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


def test_upload_sketch_png_success(client):
    """Test uploading a PNG sketch via signed upload URL and confirm flow.
    
    Verifies:
    - Path matches: soraplan-assest-dev/projects/user_id/content uploaded
    - Storage and Firestore ID follows Google Cloud rules (20 chars)
    - Signed display URL is created for public display
    - Firestore is updated with the new upload
    """
    project = client.post(
        "/v1/projects",
        json={"name": "Living Room Sketch"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 1. Request signed upload URL
    url_res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "my_sketch.png", "contentType": "image/png", "sizeBytes": 1024},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res.status_code == 200
    url_data = url_res.json()
    upload_id = url_data["uploadId"]

    # ID used in both storage and Firestore must follow Google Cloud rules
    assert len(upload_id) == 20
    assert url_data["bucket"] == "soraplan-assest-dev"
    assert url_data["storagePath"] == f"usr_test123/{project_id}/{upload_id}.png"
    assert url_data["gcsUri"] == f"gs://soraplan-assest-dev/usr_test123/{project_id}/{upload_id}.png"
    assert "signedUploadUrl" in url_data
    assert "signedDisplayUrl" in url_data

    # 2. Confirm upload
    confirm_res = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "my_sketch.png",
            "contentType": "image/png",
            "sizeBytes": 1024,
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    data = confirm_res.json()

    assert data["hasPlan"] is True
    assert data["status"] == "uploaded"
    assert data["planImage"] is not None

    plan = data["planImage"]
    assert plan["id"] == upload_id
    assert plan["fileName"] == "my_sketch.png"
    assert plan["contentType"] == "image/png"
    assert plan["bucket"] == "soraplan-assest-dev"
    assert plan["storagePath"] == f"usr_test123/{project_id}/{upload_id}.png"

    # The url uploaded by user must be signed to be displayed publicly
    assert "signedUrl" in plan
    assert plan["signedUrl"].startswith("https://storage.googleapis.com/soraplan-assest-dev/")
    assert "X-Goog-Algorithm=GOOG4-RSA-SHA256" in plan["signedUrl"]


def test_upload_pdf_success(client):
    """Test uploading a PDF floor plan document."""
    project = client.post(
        "/v1/projects",
        json={"name": "Architectural PDF Export"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    url_res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "floorplan.pdf", "contentType": "application/pdf", "sizeBytes": 4096},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res.status_code == 200
    upload_id = url_res.json()["uploadId"]

    confirm_res = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "floorplan.pdf",
            "contentType": "application/pdf",
            "sizeBytes": 4096,
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    data = confirm_res.json()
    assert data["hasPlan"] is True
    assert data["planImage"]["contentType"] == "application/pdf"
    assert data["planImage"]["storagePath"] == f"usr_test123/{project_id}/{upload_id}.pdf"


def test_upload_screenshot_jpeg_success(client):
    """Test uploading a JPEG screenshot."""
    project = client.post(
        "/v1/projects",
        json={"name": "Tablet Screenshot Plan"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    url_res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "screenshot.jpg", "contentType": "image/jpeg", "sizeBytes": 2048},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res.status_code == 200
    upload_id = url_res.json()["uploadId"]

    confirm_res = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "screenshot.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": 2048,
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    data = confirm_res.json()
    assert data["hasPlan"] is True
    assert data["planImage"]["contentType"] == "image/jpeg"
    assert data["planImage"]["storagePath"] == f"usr_test123/{project_id}/{upload_id}.jpg"


def test_cannot_upload_twice_to_same_project(client):
    """Critical Requirement:
    One project uses only one sketch, pdf or screenshot. Once uploading successfully,
    user cannot turn back to do it again. If user want to upload another one,
    they must create a new project.
    """
    project = client.post(
        "/v1/projects",
        json={"name": "Single Plan Only Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 1. First upload succeeds
    url_res_1 = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "first_sketch.png", "contentType": "image/png"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res_1.status_code == 200
    upload_id_1 = url_res_1.json()["uploadId"]

    confirm_res_1 = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": upload_id_1,
            "fileName": "first_sketch.png",
            "contentType": "image/png",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res_1.status_code == 200

    # 2. Attempt to upload another file to the SAME project must be rejected with 409 Conflict
    url_res_2 = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "second_sketch.png", "contentType": "image/png"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res_2.status_code == 409
    error_data = url_res_2.json()
    assert error_data["code"] == "PLAN_ALREADY_UPLOADED"
    assert "Each project allows only one sketch" in error_data["detail"]
    assert "To upload another one, please create a new project" in error_data["detail"]

    # Confirming upload again on same project is also blocked
    confirm_res_2 = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": "anotherUploadId12345",
            "fileName": "second_sketch.png",
            "contentType": "image/png",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res_2.status_code == 409
    assert confirm_res_2.json()["code"] == "PLAN_ALREADY_UPLOADED"

    # 3. Create a NEW project -> Upload succeeds on the new project
    new_project = client.post(
        "/v1/projects",
        json={"name": "Second Project For Another Plan"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    new_project_id = new_project["id"]

    url_res_3 = client.post(
        f"/v1/projects/{new_project_id}/upload-url",
        json={"fileName": "second_sketch.png", "contentType": "image/png"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res_3.status_code == 200
    upload_id_3 = url_res_3.json()["uploadId"]

    confirm_res_3 = client.post(
        f"/v1/projects/{new_project_id}/confirm-upload",
        json={
            "uploadId": upload_id_3,
            "fileName": "second_sketch.png",
            "contentType": "image/png",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res_3.status_code == 200
    assert confirm_res_3.json()["hasPlan"] is True


def test_upload_unsupported_file_type(client):
    """Uploading files other than sketches, PDFs, or screenshots is rejected."""
    project = client.post(
        "/v1/projects",
        json={"name": "Type Test Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={
            "fileName": "document.docx",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "UNSUPPORTED_FILE_TYPE"


def test_upload_oversized_file(client):
    """Requesting upload for file exceeding size limit is rejected."""
    project = client.post(
        "/v1/projects",
        json={"name": "Oversized File Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 30MB exceeds default 25MB limit
    res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={
            "fileName": "huge_plan.png",
            "contentType": "image/png",
            "sizeBytes": 30 * 1024 * 1024,
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "FILE_TOO_LARGE"


def test_removed_direct_upload_endpoint_returns_404(client):
    """Verify that the removed endpoint /v1/projects/{project_id}/upload returns 404 or 405."""
    project = client.post(
        "/v1/projects",
        json={"name": "Removed Endpoint Test"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    res = client.post(
        f"/v1/projects/{project_id}/upload",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code in (404, 405)


def test_signed_upload_url_flow(client):
    """Test requesting a V4 signed PUT upload URL and confirming upload."""
    project = client.post(
        "/v1/projects",
        json={"name": "Direct to Cloud Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 1. Request signed upload URL
    url_res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "cad_drawing.png", "contentType": "image/png", "sizeBytes": 2048},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res.status_code == 200
    url_data = url_res.json()
    upload_id = url_data["uploadId"]
    assert len(upload_id) == 20
    assert "signedUploadUrl" in url_data
    assert "signedDisplayUrl" in url_data
    assert url_data["storagePath"] == f"usr_test123/{project_id}/{upload_id}.png"

    # 2. Confirm upload
    confirm_res = client.post(
        f"/v1/projects/{project_id}/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "cad_drawing.png",
            "contentType": "image/png",
            "sizeBytes": 2048,
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    confirmed = confirm_res.json()
    assert confirmed["hasPlan"] is True
    assert confirmed["status"] == "uploaded"
    assert confirmed["planImage"]["id"] == upload_id

    # 3. Trying to request another upload URL on same project is blocked
    conflict_res = client.post(
        f"/v1/projects/{project_id}/upload-url",
        json={"fileName": "another.png", "contentType": "image/png"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert conflict_res.status_code == 409
    assert conflict_res.json()["code"] == "PLAN_ALREADY_UPLOADED"


def test_delete_project(client):
    """Deleting a project removes it from Firestore and cleans up plan images."""
    project = client.post(
        "/v1/projects",
        json={"name": "Temporary Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # Delete
    del_res = client.delete(
        f"/v1/projects/{project_id}",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert del_res.status_code == 204

    # Subsequent GET returns 404
    get_res = client.get(
        f"/v1/projects/{project_id}",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert get_res.status_code == 404


def test_furniture_upload_url_and_confirm(client):
    """Test full furniture photo upload flow: signed URL -> confirm -> list."""
    project = client.post(
        "/v1/projects",
        json={"name": "Furniture Showcase Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 1. Request signed URL for custom furniture photo
    url_res = client.post(
        f"/v1/projects/{project_id}/furniture/upload-url",
        json={
            "fileName": "sofa_leather.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": 1048576,
            "furnitureName": "Italian Leather Sectional",
            "furnitureType": "sofa",
            "componentId": "sofa_001",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert url_res.status_code == 200
    url_data = url_res.json()
    assert "uploadId" in url_data
    assert "signedUploadUrl" in url_data
    assert "signedDisplayUrl" in url_data
    upload_id = url_data["uploadId"]
    assert url_data["storagePath"] == f"usr_test123/{project_id}/furniture/{upload_id}.jpg"
    assert url_data["gcsUri"].startswith("gs://")

    # 2. Confirm furniture upload
    confirm_res = client.post(
        f"/v1/projects/{project_id}/furniture/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "sofa_leather.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": 1048576,
            "furnitureName": "Italian Leather Sectional",
            "furnitureType": "sofa",
            "componentId": "sofa_001",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    furn_item = confirm_res.json()
    assert furn_item["id"] == upload_id
    assert furn_item["furnitureName"] == "Italian Leather Sectional"
    assert furn_item["furnitureType"] == "sofa"
    assert furn_item["componentId"] == "sofa_001"
    assert furn_item["status"] == "uploaded"
    assert "signedUrl" in furn_item

    # 3. List project furniture
    list_res = client.get(
        f"/v1/projects/{project_id}/furniture",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert list_res.status_code == 200
    furn_list = list_res.json()
    assert len(furn_list) >= 1
    assert furn_list[0]["id"] == upload_id

    # 4. Check project document updated
    proj_res = client.get(
        f"/v1/projects/{project_id}",
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    assert proj_res["hasFurniture"] is True
    assert proj_res["furnitureCount"] >= 1

    # 5. Delete furniture item
    del_res = client.delete(
        f"/v1/projects/{project_id}/furniture/{upload_id}",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert del_res.status_code == 204


def test_furniture_upload_unsupported_file_type(client):
    """Furniture upload only accepts image formats (PNG, JPEG, WebP), rejecting PDF or others."""
    project = client.post(
        "/v1/projects",
        json={"name": "Type Test Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    res = client.post(
        f"/v1/projects/{project_id}/furniture/upload-url",
        json={"fileName": "doc.pdf", "contentType": "application/pdf"},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "UNSUPPORTED_FILE_TYPE"


def test_furniture_meshy_3d_generation_and_polling(client, monkeypatch, mock_storage_service):
    """Test Meshy 3D generation trigger on upload confirm and polling 3d-status."""
    from app.services.meshy_service import MeshyService

    mock_task_id = "01a13mock-task-id-12345"
    created_calls = []

    def mock_create(self, image_url, resolution="standard", texture_allowed=True, enhancement_allowed=True):
        created_calls.append({
            "image_url": image_url,
            "resolution": resolution,
            "texture_allowed": texture_allowed,
            "enhancement_allowed": enhancement_allowed,
        })
        return mock_task_id

    def mock_get_status(self, task_id):
        return {
            "id": task_id,
            "status": "SUCCEEDED",
            "progress": 100,
            "model_urls": {
                "glb": "https://assets.meshy.ai/mock/model.glb",
                "usdz": "https://assets.meshy.ai/mock/model.usdz",
            },
            "thumbnail_url": "https://assets.meshy.ai/mock/preview.png",
        }

    monkeypatch.setattr(MeshyService, "is_configured", True)
    monkeypatch.setattr(MeshyService, "create_image_to_3d_task", mock_create)
    monkeypatch.setattr(MeshyService, "get_task_status", mock_get_status)

    project = client.post(
        "/v1/projects",
        json={"name": "3D Generation Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    # 1. Request signed URL
    url_res = client.post(
        f"/v1/projects/{project_id}/furniture/upload-url",
        json={"fileName": "chair.png", "contentType": "image/png", "furnitureName": "Nordic Armchair"},
        headers={"Authorization": "Bearer valid_token"},
    )
    upload_id = url_res.json()["uploadId"]

    # 2. Confirm upload -> triggers Meshy 3D generation
    confirm_res = client.post(
        f"/v1/projects/{project_id}/furniture/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "chair.png",
            "contentType": "image/png",
            "furnitureName": "Nordic Armchair",
            "furnitureType": "chair",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    confirmed = confirm_res.json()
    assert confirmed["status"] == "generating_3d"
    assert confirmed["meshyTaskId"] == mock_task_id
    assert confirmed["meshyStatus"] == "PENDING"
    assert len(created_calls) == 1
    assert created_calls[0]["resolution"] == "standard"
    assert created_calls[0]["texture_allowed"] is True
    assert created_calls[0]["enhancement_allowed"] is True

    # 3. Poll 3D status endpoint -> transitions to SUCCEEDED and 3d_ready
    status_res = client.get(
        f"/v1/projects/{project_id}/furniture/{upload_id}/3d-status",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["meshyStatus"] == "SUCCEEDED"
    assert status_data["meshyProgress"] == 100
    assert status_data["status"] == "3d_ready"
    assert status_data["modelUrls"]["glb"] == "https://assets.meshy.ai/mock/model.glb"
    assert status_data["thumbnail3dUrl"] == "https://assets.meshy.ai/mock/preview.png"

    # 4. Trigger explicit 3D generation re-try
    retry_res = client.post(
        f"/v1/projects/{project_id}/furniture/{upload_id}/generate-3d",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert retry_res.status_code == 200
    retry_data = retry_res.json()
    assert retry_data["meshyTaskId"] == mock_task_id
    assert retry_data["meshyStatus"] == "PENDING"
    assert len(created_calls) == 2

    # 5. Stream GLB file endpoint
    def mock_requests_get(url, *args, **kwargs):
        m = MagicMock()
        m.status_code = 200
        m.content = b"glTF_binary_mock_data"
        return m

    monkeypatch.setattr("requests.get", mock_requests_get)
    mock_blob = MagicMock()
    mock_blob.download_as_bytes.return_value = b"glTF_binary_mock_data"
    mock_storage_service.bucket.blob.return_value = mock_blob
    mock_storage_service.blob_exists.return_value = True

    glb_res = client.get(f"/v1/projects/{project_id}/furniture/{upload_id}/glb")
    assert glb_res.status_code == 200
    assert glb_res.content == b"glTF_binary_mock_data"
    assert glb_res.headers["content-type"] == "model/gltf-binary"
    assert "NordicArmchair.glb" in glb_res.headers["content-disposition"]
    assert glb_res.headers["access-control-allow-origin"] == "*"


def test_furniture_is_system_non_admin_forbidden(client):
    """Verify that is_system defaults to False and non-admins receive 403 Forbidden."""
    project = client.post(
        "/v1/projects",
        json={"name": "Non Admin Furniture Project"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    url_res = client.post(
        f"/v1/projects/{project_id}/furniture/upload-url",
        json={
            "fileName": "chair.png",
            "contentType": "image/png",
            "furnitureName": "Test Chair",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    upload_id = url_res.json()["uploadId"]

    confirm_res = client.post(
        f"/v1/projects/{project_id}/furniture/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "chair.png",
            "contentType": "image/png",
            "furnitureName": "Test Chair",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert confirm_res.status_code == 200
    furn_data = confirm_res.json()
    assert furn_data.get("isSystem") is False

    # Regular user tries to adjust is_system -> must be 403 Forbidden
    non_admin_patch = client.patch(
        f"/v1/projects/{project_id}/furniture/{upload_id}/system",
        json={"is_system": True},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert non_admin_patch.status_code == 403
    assert non_admin_patch.json()["code"] == "ADMIN_REQUIRED"

    non_admin_gen_patch = client.patch(
        f"/v1/projects/{project_id}/furniture/{upload_id}",
        json={"is_system": True},
        headers={"Authorization": "Bearer valid_token"},
    )
    assert non_admin_gen_patch.status_code == 403
    assert non_admin_gen_patch.json()["code"] == "ADMIN_REQUIRED"


def test_furniture_is_system_admin_allowed(admin_client):
    """Verify that Admin user can toggle is_system on furniture."""
    project = admin_client.post(
        "/v1/projects",
        json={"name": "Admin Furniture Project"},
        headers={"Authorization": "Bearer admin_token"},
    ).json()
    project_id = project["id"]

    url_res = admin_client.post(
        f"/v1/projects/{project_id}/furniture/upload-url",
        json={
            "fileName": "sofa.png",
            "contentType": "image/png",
            "furnitureName": "Admin Sofa",
        },
        headers={"Authorization": "Bearer admin_token"},
    )
    upload_id = url_res.json()["uploadId"]

    confirm_res = admin_client.post(
        f"/v1/projects/{project_id}/furniture/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "sofa.png",
            "contentType": "image/png",
            "furnitureName": "Admin Sofa",
        },
        headers={"Authorization": "Bearer admin_token"},
    )
    assert confirm_res.status_code == 200

    # 1. Admin user adjusts is_system to True -> succeeds
    admin_patch = admin_client.patch(
        f"/v1/projects/{project_id}/furniture/{upload_id}/system",
        json={"is_system": True},
        headers={"Authorization": "Bearer admin_token"},
    )
    assert admin_patch.status_code == 200
    assert admin_patch.json()["isSystem"] is True

    # 2. Admin toggles back to False -> succeeds
    admin_patch_false = admin_client.patch(
        f"/v1/projects/{project_id}/furniture/{upload_id}/system",
        json={"is_system": False},
        headers={"Authorization": "Bearer admin_token"},
    )
    assert admin_patch_false.status_code == 200
    assert admin_patch_false.json()["isSystem"] is False

    # 3. Admin updates via general PATCH with is_system=True and new name
    admin_full_patch = admin_client.patch(
        f"/v1/projects/{project_id}/furniture/{upload_id}",
        json={"is_system": True, "furniture_name": "Catalog Armchair"},
        headers={"Authorization": "Bearer admin_token"},
    )
    assert admin_full_patch.status_code == 200
    assert admin_full_patch.json()["isSystem"] is True
    assert admin_full_patch.json()["furnitureName"] == "Catalog Armchair"


def test_choose_system_asset_for_project(client):
    """Test choosing a curated system asset for any project."""
    project = client.post(
        "/v1/projects",
        json={"name": "Loft Project for System Asset"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    project_id = project["id"]

    res = client.post(
        f"/v1/projects/{project_id}/furniture/choose-asset",
        json={
            "sourceType": "system",
            "style": "Industrial",
            "assetFileName": "In_sofa.png",
            "furnitureName": "Industrial Leather Sectional",
            "furnitureType": "sofa",
            "componentId": "sofa_main",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert res.status_code == 201
    furn = res.json()
    assert furn["isSystem"] is True
    assert furn["furnitureName"] == "Industrial Leather Sectional"
    assert furn["furnitureType"] == "sofa"
    assert furn["componentId"] == "sofa_main"
    assert "In_sofa.png" in furn["fileName"]
    assert furn["status"] == "3d_ready"
    assert furn["meshyStatus"] == "SUCCEEDED"
    assert furn["meshyProgress"] == 100
    # Preset files are served from the public catalog bucket, never local disk
    catalog = "https://storage.googleapis.com/soraplan-catalog/assets/Industrial"
    assert furn["signedUrl"] == f"{catalog}/In_sofa.png"
    assert furn["modelUrls"]["glb"] == f"{catalog}/In_sofa.glb"

    # Verify project has updated furniture count
    proj_res = client.get(
        f"/v1/projects/{project_id}",
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    assert proj_res["hasFurniture"] is True
    assert proj_res["furnitureCount"] >= 1

    # Verify that listing all user furniture excludes this chosen system asset
    all_furn_res = client.get(
        "/v1/projects/furniture/all",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert all_furn_res.status_code == 200
    user_furn_names = [f["furnitureName"] for f in all_furn_res.json()]
    assert "Industrial Leather Sectional" not in user_furn_names


def test_choose_user_asset_and_list_all(client):
    """Test choosing an existing user asset across projects, listing all user furniture, and deleting user asset."""
    # Project 1: Upload a furniture photo
    proj1 = client.post(
        "/v1/projects",
        json={"name": "Project Alpha"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    p1_id = proj1["id"]

    url_res = client.post(
        f"/v1/projects/{p1_id}/furniture/upload-url",
        json={"fileName": "desk.png", "contentType": "image/png", "furnitureName": "Oak Standing Desk"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    upload_id = url_res["uploadId"]

    client.post(
        f"/v1/projects/{p1_id}/furniture/confirm-upload",
        json={
            "uploadId": upload_id,
            "fileName": "desk.png",
            "contentType": "image/png",
            "furnitureName": "Oak Standing Desk",
            "furnitureType": "table",
        },
        headers={"Authorization": "Bearer valid_token"},
    )

    # Project 2: Choose that user asset for Project Beta
    proj2 = client.post(
        "/v1/projects",
        json={"name": "Project Beta"},
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    p2_id = proj2["id"]

    choose_res = client.post(
        f"/v1/projects/{p2_id}/furniture/choose-asset",
        json={
            "sourceType": "user",
            "assetFileName": "desk.png",
            "sourceProjectId": p1_id,
            "sourceFurnitureId": upload_id,
            "furnitureName": "Oak Standing Desk (Reused)",
            "furnitureType": "table",
        },
        headers={"Authorization": "Bearer valid_token"},
    )
    assert choose_res.status_code == 201
    reused_id = choose_res.json()["id"]
    assert choose_res.json()["projectId"] == p2_id
    assert choose_res.json()["furnitureName"] == "Oak Standing Desk (Reused)"

    # List all user furniture across projects
    all_res = client.get(
        "/v1/projects/furniture/all",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert all_res.status_code == 200
    all_items = all_res.json()
    assert len(all_items) >= 2
    names = [item["furnitureName"] for item in all_items]
    assert "Oak Standing Desk" in names
    assert "Oak Standing Desk (Reused)" in names

    # Test deleting user asset via DELETE /furniture/{furniture_id}
    del_res = client.delete(
        f"/v1/projects/furniture/{reused_id}",
        headers={"Authorization": "Bearer valid_token"},
    )
    assert del_res.status_code == 204

    # Verify deleted
    all_after = client.get(
        "/v1/projects/furniture/all",
        headers={"Authorization": "Bearer valid_token"},
    ).json()
    after_ids = [item["id"] for item in all_after]
    assert reused_id not in after_ids






def test_stale_job_is_marked_failed(client, mock_firestore):
    """A queued job the worker never picked up times out instead of polling forever."""
    import datetime

    old = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
    mock_firestore.collection("jobs").document("job_stale").set({
        "id": "job_stale",
        "ownerUid": "usr_test123",
        "projectId": "proj_x",
        "status": "queued",
        "stage": "queued",
        "updatedAt": old.isoformat(),
    })
    res = client.get("/v1/jobs/job_stale", headers={"Authorization": "Bearer valid_token"})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "failed"
    assert "timed out" in body["error"]


def test_recent_job_is_left_running(client, mock_firestore):
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    mock_firestore.collection("jobs").document("job_fresh").set({
        "id": "job_fresh",
        "ownerUid": "usr_test123",
        "projectId": "proj_x",
        "status": "running",
        "stage": "analyzing_with_ai",
        "updatedAt": now.isoformat(),
    })
    res = client.get("/v1/jobs/job_fresh", headers={"Authorization": "Bearer valid_token"})
    assert res.json()["status"] == "running"
