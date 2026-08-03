import { routeDataProviderLabel } from "../shared/map-provider";
import type {
  AnalyzeResponse,
  MapProvider,
  ObservedRoute,
  WeatherFeatures
} from "../shared/types";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const TRAFFIC_SIGNAL_STRESS = {
  light: 15,
  slow: 55,
  heavy: 85
} as const;

/**
 * Uses only traffic evidence already visible in the route card. It never
 * claims to know segment shares: explicit labels provide an ordinal estimate,
 * ETA versus a displayed without-traffic time provides a time-based one, and
 * a caller-supplied relative pace is the last resort when multiple visible
 * alternatives expose both distance and time.
 */
export function visibleTrafficStress(
  route: ObservedRoute,
  relativePaceStress: number | null = null
): number | null {
  const labelStress =
    route.trafficSignal === "unknown"
      ? null
      : TRAFFIC_SIGNAL_STRESS[route.trafficSignal];
  const withoutTraffic = route.withoutTrafficMinutes;
  const etaStress =
    withoutTraffic !== null &&
    Number.isFinite(withoutTraffic) &&
    withoutTraffic > 0 &&
    route.durationMinutes >= withoutTraffic
      ? clamp(
          ((route.durationMinutes / withoutTraffic - 1) / 0.6) * 100,
          0,
          100
        )
      : null;
  if (labelStress !== null && etaStress !== null) {
    return Math.max(labelStress, etaStress);
  }
  if (etaStress !== null) return etaStress;
  if (labelStress !== null) return labelStress;
  return relativePaceStress;
}

function addMatches(
  target: Set<string>,
  value: string,
  pattern: RegExp
): void {
  for (const match of value.matchAll(pattern)) {
    const normalized = match[0]
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) target.add(normalized);
  }
}

/**
 * Produces a repeatable route-name complexity proxy without pretending that
 * route-card text contains turn-by-turn maneuvers. Unrecognizable placeholder
 * names return null and therefore leave Complexity out of the score.
 */
export function routeDescriptionComplexityStress(
  description: string
): number | null {
  const normalized = description
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ");
  if (!normalized) return null;

  const roads = new Set<string>();
  addMatches(
    roads,
    normalized,
    /\b(?:I|US|U\.S\.|SR|SH|CT|NY|MA|NJ|PA|CA|A|M|N)[- ]?\d{1,4}[A-Z]?\b/gi
  );
  addMatches(
    roads,
    normalized,
    /\b(?:[A-Z0-9][A-Za-z0-9.'-]*\s+){0,4}(?:Street|Streets|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Highway|Hwy|Expressway|Freeway|Parkway|Turnpike|Bridge|Tunnel)\b/gi
  );
  addMatches(
    roads,
    normalized,
    /[\u3400-\u9fff]{1,12}?(?:高速|快速路|大道|大街|公路|街|路|桥|橋|隧道|环线|環線)/g
  );
  if (
    /\b(?:local|surface) streets?\b|市区道路|市區道路|城市道路/i.test(
      normalized
    )
  ) {
    roads.add("local streets");
  }
  if (roads.size === 0) return null;

  const decisionCues =
    normalized.match(
      /\b(?:exit|merge|ramp|junction|interchange|roundabout)\b|出口|匝道|合流|互通|立交|环岛|環島/g
    )?.length ?? 0;
  return clamp(18 + Math.max(0, roads.size - 1) * 20 + decisionCues * 12, 0, 100);
}

export function createLocalFallbackResponse(
  observedRoutes: ObservedRoute[],
  weather: WeatherFeatures | null = null,
  provider: MapProvider = "unknown"
): AnalyzeResponse {
  const routes = observedRoutes
    .filter(
      (route) =>
        Number.isFinite(route.durationMinutes) && route.durationMinutes > 0
    )
    .slice(0, 5);
  const resolvedDistances = routes.map(
    (route) =>
      route.distanceMeters !== null &&
      Number.isFinite(route.distanceMeters) &&
      route.distanceMeters > 0
        ? route.distanceMeters
        : Math.max(1000, route.durationMinutes * 1150)
  );
  const visibleSpeeds = routes.map((route) =>
    route.distanceMeters !== null &&
    Number.isFinite(route.distanceMeters) &&
    route.distanceMeters > 0
      ? route.distanceMeters / route.durationMinutes
      : null
  );
  const comparableSpeeds = visibleSpeeds.filter(
    (speed): speed is number => speed !== null
  );
  const baselineVisibleSpeed =
    comparableSpeeds.length >= 2 ? Math.max(...comparableSpeeds) : null;
  const fastestDuration = Math.min(
    ...routes.map((route) => route.durationMinutes)
  );

  return {
    schemaVersion: "1.0",
    analysisId: "local_" + Date.now().toString(36),
    generatedAt: new Date().toISOString(),
    routes: routes.map((route, index) => {
      const distanceMeters = resolvedDistances[index];
      const relativeDurationDelay =
        ((route.durationMinutes - fastestDuration) / fastestDuration) * 2.5;
      const relativePaceStress =
        baselineVisibleSpeed !== null && visibleSpeeds[index] !== null
          ? clamp(
              ((baselineVisibleSpeed - visibleSpeeds[index]) /
                baselineVisibleSpeed /
                0.6) *
                100,
              0,
              100
            )
          : null;
      const delayRatio = clamp(
        relativeDurationDelay,
        0,
        0.6
      );
      return {
        routeId: "local_route_" + index,
        description: route.description,
        durationMinutes: route.durationMinutes,
        staticDurationMinutes: Math.max(
          1,
          Math.round(route.durationMinutes / (1 + delayRatio))
        ),
        distanceMeters,
        hasTolls: route.hasTolls,
        features: {
          slowDistanceShare: null,
          jamDistanceShare: null,
          trafficStress: visibleTrafficStress(route, relativePaceStress),
          delayRatio,
          weightedManeuvers: null,
          maneuverCount: null,
          maneuverDensity: null,
          complexityStress: routeDescriptionComplexityStress(
            route.description
          ),
          durationMinutes: route.durationMinutes,
          weather
        }
      };
    }),
    attribution: {
      routeDataProvider: routeDataProviderLabel(provider),
      weatherDataProvider: weather ? "Open-Meteo" : null
    }
  };
}
