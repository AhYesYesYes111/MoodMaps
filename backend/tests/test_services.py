import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.errors import ApiError
from app.providers.demo_routes import analyze_demo
from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.cache import TtlCache
from app.services.rate_limit import SlidingWindowRateLimiter
from app.services.route_analysis import RouteAnalysisService


class MutableClock:
    def __init__(self, now: float = 0.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class FakeProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def analyze(
        self,
        request: AnalyzeRequest,
        analysis_id: str,
        generated_at: datetime,
    ) -> AnalyzeResponse:
        self.calls += 1
        await asyncio.sleep(0.01)
        return await analyze_demo(request, analysis_id, generated_at)


def service_settings(*, demo_mode: bool) -> Settings:
    return Settings.model_validate(
        {
            "app_env": "test",
            "google_maps_api_key": None,
            "demo_mode": demo_mode,
            "allowed_origins": "http://test",
            "cache_ttl_seconds": 300,
            "cache_max_items": 32,
            "rate_limit_per_minute": 100,
            "rate_limit_max_clients": 32,
            "max_request_body_bytes": 16_384,
            "google_weather_enabled": False,
            "log_level": "WARNING",
        }
    )


def analyze_request(
    origin: dict | None = None,
    destination: dict | None = None,
    *,
    departure_time: datetime | None = None,
) -> AnalyzeRequest:
    return AnalyzeRequest.model_validate(
        {
            "origin": origin or {"text": "A"},
            "destination": destination or {"text": "B"},
            "departureTime": (
                departure_time or datetime.now(UTC) + timedelta(hours=1)
            ).isoformat(),
        }
    )


@pytest.mark.asyncio
async def test_ttl_cache_purges_unrelated_expired_entries() -> None:
    clock = MutableClock()
    cache: TtlCache[int] = TtlCache(
        1,
        max_items=10,
        clock=clock,
    )
    await cache.set("a", 1)
    await cache.set("b", 2)
    clock.now = 2
    await cache.set("c", 3)
    assert len(cache._items) == 1
    assert await cache.entry_count() == 1
    assert await cache.get("a") is None
    assert await cache.get("c") == 3


@pytest.mark.asyncio
async def test_ttl_cache_enforces_lru_capacity() -> None:
    cache: TtlCache[int] = TtlCache(60, max_items=2)
    await cache.set("a", 1)
    await cache.set("b", 2)
    assert await cache.get("a") == 1
    await cache.set("c", 3)
    assert await cache.get("a") == 1
    assert await cache.get("b") is None
    assert await cache.get("c") == 3


@pytest.mark.asyncio
async def test_rate_limiter_purges_expired_clients_and_caps_keys() -> None:
    clock = MutableClock()
    limiter = SlidingWindowRateLimiter(
        2,
        window_seconds=60,
        max_keys=2,
        clock=clock,
    )
    assert await limiter.allow("a")
    assert await limiter.allow("b")
    assert await limiter.allow("c")
    assert await limiter.entry_count() == 2

    clock.now = 61
    assert await limiter.allow("new")
    assert len(limiter._requests) == 1
    assert await limiter.entry_count() == 1


@pytest.mark.asyncio
async def test_rate_limiter_reports_retry_window() -> None:
    clock = MutableClock()
    limiter = SlidingWindowRateLimiter(
        2,
        window_seconds=60,
        clock=clock,
    )
    assert await limiter.allow("client")
    assert await limiter.allow("client")
    assert not await limiter.allow("client")
    assert await limiter.retry_after_seconds("client") == 60
    clock.now = 30
    assert await limiter.retry_after_seconds("client") == 30
    clock.now = 61
    assert await limiter.allow("client")


@pytest.mark.asyncio
async def test_identical_concurrent_requests_share_one_provider_call() -> None:
    provider = FakeProvider()
    service = RouteAnalysisService(
        service_settings(demo_mode=False),
        provider=provider,
    )
    request = analyze_request()
    responses = await asyncio.gather(*(service.analyze(request) for _ in range(10)))
    assert provider.calls == 1
    assert len({response.analysis_id for response in responses}) == 1


@pytest.mark.asyncio
async def test_demo_allows_past_departure_but_live_rejects_it() -> None:
    past_request = analyze_request(
        departure_time=datetime.now(UTC) - timedelta(hours=1)
    )
    demo_service = RouteAnalysisService(service_settings(demo_mode=True))
    demo_response = await demo_service.analyze(past_request)
    assert demo_response.attribution.demo_data is True

    provider = FakeProvider()
    live_service = RouteAnalysisService(
        service_settings(demo_mode=False),
        provider=provider,
    )
    with pytest.raises(ApiError) as caught:
        await live_service.analyze(past_request)
    assert caught.value.code == "INVALID_INPUT"
    assert caught.value.status_code == 400
    assert provider.calls == 0


def test_cache_key_includes_coordinates_and_is_not_delimiter_ambiguous() -> None:
    departure = datetime.now(UTC) + timedelta(hours=1)
    new_york = analyze_request(
        {
            "text": "Current location",
            "latitude": 40.7128,
            "longitude": -74.006,
        },
        departure_time=departure,
    )
    los_angeles = analyze_request(
        {
            "text": "Current location",
            "latitude": 34.0522,
            "longitude": -118.2437,
        },
        departure_time=departure,
    )
    first_split = analyze_request(
        {"text": "a|b"},
        {"text": "c"},
        departure_time=departure,
    )
    second_split = analyze_request(
        {"text": "a"},
        {"text": "b|c"},
        departure_time=departure,
    )
    assert service_key(new_york) != service_key(los_angeles)
    assert service_key(first_split) != service_key(second_split)


def service_key(request: AnalyzeRequest) -> str:
    return RouteAnalysisService.cache_key(request)
