import { extractRouteContext } from "./route-extractor";
import {
  closeScoreExplainer,
  findRouteCards,
  parseDistanceMeters,
  parseWithoutTrafficMinutes,
  renderRouteBadges,
  trafficSignalFromText
} from "./route-badges";
import {
  AutoAnalysisGate,
  canAutoAnalyze,
  RefreshDebouncer,
  routeFingerprint
} from "./auto-analysis";
import { mapProviderName } from "../shared/map-provider";
import {
  defaultUiLanguage,
  isUiLanguage,
  localizedProviderName,
  UI_LANGUAGE_STORAGE_KEY,
  type UiLanguage,
  usesChineseUi
} from "../shared/provider-language";
import { signatureFromContext } from "../shared/route-badge-payload";
import {
  lifecycleMutationNeedsReconnect,
  preferredObservationRoot
} from "./observation-root";
import type {
  AppError,
  ExtensionMessage,
  RouteBadgePayload,
  RouteBadgeViewState,
  RouteContext
} from "../shared/types";

let lastFingerprint = "";
let renderFrame: number | undefined;
let refreshInFlight = false;
let refreshQueued = false;
let lastBadgePayload: RouteBadgePayload | null = null;
let badgeState: "idle" | "loading" | "error" = "idle";
let analysisRequestId = 0;
let activeAnalysisFingerprint = "";
let selectedRouteId: string | null = null;
let detectedRouteCards = 0;
let assignedRouteIds: string[] = [];
let assignedRouteDescriptions = new Map<string, string>();
let lastPublishedBadgeState = "";
const autoAnalysisGate = new AutoAnalysisGate();
let uiLanguage: UiLanguage = "en";
let uiLanguageReady = false;

function readRouteContext(): RouteContext {
  const context = extractRouteContext();
  const observedRoutes = findRouteCards().map((card, index) => ({
    description:
      card.routeDescription ??
      (usesChineseUi(uiLanguage)
        ? localizedProviderName(context.provider, uiLanguage) +
          "路线 " +
          (index + 1)
        : mapProviderName(context.provider) + " route " + (index + 1)),
    durationMinutes: card.durationMinutes,
    distanceMeters: parseDistanceMeters(
      card.distanceElement?.innerText ?? card.distanceElement?.textContent ?? ""
    ),
    hasTolls: /\btolls?\b|\bcongestion charges?\b|收费|收費/i.test(card.text),
    withoutTrafficMinutes: parseWithoutTrafficMinutes(card.text),
    trafficSignal: trafficSignalFromText(card.text)
  }));
  return observedRoutes.length > 0 ? { ...context, observedRoutes } : context;
}

async function sendRuntimeMessage<T>(
  message: ExtensionMessage
): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

function visibleBadgePayload(): RouteBadgePayload | null {
  if (!lastBadgePayload || detectedRouteCards === 0) return null;
  const visible = new Set(assignedRouteIds);
  return {
    ...lastBadgePayload,
    routes: lastBadgePayload.routes
      .filter((route) => visible.has(route.routeId))
      .map((route) => ({
        ...route,
        description: assignedRouteDescriptions.get(route.routeId) ?? route.description
      }))
  };
}

function clearRouteAssignments(): void {
  detectedRouteCards = 0;
  selectedRouteId = null;
  assignedRouteIds = [];
  assignedRouteDescriptions.clear();
}

function currentBadgeViewState(): RouteBadgeViewState {
  return {
    routeFingerprint: lastFingerprint,
    payload: visibleBadgePayload(),
    state: badgeState,
    selectedRouteId
  };
}

function publishBadgeViewState(): void {
  const state = currentBadgeViewState();
  const fingerprint =
    state.routeFingerprint + "|" + (state.payload?.generatedAt ?? "none") +
    "|" +
    (state.payload?.routes
      .map((route) => route.routeId + ":" + route.description)
      .join(",") ?? "none") +
    "|" +
    state.state +
    "|" +
    (state.selectedRouteId ?? "none");
  if (fingerprint === lastPublishedBadgeState) return;
  lastPublishedBadgeState = fingerprint;
  void sendRuntimeMessage<void>({
      type: "ROUTE_BADGE_STATE_UPDATED",
      payload: state
    } satisfies ExtensionMessage);
}

async function publishContext(force = false): Promise<void> {
  const context = readRouteContext();
  const nextFingerprint = routeFingerprint(context);
  const changed = nextFingerprint !== lastFingerprint;

  if (changed) {
    analysisRequestId += 1;
    activeAnalysisFingerprint = "";
    lastBadgePayload = null;
    clearRouteAssignments();
    badgeState = canAutoAnalyze(context) ? "loading" : "idle";
  }

  if (force || changed) {
    lastFingerprint = nextFingerprint;
    await sendRuntimeMessage<void>({
      type: "ROUTE_CONTEXT_UPDATED",
      payload: context
    });
  }

  if (autoAnalysisGate.shouldAnalyze(context)) {
    void analyzeContext(context, nextFingerprint);
  }
}

function renderBadgeLayer(): void {
  if (!uiLanguageReady) return;
  const context = readRouteContext();
  const currentFingerprint = routeFingerprint(context);

  if (
    activeAnalysisFingerprint &&
    activeAnalysisFingerprint !== currentFingerprint
  ) {
    analysisRequestId += 1;
    activeAnalysisFingerprint = "";
    autoAnalysisGate.reset();
    scheduleRefresh();
  }

  if (currentFingerprint !== lastFingerprint ||
      (lastBadgePayload && lastBadgePayload.contextSignature !== signatureFromContext(context))) {
    lastBadgePayload = null;
    clearRouteAssignments();
    autoAnalysisGate.reset();
    badgeState = canAutoAnalyze(context) ? "loading" : "idle";
    scheduleRefresh();
  }

  if (!context.origin || !context.destination || context.travelMode !== "DRIVE") {
    lastBadgePayload = null;
    badgeState = "idle";
    clearRouteAssignments();
    closeScoreExplainer();
    document
      .querySelectorAll<HTMLElement>(".moodmaps-route-badge-slot")
      .forEach((slot) => slot.remove());
    publishBadgeViewState();
    return;
  }

  const rendered = renderRouteBadges({
    pageUrl: context.pageUrl,
    payload: lastBadgePayload,
    state: badgeState,
    language: uiLanguage,
    onAnalyze: () => void analyzeFromRouteCard()
  });
  detectedRouteCards = rendered.detectedCards;
  assignedRouteIds = rendered.assignedRouteIds;
  assignedRouteDescriptions = new Map(
    rendered.assignedRoutes.flatMap((route) =>
      route.description ? [[route.routeId, route.description]] : []
    )
  );
  selectedRouteId = rendered.selectedRouteId;
  publishBadgeViewState();
}

async function analyzeContext(
  context: RouteContext,
  expectedFingerprint: string
): Promise<void> {
  if (!canAutoAnalyze(context)) {
    lastBadgePayload = null;
    badgeState = "error";
    renderBadgeLayer();
    return;
  }
  if (
    badgeState === "loading" &&
    activeAnalysisFingerprint === expectedFingerprint
  ) {
    return;
  }

  const requestId = ++analysisRequestId;
  activeAnalysisFingerprint = expectedFingerprint;
  lastBadgePayload = null;
  clearRouteAssignments();
  badgeState = "loading";
  renderBadgeLayer();

  try {
    const result = await sendRuntimeMessage<
      | { ok: true; value: RouteBadgePayload }
      | { ok: false; error: AppError }
    >({
      type: "ANALYZE_ROUTE_BADGES",
      payload: context
    } satisfies ExtensionMessage);

    if (requestId !== analysisRequestId) return;
    if (routeFingerprint(readRouteContext()) !== expectedFingerprint) {
      autoAnalysisGate.reset();
      scheduleRefresh();
      return;
    }
    if (!result) throw new Error("Extension context is unavailable.");
    if (!result.ok) throw result.error;
    lastBadgePayload = result.value;
    badgeState = "idle";
    autoAnalysisGate.markAnalyzed(context);
  } catch {
    if (requestId !== analysisRequestId) return;
    lastBadgePayload = null;
    badgeState = "error";
  } finally {
    if (requestId === analysisRequestId) {
      activeAnalysisFingerprint = "";
    }
  }

  if (requestId === analysisRequestId) renderBadgeLayer();
}

async function analyzeFromRouteCard(): Promise<void> {
  const context = readRouteContext();
  const nextFingerprint = routeFingerprint(context);
  autoAnalysisGate.markAnalyzed(context);
  await analyzeContext(context, nextFingerprint);
}

let observedRoot: HTMLElement | null = null;

function connectObserver(): void {
  const nextRoot = preferredObservationRoot(document);
  if (nextRoot === observedRoot) return;
  routeObserver.disconnect();
  routeObserver.observe(nextRoot, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "value",
      "class",
      "role",
      "aria-label",
      "aria-checked",
      "aria-pressed",
      "aria-current",
      "aria-selected"
    ]
  });
  observedRoot = nextRoot;
}

async function flushScheduledRefresh(): Promise<void> {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;
  try {
    await publishContext();
  } catch {
    // A later mutation or explicit retry can refresh the context again.
  } finally {
    renderBadgeLayer();
    connectObserver();
    refreshInFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      refreshDebouncer.schedule();
    }
  }
}

const refreshDebouncer = new RefreshDebouncer(() => {
  window.cancelAnimationFrame(renderFrame ?? 0);
  renderFrame = window.requestAnimationFrame(() => {
    void flushScheduledRefresh();
  });
});

function scheduleRefresh(): void {
  refreshDebouncer.schedule();
}

const routeObserver = new MutationObserver(scheduleRefresh);
const rootLifecycleObserver = new MutationObserver((records) => {
  if (lifecycleMutationNeedsReconnect(records, observedRoot)) {
    connectObserver();
    scheduleRefresh();
  } else if (records.some(({ type, target }) =>
    type === "attributes" && target instanceof Element &&
    !observedRoot?.contains(target) && target.closest("[data-travel_mode], [data-travel-mode]")
  )) {
    // Google Maps can put its travel-mode controls outside the route list.
    scheduleRefresh();
  }
});
connectObserver();
rootLifecycleObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-checked", "aria-pressed", "aria-selected"]
});
window.addEventListener("popstate", scheduleRefresh);
window.addEventListener("hashchange", scheduleRefresh);
// Map apps also change the active history entry via pushState or replaceState,
// which need not change the DOM or dispatch popstate.
(window as Window & { navigation?: EventTarget }).navigation?.addEventListener(
  "currententrychange", scheduleRefresh
);

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "EXTRACT_ROUTE_CONTEXT") {
      sendResponse(readRouteContext());
      return;
    }
    if (message.type === "GET_ROUTE_BADGE_STATE") {
      const context = readRouteContext();
      const fingerprint = routeFingerprint(context);
      if (fingerprint !== lastFingerprint) {
        scheduleRefresh();
        sendResponse({
          routeFingerprint: fingerprint, payload: null, selectedRouteId: null,
          state: canAutoAnalyze(context) ? "loading" : "idle"
        } satisfies RouteBadgeViewState);
        return;
      }
      sendResponse(currentBadgeViewState());
      return;
    }
    if (message.type === "UPDATE_ROUTE_BADGES") {
      const context = readRouteContext();
      if (message.routeFingerprint !== routeFingerprint(context)) return;
      analysisRequestId += 1;
      activeAnalysisFingerprint = "";
      lastBadgePayload = message.payload;
      badgeState = "idle";
      autoAnalysisGate.markAnalyzed(context);
      renderBadgeLayer();
      return;
    }
    if (message.type === "CLEAR_ROUTE_BADGES") {
      analysisRequestId += 1;
      activeAnalysisFingerprint = "";
      lastBadgePayload = null;
      clearRouteAssignments();
      badgeState = "idle";
      autoAnalysisGate.reset();
      renderBadgeLayer();
    }
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const nextLanguage = changes[UI_LANGUAGE_STORAGE_KEY]?.newValue;
  if (!isUiLanguage(nextLanguage) || nextLanguage === uiLanguage) return;
  uiLanguage = nextLanguage;
  closeScoreExplainer();
  renderBadgeLayer();
  scheduleRefresh();
});

async function initializeContentScript(): Promise<void> {
  const context = extractRouteContext();
  const stored = await chrome.storage.local.get(UI_LANGUAGE_STORAGE_KEY);
  uiLanguage = isUiLanguage(stored[UI_LANGUAGE_STORAGE_KEY])
    ? stored[UI_LANGUAGE_STORAGE_KEY]
    : defaultUiLanguage(context.provider);
  uiLanguageReady = true;
  await publishContext(true);
  renderBadgeLayer();
  scheduleRefresh();
}

void initializeContentScript().catch(() => {
  uiLanguage = defaultUiLanguage(extractRouteContext().provider);
  uiLanguageReady = true;
  renderBadgeLayer();
  scheduleRefresh();
});
