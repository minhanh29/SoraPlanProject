import uuid
from typing import Optional, Any
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from .models.base import BaseSchema


class ProblemDetail(BaseSchema):
    """RFC 7807 problem details error response representation."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    code: str
    request_id: str


class AppException(Exception):
    """Base application exception supporting RFC 7807 problem details."""

    def __init__(
        self,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        code: str = "BAD_REQUEST",
        title: Optional[str] = None,
        detail: str = "An error occurred",
        error_type: str = "about:blank",
    ):
        self.status_code = status_code
        self.code = code
        self.title = title or code.replace("_", " ").title()
        self.detail = detail
        self.error_type = error_type
        super().__init__(detail)


class UnauthorizedException(AppException):
    def __init__(self, detail: str = "Authentication failed", code: str = "INVALID_CREDENTIALS"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=code,
            title="Unauthorized",
            detail=detail,
        )


class ForbiddenException(AppException):
    def __init__(self, detail: str = "Access forbidden", code: str = "FORBIDDEN"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code=code,
            title="Forbidden",
            detail=detail,
        )


class NotFoundException(AppException):
    def __init__(self, detail: str = "Resource not found", code: str = "NOT_FOUND"):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code=code,
            title="Not Found",
            detail=detail,
        )


class ConflictException(AppException):
    def __init__(self, detail: str = "Resource already exists", code: str = "CONFLICT"):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code=code,
            title="Conflict",
            detail=detail,
        )


class QuotaExceededException(AppException):
    def __init__(self, detail: str = "Quota limit reached", code: str = "QUOTA_EXCEEDED"):
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code=code,
            title="Quota Exceeded",
            detail=detail,
        )


class InternalException(AppException):
    def __init__(self, detail: str = "An unexpected server error occurred", code: str = "INTERNAL_ERROR"):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=code,
            title="Internal Server Error",
            detail=detail,
        )


def get_request_id(request: Request) -> str:
    req_id = getattr(request.state, "request_id", None)
    if not req_id:
        req_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
        request.state.request_id = req_id
    return req_id


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    request_id = get_request_id(request)
    body = ProblemDetail(
        type=exc.error_type,
        title=exc.title,
        status=exc.status_code,
        detail=exc.detail,
        code=exc.code,
        request_id=request_id,
    ).model_dump(by_alias=True)

    headers = {"X-Request-ID": request_id}
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        headers["WWW-Authenticate"] = "Bearer"

    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        headers=headers,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = get_request_id(request)
    errors = exc.errors()
    detail_msg = "; ".join(f"{'.'.join(str(loc) for loc in err['loc'])}: {err['msg']}" for err in errors)

    body = ProblemDetail(
        type="about:blank",
        title="Unprocessable Entity",
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=detail_msg or "Validation error in request payload",
        code="VALIDATION_ERROR",
        request_id=request_id,
    ).model_dump(by_alias=True)

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=body,
        headers={"X-Request-ID": request_id},
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = get_request_id(request)
    body = ProblemDetail(
        type="about:blank",
        title="Internal Server Error",
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=str(exc) if getattr(request.app.state, "debug", False) else "An unexpected error occurred",
        code="INTERNAL_ERROR",
        request_id=request_id,
    ).model_dump(by_alias=True)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=body,
        headers={"X-Request-ID": request_id},
    )
