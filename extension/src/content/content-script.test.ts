// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://amap.com/dir?from%5Bname%5D=Start&to%5Bname%5D=End&type=car"}

import { expect, it, vi } from "vitest";
import { createLocalFallbackResponse } from "../background/local-fallback";
import { scoreAnalysis } from "../scoring/scoring";
import { createRouteBadgePayload } from "../shared/route-badge-payload";
import type { ExtensionMessage, RouteBadgeViewState } from "../shared/types";

it("clears selected driving scores after URL-only navigation", async () => {
  vi.useFakeTimers();
  try {
    document.body.innerHTML =
      '<div class="planTitle dirtag current"><div class="dir_base_info">' +
      '<span class="dir_base">25分钟</span><span class="dir_base">10公里</span></div>' +
      '<div class="dir_passby">途经：学院路</div></div>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 300, height: 40 } as DOMRect);
    const navigation = new EventTarget();
    vi.stubGlobal("navigation", navigation);
    const addListener = vi.fn();
    const sendMessage = vi.fn(async (message: ExtensionMessage) => {
      if (message.type !== "ANALYZE_ROUTE_BADGES") return;
      const context = message.payload;
      const analysis = createLocalFallbackResponse(context.observedRoutes ?? []);
      return {
        ok: true,
        value: createRouteBadgePayload(analysis, scoreAnalysis(analysis), "Start", "End", "amap")
      };
    });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage, onMessage: { addListener } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener: vi.fn() } }
    });
    await import("./content-script");
    await vi.advanceTimersByTimeAsync(1200);
    const readState = (): RouteBadgeViewState => {
      const respond = vi.fn();
      addListener.mock.calls[0][0]({ type: "GET_ROUTE_BADGE_STATE" }, {}, respond);
      return respond.mock.calls[0][0];
    };
    expect(readState().selectedRouteId).toBe("local_route_0");
    expect(document.querySelector(".moodmaps-route-badge--score")).not.toBeNull();

    const drivingUrl = location.href;
    history.replaceState({}, "", drivingUrl.replace("type=car", "type=bus"));
    navigation.dispatchEvent(new Event("currententrychange"));
    await vi.advanceTimersByTimeAsync(1200);
    expect(document.querySelector(".moodmaps-route-badge-slot")).toBeNull();
    expect(readState()).toMatchObject({ payload: null, selectedRouteId: null, state: "idle" });

    history.replaceState({}, "", drivingUrl);
    navigation.dispatchEvent(new Event("currententrychange"));
    await vi.advanceTimersByTimeAsync(1200);
    expect(readState().selectedRouteId).toBe("local_route_0");

    history.replaceState({}, "", drivingUrl.replace("type=car", "type=bus"));
    expect(readState()).toMatchObject({ payload: null, selectedRouteId: null, state: "idle" });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
