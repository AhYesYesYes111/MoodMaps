import math
from collections.abc import Iterable
from datetime import datetime
from typing import Any

import httpx

from app.errors import ApiError
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnalyzedRoute,
    Attribution,
    RouteFeatures,
    WeatherFeatures,
)
from app.providers.google_weather import GoogleWeatherProvider

GOOGLE_ROUTES_URL = (
    "https://routes.googleapis.com/directions/v2:computeRoutes"
)

FIELD_MASK = ",".join(
    [
        "routes.routeLabels",
        "routes.description",
        "routes.distanceMeters",
        "routes.duration",
        "routes.staticDuration",
        "routes.polyline.encodedPolyline",
        "routes.travelAdvisory.speedReadingIntervals",
        "routes.travelAdvisory.tollInfo",
        "routes.legs.steps.navigationInstruction.maneuver",
        "routes.warnings",
    ]
)

MANEUVER_WEIGHTS = {
    "STRAIGHT": 0.0,
    "TURN": 0.3,
    "SHARP": 0.9,
    "RAMP": 0.8,
    "MERGE": 1.0,
    "FORK": 0.7,
    "ROUNDABOUT": 0.6,
    "UTURN": 1.2,
    "U_TURN": 1.2,
}


def duration_to_seconds(value: str) -> float:
    if not isinstance(value, str) or not value.endswith("s"):
        raise ValueError("Invalid Google duration.")
    seconds = float(value[:-1])
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("Google duration must be positive.")
    return seconds


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = lat = lng = 0
    while index < len(encoded):
        deltas: list[int] = []
        for _ in range(2):
            result = shift = 0
            while True:
                if index >= len(encoded):
                    raise ValueError("Invalid encoded polyline.")
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lng += deltas[1]
        points.append((lat / 1e5, lng / 1e5))
    return points


def haversine_meters(
    first: tuple[float, float], second: tuple[float, float]
) -> float:
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    value = min(1.0, max(0.0, value))
    return 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def segment_distances(points: list[tuple[float, float]]) -> list[float]:
    return [
        haversine_meters(points[index], points[index + 1])
        for index in range(len(points) - 1)
    ]


def route_midpoint(encoded_polyline: str | None) -> tuple[float, float] | None:
    if not encoded_polyline:
        return None
    try:
        points = decode_polyline(encoded_polyline)
    except (TypeError, ValueError):
        return None
    if not points:
        return None
    if len(points) == 1:
        return points[0]

    distances = segment_distances(points)
    total_distance = sum(distances)
    if total_distance <= 0:
        return points[len(points) // 2]
    target = total_distance / 2
    traveled = 0.0
    for index, distance in enumerate(distances):
        if traveled + distance >= target:
            share = (target - traveled) / distance if distance > 0 else 0
            first = points[index]
            second = points[index + 1]
            return (
                first[0] + (second[0] - first[0]) * share,
                first[1] + (second[1] - first[1]) * share,
            )
        traveled += distance
    return points[-1]


def traffic_distance_shares(
    encoded_polyline: str | None,
    intervals: Iterable[dict[str, Any]] | None,
) -> tuple[float | None, float | None]:
    if not encoded_polyline or not intervals:
        return None, None
    try:
        distances = segment_distances(decode_polyline(encoded_polyline))
    except (TypeError, ValueError):
        return None, None
    total_distance = sum(distances)
    if total_distance <= 0:
        return None, None

    slow_distance = 0.0
    jam_distance = 0.0
    valid_intervals = 0
    for interval in intervals:
        if not isinstance(interval, dict):
            continue
        try:
            start = max(0, int(interval.get("startPolylinePointIndex", 0)))
            end = min(
                len(distances),
                int(interval.get("endPolylinePointIndex", len(distances))),
            )
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        valid_intervals += 1
        distance = sum(distances[start:end])
        speed = interval.get("speed")
        if speed == "SLOW":
            slow_distance += distance
        elif speed == "TRAFFIC_JAM":
            jam_distance += distance

    if valid_intervals == 0:
        return None, None
    return (
        min(1.0, max(0.0, slow_distance / total_distance)),
        min(1.0, max(0.0, jam_distance / total_distance)),
    )


def maneuver_weight(maneuver: str | None) -> float:
    normalized = (maneuver or "STRAIGHT").upper()
    for key in ("UTURN", "U_TURN", "SHARP", "RAMP", "MERGE", "FORK", "ROUNDABOUT"):
        if key in normalized:
            return MANEUVER_WEIGHTS[key]
    if "TURN" in normalized:
        return MANEUVER_WEIGHTS["TURN"]
    return MANEUVER_WEIGHTS["STRAIGHT"]


def normalize_routes(
    payload: dict[str, Any],
    analysis_id: str,
    generated_at: datetime,
    weather: WeatherFeatures | None = None,
) -> AnalyzeResponse:
    if not isinstance(payload, dict):
        raise ApiError(
            code="UPSTREAM_ERROR",
            message="The route provider returned an invalid response.",
            status_code=502,
            retryable=True,
            request_id=analysis_id,
        )
    raw_routes = payload.get("routes")
    if not isinstance(raw_routes, list) or not raw_routes:
        raise ApiError(
            code="NO_ROUTES_FOUND",
            message="No driving routes were found for those locations.",
            status_code=404,
            retryable=False,
            request_id=analysis_id,
        )

    routes: list[AnalyzedRoute] = []
    for index, raw in enumerate(raw_routes):
        if not isinstance(raw, dict):
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider returned incomplete route data.",
                status_code=502,
                retryable=True,
                request_id=analysis_id,
            )
        try:
            duration_minutes = duration_to_seconds(raw["duration"]) / 60
            static_minutes = duration_to_seconds(raw["staticDuration"]) / 60
            distance_meters = int(raw["distanceMeters"])
            if distance_meters <= 0:
                raise ValueError("Distance must be positive.")
        except (KeyError, TypeError, ValueError) as error:
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider returned incomplete route data.",
                status_code=502,
                retryable=True,
                request_id=analysis_id,
            ) from error

        advisory_value = raw.get("travelAdvisory")
        advisory = advisory_value if isinstance(advisory_value, dict) else {}
        polyline_value = raw.get("polyline")
        polyline = polyline_value if isinstance(polyline_value, dict) else {}
        encoded = polyline.get("encodedPolyline")
        slow_share, jam_share = traffic_distance_shares(
            encoded,
            advisory.get("speedReadingIntervals"),
        )
        legs_value = raw.get("legs")
        legs = legs_value if isinstance(legs_value, list) else []
        steps: list[dict[str, Any]] = []
        for leg in legs:
            if not isinstance(leg, dict):
                continue
            leg_steps = leg.get("steps")
            if isinstance(leg_steps, list):
                steps.extend(step for step in leg_steps if isinstance(step, dict))
        weights = [
            maneuver_weight(
                instruction.get("maneuver")
                if isinstance(
                    instruction := step.get("navigationInstruction"),
                    dict,
                )
                else None
            )
            for step in steps
        ]
        weighted_maneuvers = sum(weights)
        distance_ten_km = max(distance_meters / 10000, 0.1)
        delay_ratio = max(0.0, (duration_minutes - static_minutes) / static_minutes)
        description_value = raw.get("description")
        description = (
            description_value
            if isinstance(description_value, str) and description_value.strip()
            else "Route " + str(index + 1)
        )

        routes.append(
            AnalyzedRoute(
                route_id="route_" + str(index),
                description=description,
                duration_minutes=round(duration_minutes, 2),
                static_duration_minutes=round(static_minutes, 2),
                distance_meters=distance_meters,
                has_tolls=bool(advisory.get("tollInfo")),
                features=RouteFeatures(
                    slow_distance_share=slow_share,
                    jam_distance_share=jam_share,
                    delay_ratio=round(min(delay_ratio, 5), 4),
                    weighted_maneuvers=round(weighted_maneuvers, 2),
                    maneuver_count=len(steps),
                    maneuver_density=round(
                        weighted_maneuvers / distance_ten_km,
                        3,
                    ),
                    duration_minutes=round(duration_minutes, 2),
                    weather=weather,
                ),
            )
        )

    return AnalyzeResponse(
        analysis_id=analysis_id,
        generated_at=generated_at,
        routes=routes,
        attribution=Attribution(route_data_provider="Google Maps Platform"),
    )


def location_payload(location: Any) -> dict[str, Any]:
    if location.latitude is not None and location.longitude is not None:
        return {
            "location": {
                "latLng": {
                    "latitude": location.latitude,
                    "longitude": location.longitude,
                }
            }
        }
    return {"address": location.text}


class GoogleRoutesProvider:
    def __init__(
        self,
        api_key: str,
        timeout_seconds: float = 8.0,
        *,
        weather_enabled: bool = False,
        weather_timeout_seconds: float = 2.0,
    ) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._weather = (
            GoogleWeatherProvider(api_key, weather_timeout_seconds)
            if weather_enabled
            else None
        )

    async def analyze(
        self,
        request: AnalyzeRequest,
        analysis_id: str,
        generated_at: datetime,
    ) -> AnalyzeResponse:
        body = {
            "origin": location_payload(request.origin),
            "destination": location_payload(request.destination),
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
            "computeAlternativeRoutes": True,
            "extraComputations": ["TRAFFIC_ON_POLYLINE"],
            "departureTime": request.departure_time.isoformat(),
            "routeModifiers": {
                "avoidTolls": request.preferences.avoid_tolls,
                "avoidHighways": request.preferences.avoid_highways,
            },
        }
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.post(
                    GOOGLE_ROUTES_URL,
                    headers=headers,
                    json=body,
                )
        except httpx.TimeoutException as error:
            raise ApiError(
                code="GOOGLE_API_TIMEOUT",
                message="Route analysis timed out. Please try again.",
                status_code=504,
                retryable=True,
                request_id=analysis_id,
            ) from error
        except httpx.HTTPError as error:
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider is temporarily unavailable.",
                status_code=502,
                retryable=True,
                request_id=analysis_id,
            ) from error

        if response.status_code in (429, 503):
            raise ApiError(
                code="GOOGLE_API_QUOTA_EXCEEDED",
                message="Route analysis is temporarily unavailable.",
                status_code=503,
                retryable=True,
                request_id=analysis_id,
            )
        if response.status_code >= 400:
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider rejected this request.",
                status_code=502,
                retryable=response.status_code >= 500,
                request_id=analysis_id,
            )
        try:
            payload = response.json()
        except ValueError as error:
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider returned an invalid response.",
                status_code=502,
                retryable=True,
                request_id=analysis_id,
            ) from error
        if not isinstance(payload, dict):
            raise ApiError(
                code="UPSTREAM_ERROR",
                message="The route provider returned an invalid response.",
                status_code=502,
                retryable=True,
                request_id=analysis_id,
            )
        weather = None
        seconds_from_now = abs(
            request.departure_time.timestamp() - generated_at.timestamp()
        )
        raw_routes = payload.get("routes")
        first_route = (
            raw_routes[0]
            if isinstance(raw_routes, list)
            and raw_routes
            and isinstance(raw_routes[0], dict)
            else None
        )
        if self._weather and seconds_from_now <= 2 * 60 * 60 and first_route:
            polyline = first_route.get("polyline")
            encoded = (
                polyline.get("encodedPolyline")
                if isinstance(polyline, dict)
                else None
            )
            midpoint = route_midpoint(encoded)
            if midpoint:
                weather = await self._weather.current_conditions(*midpoint)
        normalized = normalize_routes(payload, analysis_id, generated_at, weather)
        if weather:
            normalized.attribution.weather_data_provider = "Google Weather API"
        return normalized
