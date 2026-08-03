import {
  createMoodScoreExplanation,
  type ScoredRoute
} from "../scoring/scoring";
import type {
  AnalyzeResponse,
  MapProvider,
  RouteBadgePayload,
  RouteContext
} from "./types";

function normalizeLocation(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function routeContextSignature(
  origin: string,
  destination: string,
  provider: MapProvider = "unknown"
): string {
  return (
    provider +
    "|" +
    normalizeLocation(origin) +
    "|" +
    normalizeLocation(destination)
  );
}

export function signatureFromContext(context: RouteContext): string {
  return routeContextSignature(
    context.origin?.text ?? "",
    context.destination?.text ?? "",
    context.provider
  );
}

export function createRouteBadgePayload(
  response: AnalyzeResponse,
  scoredRoutes: ScoredRoute[],
  origin: string,
  destination: string,
  provider: MapProvider
): RouteBadgePayload {
  const scoresById = new Map(scoredRoutes.map((route) => [route.routeId, route]));
  return {
    contextSignature: routeContextSignature(origin, destination, provider),
    generatedAt: response.generatedAt,
    routes: response.routes.flatMap((route) => {
      const scored = scoresById.get(route.routeId);
      if (!scored) return [];
      return [
        {
          routeId: route.routeId,
          description: route.description,
          durationMinutes: route.durationMinutes,
          score: scored.score.finalScore,
          label: scored.score.label,
          roles: scored.roles,
          explanation: createMoodScoreExplanation(scored.score),
          reasons: scored.reasons
        }
      ];
    })
  };
}
