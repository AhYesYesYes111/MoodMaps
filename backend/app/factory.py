import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router as routes_router
from app.config import Settings, get_settings
from app.errors import ApiError, error_payload
from app.services.rate_limit import SlidingWindowRateLimiter
from app.services.request_guard import AnalyzeRequestGuardMiddleware
from app.services.route_analysis import RouteAnalysisService


def create_app(
    settings: Settings | None = None,
    *,
    analysis_service: RouteAnalysisService | None = None,
    rate_limiter: SlidingWindowRateLimiter | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    logging.basicConfig(level=app_settings.log_level.upper())

    service = analysis_service or RouteAnalysisService(app_settings)
    limiter = rate_limiter or SlidingWindowRateLimiter(
        app_settings.rate_limit_per_minute,
        max_keys=app_settings.rate_limit_max_clients,
    )

    app = FastAPI(
        title="MoodMaps API",
        version="0.1.0",
        docs_url="/docs" if app_settings.app_env != "production" else None,
        redoc_url=None,
    )
    app.state.settings = app_settings
    app.state.analysis_service = service
    app.state.rate_limiter = limiter

    app.add_middleware(
        AnalyzeRequestGuardMiddleware,
        rate_limiter=limiter,
        max_body_bytes=app_settings.max_request_body_bytes,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.include_router(routes_router, prefix="/v1")

    @app.exception_handler(ApiError)
    async def api_error_handler(
        _request: Request,
        error: ApiError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content=error_payload(
                error.code,
                error.message,
                error.retryable,
                error.request_id,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request,
        _error: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=error_payload(
                "INVALID_INPUT",
                "Check the origin, destination, and departure time.",
                False,
                None,
            ),
        )

    @app.exception_handler(Exception)
    async def unknown_error_handler(
        request: Request,
        error: Exception,
    ) -> JSONResponse:
        request_id = "req_" + uuid.uuid4().hex[:10]
        logging.exception(
            "Unhandled API error request_id=%s path=%s",
            request_id,
            request.url.path,
            exc_info=error,
        )
        return JSONResponse(
            status_code=500,
            content=error_payload(
                "INTERNAL_ERROR",
                "MoodMaps encountered an unexpected error.",
                True,
                request_id,
            ),
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "mode": "demo" if app_settings.demo_mode else "live",
        }

    @app.get("/ready", response_model=None)
    async def readiness() -> dict[str, str] | JSONResponse:
        mode = "demo" if app_settings.demo_mode else "live"
        if service.is_ready:
            return {"status": "ready", "mode": mode}
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "mode": mode,
                "reason": "route_service_not_configured",
            },
        )

    return app
