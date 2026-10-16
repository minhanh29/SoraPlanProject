import logging
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from ..models.floorplan import FloorPlan, RoomCorners
from ..services.parser_service import PlanParserService

logger = logging.getLogger("api_plan_parser.routers.parser")

router = APIRouter(prefix="/api", tags=["parser"])
parser_service = PlanParserService()


@router.post(
    "/parse-floor-plan",
    response_model=FloorPlan,
    status_code=status.HTTP_200_OK,
    summary="Direct floor plan image parsing endpoint",
    description="Accepts an uploaded image file (PNG, JPG, WebP) and returns structured FloorPlan JSON directly using gpt-6-sol.",
)
async def parse_floor_plan_direct(
    file: UploadFile = File(..., description="Floor plan image file"),
) -> FloorPlan:
    content_type = file.content_type or "image/png"
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image (PNG, JPG, WebP) or PDF.",
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        floor_plan = parser_service.parse_image_bytes(image_bytes, mime_type=content_type)
        return floor_plan
    except Exception as e:
        logger.error("Direct plan parse failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not parse floor plan: {str(e)}",
        )


@router.post(
    "/detect-room-corners",
    response_model=RoomCorners,
    status_code=status.HTTP_200_OK,
    summary="Detect exactly 4 outer angles/corners of the room footprint",
    description="Locates the 4 outermost wall corners (topLeft, topRight, bottomRight, bottomLeft), computes the crop bounding box, and derives physical scale.",
)
async def detect_room_corners_direct(
    file: UploadFile = File(..., description="Floor plan image file"),
) -> RoomCorners:
    content_type = file.content_type or "image/png"
    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        corners = parser_service.detect_room_corners(image_bytes, mime_type=content_type)
        return corners
    except Exception as e:
        logger.error("Corner detection failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not detect room corners: {str(e)}",
        )


@router.post(
    "/furniture/transparent-background",
    status_code=status.HTTP_200_OK,
    summary="Isolate furniture with transparent background using gpt-6-sol",
    description="Processes an uploaded furniture image with gpt-6-sol and the prompt '{uploaded_furniture} transparent background', returning a clean transparent PNG.",
)
async def make_furniture_transparent_background(
    file: UploadFile = File(..., description="Uploaded furniture photo"),
    furniture_name: str = Form(default="furniture", description="Furniture label or name"),
):
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

        result = parser_service.isolate_furniture_transparent_background(
            image_bytes=image_bytes,
            mime_type=content_type,
            furniture_name=furniture_name,
        )
        return result
    except Exception as e:
        logger.error("Furniture transparent background failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not generate transparent background: {str(e)}",
        )
