import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionMessage, RouteContext } from "../shared/types";
import { getEndpointMidpointWeather } from "./open-meteo";

vi.mock("./open-meteo", () => ({
  getEndpointMidpointWeather: vi.fn(async () => null)
}));

type RuntimeListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void;

function routeContext(): RouteContext {
  return {
    provider: "google",
    origin: { text: "Fresh origin" },
    destination: { text: "Fresh destination" },
    travelMode: "DRIVE",
    departureTime: "2026-07-24T20:00:00Z",
    source: "dom",
    confidence: 0.9,
    pageUrl: "https://www.google.com/maps/dir/Fresh/origin",
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
  };
}

async function installServiceWorker(options?: {
  detected?: RouteContext | null;
  sendMessageError?: Error;
  storageSetError?: Error;
}) {
  vi.resetModules();
  let runtimeListener: RuntimeListener | undefined;
  let updatedListener:
    | ((
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab
      ) => void)
    | undefined;
  const remove = vi.fn(async () => undefined);
  const get = vi.fn(async () => ({
    "routeContext:7": {
      ...routeContext(),
      origin: { text: "Stale origin" }
    }
  }));
  const set = options?.storageSetError
    ? vi.fn(async () => {
        throw options.storageSetError;
      })
    : vi.fn(async () => undefined);
  const sendMessage = options?.sendMessageError
    ? vi.fn(async () => {
        throw options.sendMessageError;
      })
    : vi.fn(async () => options?.detected ?? routeContext());

  vi.stubGlobal("chrome", {
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: {
        addListener: vi.fn(
          (
            listener: (
              tabId: number,
              changeInfo: chrome.tabs.TabChangeInfo,
              tab: chrome.tabs.Tab
            ) => void
          ) => {
            updatedListener = listener;
          }
        )
      },
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage
    },
    storage: { session: { get, set, remove } },
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        })
      }
    }
  });

  const serviceWorker = await import("./service-worker");
  if (!runtimeListener || !updatedListener) {
    throw new Error("Service-worker listeners were not registered.");
  }
  return {
    get,
    remove,
    runtimeListener,
    sendMessage,
    normalizeAnalysisError: serviceWorker.normalizeAnalysisError,
    set,
    updatedListener
  };
}

function sendRuntimeMessage(
  listener: RuntimeListener,
  message: ExtensionMessage
): Promise<unknown> {
  return new Promise((resolve) => {
    expect(listener(message, {}, resolve)).toBe(true);
  });
}

describe("service-worker route context lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("clears a tab context as soon as a new document starts loading", async () => {
    const worker = await installServiceWorker();

    worker.updatedListener(
      7,
      { status: "loading" },
      { id: 7 } as chrome.tabs.Tab
    );

    await vi.waitFor(() => {
      expect(worker.remove).toHaveBeenCalledWith("routeContext:7");
    });
  });

  it("does not return a stale cached context when the content script is absent", async () => {
    const worker = await installServiceWorker({
      sendMessageError: new Error("Receiving end does not exist")
    });

    const result = await sendRuntimeMessage(worker.runtimeListener, {
      type: "GET_CURRENT_ROUTE_CONTEXT"
    });

    expect(result).toBeNull();
    expect(worker.get).not.toHaveBeenCalled();
    expect(worker.remove).toHaveBeenCalledWith("routeContext:7");
  });

  it("returns a fresh context even when best-effort caching fails", async () => {
    const fresh = routeContext();
    const worker = await installServiceWorker({
      detected: fresh,
      storageSetError: new Error("quota")
    });

    const result = await sendRuntimeMessage(worker.runtimeListener, {
      type: "GET_CURRENT_ROUTE_CONTEXT"
    });

    expect(result).toEqual(fresh);
  });

  it("continues local analysis when optional weather fails", async () => {
    vi.mocked(getEndpointMidpointWeather).mockRejectedValueOnce(
      new Error("weather unavailable")
    );
    const worker = await installServiceWorker();

    const result = (await sendRuntimeMessage(worker.runtimeListener, {
      type: "ANALYZE_ROUTE_BADGES",
      payload: routeContext()
    })) as { ok: boolean; value?: { routes: unknown[] } };

    expect(result.ok).toBe(true);
    expect(result.value?.routes).toHaveLength(1);
  });

  it("uses provider-neutral errors for local analysis failures", async () => {
    const worker = await installServiceWorker();

    expect(
      worker.normalizeAnalysisError(new DOMException("aborted", "AbortError"))
    ).toEqual({
      code: "ANALYSIS_TIMEOUT",
      message: "Route analysis timed out. Please try again.",
      retryable: true
    });
    expect(worker.normalizeAnalysisError("unexpected")).toEqual({
      code: "ANALYSIS_ERROR",
      message: "MoodMaps could not complete the local route analysis.",
      retryable: true
    });
  });
});
