from fastapi import APIRouter, Depends

from ..deps import get_asset_service, get_current_user, get_db, get_gemini, get_scene_service, get_workflow
from ..models.conversation import (
    MappingResponse,
    OpBatchRequest,
    OpResultResponse,
    ProjectFilesResponse,
    SavePlanRequest,
    SavePlanResponse,
    SceneThumbnailRequest,
    SceneThumbnailResponse,
    TourPlanRequest,
    TourPlanResponse,
    UpdateMappingRequest,
    VersionResponse,
)
from ..models.user import UserProfile
from ..services.asset_service import AssetService
from ..services.scene_ops import SceneService
from ..services.tour_planner import TourPlanner
from ..services.workflow import Workflow

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/{project_id}/files", response_model=ProjectFilesResponse, summary="Fresh signed URLs of the plan images")
def project_files(project_id: str, user: UserProfile = Depends(get_current_user), workflow: Workflow = Depends(get_workflow)):
    return workflow.files(project_id, user.uid)


@router.post("/{project_id}/thumbnail", response_model=SceneThumbnailResponse,
             summary="Replace the sidebar thumbnail with a snapshot of the finished 3D scene")
def save_scene_thumbnail(
    project_id: str,
    body: SceneThumbnailRequest,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    return {"thumbnailUrl": workflow.save_scene_thumbnail(project_id, user.uid, body.image)}


@router.put("/{project_id}/plan", response_model=SavePlanResponse, summary="Save the edited 2D plan")
def save_plan(
    project_id: str,
    body: SavePlanRequest,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    return {"floorPlanVersion": workflow.save_plan(project_id, user.uid, body.floor_plan)}


@router.patch("/{project_id}/mapping", response_model=MappingResponse,
              summary="Rescale a matched model, reset it to the box, assign an asset to a plan box, or restore a skipped box")
def update_mapping(
    project_id: str,
    body: UpdateMappingRequest,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    mapping = workflow.update_mapping(
        project_id,
        user.uid,
        body.component_id,
        body.dims.model_dump() if body.dims else None,
        body.asset_id,
        body.apply_to_same_asset,
        body.reset,
        restore=body.restore,
    )
    return {"mapping": mapping}


@router.post("/{project_id}/tour/plan", response_model=TourPlanResponse,
             summary="AI director: Gemini picks and orders candidate tour shots from their previews (502 → use the automatic plan)")
def plan_tour(
    project_id: str,
    body: TourPlanRequest,
    user: UserProfile = Depends(get_current_user),
    db=Depends(get_db),
    gemini=Depends(get_gemini),
):
    return TourPlanner(db, gemini).plan(project_id, user.uid, body.model_dump(by_alias=True))


@router.post("/{project_id}/scene/ops", response_model=OpResultResponse,
             summary="Apply an OpBatch from the 3D editor (409 SCENE_VERSION_CONFLICT on a stale baseVersion)")
def apply_ops(
    project_id: str,
    body: OpBatchRequest,
    user: UserProfile = Depends(get_current_user),
    scenes: SceneService = Depends(get_scene_service),
    assets: AssetService = Depends(get_asset_service),
):
    # Only the catalog and the user's own assets can be placed
    for op in body.ops:
        asset_id = op.get("assetId") if op.get("op") == "item.replace" else (op.get("item") or {}).get("assetId") if op.get("op") == "item.add" else None
        if asset_id:
            assets.get_readable(asset_id, user.uid)
    return scenes.apply_batch(project_id, user.uid, body.ops, origin=body.origin, base_version=body.base_version, label=body.label)


@router.post("/{project_id}/scene/undo", response_model=VersionResponse, summary="Revert the last change (UI or AI)")
def undo(project_id: str, user: UserProfile = Depends(get_current_user), scenes: SceneService = Depends(get_scene_service)):
    return {"newVersion": scenes.undo(project_id, user.uid)["newVersion"]}


@router.post("/{project_id}/scene/redo", response_model=VersionResponse, summary="Re-apply the last undone change")
def redo(project_id: str, user: UserProfile = Depends(get_current_user), scenes: SceneService = Depends(get_scene_service)):
    return {"newVersion": scenes.redo(project_id, user.uid)["newVersion"]}
