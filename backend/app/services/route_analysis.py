import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Protocol

from app.config import Settings
from app.errors import ApiError
from app.providers.demo_routes import analyze_demo
from app.providers.google_routes import GoogleRoutesProvider
from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.cache import TtlCache

LIVE_DEPARTURE_GRACE = timedelta(minutes=5)


class RouteProvider(Protocol):
    async def analyze(
        self,
        request: AnalyzeRequest,
        analysis_id: str,
        generated_at: datetime,
    ) -> AnalyzeResponse: ...


class RouteAnalysisService:
    def __init__(
        self,
        settings: Settings,
        *,
        provider: RouteProvider | None = None,
    ) -> None:
        self._settings = settings
        self._cache: TtlCache[AnalyzeResponse] = TtlCache(
            settings.cache_ttl_seconds,
            max_items=settings.cache_max_items,
        )
        self._provider: RouteProvider | None = provider
        if self._provider is None and settings.google_maps_api_key:
            self._provider = GoogleRoutesProvider(
                settings.google_maps_api_key,
                settings.google_routes_timeout_seconds,
                weather_enabled=settings.google_weather_enabled,
                weather_timeout_seconds=settings.google_weather_timeout_seconds,
            )
        self._inflight: dict[str, asyncio.Task[AnalyzeResponse]] = {}
        self._inflight_lock = asyncio.Lock()

    @property
    def is_ready(self) -> bool:
        return self._settings.demo_mode or self._provider is not None

    @staticmethod
    def cache_key(request: AnalyzeRequest) -> str:
        bucket = int(request.departure_time.timestamp()) // 300
        raw = json.dumps(
            {
                "origin": {
                    "text": request.origin.text.casefold(),
                    "latitude": request.origin.latitude,
                    "longitude": request.origin.longitude,
                },
                "destination": {
                    "text": request.destination.text.casefold(),
                    "latitude": request.destination.latitude,
                    "longitude": request.destination.longitude,
                },
                "departureBucket": bucket,
                "preferences": {
                    "avoidTolls": request.preferences.avoid_tolls,
                    "avoidHighways": request.preferences.avoid_highways,
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def analyze(self, request: AnalyzeRequest) -> AnalyzeResponse:
        key = self.cache_key(request)
        cached = await self._cache.get(key)
        if cached is not None:
            return cached

        async with self._inflight_lock:
            task = self._inflight.get(key)
            if task is None:
                cached = await self._cache.get(key)
                if cached is not None:
                    return cached
                task = asyncio.create_task(self._analyze_uncached(request, key))
                self._inflight[key] = task
        return await asyncio.shield(task)

    async def _analyze_uncached(
        self,
        request: AnalyzeRequest,
        key: str,
    ) -> AnalyzeResponse:
        generated_at = datetime.now(UTC)
        analysis_id = (
            "an_"
            + hashlib.sha256(
                (key + generated_at.isoformat()).encode("utf-8")
            ).hexdigest()[:10]
        )

        try:
            if self._settings.demo_mode:
                response = await analyze_demo(
                    request,
                    analysis_id,
                    generated_at,
                )
            elif self._provider:
                if (
                    request.departure_time.astimezone(UTC)
                    < generated_at - LIVE_DEPARTURE_GRACE
                ):
                    raise ApiError(
                        code="INVALID_INPUT",
                        message=(
                            "Live route analysis requires a current or future "
                            "departure time."
                        ),
                        status_code=400,
                        retryable=False,
                        request_id=analysis_id,
                    )
                response = await self._provider.analyze(
                    request,
                    analysis_id,
                    generated_at,
                )
            else:
                raise ApiError(
                    code="SERVICE_NOT_CONFIGURED",
                    message="The route service is not configured.",
                    status_code=503,
                    retryable=False,
                    request_id=analysis_id,
                )
            await self._cache.set(key, response)
            return response
        finally:
            current_task = asyncio.current_task()
            async with self._inflight_lock:
                if self._inflight.get(key) is current_task:
                    self._inflight.pop(key, None)
