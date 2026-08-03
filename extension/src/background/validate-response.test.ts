import { describe, expect, it } from "vitest";
import type { AnalyzeResponse } from "../shared/types";
import { parseAnalyzeResponse } from "./validate-response";

function routeServiceResponse(): AnalyzeResponse {
  return {
    schemaVersion: "1.0",
    analysisId: "analysis_123",
    generatedAt: "2026-07-18T16:00:00Z",
    routes: [
      {
        routeId: "route_0",
        description: "via I-95 N",
        durationMinutes: 105,
        staticDurationMinutes: 92,
        distanceMeters: 130000,
        hasTolls: true,
        features: {
          slowDistanceShare: 0.18,
          jamDistanceShare: 0.06,
          delayRatio: 0.14,
          weightedManeuvers: 8.2,
          maneuverCount: 18,
          maneuverDensity: 0.63,
          durationMinutes: 105,
          weather: null
        }
      }
    ],
    attribution: { routeDataProvider: "Google Maps Platform" }
  };
}

describe("route service response validation", () => {
  it("accepts a complete response", () => {
    expect(parseAnalyzeResponse(routeServiceResponse())).not.toBeNull();
  });

  it("rejects incomplete or non-finite scoring inputs", () => {
    const response = routeServiceResponse();
    response.routes[0].features.delayRatio = Number.NaN;
    expect(parseAnalyzeResponse(response)).toBeNull();

    const incomplete = routeServiceResponse() as unknown as {
      routes: Array<{ features: Record<string, unknown> }>;
    };
    delete incomplete.routes[0].features.maneuverDensity;
    expect(parseAnalyzeResponse(incomplete)).toBeNull();
  });

  it("accepts explicitly unavailable maneuver metrics", () => {
    const response = routeServiceResponse();
    response.routes[0].features.weightedManeuvers = null;
    response.routes[0].features.maneuverCount = null;
    response.routes[0].features.maneuverDensity = null;
    expect(parseAnalyzeResponse(response)).not.toBeNull();
  });

  it("accepts bounded local proxies and rejects invalid proxy stress", () => {
    const response = routeServiceResponse();
    response.routes[0].features.slowDistanceShare = null;
    response.routes[0].features.jamDistanceShare = null;
    response.routes[0].features.trafficStress = 55;
    response.routes[0].features.weightedManeuvers = null;
    response.routes[0].features.maneuverCount = null;
    response.routes[0].features.maneuverDensity = null;
    response.routes[0].features.complexityStress = 38;
    expect(parseAnalyzeResponse(response)).not.toBeNull();

    response.routes[0].features.trafficStress = 101;
    expect(parseAnalyzeResponse(response)).toBeNull();
  });
});
