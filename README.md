# MoodMaps

MoodMaps is a Manifest V3 Chrome extension that helps a driver compare Google Maps, Apple Maps, Waze, and Amap routes by estimated calmness, not only by travel time. It includes a compact toolbar popup and a local Mood Score engine. The active extension does not require a paid mapping API.

The implementation follows the requirements in the included Chinese development manual.

## What is ready

- Google Maps, Apple Maps, Waze, and Amap origin and destination extraction through URL and semantic DOM.
- Clickable Mood Score badges inside supported route cards, with a route-specific calculation breakdown.
- Automatic route-card analysis with a stable, low-motion loading state.
- Read-only toolbar popup that follows the selected route and opens directly on its score calculation.
- A compact Chinese/English control in the toolbar popup that synchronizes every MoodMaps surface and remembers the user's choice.
- Fastest, Balanced, and Calmest route recommendations.
- Two to four bilingual, route-specific reasons in both the popup and the map-card explainer.
- Survey-calibrated Mood Score V2 using visible map ETA, congestion text, relative route pace, route-name structure, and no-key Open-Meteo weather.
- An optional FastAPI research backend remains available but is not required by the extension.
- Unit and API tests, store copy, privacy materials, icons, and packaging scripts.

## Fastest way to try it

1. Install extension dependencies:

       cd extension
       corepack enable
       pnpm install

2. Build the production extension:

       pnpm build

3. In Chrome, open chrome://extensions, enable Developer mode, select Load unpacked, and choose the extension/dist folder.
4. Open Google Maps, Apple Maps, Waze, or Amap and plan a driving route.
5. Mood Score analysis starts automatically. Click a route-card score to inspect its calculation, or select the toolbar icon to open the detailed popup comparison.
6. Traffic is estimated from explicit visible congestion text, ETA versus a displayed without-traffic time, or comparable time-and-distance pace across visible alternatives. Complexity uses a disclosed route-name structure proxy rather than claiming a turn count. Delay compares visible route times separately. When endpoint coordinates are available, current weather at their geographic midpoint comes from Open-Meteo. Weather is skipped safely when a privacy-preserving lookup is not possible.

## Optional research backend

The backend is a demo-first research harness. The Chrome extension does not call it, and the normal workflow does not require an API key.

    cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -e ".[test]"
    uvicorn app.main:app --reload

Health check:

    curl http://127.0.0.1:8000/health

The default `DEMO_MODE=true` configuration is self-contained. Provider-specific live adapters remain in the repository for isolated research, but they are dormant unless explicitly configured. The production extension has no localhost permission and never sends route analysis to this backend.

## Test and package

    cd extension
    pnpm test
    pnpm typecheck
    pnpm build

    cd ../backend
    pytest

    cd ..
    bash scripts/package-extension.sh

The package script verifies that manifest.json is at the ZIP root.

## Important product language

Mood Score is an experimental comfort estimate. It is not a safety, medical, or navigation guarantee. The supported map displays route and travel-time information; MoodMaps independently calculates Mood Scores and explanations. MoodMaps is not affiliated with or endorsed by Google, Apple, Waze, or Amap.

## Project map

- extension: Chrome toolbar popup, content script, service worker, scoring, tests, icons.
- backend: optional demo-first FastAPI research service, provider adapters, normalization, and tests.
- docs: product, API, scoring, privacy, review, and release materials.
- scripts: repeatable build and packaging helpers.
- analysis: extracted questionnaire evidence, an executed calibration notebook, and proposed model weights.
