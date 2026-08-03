# Release Checklist

## Functionality

- [ ] Load extension/dist with Chrome Load unpacked.
- [ ] Confirm the compact toolbar popup opens on Google Maps, Apple Maps, Waze, and Amap.
- [ ] Confirm each detected route card receives one MoodMaps control on every supported map.
- [ ] Click each score badge and confirm the route-specific calculation dialog opens, closes, and stays inside the viewport.
- [ ] Confirm live scores bind only when route duration or description matching is confident.
- [ ] Test English and Chinese route extraction through both URL and semantic DOM.
- [ ] On Amap, test `amap.com` and `ditu.amap.com`, route switching, and the `current` selected-card state.
- [ ] Confirm automatic analysis runs once per stable route context and does not loop after DOM updates.
- [ ] Change visible ETA, without-traffic time, and traffic warnings without changing route duration; confirm the analysis refreshes once.
- [ ] With two alternatives that expose time and distance but no traffic label, confirm the relative-pace Traffic proxy appears and is identical after repeated analysis of unchanged cards.
- [ ] Confirm recognizable road names and exit/merge cues produce the same Complexity proxy on repeated analysis, while generic route placeholders do not.
- [ ] Navigate an analyzed tab to a new or unsupported page; confirm the old route context and badges are cleared.
- [ ] Confirm Fastest, Balanced, and Calmest can all appear on one route without any role being hidden.
- [ ] Confirm zero confidently matched routes shows a recoverable error rather than an empty results panel.
- [ ] Confirm unavailable traffic, complexity, or weather inputs are marked “not used,” never treated as zero, and the displayed weights total exactly 100%.
- [ ] Confirm each route shows two to four matching bilingual reasons in the popup and map-card explainer.
- [ ] Confirm the popup opens directly on the selected route calculation and contains no duplicate route-entry form.
- [ ] Switch between Chinese and English and confirm the popup, route cards, loading states, errors, and score explanations update together without a refresh.
- [ ] Confirm the separate “How Mood Score works” block shows the base weights and formula.
- [ ] Test offline weather, the global weather deadline, storage failures, invalid input, and no-route errors.
- [ ] Confirm Open-Meteo requests prefer coordinates and never contain full street addresses or point-of-interest names.
- [ ] Confirm expired weather entries are removed and cached keys contain only coordinates or coarse city/region text.
- [ ] Test meters, decimal commas, and thousands separators in distance parsing.
- [ ] Test localized driving-mode detection on all four supported providers; unknown modes must not be treated as driving.

## Quality

- [ ] Extension unit tests and type checking pass.
- [ ] Backend tests pass.
- [ ] Production build has no source maps or remote scripts.
- [ ] Chrome console has no persistent errors.
- [ ] Validate keyboard access, focus, labels, contrast, and reduced motion.
- [ ] Confirm all explanatory and disclaimer text remains readable at 200% zoom.
- [ ] Complete the real-route matrix from the development manual.

## Security and privacy

- [ ] No paid mapping API key or localhost backend host is present in the production extension.
- [ ] Host permissions are limited to the four supported map sites and Open-Meteo.
- [ ] Store privacy disclosures match the shipped behavior.
- [ ] support@moodmaps.app is active, or replace it before publication.

## Store package

- [ ] Increase extension/package.json and manifest version together through the build.
- [ ] Build from a clean dependency install.
- [ ] Verify manifest.json is at the ZIP root.
- [ ] Prepare 16, 32, 48, and 128 pixel icons.
- [ ] Prepare at least one real screenshot, preferably five.
- [ ] Publish the privacy policy at a stable public URL.
- [ ] Complete Store Listing, Privacy, Distribution, and Test Instructions.
- [ ] Start with Private, then Unlisted, then Public after beta.
