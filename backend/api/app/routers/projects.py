import logging
from typing import List

from fastapi import APIRouter, Depends

from ..deps import get_current_user, get_project_service
from ..models.project import Project
from ..models.user import UserProfile
from ..services.project_service import ProjectService

logger = logging.getLogger("api.routers.projects")

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get(
    "",
    response_model=List[Project],
    summary="List all user projects",
    description="Retrieve all projects belonging to the authenticated user with fresh signed display URLs.",
)
def list_projects(
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
def get_project(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> Project:
    return project_service.get_project(project_id=project_id, user_uid=current_user.uid)



@router.get(
    "/{project_id}/plan",
    summary="Get parsed floor plan scene",
    description="Retrieve structured 2D floor plan geometry once analysis is completed.",
)
def get_project_plan(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    return project_service.get_project_plan(project_id=project_id, user_uid=current_user.uid)

