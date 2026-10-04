import logging
from typing import List
from fastapi import APIRouter, Depends, status

from ..deps import get_current_user, get_project_service
from ..models.project import (
    CreateProjectRequest,
    Project,
    UploadConfirmRequest,
    UploadUrlRequest,
    UploadUrlResponse,
)
from ..models.user import UserProfile
from ..services.project_service import ProjectService

logger = logging.getLogger("api_user.routers.projects")

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post(
    "",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
    description="Users must create a project first before uploading floor plan sketches, PDFs, or screenshots.",
)
async def create_project(
    request: CreateProjectRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> Project:
    project = project_service.create_project(
        user_uid=current_user.uid,
        name=request.name,
        description=request.description,
    )
    return project


@router.get(
    "",
    response_model=List[Project],
    summary="List all user projects",
    description="Retrieve all projects belonging to the authenticated user with fresh signed display URLs.",
)
async def list_projects(
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> List[Project]:
    return project_service.list_projects(user_uid=current_user.uid)


@router.get(
    "/{project_id}",
    response_model=Project,
    summary="Get project details",
    description="Retrieve a specific project by its Google Cloud generated identifier.",
)
async def get_project(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> Project:
    return project_service.get_project(project_id=project_id, user_uid=current_user.uid)



@router.post(
    "/{project_id}/upload-url",
    response_model=UploadUrlResponse,
    summary="Request signed upload URL",
    description="Generates V4 signed PUT URL for direct client-to-cloud upload and signed GET display URL.",
)
async def request_upload_url(
    project_id: str,
    request: UploadUrlRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> UploadUrlResponse:
    return project_service.create_upload_url(
        project_id=project_id,
        user_uid=current_user.uid,
        file_name=request.file_name,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
    )


@router.post(
    "/{project_id}/confirm-upload",
    response_model=Project,
    summary="Confirm direct-to-cloud upload",
    description="Confirms completion of client-side upload to Cloud Storage and records state in Firestore.",
)
async def confirm_upload(
    project_id: str,
    request: UploadConfirmRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> Project:
    return project_service.confirm_upload(
        project_id=project_id,
        user_uid=current_user.uid,
        upload_id=request.upload_id,
        file_name=request.file_name,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
    )


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
    description="Delete project and any associated uploaded files.",
)
async def delete_project(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    project_service.delete_project(project_id=project_id, user_uid=current_user.uid)
    return None
