import type { AnalyzeResponse } from "../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function isShare(value: unknown): boolean {
  return (
    value === null ||
    (isFiniteNumber(value) && value <= 1)
  );
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isOptionalNullableStress(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isFiniteNumber(value) && value <= 100)
  );
}

function isNullableNonnegativeInteger(value: unknown): boolean {
  return (
    value === null ||
    (Number.isInteger(value) && isFiniteNumber(value))
  );
}

function isValidWeather(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.risk) &&
    value.risk <= 100 &&
    typeof value.conditionType === "string"
  );
}

function isValidRoute(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.features)) return false;
  const features = value.features;
  return (
    typeof value.routeId === "string" &&
    value.routeId.length > 0 &&
    typeof value.description === "string" &&
    isFiniteNumber(value.durationMinutes, Number.EPSILON) &&
    isFiniteNumber(value.staticDurationMinutes, Number.EPSILON) &&
    isFiniteNumber(value.distanceMeters, Number.EPSILON) &&
    typeof value.hasTolls === "boolean" &&
    isShare(features.slowDistanceShare) &&
    isShare(features.jamDistanceShare) &&
    isOptionalNullableStress(features.trafficStress) &&
    isFiniteNumber(features.delayRatio) &&
    isNullableFiniteNumber(features.weightedManeuvers) &&
    isNullableNonnegativeInteger(features.maneuverCount) &&
    isNullableFiniteNumber(features.maneuverDensity) &&
    isOptionalNullableStress(features.complexityStress) &&
    isFiniteNumber(features.durationMinutes, Number.EPSILON) &&
    isValidWeather(features.weather)
  );
}

export function parseAnalyzeResponse(data: unknown): AnalyzeResponse | null {
  if (!isRecord(data) || data.schemaVersion !== "1.0") return null;
  if (
    typeof data.analysisId !== "string" ||
    typeof data.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(data.generatedAt)) ||
    !Array.isArray(data.routes) ||
    data.routes.length === 0 ||
    !data.routes.every(isValidRoute) ||
    !isRecord(data.attribution) ||
    typeof data.attribution.routeDataProvider !== "string"
  ) {
    return null;
  }
  return data as unknown as AnalyzeResponse;
}
