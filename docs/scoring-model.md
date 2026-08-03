# Mood Score V2

Mood Score is a deterministic and experimental route comfort estimate.

V2 uses a 209-response first-hand questionnaire as a conservative product prior. The two local Excel files are the same responses in numeric and text form; they are paired by response ID rather than counted twice. Row-level intermediates stay in the ignored `analysis/raw/` directory. The repository publishes only aggregate evidence and the executed `analysis/moodmaps_survey_calibration.ipynb`.

## Route stress

    Traffic Stress = clamp(100 × (0.45 × slow share + 1.20 × jam share))
    Delay Stress = clamp((delay ratio / 0.60) × 100)
    Complexity Stress = clamp((maneuver density / 10) × 100)
    Duration Stress = clamp((duration minutes / 180) × 100)

    Weather Stress = bounded risk from condition type, precipitation,
                     visibility, wind gust, and apparent temperature

    Route Stress = weighted mean of the available components:
        0.32 × Traffic Stress
      + 0.20 × Delay Stress
      + 0.20 × Complexity Stress
      + 0.12 × Duration Stress
      + 0.16 × Weather Stress

    Route Calmness = 100 - Route Stress

Trustworthy segment shares and maneuver density take priority when a provider supplies them. The shipped extension does not request those private details. It uses the following deterministic, disclosed page-visible fallbacks instead:

- Traffic first maps an explicit visible congestion label to 15 (light), 55 (slow), or 85 (heavy). A displayed ETA versus without-traffic time produces `clamp(((ETA / without-traffic) - 1) / 0.60 × 100)`, and the stronger of those two signals wins. If neither is visible, at least two alternatives with visible time and distance can produce a relative-pace proxy: `clamp(((best pace - route pace) / best pace) / 0.60 × 100)`.
- Complexity recognizes unique road names or numbers in the visible route description and explicit exit, merge, ramp, junction, interchange, or roundabout cues. Its proxy is `clamp(18 + 20 × (road count - 1) + 12 × cue count)`. This measures visible route-name structure; it is not presented as a turn count.
- Delay is kept separate from Traffic and uses only the route's visible duration relative to the fastest visible alternative. This prevents the congestion label and ETA-versus-without-traffic signal from being counted again as Delay.

The same normalized visible input therefore produces the same Traffic and Complexity values on every calculation. If there is only one route with no congestion label or without-traffic time, Traffic remains unavailable. If a route description is a generic placeholder or contains no recognizable road structure, Complexity remains unavailable. Missing traffic, complexity, or weather is never interpreted as zero stress: the component is removed and the available weights are renormalized to exactly 100 percent.

Weather uses one current-condition lookup at the geographic midpoint of the two available endpoint coordinates and is shared across nearby alternatives. This point is not represented as the route's actual midpoint. If coordinates are absent, only explicitly coarse city or region text may be geocoded; otherwise weather is skipped. One 4.5-second deadline covers the complete optional lookup, which fails open to the renormalized route-only score.

## Survey calibration

- 73.2% selected serious congestion among their three most important factors.
- 60.3% selected bad weather.
- 72.2% said rain, fog, or storms make their mood somewhat or clearly worse.
- Only 8.6% selected long distance in their top three, while long-distance attitudes were split between higher-income upside and fatigue cost.

These results justify adding bounded weather stress and reducing the duration penalty. They do not justify causal or universal coefficients: all 209 responses came through one sample service, 60.3% were completed in under 90 seconds, and roles were self-reported. The production weights therefore shrink the survey signal instead of copying the raw ranking directly.

## Labels

- 85-100: Very Calm
- 70-84: Calm
- 55-69: Balanced
- 40-54: Stressful
- 0-39: Very Stressful

## Explanations

Each route displays two to four bilingual comparative reasons. Clicking its route-card badge shows the available component stress inputs, their effective weights, weighted contributions, reasons, and the final formula. The toolbar popup opens directly on the selected route's same calculation, followed by a separate general-method disclosure. Proxy use and genuinely missing inputs are disclosed; segment shares and maneuver counts are never invented. Displayed effective weights use consistent rounding and sum to exactly 100 percent. Scores are rounded to whole numbers to avoid false precision.

These parameters are product-prototype assumptions, not medical fatigue thresholds, safety standards, weather warnings, or driving-law guidance.
