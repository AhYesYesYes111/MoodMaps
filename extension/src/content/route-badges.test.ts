// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MoodScoreExplanation,
  RouteBadgePayload
} from "../shared/types";
import {
  descriptionOverlap,
  componentPercentageLabels,
  findRouteCards,
  matchRouteBadges,
  parseDistanceMeters,
  parseDurationMinutes,
  parseWithoutTrafficMinutes,
  renderRouteBadges,
  trafficSignalFromText
} from "./route-badges";

function explanation(score: number): MoodScoreExplanation {
  const routeStress = 100 - score;
  return {
    routeStress,
    routeCalmness: score,
    finalScore: score,
    components: [
      {
        key: "traffic",
        label: "Traffic",
        stress: 20,
        effectiveWeight: 0.32,
        contribution: 6.4
      },
      {
        key: "delay",
        label: "Delay",
        stress: 30,
        effectiveWeight: 0.2,
        contribution: 6
      },
      {
        key: "maneuver",
        label: "Complexity",
        stress: 40,
        effectiveWeight: 0.2,
        contribution: 8
      },
      {
        key: "duration",
        label: "Duration",
        stress: 50,
        effectiveWeight: 0.12,
        contribution: 6
      },
      {
        key: "weather",
        label: "Weather",
        stress: 60,
        effectiveWeight: 0.16,
        contribution: 9.6
      }
    ]
  };
}

const livePayload: RouteBadgePayload = {
  contextSignature: "penn station|jfk",
  generatedAt: "2026-07-17T20:00:00Z",
  routes: [
    {
      routeId: "route_0",
      description: "I-495 E",
      durationMinutes: 60,
      score: 64,
      label: "Balanced",
      roles: ["Fastest"],
      explanation: explanation(64),
      reasons: [
        {
          type: "negative",
          message: "Heavy traffic adds stress.",
          messageZh: "拥堵路况增加了压力。"
        }
      ]
    },
    {
      routeId: "route_1",
      description: "I-495 E and Woodhaven Blvd",
      durationMinutes: 63,
      score: 78,
      label: "Calm",
      roles: ["Balanced", "Calmest"],
      explanation: explanation(78),
      reasons: [
        {
          type: "positive",
          message: "Fewer complex maneuvers support this score.",
          messageZh: "较少的复杂操作提升了这个分数。"
        }
      ]
    }
  ]
};

function rect(
  top: number,
  height: number,
  width: number,
  left = 0
): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

function installRouteCardFixture(): HTMLElement {
  document.body.innerHTML =
    '<main role="main">' +
    '<section id="route-card">' +
    '<h2 class="copy">via I-495 E</h2>' +
    '<div id="right-column">' +
    '<span id="duration">1 hr</span>' +
    '<span id="distance">14.4 miles</span>' +
    '</div>' +
    '<div>Fastest route now, avoids slowdown</div>' +
    '<div id="native-actions"><button type="button">Details</button><button type="button">Preview</button></div>' +
    '</section>' +
    '</main>';
  const card = document.getElementById("route-card") as HTMLElement;
  const column = document.getElementById("right-column") as HTMLElement;
  const duration = document.getElementById("duration") as HTMLElement;
  const distance = document.getElementById("distance") as HTMLElement;
  card.getBoundingClientRect = vi.fn(() => rect(100, 180, 540));
  column.getBoundingClientRect = vi.fn(() => rect(120, 50, 110, 410));
  duration.getBoundingClientRect = vi.fn(() => rect(120, 20, 55, 455));
  distance.getBoundingClientRect = vi.fn(() => rect(145, 18, 70, 440));
  return card;
}

function installTwoRouteCardFixture(): void {
  document.body.innerHTML =
    '<main role="main">' +
    '<section id="route-card-0">' +
    '<h2>via I-495 E</h2><div id="column-0"><span id="duration-0">1 hr</span><span id="distance-0">14.4 miles</span></div>' +
    "</section>" +
    '<section id="route-card-1" aria-selected="true">' +
    '<h2>via I-495 E and Woodhaven Blvd</h2><div id="column-1"><span id="duration-1">1 hr 3 min</span><span id="distance-1">14.8 miles</span></div>' +
    "</section>" +
    "</main>";

  for (const index of [0, 1]) {
    const top = 100 + index * 190;
    const card = document.getElementById("route-card-" + index) as HTMLElement;
    const column = document.getElementById("column-" + index) as HTMLElement;
    const duration = document.getElementById("duration-" + index) as HTMLElement;
    const distance = document.getElementById("distance-" + index) as HTMLElement;
    card.getBoundingClientRect = vi.fn(() => rect(top, 170, 540));
    column.getBoundingClientRect = vi.fn(() => rect(top + 20, 50, 110, 410));
    duration.getBoundingClientRect = vi.fn(() => rect(top + 20, 20, 70, 440));
    distance.getBoundingClientRect = vi.fn(() => rect(top + 45, 18, 75, 435));
  }
}

function installAppleRouteCardFixture(): HTMLElement {
  document.body.innerHTML =
    '<ul class="mw-route-planning">' +
    '<li id="apple-card" class="sc-platter-container selected">' +
    '<div class="mw-route-planning-info">' +
    '<div class="mw-route-planning-info-route-detail">' +
    '<div id="apple-duration" class="mw-route-planning-info-eta">1 hr 44 min</div>' +
    '<div class="mw-route-planning-info-description">' +
    '<span id="apple-distance" class="mw-route-planning-info-distance">81 miles</span>' +
    '<div class="mw-route-planning-info-label-detail-text">Fastest</div>' +
    "</div></div></div>" +
    '<ul aria-label="Advisories"><li>Tolls required</li></ul>' +
    "</li></ul>";
  const card = document.getElementById("apple-card") as HTMLElement;
  const duration = document.getElementById("apple-duration") as HTMLElement;
  const distance = document.getElementById("apple-distance") as HTMLElement;
  card.getBoundingClientRect = vi.fn(() => rect(100, 170, 380));
  duration.getBoundingClientRect = vi.fn(() => rect(118, 22, 95, 20));
  distance.getBoundingClientRect = vi.fn(() => rect(145, 18, 70, 20));
  return card;
}

function installWazeRouteCardFixture(): HTMLElement {
  document.body.innerHTML =
    '<ul class="wm-routes__list">' +
    '<li id="waze-card" class="wm-routes-item-desktop is-active">' +
    '<div class="wm-routes-item-desktop__header">' +
    '<span class="wm-routes-item-desktop__index">1</span>' +
    '<span><span id="waze-duration" title="Route duration">1 hr 48 min</span></span>' +
    "</div>" +
    '<div class="wm-routes-item-desktop__details">' +
    '<span><span dir="auto">I-95 N</span>' +
    '<div id="waze-distance" class="wm-routes-item-desktop__footer">81 miles</div>' +
    "</span></div></li></ul>";
  const card = document.getElementById("waze-card") as HTMLElement;
  const duration = document.getElementById("waze-duration") as HTMLElement;
  const distance = document.getElementById("waze-distance") as HTMLElement;
  card.getBoundingClientRect = vi.fn(() => rect(100, 150, 360));
  duration.getBoundingClientRect = vi.fn(() => rect(118, 22, 95, 20));
  distance.getBoundingClientRect = vi.fn(() => rect(145, 18, 70, 20));
  return card;
}

function installAmapRouteCardFixture(): HTMLElement {
  document.body.innerHTML =
    '<div id="amap-card" class="planTitle dirtag current" index="0">' +
    '<div class="dir_tag">方案1</div>' +
    '<p class="dir_base_info">' +
    '<span id="amap-duration" class="dir_base">约37分钟</span>' +
    '<span id="amap-distance" class="dir_base">22.7公里</span>' +
    '<span class="dir_base">红绿灯9个</span>' +
    "</p>" +
    '<h3 class="dir_passby"><span>途经：</span>' +
    '<span class="passby">二环</span>' +
    '<span class="passby">西直门北大街</span>' +
    '<span class="passby">学院路</span></h3>' +
    '<div class="sidebar"></div>' +
    "</div>";
  const card = document.getElementById("amap-card") as HTMLElement;
  const duration = document.getElementById("amap-duration") as HTMLElement;
  const distance = document.getElementById("amap-distance") as HTMLElement;
  card.getBoundingClientRect = vi.fn(() => rect(100, 93, 332));
  duration.getBoundingClientRect = vi.fn(() => rect(125, 14, 60, 40));
  distance.getBoundingClientRect = vi.fn(() => rect(125, 14, 65, 115));
  return card;
}

function singleRoutePayload(
  description: string,
  durationMinutes: number
): RouteBadgePayload {
  return {
    contextSignature: "provider|origin|destination",
    generatedAt: "2026-07-24T18:00:00Z",
    routes: [
      {
        routeId: "route_0",
        description,
        durationMinutes,
        score: 78,
        label: "Calm",
        roles: ["Fastest"],
        explanation: explanation(78),
        reasons: [
          {
            type: "positive",
            message: "This route has relatively low traffic stress.",
            messageZh: "这条路线的交通压力相对较低。"
          }
        ]
      }
    ]
  };
}

describe("route-card badges", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("parses English and Chinese route durations", () => {
    expect(parseDurationMinutes("1 hr")).toBe(60);
    expect(parseDurationMinutes("1 hr 3 min")).toBe(63);
    expect(parseDurationMinutes("36 min")).toBe(36);
    expect(parseDurationMinutes("1 day 2 hr 5 min")).toBe(1565);
    expect(parseDurationMinutes("1 小时 3 分钟")).toBe(63);
    expect(parseDurationMinutes("1 天 2 小时 5 分钟")).toBe(1565);
    expect(parseDurationMinutes("约37分钟")).toBe(37);
    expect(parseDurationMinutes("0 min")).toBeNull();
    expect(parseDurationMinutes("0分钟")).toBeNull();
    expect(parseDurationMinutes("9".repeat(400) + " min")).toBeNull();
    expect(parseDurationMinutes("14.8 miles")).toBeNull();
  });

  it("converts Google Maps route distances to meters", () => {
    expect(parseDistanceMeters("211 miles")).toBe(339572);
    expect(parseDistanceMeters("14.8 mi")).toBe(23818);
    expect(parseDistanceMeters("340 公里")).toBe(340000);
    expect(parseDistanceMeters("800 m")).toBe(800);
    expect(parseDistanceMeters("750 米")).toBe(750);
    expect(parseDistanceMeters("1,234 km")).toBe(1234000);
    expect(parseDistanceMeters("1\u202f234,5 km")).toBe(1234500);
    expect(parseDistanceMeters("14,8 km")).toBe(14800);
  });

  it("reads visible traffic hints without inspecting map pixels", () => {
    expect(parseWithoutTrafficMinutes("2 hr 35 min without traffic")).toBe(155);
    expect(trafficSignalFromText("Avoids slowdown on 12th Ave")).toBe("slow");
    expect(trafficSignalFromText("Heavy traffic ahead")).toBe("heavy");
    expect(trafficSignalFromText("Congestion charge")).toBe("unknown");
    expect(trafficSignalFromText("View traffic conditions")).toBe("unknown");
  });

  it("distributes displayed component percentages to an exact total", () => {
    const components: MoodScoreExplanation["components"] = [
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
        effectiveWeight: 5 / 13,
        contribution: 11.5
      },
      {
        key: "maneuver",
        label: "Complexity",
        stress: null,
        effectiveWeight: 0,
        contribution: null
      },
      {
        key: "duration",
        label: "Duration",
        stress: 50,
        effectiveWeight: 3 / 13,
        contribution: 11.5
      },
      {
        key: "weather",
        label: "Weather",
        stress: 60,
        effectiveWeight: 5 / 13,
        contribution: 23.1
      }
    ];
    const labels = componentPercentageLabels(components);
    const total = Object.values(labels).reduce(
      (sum, label) => sum + Number.parseFloat(label),
      0
    );
    expect(total).toBeCloseTo(100, 8);
    expect(labels).toMatchObject({
      traffic: "0%",
      delay: "38.46%",
      maneuver: "0%",
      duration: "23.08%",
      weather: "38.46%"
    });
  });

  it("uses route-name tokens for matching", () => {
    expect(
      descriptionOverlap(
        "via I-495 E and Woodhaven Blvd Avoids slowdown",
        "I-495 E and Woodhaven Blvd"
      )
    ).toBeGreaterThan(0.8);
  });

  it("matches live badges by duration and description", () => {
    const assignments = matchRouteBadges(
      [
        { text: "via I-495 E 1 hr 14.4 miles", durationMinutes: 60 },
        {
          text: "via I-495 E and Woodhaven Blvd 1 hr 3 min 14.8 miles",
          durationMinutes: 63
        }
      ],
      livePayload
    );
    expect(assignments).toHaveLength(2);
    expect(assignments.find((item) => item.cardIndex === 0)?.badge.routeId).toBe(
      "route_0"
    );
    expect(assignments.find((item) => item.cardIndex === 1)?.badge.routeId).toBe(
      "route_1"
    );
  });

  it("does not force a low-confidence live match", () => {
    const assignments = matchRouteBadges(
      [{ text: "via local streets 2 hr 30 min 22 miles", durationMinutes: 150 }],
      livePayload
    );
    expect(assignments).toHaveLength(0);
  });

  it("finds a route card without depending on Google CSS class names", () => {
    installRouteCardFixture();
    const cards = findRouteCards(document);
    expect(cards).toHaveLength(1);
    expect(cards[0].durationMinutes).toBe(60);
    expect(cards[0].text).toContain("I-495 E");
    expect(cards[0].routeDescription).toBe("via I-495 E");
    expect(cards[0].distanceElement?.id).toBe("distance");
  });

  it("does not treat a zero-minute element as a route card", () => {
    installRouteCardFixture();
    const duration = document.getElementById("duration");
    if (duration) duration.textContent = "0 min";

    expect(findRouteCards(document)).toHaveLength(0);
  });

  it("finds short metric route cards whose distance is shown in meters", () => {
    installRouteCardFixture();
    const distance = document.getElementById("distance");
    if (distance) distance.textContent = "800 m";
    const cards = findRouteCards(document);
    expect(cards).toHaveLength(1);
    expect(parseDistanceMeters(cards[0].distanceElement?.textContent ?? "")).toBe(
      800
    );
  });

  it("reads and mounts inside Apple Maps route cards", () => {
    const card = installAppleRouteCardFixture();
    const pageUrl =
      "https://maps.apple.com/directions?source=Penn&destination=Yale&mode=driving";
    const cards = findRouteCards(document, pageUrl);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      provider: "apple",
      durationMinutes: 104,
      routeDescription: "Fastest Apple route"
    });
    expect(cards[0].distanceElement?.id).toBe("apple-distance");

    const rendered = renderRouteBadges({
      doc: document,
      pageUrl,
      payload: singleRoutePayload("Fastest Apple route", 104),
      state: "idle",
      onAnalyze: vi.fn()
    });
    const slot = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge-slot--apple"
    );
    expect(rendered.selectedRouteId).toBe("route_0");
    expect(slot?.parentElement?.classList.contains(
      "mw-route-planning-info-route-detail"
    )).toBe(true);
    expect(slot?.textContent).toContain("78");
  });

  it("reads and mounts inside Waze route cards", () => {
    const card = installWazeRouteCardFixture();
    const pageUrl = "https://www.waze.com/live-map/directions";
    const cards = findRouteCards(document, pageUrl);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      provider: "waze",
      durationMinutes: 108,
      routeDescription: "via I-95 N"
    });
    expect(cards[0].distanceElement?.id).toBe("waze-distance");

    const rendered = renderRouteBadges({
      doc: document,
      pageUrl,
      payload: singleRoutePayload("via I-95 N", 108),
      state: "idle",
      onAnalyze: vi.fn()
    });
    const slot = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge-slot--waze"
    );
    expect(rendered.selectedRouteId).toBe("route_0");
    expect(slot?.parentElement?.classList.contains(
      "wm-routes-item-desktop__details"
    )).toBe(true);
    expect(slot?.textContent).toContain("78");
  });

  it("reads and mounts inside Amap route cards", () => {
    const card = installAmapRouteCardFixture();
    const pageUrl =
      "https://amap.com/dir?from%5Bname%5D=%E5%8C%97%E4%BA%AC%E5%8D%97%E7%AB%99&" +
      "to%5Bname%5D=%E6%B8%85%E5%8D%8E%E5%A4%A7%E5%AD%A6&type=car";
    const cards = findRouteCards(document, pageUrl);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      provider: "amap",
      durationMinutes: 37,
      routeDescription: "途经：二环西直门北大街学院路"
    });
    expect(cards[0].distanceElement?.id).toBe("amap-distance");

    const rendered = renderRouteBadges({
      doc: document,
      pageUrl,
      payload: singleRoutePayload("途经：二环西直门北大街学院路", 37),
      state: "idle",
      onAnalyze: vi.fn()
    });
    const slot = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge-slot--amap"
    );
    expect(rendered.selectedRouteId).toBe("route_0");
    expect(slot?.parentElement).toBe(card);
    expect(slot?.nextElementSibling?.classList.contains("sidebar")).toBe(true);
    expect(slot?.textContent).toContain("78");
    expect(slot?.textContent).toContain("心情分数");
    expect(slot?.textContent).toContain("平静");
    expect(slot?.textContent).not.toContain("MOOD SCORE");
    expect(slot?.textContent).not.toContain("Calm");

    slot
      ?.querySelector<HTMLButtonElement>(".moodmaps-route-badge--score")
      ?.click();
    const dialog = document.querySelector<HTMLElement>(
      ".moodmaps-score-explainer"
    );
    expect(dialog?.lang).toBe("zh-CN");
    expect(dialog?.textContent).toContain("这个分数是如何计算的");
    expect(dialog?.textContent).toContain("交通");
    expect(dialog?.textContent).toContain("天气");
    expect(dialog?.textContent).toContain("压力分");
    expect(
      dialog?.querySelector(".moodmaps-score-explainer__reasons")
    ).toBeNull();
    expect(
      dialog?.querySelector(".moodmaps-score-explainer__note")
    ).toBeNull();
    expect(dialog?.textContent).not.toContain("这条路线的主要因素");
    expect(dialog?.textContent).not.toContain("这条路线的交通压力相对较低。");
    expect(dialog?.textContent).not.toContain("How this score was calculated");
    expect(dialog?.textContent).not.toContain("Not available");

    renderRouteBadges({
      doc: document,
      pageUrl,
      payload: singleRoutePayload("途经：二环西直门北大街学院路", 37),
      state: "idle",
      language: "en",
      onAnalyze: vi.fn()
    });
    expect(document.querySelector(".moodmaps-score-explainer")).toBeNull();
    expect(slot?.textContent).toContain("MOOD SCORE");
    expect(slot?.textContent).toContain("Calm");
    expect(slot?.textContent).not.toContain("心情分数");
    expect(slot?.textContent).not.toContain("平静");
  });

  it("uses Chinese loading and retry controls only on Amap", () => {
    const card = installAmapRouteCardFixture();
    const pageUrl = "https://ditu.amap.com/dir?type=car";
    renderRouteBadges({
      doc: document,
      pageUrl,
      payload: null,
      state: "loading",
      onAnalyze: vi.fn()
    });
    const loading = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge--action"
    );
    expect(loading?.textContent).toContain("分析中");
    expect(loading?.textContent).toContain("路线舒适度");
    expect(loading?.textContent).not.toContain("Checking");

    renderRouteBadges({
      doc: document,
      pageUrl,
      payload: null,
      state: "error",
      onAnalyze: vi.fn()
    });
    const retry = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge--action"
    );
    expect(retry?.textContent).toContain("重新分析");
    expect(retry?.textContent).toContain("分析失败");
    expect(retry?.textContent).not.toContain("Try again");
  });

  it("can switch Google Maps route-card UI to Chinese", () => {
    const card = installRouteCardFixture();
    renderRouteBadges({
      doc: document,
      pageUrl: "https://www.google.com/maps/dir/Penn/JFK",
      payload: livePayload,
      state: "idle",
      language: "zh-CN",
      onAnalyze: vi.fn()
    });
    const score = card.querySelector<HTMLButtonElement>(
      ".moodmaps-route-badge--score"
    );
    expect(score?.textContent).toContain("心情分数");
    expect(score?.textContent).toContain("均衡");
    expect(score?.textContent).not.toContain("MOOD SCORE");
    score?.click();
    const dialog = document.querySelector<HTMLElement>(
      ".moodmaps-score-explainer"
    );
    expect(dialog?.textContent).toContain("这个分数是如何计算的");
    expect(dialog?.textContent).toContain("交通");
    expect(dialog?.textContent).toContain("复杂度");
    expect(dialog?.querySelector(".moodmaps-score-explainer__reasons")).toBeNull();
    expect(dialog?.querySelector(".moodmaps-score-explainer__note")).toBeNull();
    expect(dialog?.textContent).not.toContain("How this score was calculated");
  });

  it("renders an analyze control and then a matched score badge", () => {
    const card = installRouteCardFixture();
    const onAnalyze = vi.fn();
    renderRouteBadges({
      doc: document,
      payload: null,
      state: "idle",
      onAnalyze
    });
    const slot = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge-slot"
    );
    const action = card.querySelector<HTMLButtonElement>(
      ".moodmaps-route-badge--action"
    );
    expect(action).not.toBeNull();
    expect(slot?.parentElement?.id).toBe("right-column");
    expect(slot?.previousElementSibling?.id).toBe("distance");
    expect(action?.parentElement).toBe(slot);
    expect(action?.style.getPropertyValue("--moodmaps-badge-top")).toBe("");
    expect(card.style.position).toBe("");
    action?.click();
    expect(onAnalyze).toHaveBeenCalledOnce();

    renderRouteBadges({
      doc: document,
      payload: livePayload,
      state: "idle",
      onAnalyze
    });
    const score = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge--score"
    );
    expect(score?.textContent).toContain("64");
    expect(score?.textContent).toContain("Balanced");
    expect(score?.parentElement).toBe(slot);
    expect(card.querySelector(".moodmaps-route-badge-slot")).toBe(slot);
    expect(score?.textContent).not.toContain("BalancedBalanced");
    expect(score?.querySelector(".moodmaps-route-badge__role")).toBeNull();

    renderRouteBadges({
      doc: document,
      payload: livePayload,
      state: "idle",
      onAnalyze
    });
    expect(card.querySelector(".moodmaps-route-badge--score")).toBe(score);
    expect(card.querySelectorAll(".moodmaps-route-badge-slot")).toHaveLength(1);
  });

  it("keeps the same slot while switching through loading and results", () => {
    const card = installRouteCardFixture();
    renderRouteBadges({
      doc: document,
      payload: null,
      state: "loading",
      onAnalyze: vi.fn()
    });
    const slot = card.querySelector<HTMLElement>(
      ".moodmaps-route-badge-slot"
    );
    expect(slot).not.toBeNull();
    expect(slot?.querySelector(".moodmaps-route-badge--loading")).not.toBeNull();

    renderRouteBadges({
      doc: document,
      payload: livePayload,
      state: "idle",
      onAnalyze: vi.fn()
    });
    expect(card.querySelector(".moodmaps-route-badge-slot")).toBe(slot);
    expect(slot?.querySelector(".moodmaps-route-badge--score")).not.toBeNull();
  });

  it("reports the route Google Maps marks as selected", () => {
    installTwoRouteCardFixture();
    const rendered = renderRouteBadges({
      doc: document,
      payload: livePayload,
      state: "idle",
      onAnalyze: vi.fn()
    });
    expect(rendered.selectedRouteId).toBe("route_1");
    expect(rendered.assignedRouteIds).toEqual(["route_0", "route_1"]);
    expect(rendered.assignedRoutes).toEqual([
      { routeId: "route_0", description: "via I-495 E" },
      { routeId: "route_1", description: "via I-495 E and Woodhaven Blvd" }
    ]);
  });

  it("opens a route-specific calculation dialog from the score badge", () => {
    installRouteCardFixture();
    renderRouteBadges({
      doc: document,
      payload: livePayload,
      state: "idle",
      onAnalyze: vi.fn()
    });

    const score = document.querySelector<HTMLButtonElement>(
      ".moodmaps-route-badge--score"
    );
    expect(score?.getAttribute("aria-haspopup")).toBe("dialog");
    score?.click();

    const dialog = document.querySelector<HTMLElement>(
      ".moodmaps-score-explainer"
    );
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(
      Array.from(dialog?.children ?? []).map((child) => child.className)
    ).toEqual([
      "moodmaps-score-explainer__header",
      "moodmaps-score-explainer__summary",
      "moodmaps-score-explainer__components"
    ]);
    expect(dialog?.textContent).toContain("How this score was calculated");
    expect(dialog?.textContent).toContain("via I-495 E");
    expect(dialog?.textContent).toContain("100 − 36 weighted stress");
    expect(dialog?.textContent).toContain("Traffic");
    expect(dialog?.textContent).toContain("20 × 32%");
    expect(dialog?.querySelector(".moodmaps-score-explainer__reasons")).toBeNull();
    expect(dialog?.querySelector(".moodmaps-score-explainer__note")).toBeNull();
    expect(dialog?.textContent).not.toContain("Why this route scored this way");
    expect(dialog?.textContent).not.toContain("Heavy traffic adds stress.");
    expect(score?.getAttribute("aria-expanded")).toBe("true");

    dialog
      ?.querySelector<HTMLButtonElement>(".moodmaps-score-explainer__close")
      ?.click();
    expect(document.querySelector(".moodmaps-score-explainer")).toBeNull();
    expect(score?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows rebalanced weights that total 100% when inputs are unavailable", () => {
    installRouteCardFixture();
    const payload = structuredClone(livePayload);
    payload.routes[0].explanation.components = [
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
        effectiveWeight: 5 / 13,
        contribution: 11.5
      },
      {
        key: "maneuver",
        label: "Complexity",
        stress: null,
        effectiveWeight: 0,
        contribution: null
      },
      {
        key: "duration",
        label: "Duration",
        stress: 50,
        effectiveWeight: 3 / 13,
        contribution: 11.5
      },
      {
        key: "weather",
        label: "Weather",
        stress: 60,
        effectiveWeight: 5 / 13,
        contribution: 23.1
      }
    ];
    renderRouteBadges({
      doc: document,
      payload,
      state: "idle",
      onAnalyze: vi.fn()
    });
    document
      .querySelector<HTMLButtonElement>(".moodmaps-route-badge--score")
      ?.click();

    const dialogText =
      document.querySelector(".moodmaps-score-explainer")?.textContent ?? "";
    expect(dialogText).toContain("30 × 38.46%");
    expect(dialogText).toContain("50 × 23.08%");
    expect(dialogText).toContain("60 × 38.46%");
    expect(dialogText.match(/Not available/g)).toHaveLength(2);
  });
});
