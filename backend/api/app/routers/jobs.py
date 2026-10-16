import logging
from fastapi import APIRouter, Depends

from ..deps import get_current_user, get_project_service
from ..models.user import UserProfile
from ..services.project_service import ProjectService

logger = logging.getLogger("api.routers.jobs")

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get(
    "/{job_id}",
    summary="Get job execution status and progress",
    description="Retrieve status of asynchronous tasks (e.g. plan parsing, 3D asset generation).",
)
def get_job(
    job_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    return project_service.get_job(job_id=job_id, user_uid=current_user.uid)
