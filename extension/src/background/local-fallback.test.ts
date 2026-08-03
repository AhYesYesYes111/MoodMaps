import { describe, expect, it } from "vitest";
import { scoreAnalysis } from "../scoring/scoring";
import {
  createLocalFallbackResponse,
  routeDescriptionComplexityStress,
  visibleTrafficStress
} from "./local-fallback";

describe("local route fallback", () => {
  it("creates matchable scores from the routes visible in a supported map", () => {
    const response = createLocalFallbackResponse([
      {
        description: "via I-90 E",
        durationMinutes: 227,
        distanceMeters: 339572,
        hasTolls: true,
        withoutTrafficMinutes: 205,
        trafficSignal: "slow"
      },
      {
        description: "via I-95 N",
        durationMinutes: 246,
        distanceMeters: 368540,
        hasTolls: false,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown"
      }
    ], null, "waze");
    expect(response.routes).toHaveLength(2);
    expect(response.routes[0]).toMatchObject({
      description: "via I-90 E",
      durationMinutes: 227,
      hasTolls: true,
      features: {
        slowDistanceShare: null,
        jamDistanceShare: null,
        trafficStress: 55,
        weightedManeuvers: null,
        maneuverCount: null,
        maneuverDensity: null,
        complexityStress: 18
      }
    });
    const scored = scoreAnalysis(response);
    expect(scored).toHaveLength(2);
    expect(scored.every((route) => Number.isFinite(route.score.finalScore))).toBe(
      true
    );
    expect(new Set(scored.map((route) => route.score.finalScore)).size).toBeGreaterThan(
      1
    );
    const first = scored.find((route) => route.routeId === "local_route_0");
    expect(first?.score.components.traffic).toBe(55);
    expect(first?.score.components.maneuver).toBe(18);
    expect(first?.score.effectiveWeights.traffic).toBeGreaterThan(0);
    expect(first?.score.effectiveWeights.maneuver).toBeGreaterThan(0);
    expect(response.routes[1].features.trafficStress).toBe(0);
    expect(response.routes[1].features.complexityStress).toBe(18);
    expect(response.attribution.routeDataProvider).toContain("Waze");
  });

  it("repeats the same Traffic and Complexity results for the same visible routes", () => {
    const visibleRoutes = [
      {
        description: "I-90 W and I-84 W exit 8",
        durationMinutes: 132,
        distanceMeters: 217_000,
        hasTolls: true,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown" as const
      },
      {
        description: "CT-15 S",
        durationMinutes: 140,
        distanceMeters: 220_000,
        hasTolls: false,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown" as const
      }
    ];

    const first = createLocalFallbackResponse(visibleRoutes);
    const repeated = createLocalFallbackResponse(visibleRoutes);

    expect(
      repeated.routes.map((route) => ({
        traffic: route.features.trafficStress,
        complexity: route.features.complexityStress
      }))
    ).toEqual(
      first.routes.map((route) => ({
        traffic: route.features.trafficStress,
        complexity: route.features.complexityStress
      }))
    );
    expect(scoreAnalysis(repeated).map((route) => route.score)).toEqual(
      scoreAnalysis(first).map((route) => route.score)
    );
  });

  it("derives Traffic only from repeatable visible congestion evidence", () => {
    const base = {
      description: "via I-95 N",
      durationMinutes: 30,
      distanceMeters: 40_000,
      hasTolls: false,
      withoutTrafficMinutes: null,
      trafficSignal: "unknown" as const
    };
    expect(visibleTrafficStress(base)).toBeNull();
    expect(visibleTrafficStress(base, 25)).toBe(25);
    expect(
      visibleTrafficStress({ ...base, trafficSignal: "heavy" })
    ).toBe(85);
    expect(
      visibleTrafficStress({
        ...base,
        durationMinutes: 39,
        withoutTrafficMinutes: 30
      })
    ).toBeCloseTo(50);
    expect(
      visibleTrafficStress({
        ...base,
        durationMinutes: 39,
        withoutTrafficMinutes: 30,
        trafficSignal: "slow"
      })
    ).toBe(55);
  });

  it("derives a deterministic Complexity proxy only from recognizable roads", () => {
    expect(routeDescriptionComplexityStress("Google Maps route 1")).toBeNull();
    expect(routeDescriptionComplexityStress("I-95 N")).toBe(18);
    expect(routeDescriptionComplexityStress("I‑95 N")).toBe(18);
    expect(routeDescriptionComplexityStress("I-90 W and I-84 W")).toBe(38);
    expect(routeDescriptionComplexityStress("I-95 N exit 8")).toBe(30);
    expect(
      routeDescriptionComplexityStress("途经：二环、西直门北大街、学院路")
    ).toBe(38);
    expect(routeDescriptionComplexityStress("I-90 W and I-84 W")).toBe(
      routeDescriptionComplexityStress("I-90 W and I-84 W")
    );
  });

  it("rejects invalid durations and normalizes other non-finite route inputs", () => {
    const response = createLocalFallbackResponse([
      {
        description: "zero duration",
        durationMinutes: 0,
        distanceMeters: 100,
        hasTolls: false,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown"
      },
      {
        description: "non-finite duration",
        durationMinutes: Number.NaN,
        distanceMeters: 100,
        hasTolls: false,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown"
      },
      {
        description: "valid route",
        durationMinutes: 15,
        distanceMeters: Number.NaN,
        hasTolls: false,
        withoutTrafficMinutes: Number.NaN,
        trafficSignal: "unknown"
      }
    ]);

    expect(response.routes).toHaveLength(1);
    expect(response.routes[0].description).toBe("valid route");
    expect(response.routes[0].distanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(response.routes[0].features.delayRatio)).toBe(true);
    expect(
      scoreAnalysis(response).every((route) =>
        Number.isFinite(route.score.finalScore)
      )
    ).toBe(true);
  });
});
