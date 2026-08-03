from datetime import UTC, datetime

import pytest

from app.providers.google_routes import (
    decode_polyline,
    duration_to_seconds,
    maneuver_weight,
    normalize_routes,
    route_midpoint,
    traffic_distance_shares,
)
from app.errors import ApiError


def encoded_fixture() -> str:
    return "_p~iF~ps|U_ulLnnqC_mqNvxq" + chr(96) + "@"


def test_duration_parses_fractional_seconds() -> None:
    assert duration_to_seconds("1320.5s") == 1320.5
    with pytest.raises(ValueError):
        duration_to_seconds("22m")


def test_standard_google_polyline_decodes() -> None:
    points = decode_polyline(encoded_fixture())
    assert points == [
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
    ]


def test_route_midpoint_follows_distance_not_point_count() -> None:
    midpoint = route_midpoint(encoded_fixture())
    assert midpoint is not None
    assert 39 < midpoint[0] < 43.252
    assert -126.453 < midpoint[1] < -120.2


def test_traffic_intervals_are_weighted_by_distance() -> None:
    slow, jam = traffic_distance_shares(
        encoded_fixture(),
        [
            {
                "startPolylinePointIndex": 0,
                "endPolylinePointIndex": 1,
                "speed": "SLOW",
            },
            {
                "startPolylinePointIndex": 1,
                "endPolylinePointIndex": 2,
                "speed": "TRAFFIC_JAM",
            },
        ],
    )
    assert slow is not None and jam is not None
    assert slow + jam == pytest.approx(1.0)
    assert slow != pytest.approx(0.5)


def test_invalid_optional_traffic_intervals_are_ignored() -> None:
    slow, jam = traffic_distance_shares(
        encoded_fixture(),
        [{"startPolylinePointIndex": "invalid", "speed": "SLOW"}],
    )
    assert slow is None
    assert jam is None


def test_maneuver_weights_follow_product_spec() -> None:
    assert maneuver_weight("MERGE") == 1.0
    assert maneuver_weight("TURN_SHARP_LEFT") == 0.9
    assert maneuver_weight("TURN_LEFT") == 0.3
    assert maneuver_weight("STRAIGHT") == 0.0


def test_normalizer_returns_stable_features_without_traffic_detail() -> None:
    payload = {
        "routes": [
            {
                "description": "I-90 W",
                "distanceMeters": 10000,
                "duration": "1200s",
                "staticDuration": "1000s",
                "legs": [
                    {
                        "steps": [
                            {"navigationInstruction": {"maneuver": "MERGE"}},
                            {"navigationInstruction": {"maneuver": "TURN_LEFT"}},
                        ]
                    }
                ],
            }
        ]
    }
    response = normalize_routes(payload, "an_test", datetime.now(UTC))
    route = response.routes[0]
    assert route.features.slow_distance_share is None
    assert route.features.jam_distance_share is None
    assert route.features.delay_ratio == pytest.approx(0.2)
    assert route.features.weighted_maneuvers == pytest.approx(1.3)
    assert route.features.maneuver_density == pytest.approx(1.3)


def test_normalizer_rejects_a_non_object_provider_response() -> None:
    with pytest.raises(ApiError) as caught:
        normalize_routes([], "an_test", datetime.now(UTC))  # type: ignore[arg-type]
    assert caught.value.code == "UPSTREAM_ERROR"
