# Chrome Web Store Materials

## Product name

MoodMaps - Route Calmness Scores

## Short description

Compare driving routes in Google Maps, Apple Maps, Waze, and Amap using available delay, duration, traffic, complexity, and current-weather signals.

## Detailed description

MoodMaps works alongside Google Maps, Apple Maps, Waze, and Amap to help you compare driving routes by more than travel time.

For each available route, MoodMaps estimates a Mood Score from trustworthy signals that are currently available. The shipped local analysis uses visible ETA, explicit traffic-related route text, relative pace across comparable visible alternatives, route-name structure, route duration, and optional current weather from Open-Meteo. Traffic and Complexity fallbacks are labeled as estimates; MoodMaps does not invent detailed traffic segments, maneuvers, or turn counts when the map page does not expose them.

MoodMaps highlights:

- Mood Scores displayed directly inside supported map route cards
- A read-only popup that follows the selected route and shows its exact calculation
- One-click Chinese/English switching that updates both the popup and map cards
- Fastest route
- Balanced route
- Calmest route
- Clear explanations of the time-versus-comfort trade-off

Mood Score is an experimental comfort estimate. It is not a safety, medical, or navigation guarantee.

Visible route-card information comes from the supported map page selected by the user. Weather data is provided by Open-Meteo. Mood Score and explanations are independently calculated by MoodMaps.

MoodMaps is an independent project and is not affiliated with or endorsed by Google, Apple, Waze, or Amap.

## Permission reasons

Toolbar popup: Displays the selected route calculation without a duplicate route-entry form.

storage: Stores the Chinese/English interface preference locally and holds short-lived route/weather cache entries in Chrome session storage.

Google Maps, Apple Maps, Waze, and Amap host permissions: Read only the active route context selected by the user on those map sites.

Open-Meteo host permissions: Retrieves no-key current weather from endpoint coordinates when available. If coordinates are absent, MoodMaps may resolve only clearly coarse city or region text; it never sends a full street address or point-of-interest name.

## Review test instructions

1. Open Google Maps, Apple Maps, Waze, or Amap.
2. Select Directions and choose Driving.
3. Enter Boston South Station as the origin.
4. Enter Yale University as the destination.
5. Click the MoodMaps toolbar icon.
6. MoodMaps automatically displays the selected route's score and calculation.
7. Expand “How Mood Score works” to inspect the general weighted model.

No login or paid mapping API key is required.
