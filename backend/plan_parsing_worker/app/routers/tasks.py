import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from ..models.task import ParsePlanTaskRequest, TaskStatusResponse
from ..services.parser_service import PlanParserService

logger = logging.getLogger("plan_parsing_worker.routers.tasks")

router = APIRouter(prefix="/tasks", tags=["tasks"])
parser_service = PlanParserService()


@router.post(
    "/parse-plan",
    response_model=TaskStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Cloud Tasks worker endpoint to parse floor plan",
    description="Invoked by Cloud Tasks or main API to execute AI vision analysis with gpt-6-sol and store results.",
)
def handle_parse_plan_task(
    request: ParsePlanTaskRequest,
    background_tasks: BackgroundTasks,
) -> TaskStatusResponse:
    logger.info("Received parse plan task for jobId=%s, projectId=%s", request.jobId, request.projectId)

    try:
        # Execute parsing synchronously so Cloud Tasks receives confirmation
        floor_plan = parser_service.execute_plan_parsing_job(request)
        return TaskStatusResponse(
            jobId=request.jobId,
            status="completed",
            progress=100,
            stage="completed",
            result=floor_plan.model_dump(),
        )
    except Exception as e:
        logger.error("Failed to execute parse plan task: %s", e)
        # Return 200 with failed status to avoid infinite retry if permanent, or raise 500
        return TaskStatusResponse(
            jobId=request.jobId,
            status="failed",
            progress=100,
            stage="failed",
            error=str(e),
        )
