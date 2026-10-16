from typing import Any, Dict, List, Literal, Optional
from pydantic import Field

from .base import BaseSchema

Stage = Literal[
    "uploading",
    "cropping",
    "parsing",
    "reviewing_plan",
    "choosing_style",
    "resolving_missing",
    "scene_ready",
]

ActionType = Literal[
    "confirm_crop",
    "restart_crop",
    "retry_parse",
    "confirm_plan",
    "edit_plan",
    "select_style",
    "skip_missing",
    "continue",
    "undo_last_change",
]


class CropRect(BaseSchema):
    """Crop rectangle in pixels of the original upload."""

    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class CreateConversationRequest(BaseSchema):
    file_name: str = Field(..., min_length=1, max_length=255)
    content_type: str
    size_bytes: Optional[int] = Field(default=None, ge=1)


class CreateConversationResponse(BaseSchema):
    project_id: str
    conversation_id: str
    signed_upload_url: str
    content_type: str


class StageData(BaseSchema):
    crop: Optional[CropRect] = None


class UpdateConversationRequest(BaseSchema):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    stage_data: Optional[StageData] = None


class SendMessageRequest(BaseSchema):
    text: str = Field(..., min_length=1, max_length=4000)


class ActionRequest(BaseSchema):
    type: ActionType
    args: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(BaseSchema):
    ok: bool = True
    result: Optional[Any] = None


class ToolCallRecord(BaseSchema):
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)
    result: Any = None


class MessageIdResponse(BaseSchema):
    message_id: str


class StageResponse(BaseSchema):
    stage: Stage


class ProjectFilesResponse(BaseSchema):
    plan_original_url: Optional[str] = None
    plan_url: Optional[str] = None


class SavePlanRequest(BaseSchema):
    floor_plan: Dict[str, Any]


class SavePlanResponse(BaseSchema):
    floor_plan_version: int


class Dims(BaseSchema):
    w: float = Field(..., gt=0.02, le=12)
    d: float = Field(..., gt=0.02, le=12)
    h: float = Field(..., gt=0.02, le=12)


class UpdateMappingRequest(BaseSchema):
    component_id: str
    dims: Optional[Dims] = None
    asset_id: Optional[str] = None
    apply_to_same_asset: bool = True
    reset: bool = False


class MappingResponse(BaseSchema):
    mapping: Dict[str, Any]


class OpBatchRequest(BaseSchema):
    base_version: int = Field(..., ge=0)
    ops: List[Dict[str, Any]] = Field(..., min_length=1, max_length=200)
    origin: Literal["ui"] = "ui"
    label: Optional[str] = Field(default=None, max_length=120)


class OpResultResponse(BaseSchema):
    batch_id: str
    new_version: int
    applied: int
    warnings: List[Dict[str, Any]] = Field(default_factory=list)


class VersionResponse(BaseSchema):
    new_version: int
