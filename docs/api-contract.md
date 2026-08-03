# MoodMaps API Contract

Version: 1.0

## Scope

The backend is an optional demo and research service. The current MoodMaps
extension does not call this API. The default configuration is demo mode and
does not require an external route provider.

Production starts `app.main:app`. Tests and local integrations can construct an
isolated application without reading production settings:

```python
from app.factory import create_app

application = create_app(
    explicit_settings,
    analysis_service=optional_test_service,
    rate_limiter=optional_test_limiter,
)
```

## Liveness

`GET /health` returns:

```json
{
  "status": "ok",
  "mode": "demo"
}
```

This is a liveness check only. It reports that the process can serve requests
and identifies `demo` or `live` mode. It does not contact an external provider
or assert that route analysis is ready.

## Readiness

`GET /ready` returns HTTP 200 when demo mode is active or a live route provider
is locally configured:

```json
{
  "status": "ready",
  "mode": "demo"
}
```

An unconfigured live service returns HTTP 503:

```json
{
  "status": "not_ready",
  "mode": "live",
  "reason": "route_service_not_configured"
}
```

Readiness checks local configuration and does not make a paid or external API
request.

## Analyze routes

`POST /v1/routes/analyze`

Request:

```json
{
  "origin": {
    "text": "Boston South Station",
    "latitude": 42.3519,
    "longitude": -71.0552
  },
  "destination": {
    "text": "Yale University"
  },
  "departureTime": "2030-07-17T14:30:00-04:00",
  "preferences": {
    "avoidTolls": false,
    "avoidHighways": false
  },
  "client": {
    "extensionVersion": "0.1.0",
    "locale": "en-US"
  }
}
```

Input rules:

- `origin.text` and `destination.text` are required, normalized for whitespace,
  and limited to 300 characters.
- A location may omit coordinates, or provide both `latitude` and `longitude`.
  Supplying only one coordinate is `INVALID_INPUT`.
- `departureTime` must be timezone-aware and include `Z` or an explicit UTC
  offset. Naive local datetimes are `INVALID_INPUT`.
- Demo mode accepts historical departure times. A configured live provider
  requires a current or future departure, with a five-minute clock-skew grace
  period.
- Unknown request fields are rejected. Preferences default to `false`, and
  `client` is optional.

The current demo returns three sample routes. The abbreviated response below
shows the first route:

```json
{
  "schemaVersion": "1.0",
  "analysisId": "an_example",
  "generatedAt": "2026-07-25T02:50:02Z",
  "routes": [
    {
      "routeId": "route_fast",
      "description": "Fastest route via main roads",
      "durationMinutes": 48,
      "staticDurationMinutes": 38,
      "distanceMeters": 58400,
      "features": {
        "slowDistanceShare": 0.31,
        "jamDistanceShare": 0.17,
        "delayRatio": 0.2632,
        "weightedManeuvers": 10.2,
        "maneuverCount": 19,
        "maneuverDensity": 1.747,
        "durationMinutes": 48,
        "weather": {
          "risk": 28,
          "conditionType": "LIGHT_RAIN_SHOWERS",
          "conditionDescription": "Light rain showers",
          "precipitationProbability": 0.55,
          "visibilityKilometers": 10,
          "windGustKph": 24,
          "feelsLikeCelsius": 17,
          "observedAt": null
        }
      },
      "hasTolls": false
    }
  ],
  "attribution": {
    "routeDataProvider": "MoodMaps sample dataset",
    "weatherDataProvider": "MoodMaps sample weather",
    "demoData": true
  }
}
```

`features.weather` and `attribution.weatherDataProvider` remain nullable for
route implementations that do not provide weather.

## Request guard and rate limit

- The default maximum request body is 16,384 bytes and is configurable with
  `MAX_REQUEST_BODY_BYTES`.
- Both declared `Content-Length` bodies and streamed bodies are bounded. An
  oversized body returns HTTP 413 with `REQUEST_TOO_LARGE`.
- Rate limiting runs before body buffering, JSON parsing, and schema
  validation. Invalid and oversized attempts therefore consume rate-limit
  capacity.
- A rejected request returns HTTP 429 with `RATE_LIMITED` and a `Retry-After`
  response header.
- The bundled limiter is per client IP and per process. Multi-worker or
  multi-instance deployments require a shared limiter or an equivalent edge
  control.

Internet-facing deployments should also enforce body size, connection
concurrency, and read timeouts at the reverse proxy. Application-level limits
cannot prevent a slow client from occupying a socket before ASGI receives the
body.

## Stable errors

Errors use this shape:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please wait a moment and try again.",
    "retryable": true,
    "requestId": null
  }
}
```

Generic codes include:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Body, coordinates, or departure time is invalid. |
| 404 | `NO_ROUTES_FOUND` | No route is available for the request. |
| 413 | `REQUEST_TOO_LARGE` | The request exceeds the configured body limit. |
| 429 | `RATE_LIMITED` | The client exceeded the current process limit. |
| 500 | `INTERNAL_ERROR` | An unexpected server error occurred. |
| 502 | `UPSTREAM_ERROR` | An optional route provider failed. |
| 503 | `SERVICE_NOT_CONFIGURED` | Live mode has no configured provider. |

`requestId` may be null for errors rejected before analysis begins.
