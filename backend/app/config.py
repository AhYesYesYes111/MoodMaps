from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    google_maps_api_key: str | None = None
    demo_mode: bool = True
    allowed_origins: str = "*"
    cache_ttl_seconds: int = Field(default=300, ge=0, le=3600)
    cache_max_items: int = Field(default=2048, ge=1, le=100_000)
    rate_limit_per_minute: int = Field(default=10, ge=1, le=1000)
    rate_limit_max_clients: int = Field(default=10_000, ge=1, le=1_000_000)
    max_request_body_bytes: int = Field(
        default=16_384,
        ge=1024,
        le=1_048_576,
    )
    google_routes_timeout_seconds: float = Field(default=8.0, gt=0, le=30)
    google_weather_enabled: bool = False
    google_weather_timeout_seconds: float = Field(default=2.0, gt=0, le=10)
    log_level: str = "INFO"

    @property
    def cors_origins(self) -> list[str]:
        return [
            item.strip() for item in self.allowed_origins.split(",") if item.strip()
        ] or ["*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
