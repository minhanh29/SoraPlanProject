import logging
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .errors import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from .firebase import init_firebase
from .routers import auth_router, users_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("api_user")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events: initialize Firebase on startup."""
    logger.info("Starting up SoraPlan User API service...")
    try:
        init_firebase()
        logger.info("Firebase SDK initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize Firebase on startup: %s", e)
    yield
    logger.info("Shutting down SoraPlan User API service...")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="0.1.0",
        description="SoraPlan User Management and Authentication API connected with Firebase and Firestore.",
        lifespan=lifespan,
    )

    # Middleware: Request ID tracking
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        req_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
        request.state.request_id = req_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

    # Middleware: CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Exception Handlers (RFC 7807 problem details)
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # Health check endpoints
    @app.get("/health", tags=["system"])
    async def health_check():
        return {
            "status": "healthy",
            "service": "api_user",
            "version": "0.1.0",
            "projectId": settings.FIREBASE_PROJECT_ID,
        }

    @app.get("/", tags=["system"])
    async def root():
        return {
            "message": "Welcome to SoraPlan User API",
            "docs": "/docs",
            "health": "/health",
            "version": "0.1.0",
        }

    # API Routers
    app.include_router(auth_router, prefix=settings.API_V1_STR)
    app.include_router(users_router, prefix=settings.API_V1_STR)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG or settings.ENV == "development",
    )
