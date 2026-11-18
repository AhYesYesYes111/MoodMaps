import type { RouteContext } from "../shared/types";

function normalizedLocation(value?: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function locationFingerprint(
  location: RouteContext["origin"]
): [string, number | null, number | null] {
  return [
    normalizedLocation(location?.text),
    Number.isFinite(location?.latitude) ? location?.latitude ?? null : null,
    Number.isFinite(location?.longitude) ? location?.longitude ?? null : null
  ];
}

export function routeFingerprint(context: RouteContext): string {
  return JSON.stringify({
    provider: context.provider,
    origin: locationFingerprint(context.origin),
    destination: locationFingerprint(context.destination),
    mode: context.travelMode,
    confidence: context.confidence,
    routes: (context.observedRoutes ?? []).map((route) => [
      normalizedLocation(route.description),
      route.durationMinutes,
      route.distanceMeters,
      route.hasTolls,
      route.withoutTrafficMinutes,
      route.trafficSignal
    ])
  });
}

export class RefreshDebouncer {
  private trailingTimer: number | undefined;
  private maximumTimer: number | undefined;

  constructor(
    private readonly callback: () => void,
    private readonly delayMs = 180,
    private readonly maximumWaitMs = 900
  ) {}

  schedule(): void {
    clearTimeout(this.trailingTimer);
    this.trailingTimer = setTimeout(() => this.flush(), this.delayMs);
    if (this.maximumTimer === undefined) {
      this.maximumTimer = setTimeout(
        () => this.flush(),
        this.maximumWaitMs
      );
    }
  }

  flush(): void {
    clearTimeout(this.trailingTimer);
    clearTimeout(this.maximumTimer);
    this.trailingTimer = undefined;
    this.maximumTimer = undefined;
    this.callback();
  }

  cancel(): void {
    clearTimeout(this.trailingTimer);
    clearTimeout(this.maximumTimer);
    this.trailingTimer = undefined;
    this.maximumTimer = undefined;
  }
}

export function hasDrivingEndpoints(context: RouteContext | null): boolean {
  return Boolean(
    context?.origin?.text.trim() &&
      context.destination?.text.trim() &&
      context.travelMode === "DRIVE" &&
      context.confidence >= 0.6
  );
}

export function canAutoAnalyze(context: RouteContext | null): boolean {
  return hasDrivingEndpoints(context) && Boolean(context?.observedRoutes?.length);
}

export class AutoAnalysisGate {
  private observedFingerprint = "";
  private analyzedFingerprint = "";

  shouldAnalyze(context: RouteContext): boolean {
    const nextFingerprint = routeFingerprint(context);
    if (nextFingerprint !== this.observedFingerprint) {
      this.observedFingerprint = nextFingerprint;
      this.analyzedFingerprint = "";
    }
    if (!canAutoAnalyze(context) || nextFingerprint === this.analyzedFingerprint) {
      return false;
    }
    this.analyzedFingerprint = nextFingerprint;
    return true;
  }

  markAnalyzed(context: RouteContext): void {
    const nextFingerprint = routeFingerprint(context);
    this.observedFingerprint = nextFingerprint;
    this.analyzedFingerprint = nextFingerprint;
  }

  reset(): void {
    this.observedFingerprint = "";
    this.analyzedFingerprint = "";
  }
}
