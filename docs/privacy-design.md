# Privacy by Design

## Data map

| Data | Needed | Processing | Retention |
| --- | --- | --- | --- |
| Origin, destination, and current route-card signals | Yes | Locally from the active supported map page | Current tab context in Chrome session storage; cleared on navigation or tab close |
| Endpoint-coordinate midpoint | Optional | Open-Meteo current-weather lookup; this is not claimed to be a point on the route | Fifteen-minute Chrome session cache |
| Clearly coarse city or region text | Optional fallback | Open-Meteo geocoding; street addresses and POI names are rejected | Cache key contains only normalized coarse text |
| Full map URL or DOM | No server upload | Current browser tab only | Not retained |
| Interface language | Optional | Extension only | Chrome local storage; user can clear it |
| Browsing history | No | Not collected | None |

## Security decisions

- No paid mapping API key is bundled or required.
- No remote JavaScript, eval, dynamic command interpreter, or remote script.
- Only storage, supported map hosts, and Open-Meteo hosts are requested; the detailed interface is an action popup.
- Analysis runs only for a driving route actively planned by the user on Google Maps, Apple Maps, Waze, or Amap.
- Weather lookup uses Open-Meteo over HTTPS and fails open to a route-only score when unavailable.
- A single 4.5-second deadline covers optional geocoding and weather retrieval.
- Weather caching is best-effort; storage failures never block local scoring.
- Raw addresses and point-of-interest names are never sent to Open-Meteo or used in weather cache keys.
- Visible route details are reduced locally to versioned route features.
- Timeouts and short session caching limit unnecessary weather requests.

## Chrome Web Store single purpose

MoodMaps analyzes driving routes actively selected by the user on Google Maps, Apple Maps, Waze, or Amap and provides estimated route calmness scores and route comparisons.
