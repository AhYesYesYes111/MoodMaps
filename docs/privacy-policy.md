# MoodMaps Privacy Policy

Last updated: July 24, 2026

MoodMaps is a Chrome extension that compares driving routes selected by a user and provides an experimental route comfort estimate.

## Information processed

MoodMaps reads the route names, ETA, distance, toll warning, and traffic-related text already visible in active Google Maps, Apple Maps, Waze, or Amap route cards. These route signals are processed locally in the extension.

For weather, MoodMaps prefers coordinates already exposed for the route endpoints and sends only their geographic midpoint to Open-Meteo. It does not claim that this point lies on the route. If endpoint coordinates are unavailable, MoodMaps may geocode only text that is clearly city- or region-level. It never sends a full street address or a point-of-interest name to Open-Meteo, and it skips weather when a privacy-preserving lookup is not possible.

MoodMaps does not collect browsing history, cookies, advertising identifiers, or the full map page DOM.

## Purpose and retention

Route inputs are processed only to calculate route comparisons and retrieve current weather. The current route context may be held in Chrome session storage for tab synchronization and is cleared when the tab navigates or closes. Weather results use coordinate- or coarse-region-based cache keys, never raw street addresses, and may be cached for up to fifteen minutes; expired entries are removed when encountered. MoodMaps does not create a long-term location history.

The selected Chinese or English interface preference is stored locally in Chrome so the popup and map-card interface stay synchronized.

## Service providers

Current weather and optional coarse geocoding are processed by Open-Meteo. Its processing may be subject to its own terms and privacy practices.

## Sharing and sale

MoodMaps does not sell personal information and does not use route data for advertising, credit evaluation, or medical profiling.

## Security

MoodMaps uses HTTPS and short-lived Chrome session caching. No method of transmission is guaranteed to be completely secure.

## User choices

Users can clear MoodMaps local storage through Chrome or uninstall the extension. If future versions store server-side user data, this policy and the deletion process will be updated before collection begins.

## Children and international users

MoodMaps is a route-comparison tool and is not intended to make safety or medical decisions. Local laws and platform requirements may provide additional rights.

## Contact

For privacy or support questions, contact support@moodmaps.app.

MoodMaps is independent and is not affiliated with or endorsed by Google, Apple, Waze, or Amap. Mood Score is an experimental comfort estimate, not a safety or medical assessment.
