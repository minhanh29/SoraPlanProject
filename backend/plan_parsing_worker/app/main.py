import logging
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import get_settings
from .firebase import init_firebase
from .routers import tasks, parser

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("plan_parsing_worker")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events: initialize Firebase on worker startup."""
    logger.info("Starting up SoraPlan Floor Plan Parser Worker...")
    try:
        init_firebase()
        logger.info("Firebase SDK initialized successfully in plan parser worker.")
    except Exception as e:
        logger.error("Failed to initialize Firebase on startup: %s", e)
    yield
    logger.info("Shutting down SoraPlan Floor Plan Parser Worker...")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="0.1.0",
        description="Cloud Run Worker API that converts uploaded floor plans into structured metric scene geometry using OpenAI gpt-6-sol.",
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

    # No CORS: browsers never call the worker. On Cloud Run it is private
    # (--no-allow-unauthenticated) and only the API / Cloud Tasks can invoke it.

    # Health check endpoints
    @app.get("/health", tags=["system"])
    async def health_check():
        return {
            "status": "healthy",
            "service": "plan_parsing_worker",
            "model": settings.OPENAI_MODEL,
            "version": "0.1.0",
            "projectId": settings.FIREBASE_PROJECT_ID,
        }

    @app.get("/", tags=["system"])
    async def root():
        return {
            "message": "Welcome to SoraPlan Plan Parser Worker",
            "docs": "/docs",
            "health": "/health",
            "version": "0.1.0",
        }

    # Mount routers
    app.include_router(tasks.router)
    app.include_router(parser.router)

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
