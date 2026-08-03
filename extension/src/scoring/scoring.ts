import type {
  AnalyzeResponse,
  AnalyzedRoute,
  MoodScoreComponentKey,
  MoodScoreExplanation,
  RouteFeatures,
  ScoreReason as SharedScoreReason
} from "../shared/types";

export type MoodLabel =
  | "Very Calm"
  | "Calm"
  | "Balanced"
  | "Stressful"
  | "Very Stressful";

export interface ScoreBreakdown {
  routeStress: number;
  routeCalmness: number;
  finalScore: number;
  label: MoodLabel;
  components: {
    traffic: number | null;
    delay: number;
    maneuver: number | null;
    duration: number;
    weather: number | null;
  };
  effectiveWeights: Record<MoodScoreComponentKey, number>;
}

export type ScoreReason = SharedScoreReason;

export interface ScoredRoute extends AnalyzedRoute {
  score: ScoreBreakdown;
  reasons: ScoreReason[];
  roles: Array<"Fastest" | "Balanced" | "Calmest">;
}

export const MOOD_SCORE_COMPONENTS = [
  { key: "traffic", label: "Traffic", baseWeight: 0.32 },
  { key: "delay", label: "Delay", baseWeight: 0.2 },
  { key: "maneuver", label: "Complexity", baseWeight: 0.2 },
  { key: "duration", label: "Duration", baseWeight: 0.12 },
  { key: "weather", label: "Weather", baseWeight: 0.16 }
] as const satisfies ReadonlyArray<{
  key: MoodScoreComponentKey;
  label: string;
  baseWeight: number;
}>;

export const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, value));

export function labelForScore(score: number): MoodLabel {
  if (score >= 85) return "Very Calm";
  if (score >= 70) return "Calm";
  if (score >= 55) return "Balanced";
  if (score >= 40) return "Stressful";
  return "Very Stressful";
}

export function scoreRoute(features: RouteFeatures): ScoreBreakdown {
  const finiteWhenAvailable = (value: number | null | undefined) =>
    value === null || value === undefined || Number.isFinite(value);
  if (
    !Number.isFinite(features.durationMinutes) ||
    features.durationMinutes <= 0 ||
    !Number.isFinite(features.delayRatio) ||
    features.delayRatio < 0 ||
    !finiteWhenAvailable(features.slowDistanceShare) ||
    !finiteWhenAvailable(features.jamDistanceShare) ||
    !finiteWhenAvailable(features.trafficStress) ||
    !finiteWhenAvailable(features.maneuverDensity) ||
    !finiteWhenAvailable(features.complexityStress) ||
    !finiteWhenAvailable(features.weather?.risk)
  ) {
    throw new RangeError(
      "Available route score inputs must be finite, with positive duration and nonnegative delay."
    );
  }
  const hasTrafficDetail =
    features.slowDistanceShare !== null && features.jamDistanceShare !== null;
  const slow = features.slowDistanceShare ?? 0;
  const jam = features.jamDistanceShare ?? 0;
  const traffic = hasTrafficDetail
    ? clamp(100 * (0.45 * slow + 1.2 * jam))
    : features.trafficStress === null ||
        features.trafficStress === undefined
      ? null
      : clamp(features.trafficStress);
  const delay = clamp((features.delayRatio / 0.6) * 100);
  const maneuver =
    features.maneuverDensity === null
      ? features.complexityStress === null ||
        features.complexityStress === undefined
        ? null
        : clamp(features.complexityStress)
      : clamp((features.maneuverDensity / 10) * 100);
  const duration = clamp((features.durationMinutes / 180) * 100);
  const weather = features.weather ? clamp(features.weather.risk) : null;
  const components = { traffic, delay, maneuver, duration, weather };
  const weightedComponents = MOOD_SCORE_COMPONENTS.flatMap((component) => {
    const value = components[component.key];
    return value === null
      ? []
      : [{ key: component.key, value, weight: component.baseWeight }];
  });
  const availableWeight = weightedComponents.reduce(
    (total, component) => total + component.weight,
    0
  );
  const stress =
    weightedComponents.reduce(
      (total, component) => total + component.value * component.weight,
      0
    ) / availableWeight;
  const routeCalmness = Math.round(clamp(100 - stress));
  const routeStress = 100 - routeCalmness;
  const finalScore = routeCalmness;
  const effectiveWeights = Object.fromEntries(
    MOOD_SCORE_COMPONENTS.map((component) => [
      component.key,
      components[component.key] === null
        ? 0
        : component.baseWeight / availableWeight
    ])
  ) as Record<MoodScoreComponentKey, number>;

  return {
    routeStress,
    routeCalmness,
    finalScore,
    label: labelForScore(finalScore),
    components,
    effectiveWeights
  };
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createMoodScoreExplanation(
  score: ScoreBreakdown
): MoodScoreExplanation {
  return {
    routeStress: score.routeStress,
    routeCalmness: score.routeCalmness,
    finalScore: score.finalScore,
    components: MOOD_SCORE_COMPONENTS.map((component) => {
      const stress = score.components[component.key];
      const effectiveWeight = score.effectiveWeights[component.key];
      return {
        key: component.key,
        label: component.label,
        stress,
        effectiveWeight,
        contribution:
          stress === null ? null : roundToOne(stress * effectiveWeight)
      };
    })
  };
}

function percentDifference(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline <= 0) return null;
  return Math.round(((baseline - value) / baseline) * 100);
}

const COMPONENT_REASON_LABELS_ZH: Record<MoodScoreComponentKey, string> = {
  traffic: "交通",
  delay: "延误",
  maneuver: "复杂度",
  duration: "时长",
  weather: "天气"
};

function buildReasons(
  route: AnalyzedRoute,
  fastest: AnalyzedRoute,
  score: ScoreBreakdown
): ScoreReason[] {
  const reasons: ScoreReason[] = [];
  const weather = route.features.weather;
  const hasTrafficSegmentDetail =
    route.features.slowDistanceShare !== null &&
    route.features.jamDistanceShare !== null;
  const fastestHasTrafficSegmentDetail =
    fastest.features.slowDistanceShare !== null &&
    fastest.features.jamDistanceShare !== null;
  const fastestScore =
    route.routeId === fastest.routeId ? score : scoreRoute(fastest.features);
  const hasTrafficProxy =
    !hasTrafficSegmentDetail &&
    route.features.trafficStress !== null &&
    route.features.trafficStress !== undefined;
  const hasComplexityProxy =
    route.features.maneuverDensity === null &&
    route.features.complexityStress !== null &&
    route.features.complexityStress !== undefined;
  const jamDifference =
    hasTrafficSegmentDetail && fastestHasTrafficSegmentDetail
      ? percentDifference(
          route.features.jamDistanceShare,
          fastest.features.jamDistanceShare
        )
      : null;
  const slowDifference =
    hasTrafficSegmentDetail && fastestHasTrafficSegmentDetail
      ? percentDifference(
          route.features.slowDistanceShare,
          fastest.features.slowDistanceShare
        )
      : null;
  const extraMinutes = Math.round(route.durationMinutes - fastest.durationMinutes);
  const maneuverDifference =
    fastest.features.weightedManeuvers === null ||
    route.features.weightedManeuvers === null
      ? null
      : Math.round(
          fastest.features.weightedManeuvers -
            route.features.weightedManeuvers
        );

  const hasManeuverDetail = route.features.maneuverDensity !== null;
  if (hasTrafficProxy && hasComplexityProxy) {
    reasons.push({
      type: "neutral",
      message:
        "Traffic uses visible congestion or relative-pace cues; Complexity is a route-name proxy, not a turn count.",
      messageZh:
        "交通使用页面可见的拥堵或相对速度线索；复杂度是路线名称代理值，不代表真实转弯次数。"
    });
  } else if (hasTrafficProxy) {
    reasons.push({
      type: "neutral",
      message:
        "Traffic uses visible congestion or relative-pace cues, not hidden segment data.",
      messageZh: "交通使用页面可见的拥堵或相对速度线索，不使用隐藏路段数据。"
    });
  } else if (hasComplexityProxy) {
    reasons.push({
      type: "neutral",
      message: "Complexity is a repeatable route-name proxy, not a turn count.",
      messageZh: "复杂度是可重复计算的路线名称代理值，不代表真实转弯次数。"
    });
  }

  const hasTraffic = score.components.traffic !== null;
  const hasComplexity = score.components.maneuver !== null;
  if (!hasTraffic && !hasComplexity) {
    reasons.push({
      type: "neutral",
      message:
        "No usable traffic/pace cue or recognizable road structure is visible, so Traffic and Complexity are not used.",
      messageZh:
        "页面未显示可用的交通/相对速度线索或可识别道路结构，因此交通和复杂度未计入。"
    });
  } else if (!hasTraffic) {
    reasons.push({
      type: "neutral",
      message:
        "No traffic cue, without-traffic time, or comparable visible distance is available, so Traffic is not used.",
      messageZh:
        "页面没有交通提示、无拥堵时间或可比较的可见距离，因此交通未计入。"
    });
  } else if (!hasComplexity) {
    reasons.push({
      type: "neutral",
      message:
        "No recognizable road structure is visible, so Complexity is not used.",
      messageZh: "页面未显示可识别的道路结构，因此复杂度未计入。"
    });
  }
  if (jamDifference !== null && jamDifference >= 10) {
    reasons.push({
      type: "positive",
      message: jamDifference + "% less heavy traffic than the fastest route.",
      messageZh: "相比最快路线，严重拥堵路段减少 " + jamDifference + "%。"
    });
  } else if (slowDifference !== null && slowDifference >= 10) {
    reasons.push({
      type: "positive",
      message: slowDifference + "% less slow traffic than the fastest route.",
      messageZh: "相比最快路线，缓慢路段减少 " + slowDifference + "%。"
    });
  }
  const trafficStressDifference =
    score.components.traffic === null ||
    fastestScore.components.traffic === null
      ? null
      : Math.round(
          fastestScore.components.traffic - score.components.traffic
        );
  if (
    !hasTrafficSegmentDetail &&
    trafficStressDifference !== null &&
    trafficStressDifference >= 10
  ) {
    reasons.push({
      type: "positive",
      message:
        "Visible traffic stress is " +
        trafficStressDifference +
        " points lower than the fastest route.",
      messageZh:
        "可见交通压力比最快路线低 " + trafficStressDifference + " 分。"
    });
  }
  if (maneuverDifference !== null && maneuverDifference >= 1) {
    reasons.push({
      type: "positive",
      message: maneuverDifference + " fewer weighted merges, exits, and turns.",
      messageZh: "加权合流、出口和转弯比最快路线少 " + maneuverDifference + " 个。"
    });
  }
  const complexityStressDifference =
    score.components.maneuver === null ||
    fastestScore.components.maneuver === null
      ? null
      : Math.round(
          fastestScore.components.maneuver - score.components.maneuver
        );
  if (
    !hasManeuverDetail &&
    complexityStressDifference !== null &&
    complexityStressDifference >= 10
  ) {
    reasons.push({
      type: "positive",
      message:
        "The route-name complexity proxy is " +
        complexityStressDifference +
        " points lower than the fastest route.",
      messageZh:
        "路线名称复杂度代理值比最快路线低 " +
        complexityStressDifference +
        " 分。"
    });
  }
  if (extraMinutes > 0) {
    reasons.push({
      type: "negative",
      message: extraMinutes + " minutes longer than the fastest route.",
      messageZh: "比最快路线多用 " + extraMinutes + " 分钟。"
    });
  }
  if (weather && weather.risk >= 55) {
    reasons.unshift({
      type: "negative",
      message:
        (weather.conditionDescription ?? "Current weather") +
        " adds significant weather stress.",
      messageZh: "当前天气明显增加了路线压力。"
    });
  } else if (weather && weather.risk >= 25) {
    reasons.push({
      type: "neutral",
      message:
        (weather.conditionDescription ?? "Current weather") +
        " adds some weather stress.",
      messageZh: "当前天气增加了一些路线压力。"
    });
  }
  if (reasons.length < 2) {
    const lowestAvailableComponent = MOOD_SCORE_COMPONENTS.flatMap((component) => {
      const stress = score.components[component.key];
      return stress === null ? [] : [{ ...component, stress }];
    }).sort((a, b) => a.stress - b.stress)[0];
    if (lowestAvailableComponent) {
      reasons.push({
        type: "neutral",
        message:
          lowestAvailableComponent.label +
          " is this route's lowest available stress input.",
        messageZh:
          COMPONENT_REASON_LABELS_ZH[lowestAvailableComponent.key] +
          "是这条路线当前最低的可用压力因素。"
      });
    }
  }
  if (reasons.length < 2) {
    reasons.push(
      route.routeId === fastest.routeId
        ? {
            type: "positive",
            message: "This is the fastest available option.",
            messageZh: "这是当前可用的最快路线。"
          }
        : {
            type: "neutral",
            message: "This score is compared with the fastest available option.",
            messageZh: "该分数以当前可用的最快路线作为比较基准。"
          }
    );
  }
  if (reasons.length < 2) {
    reasons.push({
      type: "neutral",
      message: "The score uses the route inputs that are currently available.",
      messageZh: "该分数仅使用当前可用的路线因素。"
    });
  }
  return reasons.slice(0, 4);
}

export function scoreAnalysis(
  response: AnalyzeResponse
): ScoredRoute[] {
  if (response.routes.length === 0) return [];
  const fastest = [...response.routes].sort(
    (a, b) => a.durationMinutes - b.durationMinutes
  )[0];
  const withScores = response.routes.map((route) => {
    const score = scoreRoute(route.features);
    return {
      ...route,
      score,
      reasons: buildReasons(route, fastest, score),
      roles: [] as ScoredRoute["roles"]
    };
  });
  const calmest = [...withScores].sort(
    (a, b) => b.score.finalScore - a.score.finalScore
  )[0];
  const balanced = [...withScores].sort((a, b) => {
    const aCost =
      a.durationMinutes - fastest.durationMinutes + (100 - a.score.finalScore) * 0.45;
    const bCost =
      b.durationMinutes - fastest.durationMinutes + (100 - b.score.finalScore) * 0.45;
    return aCost - bCost;
  })[0];

  for (const route of withScores) {
    if (route.routeId === fastest.routeId) route.roles.push("Fastest");
    if (route.routeId === balanced.routeId) route.roles.push("Balanced");
    if (route.routeId === calmest.routeId) route.roles.push("Calmest");
  }

  return withScores.sort((a, b) => {
    const roleOrder = (route: ScoredRoute) =>
      route.roles.includes("Balanced")
        ? 0
        : route.roles.includes("Calmest")
          ? 1
          : route.roles.includes("Fastest")
            ? 2
            : 3;
    return roleOrder(a) - roleOrder(b) || a.durationMinutes - b.durationMinutes;
  });
}
