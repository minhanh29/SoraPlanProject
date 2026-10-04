import pytest


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
