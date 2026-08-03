# MoodMaps MVP Product Spec

## Product promise

Map apps help users find the fastest route. MoodMaps helps users compare how calm each driving route may feel and explains the time-versus-comfort trade-off.

## Primary flow

1. The user plans a desktop driving route in Google Maps, Apple Maps, Waze, or Amap.
2. The user opens MoodMaps from the Chrome toolbar.
3. MoodMaps automatically reads the current supported-map route context.
4. Route analysis starts automatically and remains visible on the map's route cards.
5. The toolbar popup opens directly on the selected route's score calculation.
6. The user can inspect the general model and compact summaries of the other routes.

## MVP scope

- Chrome desktop and Manifest V3.
- Driving routes only.
- One origin and one destination.
- A compact, read-only toolbar popup as the primary detailed experience.
- Compact Mood Score badges inside high-confidence supported-map route cards.
- No account or cloud sync.
- Explainable weighted scoring.
- A clear empty state when a stable driving route cannot be detected.

## Out of scope

- Turn-by-turn navigation.
- Mobile Chrome.
- Social features.
- Machine-learning or medical claims.
- Internal network request scraping from any supported map.

## Quality goals

- Automatic origin and destination detection target: at least 90 percent.
- Low-confidence route contexts are never analyzed silently.
- The same inputs always produce the same Mood Score.
- Increasing congestion cannot improve a score.
- Two to four understandable reasons per route.
- No API key in extension bundles.
- Missing provider data is excluded and disclosed, never synthesized as favorable.
- Weather failure never blocks route-only scoring.
- No full street address or point-of-interest name is sent for weather geocoding.

## Language guardrails

Use estimated calmness, route comfort estimate, and experimental Mood Score. Do not use safe route, guaranteed stress reduction, or mental-health diagnosis.
