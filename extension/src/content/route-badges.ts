import { detectMapProvider } from "../shared/map-provider";
import {
  defaultUiLanguage,
  localizedComponentLabel,
  localizedMoodLabel,
  type UiLanguage,
  usesChineseUi
} from "../shared/provider-language";
import type {
  MapProvider,
  MoodScoreComponentExplanation,
  MoodScoreComponentKey,
  RouteBadgeItem,
  RouteBadgePayload
} from "../shared/types";

const DISTANCE_PATTERN =
  /(\d[\d.,\u00a0\u202f ]*)\s*(miles?|mi|kilometers?|kilometres?|km|meters?|metres?|m|公里|千米|英里|米)(?![a-z])/i;

function parseLocalizedNumber(value: string): number | null {
  const compact = value.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;
  const separators = [...compact.matchAll(/[.,]/g)];
  if (separators.length === 0) {
    const parsed = Number(compact);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const lastSeparator = separators.at(-1);
  if (!lastSeparator || lastSeparator.index === undefined) return null;
  const decimalDigits = compact.length - lastSeparator.index - 1;
  const separator = lastSeparator[0];
  const sameSeparators = separators.every((match) => match[0] === separator);
  const groupedThousands =
    sameSeparators &&
    decimalDigits === 3 &&
    compact
      .split(separator)
      .slice(1)
      .every((group) => group.length === 3);
  const normalized = groupedThousands
    ? compact.replace(/[.,]/g, "")
    : compact
        .slice(0, lastSeparator.index)
        .replace(/[.,]/g, "") +
      "." +
      compact.slice(lastSeparator.index + 1);
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDistanceMeters(value: string): number | null {
  const match = DISTANCE_PATTERN.exec(normalizedText(value));
  if (!match) return null;
  const amount = parseLocalizedNumber(match[1]);
  if (amount === null || amount < 0) return null;
  const unit = match[2];
  if (/^(?:mi|mile|miles|英里)$/i.test(unit)) {
    return Math.round(amount * 1609.344);
  }
  if (/^(?:m|meter|meters|metre|metres|米)$/i.test(unit)) {
    return Math.round(amount);
  }
  return Math.round(amount * 1000);
}

export interface DetectedRouteCard {
  provider: MapProvider;
  element: HTMLElement;
  text: string;
  routeDescription: string | null;
  durationMinutes: number;
  durationElement: HTMLElement;
  distanceElement: HTMLElement | null;
}

const ROUTE_DESCRIPTION_PATTERN = /^(?:via\b|经由|經由|途经|途經)/i;

function findRouteDescription(card: HTMLElement): string | null {
  const candidates = Array.from(
    card.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, [role="heading"], span, div'
    )
  )
    .filter((element) => !isMoodMapsUi(element))
    .map((element) => normalizedText(element.textContent ?? ""))
    .filter((text) => text.length > 0 && text.length <= 160)
    .sort((first, second) => first.length - second.length);
  return candidates.find((text) => ROUTE_DESCRIPTION_PATTERN.test(text)) ?? null;
}

export interface RouteBadgeAssignment {
  cardIndex: number;
  badge: RouteBadgeItem;
  confidence: number;
}

export type BadgeRenderState = "idle" | "loading" | "error";

function isSelectedRouteCard(element: HTMLElement): boolean {
  const selector =
    '[aria-selected="true"], [aria-current]:not([aria-current="false"])';
  return (
    element.classList.contains("selected") ||
    element.classList.contains("is-active") ||
    element.classList.contains("current") ||
    element.matches(selector) ||
    element.querySelector(selector) !== null
  );
}

function normalizedText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isMoodMapsUi(element: Element): boolean {
  return Boolean(
    element.closest(".moodmaps-route-badge, .moodmaps-score-explainer")
  );
}

export function parseDurationMinutes(value: string): number | null {
  const text = normalizedText(value).replace(
    /^(?:about|approx(?:imately)?\.?|大约|大約|预计|預計|约|約)\s*/i,
    ""
  );
  const english =
    /^(?:(\d+)\s*(?:day|days|d))?(?:\s*(\d+)\s*(?:hr|hrs|hour|hours|h))?(?:\s*(\d+)\s*(?:min|mins|minute|minutes|m))?$/i.exec(
      text
    );
  if (english && (english[1] || english[2] || english[3])) {
    const duration =
      Number(english[1] ?? 0) * 1440 +
      Number(english[2] ?? 0) * 60 +
      Number(english[3] ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  const chinese =
    /^(?:(\d+)\s*(?:天|日))?(?:\s*(\d+)\s*(?:小时|小時))?(?:\s*(\d+)\s*(?:分钟|分鐘|分))?$/.exec(text);
  if (chinese && (chinese[1] || chinese[2] || chinese[3])) {
    const duration =
      Number(chinese[1] ?? 0) * 1440 +
      Number(chinese[2] ?? 0) * 60 +
      Number(chinese[3] ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }
  return null;
}

export function parseWithoutTrafficMinutes(value: string): number | null {
  const text = normalizedText(value);
  const english = /((?:\d+\s*(?:day|days|d)\s*)?(?:\d+\s*(?:hr|hrs|hour|hours|h)\s*)?(?:\d+\s*(?:min|mins|minute|minutes|m))?)\s+without traffic/i.exec(
    text
  );
  if (english?.[1]) return parseDurationMinutes(english[1]);
  const chinese = /(?:不堵车|不堵車|无交通拥堵|無交通擁堵)[^\d]{0,12}((?:\d+\s*(?:天|日)\s*)?(?:\d+\s*(?:小时|小時)\s*)?(?:\d+\s*(?:分钟|分鐘|分))?)/.exec(
    text
  );
  return chinese?.[1] ? parseDurationMinutes(chinese[1]) : null;
}

export function trafficSignalFromText(
  value: string
): "heavy" | "slow" | "light" | "unknown" {
  const text = normalizedText(value)
    .toLocaleLowerCase()
    .replace(/\bcongestion charges?\b/g, "");
  if (/heavy traffic|traffic jam|severe traffic|congestion|严重拥堵|嚴重擁堵|堵车|堵車/.test(text)) {
    return "heavy";
  }
  if (/slowdown|slow traffic|交通缓慢|交通緩慢|拥堵|擁堵/.test(text)) {
    return "slow";
  }
  if (/light traffic|usual traffic|traffic is light|交通顺畅|交通順暢/.test(text)) {
    return "light";
  }
  return "unknown";
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style =
    element.ownerDocument.defaultView?.getComputedStyle(element) ??
    window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function findDistanceElement(card: HTMLElement): HTMLElement | null {
  const candidates = Array.from(
    card.querySelectorAll<HTMLElement>("span, div")
  );
  return (
    candidates
      .filter((element) => {
      if (isMoodMapsUi(element)) return false;
      const text = normalizedText(element.textContent ?? "");
      return text.length <= 40 && DISTANCE_PATTERN.test(text);
      })
      .sort(
        (first, second) =>
          normalizedText(first.textContent ?? "").length -
          normalizedText(second.textContent ?? "").length
      )[0] ?? null
  );
}

function findCardAncestor(
  durationElement: HTMLElement,
  root: Element
): HTMLElement | null {
  let candidate = durationElement.parentElement;
  let depth = 0;
  while (candidate && candidate !== root && depth < 9) {
    const rect = candidate.getBoundingClientRect();
    const text = normalizedText(candidate.textContent ?? "");
    if (
      rect.width >= 220 &&
      rect.height >= 72 &&
      rect.height <= 360 &&
      text.length <= 1200 &&
      findDistanceElement(candidate) !== null
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
    depth += 1;
  }
  return null;
}

function findGenericRouteCards(
  doc: Document,
  provider: MapProvider
): DetectedRouteCard[] {
  const root = doc.querySelector('[role="main"]') ?? doc.body;
  if (!root) return [];

  const durationElements = Array.from(
    root.querySelectorAll<HTMLElement>("span, div")
  ).filter((element) => {
    if (isMoodMapsUi(element)) return false;
    const text = normalizedText(element.textContent ?? "");
    return text.length <= 32 && parseDurationMinutes(text) !== null && isVisible(element);
  });

  const cards = new Map<HTMLElement, DetectedRouteCard>();
  for (const durationElement of durationElements) {
    const card = findCardAncestor(durationElement, root);
    if (!card || cards.has(card) || !isVisible(card)) continue;
    const durationMinutes = parseDurationMinutes(durationElement.textContent ?? "");
    if (durationMinutes === null) continue;
    cards.set(card, {
      provider,
      element: card,
      text: normalizedText(card.textContent ?? ""),
      routeDescription: findRouteDescription(card),
      durationMinutes,
      durationElement,
      distanceElement: findDistanceElement(card)
    });
  }

  return [...cards.values()].sort(
    (first, second) =>
      first.element.getBoundingClientRect().top -
      second.element.getBoundingClientRect().top
  );
}

function siteRouteCard(
  provider: MapProvider,
  element: HTMLElement,
  durationElement: HTMLElement | null,
  distanceElement: HTMLElement | null,
  routeDescription: string | null
): DetectedRouteCard | null {
  if (!durationElement || !isVisible(element) || !isVisible(durationElement)) {
    return null;
  }
  const durationMinutes = parseDurationMinutes(
    durationElement.textContent ?? ""
  );
  if (durationMinutes === null) return null;
  return {
    provider,
    element,
    text: normalizedText(element.textContent ?? ""),
    routeDescription,
    durationMinutes,
    durationElement,
    distanceElement
  };
}

function findAppleRouteCards(doc: Document): DetectedRouteCard[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      "ul.mw-route-planning > li.sc-platter-container"
    )
  ).flatMap((element, index) => {
    const nativeLabel = normalizedText(
      element.querySelector<HTMLElement>(
        ".mw-route-planning-info-label-detail-text"
      )?.textContent ?? ""
    );
    const description = nativeLabel
      ? nativeLabel + " Apple route"
      : "Apple route " + (index + 1);
    const card = siteRouteCard(
      "apple",
      element,
      element.querySelector<HTMLElement>(".mw-route-planning-info-eta"),
      element.querySelector<HTMLElement>(".mw-route-planning-info-distance"),
      description
    );
    return card ? [card] : [];
  });
}

function findWazeRouteCards(doc: Document): DetectedRouteCard[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      "ul.wm-routes__list > li.wm-routes-item-desktop"
    )
  ).flatMap((element, index) => {
    const durationElement =
      element.querySelector<HTMLElement>(
        ".wm-routes-item-desktop__header span[title]"
      ) ??
      Array.from(
        element.querySelectorAll<HTMLElement>(
          ".wm-routes-item-desktop__header span"
        )
      ).find(
        (candidate) =>
          parseDurationMinutes(candidate.textContent ?? "") !== null
      ) ??
      null;
    const routeName = normalizedText(
      element.querySelector<HTMLElement>(
        ".wm-routes-item-desktop__details span[dir='auto']"
      )?.textContent ?? ""
    );
    const description = routeName
      ? ROUTE_DESCRIPTION_PATTERN.test(routeName)
        ? routeName
        : "via " + routeName
      : "Waze route " + (index + 1);
    const card = siteRouteCard(
      "waze",
      element,
      durationElement,
      element.querySelector<HTMLElement>(
        ".wm-routes-item-desktop__footer"
      ),
      description
    );
    return card ? [card] : [];
  });
}

function findAmapRouteCards(doc: Document): DetectedRouteCard[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(".planTitle.dirtag")
  ).flatMap((element, index) => {
    const metrics = Array.from(
      element.querySelectorAll<HTMLElement>(".dir_base_info .dir_base")
    );
    const durationElement =
      metrics.find(
        (candidate) =>
          parseDurationMinutes(candidate.textContent ?? "") !== null
      ) ?? null;
    const distanceElement =
      metrics.find((candidate) =>
        DISTANCE_PATTERN.test(normalizedText(candidate.textContent ?? ""))
      ) ?? null;
    const passBy = element.querySelector<HTMLElement>(".dir_passby");
    const routeName = normalizedText(passBy?.textContent ?? "");
    const description = routeName || "高德路线 " + (index + 1);
    const card = siteRouteCard(
      "amap",
      element,
      durationElement,
      distanceElement,
      description
    );
    return card ? [card] : [];
  });
}

export function findRouteCards(
  doc: Document = document,
  pageUrl = doc.location?.href ?? ""
): DetectedRouteCard[] {
  const provider = detectMapProvider(pageUrl);
  const siteCards =
    provider === "apple"
      ? findAppleRouteCards(doc)
      : provider === "waze"
        ? findWazeRouteCards(doc)
        : provider === "amap"
          ? findAmapRouteCards(doc)
          : [];
  return siteCards.length > 0
    ? siteCards
    : findGenericRouteCards(doc, provider);
}

function descriptionTokens(value: string): Set<string> {
  const stopWords = new Set([
    "and",
    "route",
    "road",
    "roads",
    "the",
    "via",
    "with",
    "fastest",
    "balanced",
    "calmer"
  ]);
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 2 && !stopWords.has(token))
  );
}

export function descriptionOverlap(
  cardText: string,
  routeDescription: string
): number {
  const cardTokens = descriptionTokens(cardText);
  const routeTokens = descriptionTokens(routeDescription);
  if (routeTokens.size === 0) return 0;
  let matches = 0;
  for (const token of routeTokens) {
    if (cardTokens.has(token)) matches += 1;
  }
  return matches / routeTokens.size;
}

function durationConfidence(difference: number): number {
  if (difference <= 1) return 0.82;
  if (difference <= 2) return 0.75;
  if (difference <= 5) return 0.6;
  if (difference <= 8) return 0.32;
  return 0;
}

export function matchRouteBadges(
  cards: Array<
    Pick<DetectedRouteCard, "text" | "durationMinutes"> &
      Partial<Pick<DetectedRouteCard, "routeDescription">>
  >,
  payload: RouteBadgePayload
): RouteBadgeAssignment[] {
  const candidates: RouteBadgeAssignment[] = [];
  cards.forEach((card, cardIndex) => {
    payload.routes.forEach((badge) => {
      const difference = Math.abs(card.durationMinutes - badge.durationMinutes);
      const duration = durationConfidence(difference);
      const description = descriptionOverlap(
        card.text + " " + (card.routeDescription ?? ""),
        badge.description
      );
      const confidence = Math.min(1, duration + description * 0.35);
      if (confidence >= 0.6) {
        candidates.push({ cardIndex, badge, confidence });
      }
    });
  });
  candidates.sort((first, second) => second.confidence - first.confidence);

  const assignments: RouteBadgeAssignment[] = [];
  const usedCards = new Set<number>();
  const usedRoutes = new Set<string>();
  for (const candidate of candidates) {
    if (
      usedCards.has(candidate.cardIndex) ||
      usedRoutes.has(candidate.badge.routeId)
    ) {
      continue;
    }
    usedCards.add(candidate.cardIndex);
    usedRoutes.add(candidate.badge.routeId);
    assignments.push(candidate);
  }
  return assignments;
}

const NATIVE_ACTION_LABELS = new Set([
  "details",
  "preview",
  "详情",
  "详细信息",
  "預覽",
  "预览"
]);

function findNativeActionRow(card: HTMLElement): HTMLElement | null {
  const controls = Array.from(
    card.querySelectorAll<HTMLElement>('button, a, [role="button"]')
  ).filter((control) => {
    if (isMoodMapsUi(control)) return false;
    const text = normalizedText(
      control.textContent || control.getAttribute("aria-label") || ""
    ).toLocaleLowerCase();
    return NATIVE_ACTION_LABELS.has(text);
  });
  if (controls.length === 0) return null;

  let row: HTMLElement | null = controls[0].parentElement;
  if (controls.length > 1) {
    while (
      row &&
      row !== card &&
      !controls.every((control) => row?.contains(control))
    ) {
      row = row.parentElement;
    }
  }
  return row && row !== card ? row : controls[0].parentElement;
}

function findMetricsColumn(card: DetectedRouteCard): HTMLElement | null {
  if (!card.distanceElement) return null;
  let ancestor = card.durationElement.parentElement;
  while (ancestor && ancestor !== card.element) {
    if (ancestor.contains(card.distanceElement)) {
      const columnRect = ancestor.getBoundingClientRect();
      const cardRect = card.element.getBoundingClientRect();
      if (
        columnRect.width > 0 &&
        cardRect.width > 0 &&
        columnRect.width > cardRect.width * 0.55
      ) {
        return null;
      }
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function badgePlacement(card: DetectedRouteCard): {
  parent: HTMLElement;
  before: HTMLElement | null;
} {
  if (card.provider === "apple") {
    const details = card.element.querySelector<HTMLElement>(
      ".mw-route-planning-info-route-detail"
    );
    if (details) return { parent: details, before: null };
  }
  if (card.provider === "waze") {
    const details = card.element.querySelector<HTMLElement>(
      ".wm-routes-item-desktop__details"
    );
    if (details) return { parent: details, before: null };
  }
  if (card.provider === "amap") {
    const sidebar = card.element.querySelector<HTMLElement>(".sidebar");
    return { parent: card.element, before: sidebar };
  }

  const metricsColumn = findMetricsColumn(card);
  if (metricsColumn) {
    return { parent: metricsColumn, before: null };
  }

  const actionRow = findNativeActionRow(card.element);
  if (actionRow?.parentElement) {
    return { parent: actionRow.parentElement, before: actionRow };
  }
  return { parent: card.element, before: null };
}

interface OpenScoreExplainer {
  routeId: string;
  generatedAt: string;
  language: UiLanguage;
  close: () => void;
}

const openScoreExplainers = new WeakMap<Document, OpenScoreExplainer>();

export function closeScoreExplainer(doc: Document = document): void {
  openScoreExplainers.get(doc)?.close();
}

function formatBasisPoints(value: number): string {
  return (value / 100).toFixed(2).replace(/\.?0+$/, "") + "%";
}

export function componentPercentageLabels(
  components: MoodScoreComponentExplanation[]
): Record<MoodScoreComponentKey, string> {
  const labels = Object.fromEntries(
    components.map((component) => [component.key, "0%"])
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
  let undistributed =
    targetBasisPoints -
    available.reduce((total, component) => total + component.basisPoints, 0);
  const byRemainder = [...available].sort(
    (first, second) => second.remainder - first.remainder
  );
  for (let index = 0; undistributed > 0; index += 1, undistributed -= 1) {
    byRemainder[index % byRemainder.length].basisPoints += 1;
  }
  for (const component of available) {
    labels[component.key] = formatBasisPoints(component.basisPoints);
  }
  return labels;
}

interface RouteBadgeCopy {
  navigatorLabel: string;
  explainerTitle: string;
  closeExplanation: string;
  componentAria: string;
  unavailable: string;
  notUsed: string;
  scoreEyebrow: string;
  scoreTitle: string;
  checking: string;
  retry: string;
  productName: string;
  routeCalmness: string;
  analysisFailed: string;
  analyzeCalmness: string;
}

function routeBadgeCopy(language: UiLanguage): RouteBadgeCopy {
  if (usesChineseUi(language)) {
    return {
      navigatorLabel: "情绪导航",
      explainerTitle: "这个分数是如何计算的",
      closeExplanation: "关闭分数说明",
      componentAria: "路线加权压力因素",
      unavailable: "暂无数据",
      notUsed: "未计入",
      scoreEyebrow: "心情分数",
      scoreTitle: "查看这个心情分数的计算方式",
      checking: "分析中…",
      retry: "重新分析",
      productName: "MoodMaps",
      routeCalmness: "路线舒适度",
      analysisFailed: "分析失败",
      analyzeCalmness: "分析舒适度"
    };
  }
  return {
    navigatorLabel: "MOOD NAVIGATOR",
    explainerTitle: "How this score was calculated",
    closeExplanation: "Close score explanation",
    componentAria: "Weighted route stress inputs",
    unavailable: "Not available",
    notUsed: "Not used",
    scoreEyebrow: "MOOD SCORE",
    scoreTitle: "See how this Mood Score was calculated",
    checking: "Checking…",
    retry: "Try again",
    productName: "MoodMaps",
    routeCalmness: "Route calmness",
    analysisFailed: "Analysis failed",
    analyzeCalmness: "Analyze calmness"
  };
}

function positionExplainer(
  doc: Document,
  panel: HTMLElement,
  anchor: HTMLElement
): void {
  const viewport = doc.defaultView ?? window;
  const edge = 12;
  const gap = 8;
  const width = Math.min(420, Math.max(280, viewport.innerWidth - edge * 2));
  panel.style.width = width + "px";
  const anchorRect = anchor.getBoundingClientRect();
  const panelHeight = panel.getBoundingClientRect().height || 250;
  const left = Math.min(
    Math.max(edge, anchorRect.right - width),
    viewport.innerWidth - width - edge
  );
  const below = anchorRect.bottom + gap;
  const top =
    below + panelHeight <= viewport.innerHeight - edge
      ? below
      : Math.max(edge, anchorRect.top - panelHeight - gap);
  panel.style.left = Math.max(edge, left) + "px";
  panel.style.top = top + "px";
}

function openScoreExplainer(
  doc: Document,
  anchor: HTMLButtonElement,
  item: RouteBadgeItem,
  generatedAt: string,
  language: UiLanguage
): void {
  closeScoreExplainer(doc);
  const copy = routeBadgeCopy(language);
  const chinese = usesChineseUi(language);

  const panel = doc.createElement("aside");
  panel.className = "moodmaps-score-explainer";
  panel.dataset.moodmapsRouteId = item.routeId;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "moodmaps-score-explainer-title");
  panel.lang = chinese ? "zh-CN" : "en";
  panel.tabIndex = -1;

  const header = doc.createElement("header");
  header.className = "moodmaps-score-explainer__header";
  const heading = doc.createElement("div");
  const eyebrow = doc.createElement("span");
  eyebrow.className = "moodmaps-score-explainer__eyebrow";
  eyebrow.textContent = copy.navigatorLabel;
  const title = doc.createElement("strong");
  title.id = "moodmaps-score-explainer-title";
  title.textContent = copy.explainerTitle;
  const route = doc.createElement("small");
  route.textContent = item.description;
  heading.append(eyebrow, title, route);

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "moodmaps-score-explainer__close";
  closeButton.setAttribute("aria-label", copy.closeExplanation);
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const summary = doc.createElement("div");
  summary.className = "moodmaps-score-explainer__summary";
  const result = doc.createElement("div");
  result.className = "moodmaps-score-explainer__result";
  const score = doc.createElement("strong");
  score.textContent = String(item.score);
  const scoreLabel = doc.createElement("span");
  scoreLabel.textContent = localizedMoodLabel(item.label, language);
  result.append(score, scoreLabel);

  const formulas = doc.createElement("div");
  formulas.className = "moodmaps-score-explainer__formula";
  const routeFormula = doc.createElement("p");
  routeFormula.textContent = chinese
    ? "100 − " +
      item.explanation.routeStress +
      " 加权压力 = " +
      item.explanation.routeCalmness +
      " 路线平静度"
    : "100 − " +
      item.explanation.routeStress +
      " weighted stress = " +
      item.explanation.routeCalmness +
      " route calmness";
  formulas.append(routeFormula);
  summary.append(result, formulas);

  const componentList = doc.createElement("div");
  componentList.className = "moodmaps-score-explainer__components";
  componentList.setAttribute("aria-label", copy.componentAria);
  const componentWeights = componentPercentageLabels(
    item.explanation.components
  );
  for (const component of item.explanation.components) {
    const componentItem = doc.createElement("div");
    componentItem.className = "moodmaps-score-explainer__component";
    const componentLabel = doc.createElement("strong");
    componentLabel.textContent = localizedComponentLabel(
      component.key,
      component.label,
      language
    );
    const value = doc.createElement("span");
    const detail = doc.createElement("small");
    if (component.stress === null || component.contribution === null) {
      value.textContent = copy.unavailable;
      detail.textContent = copy.notUsed;
    } else {
      value.textContent =
        Math.round(component.stress) + " × " + componentWeights[component.key];
      detail.textContent =
        component.contribution.toFixed(1) +
        (chinese ? " 压力分" : " stress pts");
    }
    componentItem.append(componentLabel, value, detail);
    componentList.append(componentItem);
  }

  panel.append(header, summary, componentList);
  doc.body.append(panel);
  positionExplainer(doc, panel, anchor);

  const viewport = doc.defaultView ?? window;
  const onOutsidePointerDown = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && !panel.contains(target) && target !== anchor) {
      closeScoreExplainer(doc);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeScoreExplainer(doc);
      anchor.focus({ preventScroll: true });
    }
  };
  const onViewportChange = () => closeScoreExplainer(doc);
  const close = () => {
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", onOutsidePointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("scroll", onViewportChange, true);
    viewport.removeEventListener("resize", onViewportChange);
    openScoreExplainers.delete(doc);
  };
  openScoreExplainers.set(doc, {
    routeId: item.routeId,
    generatedAt,
    language,
    close
  });
  anchor.setAttribute("aria-expanded", "true");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
    anchor.focus({ preventScroll: true });
  });
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  doc.addEventListener("pointerdown", onOutsidePointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", onViewportChange, true);
  viewport.addEventListener("resize", onViewportChange);
  panel.focus({ preventScroll: true });
}

function createScoreBadge(
  doc: Document,
  item: RouteBadgeItem,
  generatedAt: string,
  language: UiLanguage
): HTMLElement {
  const copy = routeBadgeCopy(language);
  const chinese = usesChineseUi(language);
  const moodLabel = localizedMoodLabel(item.label, language);
  const badge = doc.createElement("button");
  badge.type = "button";
  badge.className = "moodmaps-route-badge moodmaps-route-badge--score";
  badge.dataset.moodmapsKey =
    "score:" +
    item.routeId +
    ":" +
    item.score +
    ":" +
    generatedAt +
    ":" +
    language;
  badge.setAttribute(
    "aria-label",
    chinese
      ? "心情分数 " +
          item.score +
          "/100，" +
          moodLabel +
          "。点击查看计算方式。"
      : "Mood Score " +
          item.score +
          " out of 100, " +
          moodLabel +
          ". Click to see how it was calculated."
  );
  badge.setAttribute("aria-haspopup", "dialog");
  badge.setAttribute("aria-expanded", "false");
  badge.title = copy.scoreTitle;
  badge.lang = chinese ? "zh-CN" : "en";

  const eyebrow = doc.createElement("span");
  eyebrow.className = "moodmaps-route-badge__eyebrow";
  eyebrow.textContent = copy.scoreEyebrow;

  const scoreRow = doc.createElement("span");
  scoreRow.className = "moodmaps-route-badge__score-row";
  const score = doc.createElement("strong");
  score.textContent = String(item.score);
  const label = doc.createElement("span");
  label.textContent = moodLabel;
  scoreRow.append(score, label);

  badge.append(eyebrow, scoreRow);
  badge.addEventListener("pointerdown", (event) => event.stopPropagation());
  badge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = openScoreExplainers.get(doc);
    if (open?.routeId === item.routeId && open.generatedAt === generatedAt) {
      closeScoreExplainer(doc);
      return;
    }
    openScoreExplainer(doc, badge, item, generatedAt, language);
  });
  return badge;
}

function createActionBadge(
  doc: Document,
  state: BadgeRenderState,
  language: UiLanguage,
  onAnalyze: () => void
): HTMLElement {
  const copy = routeBadgeCopy(language);
  const chinese = usesChineseUi(language);
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "moodmaps-route-badge moodmaps-route-badge--action";
  if (state === "loading") {
    button.classList.add("moodmaps-route-badge--loading");
  }
  button.dataset.moodmapsKey = "action:" + state + ":" + language;
  button.setAttribute(
    "aria-label",
    chinese
      ? state === "loading"
        ? "MoodMaps 正在分析路线"
        : state === "error"
          ? "重新进行 MoodMaps 路线分析"
          : "使用 MoodMaps 分析这次行程"
      : state === "loading"
        ? "MoodMaps is analyzing routes"
        : state === "error"
          ? "Retry MoodMaps route analysis"
          : "Analyze this trip with MoodMaps"
  );
  button.lang = chinese ? "zh-CN" : "en";
  button.disabled = state === "loading";

  const mark = doc.createElement("span");
  mark.className = "moodmaps-route-badge__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = state === "loading" ? "…" : state === "error" ? "!" : "M";

  const actionCopy = doc.createElement("span");
  actionCopy.className = "moodmaps-route-badge__action-copy";
  const title = doc.createElement("strong");
  title.textContent =
    state === "loading"
      ? copy.checking
      : state === "error"
        ? copy.retry
        : copy.productName;
  const subtitle = doc.createElement("small");
  subtitle.textContent =
    state === "loading"
      ? copy.routeCalmness
      : state === "error"
        ? copy.analysisFailed
        : copy.analyzeCalmness;
  actionCopy.append(title, subtitle);
  button.append(mark, actionCopy);

  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onAnalyze();
  });
  return button;
}

function existingBadge(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>(".moodmaps-route-badge");
}

function existingSlot(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>(".moodmaps-route-badge-slot");
}

function placeSlot(card: DetectedRouteCard, slot: HTMLElement): void {
  const placement = badgePlacement(card);
  const alreadyPlaced = placement.before
    ? slot.parentElement === placement.parent &&
      slot.nextSibling === placement.before
    : slot.parentElement === placement.parent &&
      slot === placement.parent.lastElementChild;
  if (alreadyPlaced) return;
  placement.parent.insertBefore(slot, placement.before);
}

function syncBadge(card: DetectedRouteCard, next: HTMLElement | null): void {
  const slot = existingSlot(card.element);
  const existing = existingBadge(card.element);
  if (!next) {
    slot?.remove();
    return;
  }
  const stableSlot = slot ?? card.element.ownerDocument.createElement("div");
  if (!slot) {
    stableSlot.className = "moodmaps-route-badge-slot";
    stableSlot.setAttribute("aria-live", "polite");
  }
  stableSlot.classList.toggle(
    "moodmaps-route-badge-slot--apple",
    card.provider === "apple"
  );
  stableSlot.classList.toggle(
    "moodmaps-route-badge-slot--waze",
    card.provider === "waze"
  );
  stableSlot.classList.toggle(
    "moodmaps-route-badge-slot--amap",
    card.provider === "amap"
  );
  placeSlot(card, stableSlot);
  if (existing && existing.dataset.moodmapsKey === next.dataset.moodmapsKey) {
    if (existing.parentElement !== stableSlot) {
      stableSlot.replaceChildren(existing);
    }
    return;
  }
  stableSlot.replaceChildren(next);
}

export function renderRouteBadges(options: {
  doc?: Document;
  pageUrl?: string;
  payload: RouteBadgePayload | null;
  state: BadgeRenderState;
  language?: UiLanguage;
  onAnalyze: () => void;
}): {
  detectedCards: number;
  assignedBadges: number;
  assignedRouteIds: string[];
  assignedRoutes: Array<{ routeId: string; description: string | null }>;
  selectedRouteId: string | null;
} {
  const doc = options.doc ?? document;
  const openExplainer = openScoreExplainers.get(doc);
  if (
    !options.payload ||
    (openExplainer &&
      (openExplainer.generatedAt !== options.payload.generatedAt ||
        (options.language !== undefined &&
          openExplainer.language !== options.language)))
  ) {
    closeScoreExplainer(doc);
  }
  const cards = findRouteCards(options.doc ?? document, options.pageUrl);
  const assignments = options.payload
    ? matchRouteBadges(cards, options.payload)
    : [];
  const assignmentsByCard = new Map(
    assignments.map((assignment) => [assignment.cardIndex, assignment])
  );
  const selectedAssignment =
    assignments.find((assignment) =>
      isSelectedRouteCard(cards[assignment.cardIndex].element)
    ) ?? [...assignments].sort((first, second) => first.cardIndex - second.cardIndex)[0];

  cards.forEach((card, index) => {
    const assignment = assignmentsByCard.get(index);
    const language = options.language ?? defaultUiLanguage(card.provider);
    if (assignment && options.payload) {
      const visibleBadge = card.routeDescription
        ? { ...assignment.badge, description: card.routeDescription }
        : assignment.badge;
      syncBadge(
        card,
        createScoreBadge(
          doc,
          visibleBadge,
          options.payload.generatedAt,
          language
        )
      );
    } else if (!options.payload) {
      syncBadge(
        card,
        createActionBadge(
          doc,
          options.state,
          language,
          options.onAnalyze
        )
      );
    } else {
      syncBadge(
        card,
        createActionBadge(
          doc,
          options.state,
          language,
          options.onAnalyze
        )
      );
    }
  });

  const activeCards = cards.map((card) => card.element);
  doc.querySelectorAll<HTMLElement>(".moodmaps-route-badge-slot").forEach((slot) => {
    if (!activeCards.some((card) => card.contains(slot))) {
      slot.remove();
    }
  });
  const remainingExplainer = openScoreExplainers.get(doc);
  if (
    remainingExplainer &&
    !assignments.some(
      (assignment) => assignment.badge.routeId === remainingExplainer.routeId
    )
  ) {
    closeScoreExplainer(doc);
  }

  return {
    detectedCards: cards.length,
    assignedBadges: assignments.length,
    assignedRouteIds: assignments.map((assignment) => assignment.badge.routeId),
    assignedRoutes: assignments.map((assignment) => ({
      routeId: assignment.badge.routeId,
      description: cards[assignment.cardIndex].routeDescription
    })),
    selectedRouteId: selectedAssignment?.badge.routeId ?? null
  };
}
