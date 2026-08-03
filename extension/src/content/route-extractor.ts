import { detectMapProvider } from "../shared/map-provider";
import type {
  LocationInput,
  MapProvider,
  RouteContext
} from "../shared/types";

const ORIGIN_LABELS = [
  "starting point",
  "start location",
  "choose starting point",
  "origin",
  "起点",
  "出发地",
  "起始地点"
];

const DESTINATION_LABELS = [
  "destination",
  "choose destination",
  "end point",
  "目的地",
  "终点",
  "到达地点"
];

function cleanLocation(value: string): string {
  return value
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableLocation(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    value.length > 0 &&
    !normalized.startsWith("data=") &&
    !normalized.startsWith("@") &&
    !normalized.startsWith("!3d") &&
    normalized !== "dir"
  );
}

function toLocation(
  value: string | null,
  coordinates?: { latitude: number; longitude: number }
): LocationInput | null {
  if (!value) return null;
  const text = cleanLocation(value);
  return usableLocation(text) ? { text, ...coordinates } : null;
}

export function extractFromUrl(pageUrl: string): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  try {
    const url = new URL(pageUrl);
    const segments = url.pathname.split("/");
    const dirIndex = segments.indexOf("dir");
    if (dirIndex < 0) {
      return { origin: null, destination: null, confidence: 0 };
    }
    const routeSegments = segments
      .slice(dirIndex + 1, dirIndex + 3)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    const coordinatePairs = [...pageUrl.matchAll(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)]
      .map((match) => ({ longitude: Number(match[1]), latitude: Number(match[2]) }))
      .filter(
        (point) =>
          Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      );
    const origin = toLocation(routeSegments[0] ?? null, coordinatePairs[0]);
    const destination = toLocation(routeSegments[1] ?? null, coordinatePairs[1]);
    return {
      origin,
      destination,
      confidence: origin && destination ? 0.93 : origin || destination ? 0.48 : 0
    };
  } catch {
    return { origin: null, destination: null, confidence: 0 };
  }
}

function searchParamLocation(
  url: URL,
  key: string
): LocationInput | null {
  return toLocation(url.searchParams.get(key));
}

export function extractAppleFromUrl(pageUrl: string): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  try {
    const url = new URL(pageUrl);
    const origin = searchParamLocation(url, "source");
    const destination = searchParamLocation(url, "destination");
    return {
      origin,
      destination,
      confidence: origin && destination ? 0.96 : origin || destination ? 0.48 : 0
    };
  } catch {
    return { origin: null, destination: null, confidence: 0 };
  }
}

function coordinateLocation(value: string | null): LocationInput | null {
  if (!value?.startsWith("ll.")) return null;
  const [latitudeText, longitudeText] = value.slice(3).split(",");
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    text: latitude.toFixed(5) + ", " + longitude.toFixed(5),
    latitude,
    longitude
  };
}

export function extractWazeFromUrl(pageUrl: string): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  try {
    const url = new URL(pageUrl);
    const origin = coordinateLocation(url.searchParams.get("from"));
    const destination = coordinateLocation(url.searchParams.get("to"));
    return {
      origin,
      destination,
      confidence: origin && destination ? 0.82 : origin || destination ? 0.42 : 0
    };
  } catch {
    return { origin: null, destination: null, confidence: 0 };
  }
}

function amapCoordinates(
  value: string | null
): { latitude: number; longitude: number } | undefined {
  if (!value) return undefined;
  const [longitudeText, latitudeText] = value.split(",");
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : undefined;
}

function amapLocation(url: URL, prefix: "from" | "to"): LocationInput | null {
  const coordinates = amapCoordinates(
    url.searchParams.get(prefix + "[lnglat]")
  );
  const name = url.searchParams.get(prefix + "[name]");
  if (name) return toLocation(name, coordinates);
  if (!coordinates) return null;
  return {
    text:
      coordinates.latitude.toFixed(5) +
      ", " +
      coordinates.longitude.toFixed(5),
    ...coordinates
  };
}

export function extractAmapFromUrl(pageUrl: string): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  try {
    const url = new URL(pageUrl);
    if (!url.pathname.startsWith("/dir")) {
      return { origin: null, destination: null, confidence: 0 };
    }
    const origin = amapLocation(url, "from");
    const destination = amapLocation(url, "to");
    return {
      origin,
      destination,
      confidence: origin && destination ? 0.98 : origin || destination ? 0.5 : 0
    };
  } catch {
    return { origin: null, destination: null, confidence: 0 };
  }
}

const DRIVING_MODE_LABELS = [
  "driving",
  "drive",
  "car",
  "驾车",
  "駕車",
  "开车",
  "開車"
];

const NON_DRIVING_MODE_LABELS = [
  "transit",
  "public transport",
  "train",
  "walking",
  "walk",
  "cycling",
  "bicycle",
  "bike",
  "flight",
  "plane",
  "公共交通",
  "公交",
  "步行",
  "骑行",
  "騎行",
  "单车",
  "單車",
  "飞机",
  "飛機"
];

function selectedTravelModeLabel(doc: Document): string {
  const selected = doc.querySelectorAll<HTMLElement>(
    '[data-travel_mode][aria-checked="true"], ' +
      '[data-travel-mode][aria-checked="true"], ' +
      '[role="radio"][aria-checked="true"], ' +
      '[role="tab"][aria-selected="true"], ' +
      'button[aria-pressed="true"]'
  );
  return Array.from(selected)
    .flatMap((element) => [
      element.getAttribute("aria-label"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("title")
    ])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();
}

export function detectTravelMode(
  pageUrl: string,
  doc: Document
): RouteContext["travelMode"] {
  const provider = detectMapProvider(pageUrl);
  if (provider === "apple") {
    try {
      const mode = new URL(pageUrl).searchParams.get("mode");
      if (mode) return mode === "driving" ? "DRIVE" : "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }
  if (provider === "waze") {
    return pageUrl.includes("/live-map/directions") ? "DRIVE" : "UNKNOWN";
  }
  if (provider === "amap") {
    try {
      const url = new URL(pageUrl);
      const type = url.searchParams.get("type");
      if (type) return type === "car" ? "DRIVE" : "UNKNOWN";
      return "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
  }

  const encodedModes = [...pageUrl.matchAll(/!3e(\d+)/g)];
  const encodedMode = encodedModes.at(-1)?.[1];
  if (encodedMode !== undefined) return encodedMode === "0" ? "DRIVE" : "UNKNOWN";

  const selectedLabel = selectedTravelModeLabel(doc);
  if (NON_DRIVING_MODE_LABELS.some((label) => selectedLabel.includes(label))) {
    return "UNKNOWN";
  }
  if (DRIVING_MODE_LABELS.some((label) => selectedLabel.includes(label))) {
    return "DRIVE";
  }
  return "UNKNOWN";
}

function labelText(input: HTMLInputElement): string {
  return [
    input.getAttribute("aria-label"),
    input.getAttribute("placeholder"),
    input.getAttribute("data-tooltip"),
    input.name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesAny(value: string, labels: string[]): boolean {
  return labels.some((label) => value.includes(label));
}

export function extractFromDom(doc: Document): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  const inputs = Array.from(
    doc.querySelectorAll<HTMLInputElement>(
      'input[aria-label], input[placeholder], input[role="combobox"]'
    )
  ).filter((input) => input.value.trim().length > 0 && !input.disabled);

  const originInput = inputs.find((input) =>
    matchesAny(labelText(input), ORIGIN_LABELS)
  );
  const destinationInput = inputs.find((input) =>
    matchesAny(labelText(input), DESTINATION_LABELS)
  );

  let origin = toLocation(originInput?.value ?? null);
  let destination = toLocation(destinationInput?.value ?? null);
  let confidence = origin && destination ? 0.86 : origin || destination ? 0.45 : 0;

  if ((!origin || !destination) && inputs.length >= 2) {
    const candidates = inputs
      .filter((input) => {
        const label = labelText(input);
        return (
          label.includes("point") ||
          label.includes("location") ||
          label.includes("destination") ||
          label.includes("地点") ||
          label.includes("起点") ||
          label.includes("终点")
        );
      })
      .slice(0, 2);
    if (candidates.length === 2) {
      origin = origin ?? toLocation(candidates[0].value);
      destination = destination ?? toLocation(candidates[1].value);
      confidence = origin && destination ? Math.max(confidence, 0.68) : confidence;
    }
  }

  return { origin, destination, confidence };
}

function appleInput(
  doc: Document,
  kind: "origin" | "destination"
): LocationInput | null {
  const labels = kind === "origin" ? ORIGIN_LABELS : DESTINATION_LABELS;
  const exactFallback = kind === "origin" ? "from" : "to";
  const input = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[role="combobox"]')
  ).find(
    (candidate) => {
      const semanticLabel = labelText(candidate);
      return (
        semanticLabel === exactFallback ||
        matchesAny(semanticLabel, labels)
      );
    }
  );
  return toLocation(input?.value ?? null);
}

export function extractAppleFromDom(doc: Document): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  const origin = appleInput(doc, "origin");
  const destination = appleInput(doc, "destination");
  return {
    origin,
    destination,
    confidence: origin && destination ? 0.9 : origin || destination ? 0.45 : 0
  };
}

function wazeContainerLocation(container: Element): LocationInput | null {
  const primary = container.querySelector<HTMLElement>(".wm-search__primary");
  const secondary = container.querySelector<HTMLElement>(
    ".wm-search__secondary"
  );
  if (primary?.textContent?.trim()) {
    return toLocation(
      [primary.textContent, secondary?.textContent]
        .filter(Boolean)
        .join(", ")
    );
  }
  const input = container.querySelector<HTMLInputElement>(".wm-search__input");
  return toLocation(input?.value ?? null);
}

export function extractWazeFromDom(doc: Document): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  const containers = Array.from(
    doc.querySelectorAll<HTMLElement>(".wm-search")
  ).filter(
    (container) =>
      container.querySelector(".wm-search__input, .wm-search__selected") !== null
  );
  const origin = containers[0]
    ? wazeContainerLocation(containers[0])
    : null;
  const destination = containers[1]
    ? wazeContainerLocation(containers[1])
    : null;
  const selectedCount = containers
    .slice(0, 2)
    .filter((container) => container.querySelector(".wm-search__selected")).length;
  return {
    origin,
    destination,
    confidence:
      origin && destination
        ? selectedCount === 2
          ? 0.93
          : 0.72
        : origin || destination
          ? 0.4
          : 0
  };
}

export function extractAmapFromDom(doc: Document): Pick<
  RouteContext,
  "origin" | "destination" | "confidence"
> {
  const origin = toLocation(
    doc.querySelector<HTMLInputElement>("#dir_from_ipt")?.value ?? null
  );
  const destination = toLocation(
    doc.querySelector<HTMLInputElement>("#dir_to_ipt")?.value ?? null
  );
  return {
    origin,
    destination,
    confidence: origin && destination ? 0.92 : origin || destination ? 0.46 : 0
  };
}

function extractForProvider(
  provider: MapProvider,
  pageUrl: string,
  doc: Document
): {
  fromUrl: Pick<RouteContext, "origin" | "destination" | "confidence">;
  fromDom: Pick<RouteContext, "origin" | "destination" | "confidence">;
} {
  if (provider === "apple") {
    return {
      fromUrl: extractAppleFromUrl(pageUrl),
      fromDom: extractAppleFromDom(doc)
    };
  }
  if (provider === "waze") {
    return {
      fromUrl: extractWazeFromUrl(pageUrl),
      fromDom: extractWazeFromDom(doc)
    };
  }
  if (provider === "amap") {
    return {
      fromUrl: extractAmapFromUrl(pageUrl),
      fromDom: extractAmapFromDom(doc)
    };
  }
  return {
    fromUrl: extractFromUrl(pageUrl),
    fromDom: extractFromDom(doc)
  };
}

export function extractRouteContext(
  pageUrl = window.location.href,
  doc = document
): RouteContext {
  const provider = detectMapProvider(pageUrl);
  const { fromUrl, fromDom } = extractForProvider(provider, pageUrl, doc);
  const origin = fromUrl.origin ?? fromDom.origin;
  const destination = fromUrl.destination ?? fromDom.destination;
  const usedUrl = Boolean(fromUrl.origin || fromUrl.destination);
  const usedDom =
    (!fromUrl.origin && Boolean(fromDom.origin)) ||
    (!fromUrl.destination && Boolean(fromDom.destination));
  const source = usedUrl && usedDom ? "mixed" : usedUrl ? "url" : usedDom ? "dom" : "manual";
  let confidence = Math.max(fromUrl.confidence, fromDom.confidence);
  if (origin && destination && source === "mixed") confidence = Math.max(confidence, 0.75);

  return {
    provider,
    origin,
    destination,
    travelMode: detectTravelMode(pageUrl, doc),
    departureTime: new Date().toISOString(),
    source,
    confidence,
    pageUrl
  };
}
