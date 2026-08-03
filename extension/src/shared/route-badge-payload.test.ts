import { describe, expect, it } from "vitest";
import { scoreAnalysis } from "../scoring/scoring";
import { createRouteBadgePayload } from "./route-badge-payload";
import type { AnalyzeResponse } from "./types";

describe("route badge payload", () => {
  it("preserves the bilingual score reasons used by popup surfaces", () => {
    const response: AnalyzeResponse = {
      schemaVersion: "1.0",
      analysisId: "analysis_payload",
      generatedAt: "2026-07-24T19:00:00Z",
      routes: [
        {
          routeId: "route_0",
          description: "via I-95 N",
          durationMinutes: 60,
          staticDurationMinutes: 54,
          distanceMeters: 24000,
          hasTolls: false,
          features: {
            slowDistanceShare: 0.1,
            jamDistanceShare: 0.04,
            delayRatio: 0.11,
            weightedManeuvers: 4,
            maneuverCount: 4,
            maneuverDensity: 1.67,
            durationMinutes: 60,
            weather: null
          }
        }
      ],
      attribution: {
        routeDataProvider: "Test"
      }
    };
    const scoredRoutes = scoreAnalysis(response);
    const payload = createRouteBadgePayload(
      response,
      scoredRoutes,
      "Penn Station",
      "Yale University",
      "google"
    );

    expect(payload.routes[0].reasons).toEqual(scoredRoutes[0].reasons);
    expect(payload.routes[0].reasons.length).toBeGreaterThanOrEqual(2);
    expect(
      payload.routes[0].reasons.every(
        (reason) => reason.message.length > 0 && reason.messageZh.length > 0
      )
    ).toBe(true);
  });
});
