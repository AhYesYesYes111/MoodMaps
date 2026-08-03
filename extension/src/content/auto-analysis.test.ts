import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../shared/types";
import {
  AutoAnalysisGate,
  canAutoAnalyze,
  RefreshDebouncer,
  routeFingerprint
} from "./auto-analysis";

function context(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    provider: "google",
    origin: { text: "Penn Station" },
    destination: { text: "Yale University" },
    travelMode: "DRIVE",
    departureTime: "2026-07-17T21:00:00Z",
    source: "url",
    confidence: 0.93,
    pageUrl: "https://www.google.com/maps/dir/Penn/Yale",
    ...overrides
  };
}

describe("automatic route analysis", () => {
  it("waits for a complete, confident driving route", () => {
    expect(canAutoAnalyze(context())).toBe(true);
    expect(canAutoAnalyze(context({ destination: null }))).toBe(false);
    expect(canAutoAnalyze(context({ travelMode: "UNKNOWN" }))).toBe(false);
    expect(canAutoAnalyze(context({ confidence: 0.59 }))).toBe(false);
  });

  it("normalizes route text before comparing route changes", () => {
    expect(routeFingerprint(context())).toBe(
      routeFingerprint(
        context({
          origin: { text: "  PENN   station " },
          destination: { text: "YALE UNIVERSITY" }
        })
      )
    );
  });

  it("analyzes once per route and analyzes again after a route change", () => {
    const gate = new AutoAnalysisGate();
    expect(gate.shouldAnalyze(context())).toBe(true);
    expect(gate.shouldAnalyze(context())).toBe(false);
    expect(
      gate.shouldAnalyze(context({ destination: { text: "JFK Airport" } }))
    ).toBe(true);
  });

  it("starts when confidence becomes sufficient without another click", () => {
    const gate = new AutoAnalysisGate();
    expect(gate.shouldAnalyze(context({ confidence: 0.4 }))).toBe(false);
    expect(gate.shouldAnalyze(context({ confidence: 0.85 }))).toBe(true);
  });

  it("analyzes again when Google Maps route cards finish loading", () => {
    const gate = new AutoAnalysisGate();
    expect(gate.shouldAnalyze(context())).toBe(true);
    expect(gate.shouldAnalyze(context())).toBe(false);
    expect(
      gate.shouldAnalyze(
        context({
          observedRoutes: [
            {
              description: "via I-95 N",
              durationMinutes: 246,
              distanceMeters: 368540,
              hasTolls: false,
              withoutTrafficMinutes: null,
              trafficSignal: "unknown"
            }
          ]
        })
      )
    ).toBe(true);
  });

  it("analyzes again when traffic inputs change without an ETA change", () => {
    const gate = new AutoAnalysisGate();
    const observedRoutes = [
      {
        description: "via I-95 N",
        durationMinutes: 60,
        distanceMeters: 80000,
        hasTolls: false,
        withoutTrafficMinutes: null,
        trafficSignal: "unknown" as const
      }
    ];
    expect(gate.shouldAnalyze(context({ observedRoutes }))).toBe(true);
    expect(
      gate.shouldAnalyze(
        context({
          observedRoutes: [
            {
              ...observedRoutes[0],
              withoutTrafficMinutes: 45,
              trafficSignal: "heavy"
            }
          ]
        })
      )
    ).toBe(true);
  });

  it("tracks coordinate, confidence, and toll changes in the route identity", () => {
    const base = context({
      origin: { text: "Home", latitude: 40, longitude: -73 },
      observedRoutes: [
        {
          description: "via Main St",
          durationMinutes: 20,
          distanceMeters: 12000,
          hasTolls: false,
          withoutTrafficMinutes: 18,
          trafficSignal: "light"
        }
      ]
    });

    expect(
      routeFingerprint(base)
    ).not.toBe(
      routeFingerprint({
        ...base,
        origin: { text: "Home", latitude: 41, longitude: -73 }
      })
    );
    expect(routeFingerprint(base)).not.toBe(
      routeFingerprint({ ...base, confidence: 0.4 })
    );
    expect(routeFingerprint(base)).not.toBe(
      routeFingerprint({
        ...base,
        observedRoutes: [{ ...base.observedRoutes![0], hasTolls: true }]
      })
    );
  });
});

describe("content refresh debouncing", () => {
  it("coalesces bursts and still flushes during continuous mutations", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new RefreshDebouncer(callback, 100, 300);

    debouncer.schedule();
    vi.advanceTimersByTime(80);
    debouncer.schedule();
    vi.advanceTimersByTime(80);
    debouncer.schedule();
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);

    for (let elapsed = 0; elapsed < 300; elapsed += 80) {
      debouncer.schedule();
      vi.advanceTimersByTime(80);
    }
    expect(callback).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
