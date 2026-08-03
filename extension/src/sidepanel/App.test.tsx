// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MoodScoreComponentExplanation,
  RouteBadgeViewState,
  RouteContext
} from "../shared/types";
import { App, chooseSelectedRouteId, percentageLabels } from "./App";

describe("MoodMaps read-only popup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  async function remountWithChrome(fakeChrome: unknown): Promise<void> {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: fakeChrome
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("removes the duplicate route form and asks for a supported map route", () => {
    expect(container.textContent).not.toContain("Where are you headed?");
    expect(container.textContent).not.toContain("Starting point");
    expect(container.textContent).not.toContain("Destination");
    expect(container.textContent).not.toContain("Analyze routes");
    expect(container.querySelectorAll("input[type='text']")).toHaveLength(0);

    expect(container.textContent).toContain("Plan a driving route first.");
    expect(container.textContent).toContain("APPLE MAPS");
    expect(container.textContent).toContain("WAZE");
    expect(container.textContent).toContain("AMAP");
    expect(container.textContent).not.toContain("Preview");
    expect(container.textContent).not.toContain("Demo");
  });

  it("opens the model by default after the routes on this map", () => {
    const method = container.querySelector<HTMLDetailsElement>(".method-block");
    expect(method?.open).toBe(true);
    expect(method?.querySelector("summary")?.textContent).toContain(
      "How Mood Score works"
    );
    expect(method?.textContent).toContain("100 − Σ (stress × weight)");
    expect(method?.querySelectorAll(".base-weights > div")).toHaveLength(5);
    expect(method?.textContent).toContain("Traffic");
    expect(method?.textContent).toContain("Weather");
  });

  it("keeps the current route selected when refreshed results still contain it", () => {
    const routes = [
      { routeId: "route_0" },
      { routeId: "route_1" }
    ] as Parameters<typeof chooseSelectedRouteId>[0];
    expect(chooseSelectedRouteId(routes, "route_1")).toBe("route_1");
    expect(chooseSelectedRouteId(routes, "missing")).toBe("route_0");
  });

  it("displays rebalanced weights that add up exactly to the available total", () => {
    const components: MoodScoreComponentExplanation[] = [
      {
        key: "traffic",
        label: "Traffic",
        stress: null,
        effectiveWeight: 0,
        contribution: null
      },
      {
        key: "delay",
        label: "Delay",
        stress: 30,
        effectiveWeight: 0.2 / 0.52,
        contribution: 11.5
      },
      {
        key: "maneuver",
        label: "Complexity",
        stress: 30,
        effectiveWeight: 0.2 / 0.52,
        contribution: 11.5
      },
      {
        key: "duration",
        label: "Duration",
        stress: 30,
        effectiveWeight: 0.12 / 0.52,
        contribution: 6.9
      },
      {
        key: "weather",
        label: "Weather",
        stress: null,
        effectiveWeight: 0,
        contribution: null
      }
    ];
    const labels = percentageLabels(components);
    expect(labels).toMatchObject({
      traffic: "0%",
      delay: "38.46%",
      maneuver: "38.46%",
      duration: "23.08%",
      weather: "0%"
    });
    expect(
      Object.values(labels).reduce(
        (total, label) => total + Number.parseFloat(label),
        0
      )
    ).toBe(100);
  });

  it("shows a clear error when a payload contains no confidently matched routes", async () => {
    const context: RouteContext = {
      provider: "google",
      origin: { text: "Penn Station" },
      destination: { text: "Yale University" },
      travelMode: "DRIVE",
      departureTime: "2026-07-24T19:00:00Z",
      source: "url",
      confidence: 0.98,
      pageUrl: "https://www.google.com/maps/dir/Penn/Yale"
    };
    const mapState: RouteBadgeViewState = {
      state: "idle",
      selectedRouteId: null,
      payload: {
        contextSignature: "google|penn station|yale university",
        generatedAt: "2026-07-24T19:00:00Z",
        routes: []
      }
    };
    await remountWithChrome({
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn(async () => context),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn(async () => [{ id: 1 }]),
        sendMessage: vi.fn(async () => mapState)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined)
        }
      }
    });

    expect(container.querySelector(".error-state")).not.toBeNull();
    expect(container.textContent).toContain(
      "could not reliably match a result to the current map routes"
    );
    expect(container.textContent).not.toContain("Plan a driving route first.");
    expect(container.querySelector(".error-state button")).not.toBeNull();
  });

  it("does not offer retry for a non-retryable analysis error", async () => {
    const context: RouteContext = {
      provider: "google",
      origin: { text: "Penn Station" },
      destination: { text: "Yale University" },
      travelMode: "DRIVE",
      departureTime: "2026-07-24T19:00:00Z",
      source: "url",
      confidence: 0.98,
      pageUrl: "https://www.google.com/maps/dir/Penn/Yale"
    };
    await remountWithChrome({
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn(async (message: { type: string }) =>
          message.type === "GET_CURRENT_ROUTE_CONTEXT"
            ? context
            : {
                ok: false,
                error: {
                  code: "INVALID_INPUT",
                  message: "The route input is not valid.",
                  retryable: false
                }
              }
        ),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn(async () => [{ id: 1 }]),
        sendMessage: vi.fn(async () => null)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined)
        }
      }
    });

    expect(container.querySelector(".error-state")).not.toBeNull();
    expect(container.textContent).toContain("The route input is not valid.");
    expect(container.querySelector(".error-state button")).toBeNull();
  });

  it("uses the active provider in Chinese route copy", async () => {
    const context: RouteContext = {
      provider: "google",
      origin: { text: "Penn Station" },
      destination: { text: "Yale University" },
      travelMode: "DRIVE",
      departureTime: "2026-07-24T19:00:00Z",
      source: "url",
      confidence: 0.98,
      pageUrl: "https://www.google.com/maps/dir/Penn/Yale"
    };
    await remountWithChrome({
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn(async () => context),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn(async () => [{ id: 1 }]),
        sendMessage: vi.fn(async () => ({
          state: "idle",
          selectedRouteId: null,
          payload: {
            contextSignature: "google|penn station|yale university",
            generatedAt: "2026-07-24T19:00:00Z",
            routes: []
          }
        }))
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ moodmapsUiLanguage: "zh-CN" })),
          set: vi.fn(async () => undefined)
        }
      }
    });

    expect(container.querySelector("main")?.lang).toBe("zh-CN");
    expect(container.textContent).toContain("Google 地图路线卡片");
    expect(container.textContent).not.toContain("高德地图路线卡片");
  });

  it("renders the Amap popup in Chinese without English UI copy", async () => {
    await act(async () => root.unmount());
    container.remove();

    const context: RouteContext = {
      provider: "amap",
      origin: { text: "北京南站", latitude: 39.865246, longitude: 116.378517 },
      destination: {
        text: "清华大学",
        latitude: 40.003213,
        longitude: 116.326936
      },
      travelMode: "DRIVE",
      departureTime: "2026-07-24T19:00:00Z",
      source: "url",
      confidence: 0.98,
      pageUrl: "https://amap.com/dir?type=car"
    };
    const mapState: RouteBadgeViewState = {
      state: "idle",
      selectedRouteId: "route_0",
      payload: {
        contextSignature: "amap|北京南站|清华大学",
        generatedAt: "2026-07-24T19:00:00Z",
        routes: [
          {
            routeId: "route_0",
            description: "途经：二环、西直门北大街、学院路",
            durationMinutes: 37,
            score: 78,
            label: "Calm",
            roles: ["Fastest", "Balanced", "Calmest"],
            explanation: {
              routeStress: 22,
              routeCalmness: 78,
              finalScore: 78,
              components: [
                {
                  key: "traffic",
                  label: "Traffic",
                  stress: 20,
                  effectiveWeight: 0.32,
                  contribution: 6.4
                },
                {
                  key: "weather",
                  label: "Weather",
                  stress: 10,
                  effectiveWeight: 0.16,
                  contribution: 1.6
                }
              ]
            },
            reasons: [
              {
                type: "positive",
                message: "This route has the lowest delay stress.",
                messageZh: "这条路线的延误压力最低。"
              },
              {
                type: "negative",
                message: "This route takes two minutes longer.",
                messageZh: "这条路线多用两分钟。"
              }
            ]
          }
        ]
      }
    };
    const fakeChrome = {
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn(async () => context),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: {
        query: vi.fn(async () => [{ id: 1 }]),
        sendMessage: vi.fn(async () => mapState)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined)
        }
      }
    };
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: fakeChrome
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("main")?.lang).toBe("zh-CN");
    expect(container.textContent).toContain("路线舒适度，一目了然。");
    expect(container.textContent).toContain("已选路线 · 高德地图");
    expect(container.textContent).toContain("37 分钟");
    expect(container.textContent).toContain("最快路线");
    expect(container.textContent).toContain("均衡选择");
    expect(container.textContent).toContain("最平静路线");
    expect(container.textContent).toContain("平静");
    expect(container.textContent).toContain("路线计算");
    expect(container.textContent).toContain("为什么是这个分数");
    expect(container.textContent).toContain("这条路线的延误压力最低。");
    expect(container.textContent).toContain(
      "交通只使用高德地图中可见的拥堵提示、预计时间与无拥堵时间之差，或多条可见路线间的相对速度"
    );
    expect(container.textContent).toContain(
      "复杂度是可重复计算的路线名称代理值，不代表真实转弯次数"
    );
    expect(container.textContent).toContain(
      "交通和复杂度代理只在页面存在明确可见信号时计入"
    );
    expect(container.textContent).not.toContain("交通情况根据高德地图");
    expect(container.querySelectorAll(".score-reason")).toHaveLength(2);
    expect(container.textContent).toContain("交通");
    expect(container.textContent).toContain("天气");
    expect(container.textContent).toContain("心情分数如何计算");
    expect(container.textContent).not.toContain("Route calmness, explained.");
    expect(container.textContent).not.toContain("SELECTED ROUTE");
    expect(container.textContent).not.toContain("How Mood Score works");
    expect(container.textContent).not.toContain("Traffic");
    expect(container.textContent).not.toContain("Weather");
    expect(container.textContent).not.toContain("Calm");

    const toggle = container.querySelector<HTMLButtonElement>(
      ".language-toggle"
    );
    expect(toggle?.textContent).toContain("中");
    expect(toggle?.textContent).toContain("EN");
    await act(async () => toggle?.click());
    expect(container.querySelector("main")?.lang).toBe("en");
    expect(container.textContent).toContain("Route calmness, explained.");
    expect(container.textContent).toContain("SELECTED ROUTE · Amap");
    expect(container.textContent).toContain("37 min");
    expect(container.textContent).toContain("Fastest option");
    expect(container.textContent).toContain("Balanced choice");
    expect(container.textContent).toContain("Calmest option");
    expect(container.textContent).toContain("Calm");
    expect(container.textContent).toContain("How Mood Score works");
    expect(container.textContent).toContain("Why this score");
    expect(container.textContent).toContain(
      "This route has the lowest delay stress."
    );
    expect(container.textContent).toContain(
      "Traffic uses only visible Amap congestion cues, ETA versus without-traffic time, or relative pace across visible routes."
    );
    expect(container.textContent).toContain(
      "Complexity is a repeatable route-name proxy, not a turn count."
    );
    expect(container.textContent).toContain(
      "Traffic and Complexity proxies are included only when an explicit visible signal exists."
    );
    expect(container.textContent).not.toContain(
      "Traffic is estimated from the visible Amap ETA"
    );
    expect(container.textContent).not.toContain("这条路线的延误压力最低。");
    expect(container.textContent).not.toContain("路线舒适度，一目了然。");
    expect(fakeChrome.storage.local.set).toHaveBeenCalledWith({
      moodmapsUiLanguage: "en"
    });
  });
});
