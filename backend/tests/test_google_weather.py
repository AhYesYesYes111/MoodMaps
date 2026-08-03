from app.providers.google_weather import (
    GoogleWeatherProvider,
    calculate_weather_features,
    condition_risk,
)
import httpx
import pytest


def test_clear_weather_has_no_stress() -> None:
    weather = calculate_weather_features(
        {
            "currentTime": "2026-07-17T16:00:00Z",
            "weatherCondition": {
                "type": "CLEAR",
                "description": {"text": "Clear"},
            },
            "precipitation": {"probability": {"percent": 0}},
            "wind": {
                "gust": {"value": 10, "unit": "KILOMETERS_PER_HOUR"}
            },
            "visibility": {"distance": 16, "unit": "KILOMETERS"},
            "feelsLikeTemperature": {"degrees": 22, "unit": "CELSIUS"},
        }
    )
    assert weather is not None
    assert weather.risk == 0
    assert weather.precipitation_probability == 0


def test_severe_weather_produces_high_bounded_stress() -> None:
    weather = calculate_weather_features(
        {
            "weatherCondition": {
                "type": "HEAVY_THUNDERSTORM",
                "description": {"text": "Heavy thunderstorm"},
            },
            "precipitation": {"probability": {"percent": 100}},
            "thunderstormProbability": 100,
            "wind": {"gust": {"value": 45, "unit": "MILES_PER_HOUR"}},
            "visibility": {"distance": 0.5, "unit": "MILES"},
            "feelsLikeTemperature": {"degrees": 72, "unit": "FAHRENHEIT"},
        }
    )
    assert weather is not None
    assert 75 <= weather.risk <= 100
    assert weather.wind_gust_kph is not None
    assert weather.wind_gust_kph > 70
    assert weather.visibility_kilometers is not None
    assert weather.visibility_kilometers < 1


def test_condition_mapping_is_conservative_for_light_rain() -> None:
    assert condition_risk("LIGHT_RAIN_SHOWERS") < condition_risk("HEAVY_RAIN")
    assert condition_risk("CLEAR") == 0


@pytest.mark.asyncio
async def test_optional_weather_falls_back_when_payload_is_malformed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeClient:
        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> object:
            return type(
                "Response",
                (),
                {
                    "status_code": 200,
                    "json": lambda _self: {
                        "weatherCondition": {"type": ["not", "a", "string"]}
                    },
                },
            )()

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    provider = GoogleWeatherProvider("test-key")
    assert await provider.current_conditions(40.0, -73.0) is None
