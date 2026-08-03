import { describe, expect, it } from "vitest";
import type { AnalyzeResponse, RouteFeatures } from "../shared/types";
import {
  createMoodScoreExplanation,
  labelForScore,
  scoreAnalysis,
  scoreRoute
} from "./scoring";

const baseFeatures: RouteFeatures = {
  slowDistanceShare: 0.1,
  jamDistanceShare: 0.05,
  delayRatio: 0.1,
  weightedManeuvers: 4,
  maneuverCount: 10,
  maneuverDensity: 2,
  durationMinutes: 60
};

describe("Mood Score", () => {
  it("is deterministic and clamped", () => {
    expect(scoreRoute(baseFeatures)).toEqual(scoreRoute(baseFeatures));
    expect(scoreRoute(baseFeatures).routeCalmness).toBeGreaterThanOrEqual(0);
    expect(scoreRoute(baseFeatures).routeCalmness).toBeLessThanOrEqual(100);
  });

  it("rejects non-finite available inputs instead of producing NaN", () => {
    expect(() =>
      scoreRoute({ ...baseFeatures, durationMinutes: 0 })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({ ...baseFeatures, durationMinutes: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({ ...baseFeatures, delayRatio: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({ ...baseFeatures, slowDistanceShare: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({ ...baseFeatures, jamDistanceShare: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({
        ...baseFeatures,
        slowDistanceShare: null,
        jamDistanceShare: null,
        trafficStress: Number.NaN
      })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({ ...baseFeatures, maneuverDensity: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({
        ...baseFeatures,
        maneuverDensity: null,
        complexityStress: Number.POSITIVE_INFINITY
      })
    ).toThrow(RangeError);
    expect(() =>
      scoreRoute({
        ...baseFeatures,
        weather: {
          risk: Number.POSITIVE_INFINITY,
          conditionType: "UNKNOWN",
          conditionDescription: null,
          precipitationProbability: null,
          visibilityKilometers: null,
          windGustKph: null,
          feelsLikeCelsius: null,
          observedAt: null
        }
      })
    ).toThrow(RangeError);
  });

  it("continues to clamp finite out-of-range stress inputs", () => {
    const score = scoreRoute({
      ...baseFeatures,
      slowDistanceShare: 20,
      jamDistanceShare: 20,
      maneuverDensity: 200,
      weather: {
        risk: 200,
        conditionType: "EXTREME_TEST",
        conditionDescription: null,
        precipitationProbability: null,
        visibilityKilometers: null,
        windGustKph: null,
        feelsLikeCelsius: null,
        observedAt: null
      }
    });

    expect(score.components.traffic).toBe(100);
    expect(score.components.maneuver).toBe(100);
    expect(score.components.weather).toBe(100);
  });

  it("never improves when jam share increases", () => {
    const base = scoreRoute(baseFeatures).routeCalmness;
    const worse = scoreRoute({ ...baseFeatures, jamDistanceShare: 0.35 }).routeCalmness;
    expect(worse).toBeLessThan(base);
  });

  it("never improves when weather risk increases", () => {
    const clear = scoreRoute({
      ...baseFeatures,
      weather: {
        risk: 0,
        conditionType: "CLEAR",
        conditionDescription: "Clear",
        precipitationProbability: 0,
        visibilityKilometers: 16,
        windGustKph: 10,
        feelsLikeCelsius: 20,
        observedAt: null
      }
    }).routeCalmness;
    const severe = scoreRoute({
      ...baseFeatures,
      weather: {
        risk: 90,
        conditionType: "HEAVY_THUNDERSTORM",
        conditionDescription: "Heavy thunderstorm",
        precipitationProbability: 1,
        visibilityKilometers: 1,
        windGustKph: 70,
        feelsLikeCelsius: 20,
        observedAt: null
      }
    }).routeCalmness;
    expect(severe).toBeLessThan(clear);
  });

  it("renormalizes instead of treating missing traffic and weather as calm", () => {
    const missing = scoreRoute({
      ...baseFeatures,
      slowDistanceShare: null,
      jamDistanceShare: null,
      weather: null
    });
    expect(missing.components.traffic).toBeNull();
    expect(missing.components.weather).toBeNull();
    expect(missing.routeCalmness).toBeLessThan(100);
    expect(missing.effectiveWeights.traffic).toBe(0);
    expect(missing.effectiveWeights.weather).toBe(0);
    expect(
      Object.values(missing.effectiveWeights).reduce(
        (total, weight) => total + weight,
        0
      )
    ).toBeCloseTo(1);
  });

  it("excludes traffic when either required traffic share is missing", () => {
    for (const features of [
      { ...baseFeatures, slowDistanceShare: null },
      { ...baseFeatures, jamDistanceShare: null }
    ]) {
      const score = scoreRoute(features);
      expect(score.components.traffic).toBeNull();
      expect(score.effectiveWeights.traffic).toBe(0);
      expect(
        Object.values(score.effectiveWeights).reduce(
          (total, weight) => total + weight,
          0
        )
      ).toBeCloseTo(1);
    }
  });

  it("excludes unavailable maneuver complexity and rebalances its weight", () => {
    const score = scoreRoute({
      ...baseFeatures,
      weightedManeuvers: null,
      maneuverCount: null,
      maneuverDensity: null
    });
    expect(score.components.maneuver).toBeNull();
    expect(score.effectiveWeights.maneuver).toBe(0);
    expect(
      Object.values(score.effectiveWeights).reduce(
        (total, weight) => total + weight,
        0
      )
    ).toBeCloseTo(1);
  });

  it("uses transparent local proxies when segment and maneuver detail are absent", () => {
    const score = scoreRoute({
      ...baseFeatures,
      slowDistanceShare: null,
      jamDistanceShare: null,
      trafficStress: 55,
      weightedManeuvers: null,
      maneuverCount: null,
      maneuverDensity: null,
      complexityStress: 38
    });
    expect(score.components.traffic).toBe(55);
    expect(score.components.maneuver).toBe(38);
    expect(score.effectiveWeights.traffic).toBeCloseTo(0.32 / 0.84);
    expect(score.effectiveWeights.maneuver).toBeCloseTo(0.2 / 0.84);
  });

  it("exposes the actual inputs, weights, and contributions used by the UI", () => {
    const score = scoreRoute({
      ...baseFeatures,
      weather: {
        risk: 40,
        conditionType: "RAIN",
        conditionDescription: "Rain",
        precipitationProbability: 0.7,
        visibilityKilometers: 8,
        windGustKph: 25,
        feelsLikeCelsius: 18,
        observedAt: null
      }
    });
    const explanation = createMoodScoreExplanation(score);
    expect(explanation.components).toHaveLength(5);
    expect(
      explanation.components.reduce(
        (total, component) => total + component.effectiveWeight,
        0
      )
    ).toBeCloseTo(1);
    expect(explanation.components.find((item) => item.key === "weather")).toMatchObject({
      stress: 40,
      effectiveWeight: 0.16,
      contribution: 6.4
    });
  });

  it("maps score boundaries to readable labels", () => {
    expect(labelForScore(85)).toBe("Very Calm");
    expect(labelForScore(70)).toBe("Calm");
    expect(labelForScore(55)).toBe("Balanced");
    expect(labelForScore(40)).toBe("Stressful");
    expect(labelForScore(39)).toBe("Very Stressful");
  });

  it("combines unavailable disclosures and still explains an available factor", () => {
    const response: AnalyzeResponse = {
      schemaVersion: "1.0",
      analysisId: "analysis_missing_traffic",
      generatedAt: "2026-07-24T19:00:00Z",
      routes: [
        {
          routeId: "route_0",
          description: "Local streets",
          durationMinutes: 60,
          staticDurationMinutes: 54,
          distanceMeters: 24000,
          hasTolls: false,
          features: {
            ...baseFeatures,
            slowDistanceShare: null,
            jamDistanceShare: null,
            weightedManeuvers: null,
            maneuverCount: null,
            maneuverDensity: null
          }
        }
      ],
      attribution: {
        routeDataProvider: "Test"
      }
    };
    const [route] = scoreAnalysis(response);
    expect(route.reasons.length).toBeGreaterThanOrEqual(2);
    expect(route.reasons.length).toBeLessThanOrEqual(4);
    expect(route.reasons.every((reason) => reason.message && reason.messageZh)).toBe(
      true
    );
    const englishReasons = route.reasons.map((reason) => reason.message);
    const chineseReasons = route.reasons.map((reason) => reason.messageZh);
    expect(englishReasons).toContain(
      "No usable traffic/pace cue or recognizable road structure is visible, so Traffic and Complexity are not used."
    );
    expect(chineseReasons).toContain(
      "页面未显示可用的交通/相对速度线索或可识别道路结构，因此交通和复杂度未计入。"
    );
    expect(englishReasons).toContain(
      "Delay is this route's lowest available stress input."
    );
    expect(chineseReasons).toContain(
      "延误是这条路线当前最低的可用压力因素。"
    );
    expect(englishReasons.join(" ")).not.toMatch(/low traffic stress/i);
    expect(englishReasons.filter((message) => /not used/.test(message))).toHaveLength(
      1
    );
    expect(route.roles).toEqual(["Fastest", "Balanced", "Calmest"]);
  });
});
