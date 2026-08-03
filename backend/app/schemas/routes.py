from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class LocationInput(ApiModel):
    text: str = Field(min_length=1, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Location text cannot be empty.")
        return normalized

    @model_validator(mode="after")
    def require_complete_coordinates(self) -> "LocationInput":
        has_latitude = self.latitude is not None
        has_longitude = self.longitude is not None
        if has_latitude != has_longitude:
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class RoutePreferences(ApiModel):
    avoid_tolls: bool = False
    avoid_highways: bool = False


class ClientInfo(ApiModel):
    extension_version: str = Field(max_length=30)
    locale: str = Field(max_length=30)


class AnalyzeRequest(ApiModel):
    origin: LocationInput
    destination: LocationInput
    departure_time: datetime
    preferences: RoutePreferences = Field(default_factory=RoutePreferences)
    client: ClientInfo | None = None

    @field_validator("departure_time")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Departure time must include a timezone offset.")
        return value


class WeatherFeatures(ApiModel):
    risk: float = Field(ge=0, le=100)
    condition_type: str
    condition_description: str | None = None
    precipitation_probability: float | None = Field(default=None, ge=0, le=1)
    visibility_kilometers: float | None = Field(default=None, ge=0)
    wind_gust_kph: float | None = Field(default=None, ge=0)
    feels_like_celsius: float | None = None
    observed_at: datetime | None = None


class RouteFeatures(ApiModel):
    slow_distance_share: float | None = Field(default=None, ge=0, le=1)
    jam_distance_share: float | None = Field(default=None, ge=0, le=1)
    delay_ratio: float = Field(ge=0)
    weighted_maneuvers: float = Field(ge=0)
    maneuver_count: int = Field(ge=0)
    maneuver_density: float = Field(ge=0)
    duration_minutes: float = Field(gt=0)
    weather: WeatherFeatures | None = None


class AnalyzedRoute(ApiModel):
    route_id: str
    description: str
    duration_minutes: float = Field(gt=0)
    static_duration_minutes: float = Field(gt=0)
    distance_meters: int = Field(gt=0)
    features: RouteFeatures
    has_tolls: bool = False


class Attribution(ApiModel):
    route_data_provider: str
    weather_data_provider: str | None = None
    demo_data: bool = False


class AnalyzeResponse(ApiModel):
    schema_version: Literal["1.0"] = "1.0"
    analysis_id: str
    generated_at: datetime
    routes: list[AnalyzedRoute]
    attribution: Attribution
