import { mapProviderName } from "../shared/map-provider";
import { scoreAnalysis } from "../scoring/scoring";
import { createRouteBadgePayload } from "../shared/route-badge-payload";
import { createLocalFallbackResponse } from "./local-fallback";
import { getEndpointMidpointWeather } from "./open-meteo";
import type {
  AppError,
  ExtensionMessage,
  RouteBadgePayload,
  RouteContext,
  WeatherFeatures
} from "../shared/types";

function contextKey(tabId: number): string {
  return "routeContext:" + tabId;
}

function removeStoredContext(tabId: number): void {
  void chrome.storage.session
    .remove(contextKey(tabId))
    .catch(() => undefined);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  removeStoredContext(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    removeStoredContext(tabId);
  }
});

export function normalizeAnalysisError(error: unknown): AppError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "ANALYSIS_TIMEOUT",
      message: "Route analysis timed out. Please try again.",
      retryable: true
    };
  }
  return {
    code: "ANALYSIS_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "MoodMaps could not complete the local route analysis.",
    retryable: true
  };
}

async function currentContext(senderTabId?: number): Promise<RouteContext | null> {
  const tabs = senderTabId !== undefined
    ? [{ id: senderTabId }]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) return null;
  const key = contextKey(tabId);
  try {
    const detected = (await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_ROUTE_CONTEXT"
    })) as RouteContext | null;
    if (detected) {
      void chrome.storage.session
        .set({ [key]: detected })
        .catch(() => undefined);
      return detected;
    }
  } catch {
    // A missing content script means the current page is unsupported or still
    // navigating. Never substitute a context captured from an older document.
  }
  removeStoredContext(tabId);
  return null;
}

async function analyzeRouteBadges(
  context: RouteContext
): Promise<RouteBadgePayload> {
  if (!context.origin || !context.destination || context.travelMode !== "DRIVE") {
    throw {
      code: "INVALID_INPUT",
      message: "Plan a driving route in a supported map before analyzing calmness.",
      retryable: false
    } satisfies AppError;
  }
  if (context.confidence < 0.6) {
    throw {
      code: "ROUTE_CONFIRMATION_REQUIRED",
      message: "Open MoodMaps and confirm the origin and destination first.",
      retryable: false
    } satisfies AppError;
  }

  if (!context.observedRoutes?.length) {
    throw {
      code: "ROUTE_DETAILS_LOADING",
      message:
        "Wait for the " +
        mapProviderName(context.provider) +
        " route cards to finish loading.",
      retryable: true
    } satisfies AppError;
  }
  let weather: WeatherFeatures | null = null;
  try {
    weather = await getEndpointMidpointWeather(
      context.origin,
      context.destination
    );
  } catch {
    // Weather is optional. Local route scoring must remain available.
  }
  const response = createLocalFallbackResponse(
    context.observedRoutes,
    weather,
    context.provider
  );
  const scoredRoutes = scoreAnalysis(response);
  return createRouteBadgePayload(
    response,
    scoredRoutes,
    context.origin.text,
    context.destination.text,
    context.provider
  );
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === "ROUTE_CONTEXT_UPDATED") {
      if (sender.tab?.id !== undefined) {
        void chrome.storage.session
          .set({
            [contextKey(sender.tab.id)]: message.payload
          })
          .catch(() => undefined);
      }
      return false;
    }

    if (message.type === "GET_CURRENT_ROUTE_CONTEXT") {
      void currentContext(sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true;
    }

    if (message.type === "ANALYZE_ROUTE_BADGES") {
      void analyzeRouteBadges(message.payload)
        .then((value) => sendResponse({ ok: true, value }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error:
              typeof error === "object" && error && "code" in error
                ? error
                : normalizeAnalysisError(error)
          })
        );
      return true;
    }

    return false;
  }
);
