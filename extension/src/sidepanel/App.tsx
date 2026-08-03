import { useEffect, useMemo, useRef, useState } from "react";
import { MOOD_SCORE_COMPONENTS } from "../scoring/scoring";
import {
  defaultUiLanguage,
  isUiLanguage,
  localizedComponentLabel,
  localizedMoodLabel,
  localizedProviderName,
  localizedRoleLabel,
  localizedScoreReason,
  UI_LANGUAGE_STORAGE_KEY,
  type UiLanguage,
  usesChineseUi
} from "../shared/provider-language";
import { signatureFromContext } from "../shared/route-badge-payload";
import type {
  AppError,
  ExtensionMessage,
  MapProvider,
  MoodScoreComponentExplanation,
  MoodScoreComponentKey,
  RouteBadgeItem,
  RouteBadgeViewState,
  RouteContext
} from "../shared/types";

type ViewState = "detecting" | "loading" | "results" | "empty" | "error";

function isExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function canAnalyze(context: RouteContext | null): context is RouteContext {
  return Boolean(
    context?.origin?.text.trim() &&
      context.destination?.text.trim() &&
      context.travelMode === "DRIVE" &&
      context.confidence >= 0.6
  );
}

function percentage(value: number): string {
  return Math.round(value * 100) + "%";
}

function formatBasisPoints(value: number): string {
  return (value / 100).toFixed(2).replace(/\.?0+$/, "") + "%";
}

export function percentageLabels(
  components: MoodScoreComponentExplanation[]
): Record<MoodScoreComponentKey, string> {
  const labels = Object.fromEntries(
    MOOD_SCORE_COMPONENTS.map((component) => [component.key, "0%"])
  ) as Record<MoodScoreComponentKey, string>;
  const available = components
    .filter((component) => component.effectiveWeight > 0)
    .map((component) => {
      const exactBasisPoints = component.effectiveWeight * 10000;
      const basisPoints = Math.floor(exactBasisPoints);
      return {
        key: component.key,
        basisPoints,
        remainder: exactBasisPoints - basisPoints
      };
    });
  if (available.length === 0) return labels;

  const targetBasisPoints = Math.round(
    components.reduce(
      (total, component) => total + component.effectiveWeight,
      0
    ) * 10000
  );
  const undistributed =
    targetBasisPoints -
    available.reduce((total, component) => total + component.basisPoints, 0);
  const byRemainder = [...available].sort(
    (first, second) => second.remainder - first.remainder
  );
  for (let index = 0; index < undistributed; index += 1) {
    byRemainder[index % byRemainder.length].basisPoints += 1;
  }
  for (const component of available) {
    labels[component.key] = formatBasisPoints(component.basisPoints);
  }
  return labels;
}

function formatDuration(minutes: number, language: UiLanguage): string {
  const rounded = Math.round(minutes);
  if (usesChineseUi(language)) {
    if (rounded < 60) return rounded + " 分钟";
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return hours + " 小时" + (remainder ? " " + remainder + " 分钟" : "");
  }
  if (rounded < 60) return rounded + " min";
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours + " hr" + (remainder ? " " + remainder + " min" : "");
}

interface SidepanelCopy {
  brandTagline: string;
  selectedRoute: string;
  routeCalculation: string;
  componentAria: string;
  reasonsTitle: string;
  reasonsAria: string;
  notUsed: string;
  points: string;
  routeNote: string;
  loadingRoute: string;
  methodTitle: string;
  methodSubtitle: string;
  methodDescription: string;
  modelLabel: string;
  modelFormula: string;
  baseWeightsAria: string;
  methodNote: string;
  onThisMap: string;
  otherRoutes: string;
  emptyEyebrow: string;
  emptyTitle: string;
  emptyBody: string;
  errorEyebrow: string;
  errorTitle: string;
  errorFallback: string;
  noMatchedRoutes: string;
  retry: string;
  disclaimer: string;
  weatherBy: string;
  independence: string;
}

function sidepanelCopy(
  provider: MapProvider,
  language: UiLanguage
): SidepanelCopy {
  if (usesChineseUi(language)) {
    const providerName =
      provider === "unknown"
        ? "支持的地图"
        : localizedProviderName(provider, language);
    return {
      brandTagline: "路线舒适度，一目了然。",
      selectedRoute: "已选路线",
      routeCalculation: "路线计算",
      componentAria: "路线加权压力因素",
      reasonsTitle: "为什么是这个分数",
      reasonsAria: "路线评分原因",
      notUsed: "未计入",
      points: "分",
      routeNote:
        "交通只使用" +
        providerName +
        "中可见的拥堵提示、预计时间与无拥堵时间之差，或多条可见路线间的相对速度；复杂度是可重复计算的路线名称代理值，不代表真实转弯次数；延误比较可见路线的相对耗时；天气数据在可用时由 Open-Meteo 提供。",
      loadingRoute: "正在读取" + providerName + "中已经规划好的路线…",
      methodTitle: "心情分数如何计算",
      methodSubtitle: "五项路线因素，一个加权分数",
      methodDescription:
        "Mood Navigator 会把每项路线条件转换为 0–100 的压力值，计算加权平均值，再用 100 减去该结果。",
      modelLabel: "计算模型",
      modelFormula: "100 − Σ（压力 × 权重）",
      baseWeightsAria: "心情分数基础权重",
      methodNote:
        "交通和复杂度代理只在页面存在明确可见信号时计入；不可用的项目会被排除，而不是被视为平静，其余权重会自动重新平衡。",
      onThisMap: "当前地图",
      otherRoutes: "其他路线",
      emptyEyebrow:
        provider === "unknown"
          ? "GOOGLE 地图 · APPLE 地图 · WAZE · 高德地图"
          : providerName,
      emptyTitle: "请先规划一条驾车路线。",
      emptyBody:
        "MoodMaps 会直接读取" +
        providerName +
        "中已经规划好的路线，不需要在插件里再次输入起点和终点。",
      errorEyebrow: "路线不可用",
      errorTitle: "暂时无法读取这条路线。",
      errorFallback: "请等待" + providerName + "路线卡片加载完成后再试一次。",
      noMatchedRoutes:
        "路线分析已完成，但暂时无法将结果可靠地匹配到" +
        providerName +
        "路线卡片。请等待路线卡片稳定后重试。",
      retry: "重新分析",
      disclaimer: "实验性路线舒适度估算，不属于安全或医疗评估。",
      weatherBy: "天气数据由",
      independence:
        "MoodMaps 为独立项目，与 Google、Apple、Waze 或高德地图不存在隶属或官方合作关系。"
    };
  }
  return {
    brandTagline: "Route calmness, explained.",
    selectedRoute: "SELECTED ROUTE",
    routeCalculation: "Route calculation",
    componentAria: "Weighted route stress inputs",
    reasonsTitle: "Why this score",
    reasonsAria: "Reasons for this route score",
    notUsed: "not used",
    points: "pts",
    routeNote:
      "Traffic uses only visible " +
      localizedProviderName(provider, language) +
      " congestion cues, ETA versus without-traffic time, or relative pace across visible routes. Complexity is a repeatable route-name proxy, not a turn count. Delay compares visible route times. Weather uses Open-Meteo when available.",
    loadingRoute:
      "Reading the route already open in " +
      localizedProviderName(provider, language) +
      "…",
    methodTitle: "How Mood Score works",
    methodSubtitle: "Five route inputs, one weighted score",
    methodDescription:
      "Mood Navigator converts each route condition into a 0–100 stress input, calculates a weighted mean, and subtracts it from 100.",
    modelLabel: "THE MODEL",
    modelFormula: "100 − Σ (stress × weight)",
    baseWeightsAria: "Base Mood Score weights",
    methodNote:
      "Traffic and Complexity proxies are included only when an explicit visible signal exists. Unavailable inputs are excluded—not treated as calm—and the remaining weights rebalance automatically.",
    onThisMap: "ON THIS MAP",
    otherRoutes: "Other routes",
    emptyEyebrow: "GOOGLE MAPS · APPLE MAPS · WAZE · AMAP",
    emptyTitle: "Plan a driving route first.",
    emptyBody:
      "MoodMaps reads the route already open in a supported map. There is no second origin or destination form to fill in here.",
    errorEyebrow: "ROUTE UNAVAILABLE",
    errorTitle: "We could not read this route.",
    errorFallback: "Try again after the map's route cards have loaded.",
    noMatchedRoutes:
      "The analysis finished, but MoodMaps could not reliably match a result to the current map routes. Wait for the route cards to settle, then try again.",
    retry: "Try again",
    disclaimer: "Experimental comfort estimate—not a safety or medical assessment.",
    weatherBy: "Weather data by",
    independence:
      "MoodMaps is independent and is not affiliated with Google, Apple, Waze, or Amap."
  };
}

export function chooseSelectedRouteId(
  routes: RouteBadgeItem[],
  currentRouteId: string | null
): string | null {
  return routes.some((route) => route.routeId === currentRouteId)
    ? currentRouteId
    : routes[0]?.routeId ?? null;
}

function normalizeError(caught: unknown): AppError {
  return typeof caught === "object" && caught && "code" in caught
    ? (caught as AppError)
    : {
        code: "UNKNOWN_ERROR",
        message: "MoodMaps could not read this route right now.",
        retryable: true
      };
}

function noMatchedRoutesError(): AppError {
  return {
    code: "NO_MATCHED_ROUTES",
    message:
      "The analysis finished, but MoodMaps could not reliably match a result to the current map routes.",
    retryable: true
  };
}

function ScoreComponents(props: {
  route: RouteBadgeItem;
  language: UiLanguage;
}) {
  const copy = sidepanelCopy("unknown", props.language);
  const weights = percentageLabels(props.route.explanation.components);
  return (
    <div className="score-components" aria-label={copy.componentAria}>
      {props.route.explanation.components.map((component) => (
        <div key={component.key}>
          <strong>
            {localizedComponentLabel(
              component.key,
              component.label,
              props.language
            )}
          </strong>
          {component.stress === null || component.contribution === null ? (
            <>
              <span>—</span>
              <small>{copy.notUsed}</small>
            </>
          ) : (
            <>
              <span>
                {Math.round(component.stress)} × {weights[component.key]}
              </span>
              <small>
                {component.contribution.toFixed(1)} {copy.points}
              </small>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ScoreReasons(props: {
  route: RouteBadgeItem;
  language: UiLanguage;
}) {
  const copy = sidepanelCopy("unknown", props.language);
  return (
    <section className="score-reasons" aria-label={copy.reasonsAria}>
      <h2>{copy.reasonsTitle}</h2>
      <ul>
        {props.route.reasons.slice(0, 4).map((reason, index) => (
          <li className={"score-reason score-reason--" + reason.type} key={index}>
            {localizedScoreReason(reason, props.language)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SelectedRouteScore(props: {
  route: RouteBadgeItem;
  provider: MapProvider;
  language: UiLanguage;
}) {
  const { route } = props;
  const explanation = route.explanation;
  const copy = sidepanelCopy(props.provider, props.language);
  const moodLabel = localizedMoodLabel(route.label, props.language);
  return (
    <section className="selected-score" aria-labelledby="selected-route-heading">
      <div className="selected-score-top">
        <div className="selected-route-copy">
          <p className="eyebrow">
            {copy.selectedRoute} ·{" "}
            {localizedProviderName(props.provider, props.language)}
          </p>
          <h1 id="selected-route-heading">{route.description}</h1>
          <p className="route-meta">
            {formatDuration(route.durationMinutes, props.language)}{" "}
            <span>·</span>{" "}
            {localizedRoleLabel(route.roles, props.language)}
          </p>
        </div>
        <div
          className="selected-score-value"
          aria-label={
            usesChineseUi(props.language)
              ? "心情分数 " + route.score + "/100，" + moodLabel
              : "Mood Score " + route.score + " out of 100, " + moodLabel
          }
        >
          <strong>{route.score}</strong>
          <span>{moodLabel}</span>
        </div>
      </div>

      <div className="score-formula">
        <span>{copy.routeCalculation}</span>
        <p>
          100 − {explanation.routeStress}{" "}
          {usesChineseUi(props.language) ? "加权压力" : "weighted stress"} ={" "}
          <strong>{explanation.routeCalmness}</strong>
        </p>
      </div>

      <ScoreComponents route={route} language={props.language} />
      <ScoreReasons route={route} language={props.language} />

      <p className="selected-score-note">{copy.routeNote}</p>
    </section>
  );
}

function LoadingScore(props: {
  provider: MapProvider;
  language: UiLanguage;
}) {
  const copy = sidepanelCopy(props.provider, props.language);
  return (
    <section className="selected-score loading-score" aria-live="polite">
      <p className="eyebrow">{copy.selectedRoute}</p>
      <div className="loading-title" />
      <div className="loading-subtitle" />
      <div className="loading-divider" />
      <p>{copy.loadingRoute}</p>
    </section>
  );
}

function DetectingScore() {
  return (
    <section className="selected-score loading-score" aria-busy="true">
      <div className="loading-title" />
      <div className="loading-subtitle" />
      <div className="loading-divider" />
    </section>
  );
}

function HowMoodScoreWorks(props: {
  provider: MapProvider;
  language: UiLanguage;
}) {
  const copy = sidepanelCopy(props.provider, props.language);
  return (
    <details className="method-block" open>
      <summary>
        <span>
          <strong>{copy.methodTitle}</strong>
          <small>{copy.methodSubtitle}</small>
        </span>
        <i aria-hidden="true">+</i>
      </summary>
      <div className="method-content">
        <p>{copy.methodDescription}</p>
        <div className="method-equation">
          <span>{copy.modelLabel}</span>
          <strong>{copy.modelFormula}</strong>
        </div>
        <div className="base-weights" aria-label={copy.baseWeightsAria}>
          {MOOD_SCORE_COMPONENTS.map((component) => (
            <div key={component.key}>
              <strong>
                {localizedComponentLabel(
                  component.key,
                  component.label,
                  props.language
                )}
              </strong>
              <span>{percentage(component.baseWeight)}</span>
            </div>
          ))}
        </div>
        <p className="method-note">{copy.methodNote}</p>
      </div>
    </details>
  );
}

function OtherRoutes(props: {
  routes: RouteBadgeItem[];
  provider: MapProvider;
  language: UiLanguage;
}) {
  if (props.routes.length === 0) return null;
  const copy = sidepanelCopy(props.provider, props.language);
  return (
    <section className="other-routes" aria-labelledby="other-routes-heading">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{copy.onThisMap}</p>
          <h2 id="other-routes-heading">{copy.otherRoutes}</h2>
        </div>
        <span>{props.routes.length}</span>
      </div>
      <div className="route-row-list">
        {props.routes.map((route) => (
          <div className="route-row" key={route.routeId}>
            <div>
              <strong>{route.description}</strong>
              <span>
                {formatDuration(route.durationMinutes, props.language)} ·{" "}
                {localizedRoleLabel(route.roles, props.language)}
              </span>
            </div>
            <p>
              <strong>{route.score}</strong>
              <span>{localizedMoodLabel(route.label, props.language)}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [context, setContext] = useState<RouteContext | null>(null);
  const [badgeView, setBadgeView] = useState<RouteBadgeViewState>({
    payload: null,
    state: "idle",
    selectedRouteId: null
  });
  const [view, setView] = useState<ViewState>("detecting");
  const [error, setError] = useState<AppError | null>(null);
  const [language, setLanguage] = useState<UiLanguage>("en");
  const requestRef = useRef(0);
  const contextRef = useRef<RouteContext | null>(null);
  const languagePreferenceRef = useRef(false);
  const selectedRouteIdRef = useRef<string | null>(null);
  const provider = context?.provider ?? "unknown";
  const copy = sidepanelCopy(provider, language);
  const chinese = usesChineseUi(language);

  const selectedRoute = useMemo(() => {
    const routes = badgeView.payload?.routes ?? [];
    return (
      routes.find((route) => route.routeId === badgeView.selectedRouteId) ??
      routes[0] ??
      null
    );
  }, [badgeView]);

  const otherRoutes = useMemo(
    () =>
      (badgeView.payload?.routes ?? []).filter(
        (route) => route.routeId !== selectedRoute?.routeId
      ),
    [badgeView.payload, selectedRoute]
  );

  function showBadgeView(
    nextBadgeView: RouteBadgeViewState,
    currentContext: RouteContext | null
  ): void {
    selectedRouteIdRef.current = nextBadgeView.selectedRouteId;
    setBadgeView(nextBadgeView);
    if (nextBadgeView.payload) {
      if (nextBadgeView.payload.routes.length === 0) {
        setError(noMatchedRoutesError());
        setView("error");
      } else {
        setError(null);
        setView("results");
      }
      return;
    }
    if (!canAnalyze(currentContext)) {
      setView("empty");
      return;
    }
    if (nextBadgeView.state === "error") {
      setError({
        code: "ANALYSIS_FAILED",
        message: "MoodMaps could not analyze this route. Try again in a moment.",
        retryable: true
      });
      setView("error");
      return;
    }
    setView("loading");
  }

  async function applyContext(
    nextContext: RouteContext | null,
    preferMapState = true
  ): Promise<void> {
    const requestId = ++requestRef.current;
    contextRef.current = nextContext;
    setContext(nextContext);
    setError(null);
    if (!languagePreferenceRef.current) {
      setLanguage(defaultUiLanguage(nextContext?.provider ?? "unknown"));
    }

    if (!isExtensionRuntime()) {
      selectedRouteIdRef.current = null;
      setBadgeView({ payload: null, state: "idle", selectedRouteId: null });
      setView("empty");
      return;
    }

    if (!canAnalyze(nextContext)) {
      selectedRouteIdRef.current = null;
      setBadgeView({ payload: null, state: "idle", selectedRouteId: null });
      setView("empty");
      return;
    }

    setView("loading");
    setBadgeView((current) => ({ ...current, state: "loading" }));

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (preferMapState && tabId !== undefined) {
        const mapState = (await chrome.tabs
          .sendMessage(tabId, {
            type: "GET_ROUTE_BADGE_STATE"
          } satisfies ExtensionMessage)
          .catch(() => null)) as RouteBadgeViewState | null;
        if (
          mapState?.payload &&
          mapState.payload.contextSignature === signatureFromContext(nextContext)
        ) {
          if (requestId !== requestRef.current) return;
          showBadgeView(mapState, nextContext);
          return;
        }
        if (mapState?.state === "loading") {
          if (requestId !== requestRef.current) return;
          setBadgeView(mapState);
          setView("loading");
          return;
        }
      }

      const result = (await chrome.runtime.sendMessage({
        type: "ANALYZE_ROUTE_BADGES",
        payload: nextContext
      } satisfies ExtensionMessage)) as
        | { ok: true; value: NonNullable<RouteBadgeViewState["payload"]> }
        | { ok: false; error: AppError };
      if (requestId !== requestRef.current) return;
      if (!result.ok) throw result.error;
      const nextBadgeView: RouteBadgeViewState = {
        payload: result.value,
        state: "idle",
        selectedRouteId: chooseSelectedRouteId(
          result.value.routes,
          selectedRouteIdRef.current
        )
      };
      showBadgeView(nextBadgeView, nextContext);
      if (tabId !== undefined) {
        await chrome.tabs
          .sendMessage(tabId, {
            type: "UPDATE_ROUTE_BADGES",
            payload: result.value
          } satisfies ExtensionMessage)
          .catch(() => undefined);
      }
    } catch (caught) {
      if (requestId !== requestRef.current) return;
      setError(normalizeError(caught));
      setView("error");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      if (!isExtensionRuntime()) {
        await applyContext(null);
        return;
      }
      const [detected, stored] = await Promise.all([
        chrome.runtime.sendMessage({
          type: "GET_CURRENT_ROUTE_CONTEXT"
        } satisfies ExtensionMessage) as Promise<RouteContext | null>,
        chrome.storage.local.get(UI_LANGUAGE_STORAGE_KEY)
      ]);
      if (!mounted) return;
      const savedLanguage = stored[UI_LANGUAGE_STORAGE_KEY];
      languagePreferenceRef.current = isUiLanguage(savedLanguage);
      setLanguage(
        isUiLanguage(savedLanguage)
          ? savedLanguage
          : defaultUiLanguage(detected?.provider ?? "unknown")
      );
      await applyContext(detected);
    }

    function onMessage(
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender
    ) {
      if (
        message.type !== "ROUTE_CONTEXT_UPDATED" &&
        message.type !== "ROUTE_BADGE_STATE_UPDATED"
      ) {
        return;
      }
      void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (
          !mounted ||
          sender.tab?.id === undefined ||
          tabs[0]?.id !== sender.tab.id
        ) {
          return;
        }
        if (message.type === "ROUTE_CONTEXT_UPDATED") {
          void applyContext(message.payload);
          return;
        }
        const currentContext = contextRef.current;
        if (
          message.payload.payload &&
          currentContext &&
          message.payload.payload.contextSignature !==
            signatureFromContext(currentContext)
        ) {
          return;
        }
        showBadgeView(message.payload, currentContext);
      }).catch(() => undefined);
    }

    if (isExtensionRuntime()) chrome.runtime.onMessage.addListener(onMessage);
    void initialize().catch((caught) => {
      if (!mounted) return;
      setError(normalizeError(caught));
      setView("error");
    });
    return () => {
      mounted = false;
      requestRef.current += 1;
      if (isExtensionRuntime()) chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  function toggleLanguage(): void {
    const nextLanguage: UiLanguage =
      language === "zh-CN" ? "en" : "zh-CN";
    languagePreferenceRef.current = true;
    setLanguage(nextLanguage);
    if (isExtensionRuntime()) {
      void chrome.storage.local.set({
        [UI_LANGUAGE_STORAGE_KEY]: nextLanguage
      });
    }
  }

  return (
    <main className="app-shell" lang={chinese ? "zh-CN" : "en"}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <p>MoodMaps</p>
            <span>{view === "detecting" ? "" : copy.brandTagline}</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="language-toggle"
            onClick={toggleLanguage}
            aria-label={chinese ? "切换到英文" : "Switch to Chinese"}
            title={chinese ? "切换到英文" : "Switch to Chinese"}
          >
            <span className={chinese ? "active" : ""}>中</span>
            <i aria-hidden="true">/</i>
            <span className={chinese ? "" : "active"}>EN</span>
          </button>
          <span className="version">1.2.1</span>
        </div>
      </header>

      {view === "detecting" && <DetectingScore />}

      {view === "loading" && (
        <LoadingScore provider={provider} language={language} />
      )}

      {view === "results" && selectedRoute && (
        <SelectedRouteScore
          route={selectedRoute}
          provider={provider}
          language={language}
        />
      )}

      {view === "empty" && (
        <section className="empty-state">
          <p className="eyebrow">{copy.emptyEyebrow}</p>
          <h1>{copy.emptyTitle}</h1>
          <p>{copy.emptyBody}</p>
        </section>
      )}

      {view === "error" && (
        <section className="empty-state error-state" role="alert">
          <p className="eyebrow">{copy.errorEyebrow}</p>
          <h1>{copy.errorTitle}</h1>
          <p>
            {error?.code === "NO_MATCHED_ROUTES"
              ? copy.noMatchedRoutes
              : chinese
                ? copy.errorFallback
                : error?.message ?? copy.errorFallback}
          </p>
          {error?.retryable !== false && (
            <button type="button" onClick={() => void applyContext(context, false)}>
              {copy.retry}
            </button>
          )}
        </section>
      )}

      {view === "results" && (
        <OtherRoutes
          routes={otherRoutes}
          provider={provider}
          language={language}
        />
      )}

      {view !== "detecting" && (
        <HowMoodScoreWorks provider={provider} language={language} />
      )}

      {view !== "detecting" && (
        <footer>
          <p>{copy.disclaimer}</p>
          <p>
            {copy.weatherBy}{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo.com
            </a>
            {chinese ? " 提供。" : "."}
          </p>
          <p>{copy.independence}</p>
        </footer>
      )}
    </main>
  );
}
