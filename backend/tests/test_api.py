from collections.abc import AsyncIterator

import httpx
import pytest

from app.config import Settings
from app.factory import create_app
from app.services.route_analysis import RouteAnalysisService


def request_body() -> dict:
    return {
        "origin": {"text": "Boston South Station"},
        "destination": {"text": "Yale University"},
        "departureTime": "2026-07-17T14:30:00-04:00",
        "preferences": {
            "avoidTolls": False,
            "avoidHighways": False,
        },
        "client": {
            "extensionVersion": "0.1.0",
            "locale": "en-US",
        },
    }


def make_test_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "google_maps_api_key": None,
        "demo_mode": True,
        "allowed_origins": "http://test",
        "cache_ttl_seconds": 300,
        "cache_max_items": 128,
        "rate_limit_per_minute": 100,
        "rate_limit_max_clients": 128,
        "max_request_body_bytes": 16_384,
        "google_weather_enabled": False,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings.model_validate(values)


def api_client(
    settings: Settings | None = None,
    *,
    service: RouteAnalysisService | None = None,
) -> httpx.AsyncClient:
    application = create_app(
        settings or make_test_settings(),
        analysis_service=service,
    )
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://test",
    )


@pytest.mark.asyncio
async def test_health_and_readiness_do_not_call_paid_api() -> None:
    async with api_client() as client:
        health = await client.get("/health")
        readiness = await client.get("/ready")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "mode": "demo"}
    assert readiness.status_code == 200
    assert readiness.json() == {"status": "ready", "mode": "demo"}


@pytest.mark.asyncio
async def test_unconfigured_live_service_is_alive_but_not_ready() -> None:
    async with api_client(make_test_settings(demo_mode=False)) as client:
        health = await client.get("/health")
        readiness = await client.get("/ready")
    assert health.status_code == 200
    assert health.json()["mode"] == "live"
    assert readiness.status_code == 503
    assert readiness.json() == {
        "status": "not_ready",
        "mode": "live",
        "reason": "route_service_not_configured",
    }


@pytest.mark.asyncio
async def test_demo_analysis_returns_versioned_route_features() -> None:
    async with api_client() as client:
        response = await client.post("/v1/routes/analyze", json=request_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["schemaVersion"] == "1.0"
    assert len(payload["routes"]) == 3
    assert payload["attribution"]["demoData"] is True
    for route in payload["routes"]:
        assert route["durationMinutes"] > 0
        assert route["distanceMeters"] > 0
        assert 0 <= route["features"]["jamDistanceShare"] <= 1


@pytest.mark.asyncio
async def test_invalid_input_has_stable_error_shape() -> None:
    body = request_body()
    body["origin"]["text"] = " "
    async with api_client() as client:
        response = await client.post("/v1/routes/analyze", json=body)
    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "INVALID_INPUT"
    assert payload["error"]["retryable"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body_update",
    [
        {"origin": {"text": "Boston", "latitude": 42.36}},
        {"departureTime": "2026-07-17T14:30:00"},
    ],
)
async def test_coordinates_and_departure_timezone_are_validated(
    body_update: dict,
) -> None:
    body = request_body()
    body.update(body_update)
    async with api_client() as client:
        response = await client.post("/v1/routes/analyze", json=body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_INPUT"


@pytest.mark.asyncio
async def test_declared_oversized_body_is_rejected_before_parsing() -> None:
    body = {"unexpected": "x" * 2000}
    settings = make_test_settings(max_request_body_bytes=1024)
    async with api_client(settings) as client:
        response = await client.post("/v1/routes/analyze", json=body)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


@pytest.mark.asyncio
async def test_streamed_oversized_body_is_rejected_without_content_length() -> None:
    async def oversized_body() -> AsyncIterator[bytes]:
        yield b'{"unexpected":"'
        yield b"x" * 2000
        yield b'"}'

    settings = make_test_settings(max_request_body_bytes=1024)
    async with api_client(settings) as client:
        response = await client.post(
            "/v1/routes/analyze",
            content=oversized_body(),
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


@pytest.mark.asyncio
async def test_invalid_requests_are_rate_limited_before_validation() -> None:
    settings = make_test_settings(rate_limit_per_minute=1)
    async with api_client(settings) as client:
        invalid = await client.post(
            "/v1/routes/analyze",
            json={"unexpected": "small"},
        )
        limited = await client.post(
            "/v1/routes/analyze",
            json=request_body(),
        )
    assert invalid.status_code == 400
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    assert limited.headers["retry-after"] == "60"
