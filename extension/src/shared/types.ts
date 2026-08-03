export interface LocationInput {
  text: string;
  latitude?: number;
  longitude?: number;
}

export type MapProvider = "google" | "apple" | "waze" | "amap" | "unknown";

export interface RouteContext {
  provider: MapProvider;
  origin: LocationInput | null;
  destination: LocationInput | null;
  travelMode: "DRIVE" | "UNKNOWN";
  departureTime: string;
  source: "url" | "dom" | "manual" | "mixed";
  confidence: number;
  pageUrl: string;
  observedRoutes?: ObservedRoute[];
}

export interface ObservedRoute {
  description: string;
  durationMinutes: number;
  distanceMeters: number | null;
  hasTolls: boolean;
  withoutTrafficMinutes: number | null;
  trafficSignal: "heavy" | "slow" | "light" | "unknown";
}

export interface RoutePreferences {
  avoidTolls: boolean;
  avoidHighways: boolean;
}

export interface AnalyzeRequest {
  origin: LocationInput;
  destination: LocationInput;
  departureTime: string;
  preferences: RoutePreferences;
  client?: {
    extensionVersion: string;
    locale: string;
  };
}

export interface WeatherFeatures {
  risk: number;
  conditionType: string;
  conditionDescription: string | null;
  precipitationProbability: number | null;
  visibilityKilometers: number | null;
  windGustKph: number | null;
  feelsLikeCelsius: number | null;
  observedAt: string | null;
}

export interface RouteFeatures {
  slowDistanceShare: number | null;
  jamDistanceShare: number | null;
  /** Direct visible-page traffic proxy used only when segment shares are absent. */
  trafficStress?: number | null;
  delayRatio: number;
  weightedManeuvers: number | null;
  maneuverCount: number | null;
  maneuverDensity: number | null;
  /** Deterministic route-description proxy used only when maneuvers are absent. */
  complexityStress?: number | null;
  durationMinutes: number;
  weather?: WeatherFeatures | null;
}

export interface AnalyzedRoute {
  routeId: string;
  description: string;
  durationMinutes: number;
  staticDurationMinutes: number;
  distanceMeters: number;
  features: RouteFeatures;
  hasTolls: boolean;
}

export interface AnalyzeResponse {
  schemaVersion: "1.0";
  analysisId: string;
  generatedAt: string;
  routes: AnalyzedRoute[];
  attribution: {
    routeDataProvider: string;
    weatherDataProvider?: string | null;
  };
}

export interface AppError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export type RouteRecommendation = "Fastest" | "Balanced" | "Calmest";

export type MoodScoreComponentKey =
  | "traffic"
  | "delay"
  | "maneuver"
  | "duration"
  | "weather";

export interface MoodScoreComponentExplanation {
  key: MoodScoreComponentKey;
  label: string;
  stress: number | null;
  effectiveWeight: number;
  contribution: number | null;
}

export interface MoodScoreExplanation {
  routeStress: number;
  routeCalmness: number;
  finalScore: number;
  components: MoodScoreComponentExplanation[];
}

export interface ScoreReason {
  type: "positive" | "negative" | "neutral";
  message: string;
  messageZh: string;
}

export interface RouteBadgeItem {
  routeId: string;
  description: string;
  durationMinutes: number;
  score: number;
  label: string;
  roles: RouteRecommendation[];
  explanation: MoodScoreExplanation;
  reasons: ScoreReason[];
}

export interface RouteBadgePayload {
  contextSignature: string;
  generatedAt: string;
  routes: RouteBadgeItem[];
}

export interface RouteBadgeViewState {
  payload: RouteBadgePayload | null;
  state: "idle" | "loading" | "error";
  selectedRouteId: string | null;
}

export type ExtensionMessage =
  | { type: "ROUTE_CONTEXT_UPDATED"; payload: RouteContext }
  | { type: "GET_CURRENT_ROUTE_CONTEXT" }
  | { type: "EXTRACT_ROUTE_CONTEXT" }
  | { type: "ANALYZE_ROUTE_BADGES"; payload: RouteContext }
  | { type: "GET_ROUTE_BADGE_STATE" }
  | { type: "ROUTE_BADGE_STATE_UPDATED"; payload: RouteBadgeViewState }
  | { type: "UPDATE_ROUTE_BADGES"; payload: RouteBadgePayload }
  | { type: "CLEAR_ROUTE_BADGES" };
