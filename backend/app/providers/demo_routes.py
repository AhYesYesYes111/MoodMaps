from datetime import datetime

from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnalyzedRoute,
    Attribution,
    RouteFeatures,
    WeatherFeatures,
)

DEMO_WEATHER = WeatherFeatures(
    risk=28,
    condition_type="LIGHT_RAIN_SHOWERS",
    condition_description="Light rain showers",
    precipitation_probability=0.55,
    visibility_kilometers=10,
    wind_gust_kph=24,
    feels_like_celsius=17,
)


def demo_route(
    route_id: str,
    description: str,
    duration: float,
    static_duration: float,
    distance: int,
    slow: float,
    jam: float,
    weighted_maneuvers: float,
    maneuver_count: int,
) -> AnalyzedRoute:
    delay_ratio = max(0.0, (duration - static_duration) / static_duration)
    density = weighted_maneuvers / max(distance / 10000, 0.1)
    return AnalyzedRoute(
        route_id=route_id,
        description=description,
        duration_minutes=duration,
        static_duration_minutes=static_duration,
        distance_meters=distance,
        has_tolls=False,
        features=RouteFeatures(
            slow_distance_share=slow,
            jam_distance_share=jam,
            delay_ratio=round(delay_ratio, 4),
            weighted_maneuvers=weighted_maneuvers,
            maneuver_count=maneuver_count,
            maneuver_density=round(density, 3),
            duration_minutes=duration,
            weather=DEMO_WEATHER,
        ),
    )


async def analyze_demo(
    request: AnalyzeRequest,
    analysis_id: str,
    generated_at: datetime,
) -> AnalyzeResponse:
    adjustment = (
        len(request.origin.text) * 17 + len(request.destination.text) * 29
    ) % 7 - 3
    routes = [
        demo_route(
            "route_fast",
            "Fastest route via main roads",
            46 + adjustment,
            36 + adjustment,
            58400,
            0.31,
            0.17,
            10.2,
            19,
        ),
        demo_route(
            "route_balanced",
            "Balanced route with steadier traffic",
            51 + adjustment,
            43 + adjustment,
            61200,
            0.18,
            0.07,
            7.1,
            15,
        ),
        demo_route(
            "route_calm",
            "Calmer route with simpler maneuvers",
            56 + adjustment,
            49 + adjustment,
            63700,
            0.12,
            0.03,
            4.8,
            11,
        ),
    ]
    return AnalyzeResponse(
        analysis_id=analysis_id,
        generated_at=generated_at,
        routes=routes,
        attribution=Attribution(
            route_data_provider="MoodMaps sample dataset",
            weather_data_provider="MoodMaps sample weather",
            demo_data=True,
        ),
    )
