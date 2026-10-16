import logging
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from ..deps import get_current_user, get_project_service
from ..models.project import (
    ChooseAssetRequest,
    CreateProjectRequest,
    FurnitureImage,
    FurnitureUploadConfirmRequest,
    FurnitureUploadUrlRequest,
    Project,
    UpdateFurnitureRequest,
    UpdateFurnitureSystemRequest,
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
    "/furniture/all",
    response_model=List[FurnitureImage],
    summary="List all user uploaded furniture across all projects",
    description="Retrieve all custom furniture photos uploaded by the authenticated user across all projects with refreshed signed display URLs.",
)
async def list_all_user_furniture(
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> List[FurnitureImage]:
    return project_service.list_all_user_furniture(user_uid=current_user.uid)


@router.delete(
    "/furniture/{furniture_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a user uploaded furniture photo across all projects",
    description="Finds and deletes the specified custom furniture image from Cloud Storage and its project subcollection.",
)
async def delete_user_furniture_anywhere(
    furniture_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    project_service.delete_user_furniture_by_id(user_uid=current_user.uid, furniture_id=furniture_id)
    return None


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


@router.post(
    "/{project_id}/parse-plan",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger floor plan AI parsing",
    description="Initiates asynchronous processing task using Cloud Tasks / worker with gpt-6-sol.",
)
async def trigger_parse_plan(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    return project_service.trigger_plan_parsing(project_id=project_id, user_uid=current_user.uid)


@router.post(
    "/{project_id}/plan:parse",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger floor plan AI parsing (alias)",
)
async def trigger_parse_plan_alias(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    return project_service.trigger_plan_parsing(project_id=project_id, user_uid=current_user.uid)


@router.get(
    "/{project_id}/plan",
    summary="Get parsed floor plan scene",
    description="Retrieve structured 2D floor plan geometry once analysis is completed.",
)
async def get_project_plan(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    return project_service.get_project_plan(project_id=project_id, user_uid=current_user.uid)


@router.post(
    "/{project_id}/furniture/upload-url",
    response_model=UploadUrlResponse,
    summary="Request signed upload URL for furniture photo",
    description="Generates V4 signed PUT URL for uploading custom furniture photo directly to Google Cloud Storage.",
)
async def request_furniture_upload_url(
    project_id: str,
    request: FurnitureUploadUrlRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> UploadUrlResponse:
    return project_service.create_furniture_upload_url(
        project_id=project_id,
        user_uid=current_user.uid,
        file_name=request.file_name,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
        furniture_name=request.furniture_name,
        furniture_type=request.furniture_type,
        component_id=request.component_id,
    )


@router.post(
    "/{project_id}/furniture/confirm-upload",
    response_model=FurnitureImage,
    summary="Confirm furniture photo upload",
    description="Confirms completion of furniture upload to Cloud Storage and writes metadata to Firestore.",
)
async def confirm_furniture_upload(
    project_id: str,
    request: FurnitureUploadConfirmRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.confirm_furniture_upload(
        project_id=project_id,
        user_uid=current_user.uid,
        upload_id=request.upload_id,
        file_name=request.file_name,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
        furniture_name=request.furniture_name,
        furniture_type=request.furniture_type,
        component_id=request.component_id,
        is_system=request.is_system or False,
        current_user=current_user,
    )


@router.get(
    "/{project_id}/furniture",
    response_model=List[FurnitureImage],
    summary="List project furniture photos",
    description="Retrieve all custom uploaded furniture photos for this project with active signed display URLs.",
)
async def list_project_furniture(
    project_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> List[FurnitureImage]:
    return project_service.list_project_furniture(
        project_id=project_id,
        user_uid=current_user.uid,
    )


@router.post(
    "/{project_id}/furniture/choose-asset",
    response_model=FurnitureImage,
    status_code=status.HTTP_201_CREATED,
    summary="Choose a system or user asset for this project",
    description="Attaches a curated system asset or copies an existing user asset to this project.",
)
async def choose_asset_for_project(
    project_id: str,
    request: ChooseAssetRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.choose_asset_for_project(
        project_id=project_id,
        user_uid=current_user.uid,
        request=request,
    )


@router.delete(
    "/{project_id}/furniture/{furniture_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a furniture photo",
    description="Deletes custom furniture image from Cloud Storage and Firestore subcollection.",
)
async def delete_project_furniture(
    project_id: str,
    furniture_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
):
    project_service.delete_project_furniture(
        project_id=project_id,
        user_uid=current_user.uid,
        furniture_id=furniture_id,
    )
    return None


@router.patch(
    "/{project_id}/furniture/{furniture_id}/system",
    response_model=FurnitureImage,
    summary="Update furniture is_system status (Admin only)",
    description="Adjust whether this furniture item belongs to the system catalog. Only Admin users can adjust this field.",
)
async def update_furniture_system(
    project_id: str,
    furniture_id: str,
    request: UpdateFurnitureSystemRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.update_furniture_system(
        project_id=project_id,
        furniture_id=furniture_id,
        is_system=request.is_system,
        current_user=current_user,
    )


@router.patch(
    "/{project_id}/furniture/{furniture_id}",
    response_model=FurnitureImage,
    summary="Update furniture details (is_system is Admin only)",
)
async def update_furniture(
    project_id: str,
    furniture_id: str,
    request: UpdateFurnitureRequest,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.update_furniture(
        project_id=project_id,
        furniture_id=furniture_id,
        request=request,
        current_user=current_user,
    )



@router.get(
    "/{project_id}/furniture/{furniture_id}/3d-status",
    response_model=FurnitureImage,
    summary="Get Meshy 3D generation status",
    description="Polls Meshy API for the 3D model generation status and updates Firestore when ready.",
)
async def get_furniture_3d_status(
    project_id: str,
    furniture_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.get_furniture_3d_status(
        project_id=project_id,
        user_uid=current_user.uid,
        furniture_id=furniture_id,
    )


@router.post(
    "/{project_id}/furniture/{furniture_id}/generate-3d",
    response_model=FurnitureImage,
    summary="Trigger Meshy 3D generation",
    description="Explicitly triggers or retries 3D generation with Meshy for an uploaded furniture photo.",
)
async def generate_furniture_3d(
    project_id: str,
    furniture_id: str,
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> FurnitureImage:
    return project_service.generate_furniture_3d(
        project_id=project_id,
        user_uid=current_user.uid,
        furniture_id=furniture_id,
    )


@router.api_route(
    "/{project_id}/furniture/{furniture_id}/glb",
    methods=["GET", "HEAD"],
    summary="Download or stream GLB 3D model",
    description="Streams the binary glTF (.glb) 3D model file directly with appropriate CORS headers.",
)
async def get_furniture_glb_file(
    project_id: str,
    furniture_id: str,
    project_service: ProjectService = Depends(get_project_service),
):
    content, filename = project_service.get_furniture_glb_bytes(
        project_id=project_id,
        furniture_id=furniture_id,
    )
    return Response(
        content=content,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.post(
    "/{project_id}/furniture/transparent-background",
    status_code=status.HTTP_200_OK,
    summary="Generate transparent background for furniture via worker",
    description="Proxies request to plan parser worker gpt-6-sol with prompt '{uploaded_furniture} transparent background'.",
)
async def generate_furniture_transparent_background(
    project_id: str,
    file: UploadFile = File(..., description="Uploaded furniture photo"),
    furniture_name: str = Form(default="furniture", description="Furniture label or name"),
    current_user: UserProfile = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
) -> Dict[str, Any]:
    content_type = file.content_type or "image/jpeg"
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image (PNG, JPG, WebP).",
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        return project_service.remove_furniture_background(
            image_bytes=image_bytes,
            filename=file.filename or "furniture.jpg",
            content_type=content_type,
            furniture_name=furniture_name,
        )
    except Exception as e:
        logger.error("Furniture transparent background proxy error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not generate transparent background: {str(e)}",
        )



