import { createLocalFallbackResponse } from "./background/local-fallback";
import { scoreAnalysis } from "./scoring/scoring";
import { createRouteBadgePayload } from "./shared/route-badge-payload";
import type {
  RouteBadgeViewState,
  RouteContext,
  WeatherFeatures
} from "./shared/types";

const context: RouteContext = {
  provider: "google",
  origin: {
    text: "Boston South Station",
    latitude: 42.3519,
    longitude: -71.0552
  },
  destination: {
    text: "Yale University",
    latitude: 41.3163,
    longitude: -72.9223
  },
  travelMode: "DRIVE",
  departureTime: "2026-07-24T19:00:00Z",
  source: "url",
  confidence: 0.99,
  pageUrl:
    "https://www.google.com/maps/dir/Boston+South+Station/Yale+University",
  observedRoutes: [
    {
      description: "I-90 W and I-84 W",
      durationMinutes: 132,
      distanceMeters: 217_000,
      hasTolls: true,
      withoutTrafficMinutes: 118,
      trafficSignal: "slow"
    },
    {
      description: "I-95 S via Providence",
      durationMinutes: 136,
      distanceMeters: 226_000,
      hasTolls: false,
      withoutTrafficMinutes: 134,
      trafficSignal: "light"
    },
    {
      description: "CT-15 S",
      durationMinutes: 140,
      distanceMeters: 238_000,
      hasTolls: false,
      withoutTrafficMinutes: 137,
      trafficSignal: "light"
    }
  ]
};

const weather: WeatherFeatures = {
  risk: 12,
  conditionType: "CLOUDY",
  conditionDescription: "Cloudy",
  precipitationProbability: null,
  visibilityKilometers: 16,
  windGustKph: 18,
  feelsLikeCelsius: 20,
  observedAt: "2026-07-24T19:00:00Z"
};

const response = createLocalFallbackResponse(
  context.observedRoutes ?? [],
  weather,
  context.provider
);
response.analysisId = "local_store_capture";
response.generatedAt = "2026-07-24T19:00:00Z";
const payload = createRouteBadgePayload(
  response,
  scoreAnalysis(response),
  context.origin?.text ?? "",
  context.destination?.text ?? "",
  context.provider
);
const selectedRouteId =
  payload.routes.find((route) => route.roles.includes("Calmest"))?.routeId ??
  payload.routes[0]?.routeId ??
  null;

const state: RouteBadgeViewState = {
  state: "idle",
  selectedRouteId,
  payload
};

const fakeChrome = {
  runtime: {
    id: "moodmaps-store-capture",
    sendMessage: async (message: { type?: string }) =>
      message?.type === "ANALYZE_ROUTE_BADGES"
        ? { ok: true, value: state.payload }
        : context,
    onMessage: {
      addListener: () => undefined,
      removeListener: () => undefined
    }
  },
  tabs: {
    query: async () => [{ id: 1 }],
    sendMessage: async () => state
  },
  storage: {
    local: {
      get: async () => ({ moodmapsUiLanguage: "en" }),
      set: async () => undefined
    }
  }
};

Object.assign(globalThis.chrome, fakeChrome);

void import("./sidepanel/main");
