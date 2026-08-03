from __future__ import annotations

from typing import Any

import httpx

from app.schemas import WeatherFeatures

GOOGLE_WEATHER_URL = (
    "https://weather.googleapis.com/v1/currentConditions:lookup"
)


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return min(maximum, max(minimum, value))


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _piecewise_risk(value: float, points: list[tuple[float, float]]) -> float:
    if value <= points[0][0]:
        return points[0][1]
    for (left_x, left_y), (right_x, right_y) in zip(points, points[1:]):
        if value <= right_x:
            share = (value - left_x) / (right_x - left_x)
            return left_y + share * (right_y - left_y)
    return points[-1][1]


def condition_risk(condition_type: str | None) -> float:
    value = (condition_type or "TYPE_UNSPECIFIED").upper()
    if "THUNDER" in value or "HAIL" in value:
        return 95
    if any(token in value for token in ("SNOWSTORM", "HEAVY_SNOW", "BLOWING_SNOW")):
        return 90
    if "HEAVY_RAIN" in value or "RAIN_PERIODICALLY_HEAVY" in value:
        return 85
    if "WIND_AND_RAIN" in value or "RAIN_AND_SNOW" in value:
        return 80
    if "SNOW" in value:
        return 65 if "LIGHT" not in value and "CHANCE" not in value else 40
    if "RAIN" in value or "SHOWERS" in value:
        if "LIGHT" in value or "CHANCE" in value:
            return 30
        return 58
    if any(token in value for token in ("FOG", "MIST")):
        return 70
    if any(token in value for token in ("DUST", "SAND", "SMOKE", "HAZE")):
        return 60
    if "WINDY" in value:
        return 50
    if value in {"CLOUDY", "MOSTLY_CLOUDY"}:
        return 10
    if value == "PARTLY_CLOUDY":
        return 5
    return 0


def visibility_kilometers(payload: dict[str, Any]) -> float | None:
    visibility = payload.get("visibility") or {}
    distance = _number(visibility.get("distance"))
    if distance is None:
        return None
    if visibility.get("unit") == "MILES":
        return distance * 1.609344
    return distance


def wind_gust_kph(payload: dict[str, Any]) -> float | None:
    gust = ((payload.get("wind") or {}).get("gust") or {})
    value = _number(gust.get("value"))
    if value is None:
        return None
    unit = gust.get("unit")
    if unit == "MILES_PER_HOUR":
        return value * 1.609344
    if unit == "METERS_PER_SECOND":
        return value * 3.6
    return value


def feels_like_celsius(payload: dict[str, Any]) -> float | None:
    temperature = payload.get("feelsLikeTemperature") or {}
    degrees = _number(temperature.get("degrees"))
    if degrees is None:
        return None
    if temperature.get("unit") == "FAHRENHEIT":
        return (degrees - 32) * 5 / 9
    return degrees


def calculate_weather_features(payload: dict[str, Any]) -> WeatherFeatures | None:
    condition = payload.get("weatherCondition") or {}
    condition_type = condition.get("type")
    precipitation = payload.get("precipitation") or {}
    probability = _number((precipitation.get("probability") or {}).get("percent"))
    thunderstorm_probability = _number(payload.get("thunderstormProbability"))
    visibility = visibility_kilometers(payload)
    gust = wind_gust_kph(payload)
    feels_like = feels_like_celsius(payload)

    has_signal = any(
        value is not None
        for value in (
            condition_type if condition_type != "TYPE_UNSPECIFIED" else None,
            probability,
            thunderstorm_probability,
            visibility,
            gust,
            feels_like,
        )
    )
    if not has_signal:
        return None

    condition_component = condition_risk(condition_type)
    precipitation_component = clamp(max(probability or 0, thunderstorm_probability or 0))
    visibility_component = (
        0
        if visibility is None
        else _piecewise_risk(
            visibility,
            [(0, 100), (1, 100), (3, 60), (5, 30), (10, 0)],
        )
    )
    gust_component = (
        0
        if gust is None
        else _piecewise_risk(
            gust,
            [(0, 0), (25, 0), (40, 30), (60, 70), (80, 100)],
        )
    )
    temperature_component = 0.0
    if feels_like is not None:
        cold = _piecewise_risk(
            feels_like,
            [(-25, 100), (-15, 70), (-5, 30), (5, 0)],
        )
        heat = _piecewise_risk(
            feels_like,
            [(30, 0), (35, 30), (42, 70), (48, 100)],
        )
        temperature_component = max(cold if feels_like < 5 else 0, heat if feels_like > 30 else 0)

    weighted = (
        0.45 * condition_component
        + 0.25 * precipitation_component
        + 0.15 * visibility_component
        + 0.10 * gust_component
        + 0.05 * temperature_component
    )
    risk = max(
        weighted,
        0.70 * condition_component,
        0.65 * visibility_component,
    )
    description = (condition.get("description") or {}).get("text")
    return WeatherFeatures(
        risk=round(clamp(risk), 2),
        condition_type=condition_type or "TYPE_UNSPECIFIED",
        condition_description=description,
        precipitation_probability=(
            None if probability is None else round(clamp(probability) / 100, 4)
        ),
        visibility_kilometers=(
            None if visibility is None else round(max(0, visibility), 2)
        ),
        wind_gust_kph=None if gust is None else round(max(0, gust), 2),
        feels_like_celsius=(
            None if feels_like is None else round(feels_like, 2)
        ),
        observed_at=payload.get("currentTime"),
    )


class GoogleWeatherProvider:
    def __init__(self, api_key: str, timeout_seconds: float = 2.0) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    async def current_conditions(
        self,
        latitude: float,
        longitude: float,
    ) -> WeatherFeatures | None:
        params: dict[str, str | float] = {
            "key": self._api_key,
            "location.latitude": latitude,
            "location.longitude": longitude,
            "unitsSystem": "METRIC",
            "languageCode": "en",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.get(GOOGLE_WEATHER_URL, params=params)
            if response.status_code >= 400:
                return None
            payload = response.json()
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            return None
        if not isinstance(payload, dict):
            return None
        try:
            return calculate_weather_features(payload)
        except (ValueError, TypeError, AttributeError):
            return None
