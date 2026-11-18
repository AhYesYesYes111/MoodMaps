import type { LocationInput, WeatherFeatures } from "../shared/types";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 15 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;
const CACHE_PREFIX = "openMeteo:v2:";
const CACHE_READ_DEADLINE_MS = 150;
export const WEATHER_LOOKUP_DEADLINE_MS = 4500;

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface EndpointReference {
  cachePart: string;
  coordinates: Coordinates | null;
  coarseText: string | null;
}

interface WeatherCacheEntry {
  expiresAt: number;
  value: WeatherFeatures | null;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validCoordinates(
  latitude: unknown,
  longitude: unknown
): Coordinates | null {
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : null;
}

function normalizedPlacePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function looksPrecise(value: string): boolean {
  return (
    /\d/.test(value) ||
    /\b(?:airport|station|terminal|university|college|school|hospital|hotel|mall|plaza|building|tower|apartment|suite|unit|park|square|museum|gallery|stadium|arena|theater|theatre|cinema|restaurant|cafe|coffee|bar|pub|store|shop|market|center|centre|hall|church|temple|mosque|synagogue|zoo|aquarium|library|monument|beach|garden|club|office|house|home|work)\b/i.test(
      value
    ) ||
    /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|highway|hwy|route|rte)\b\.?$/i.test(
      value
    ) ||
    /(?:机场|機場|车站|車站|火车站|火車站|大学|大學|学校|學校|医院|醫院|酒店|商场|商場|大厦|大廈|公寓|公园|公園|广场|廣場|博物馆|博物館|体育场|體育場|剧院|劇院|影院|餐厅|餐廳|咖啡馆|咖啡館|市场|市場|超市|夜市|教堂|寺|清真寺|图书馆|圖書館|纪念碑|紀念碑|海滩|海灘|花园|花園|办公室|辦公室|街道|道路|路|街|巷|弄|号|號)$/.test(
      value
    )
  );
}

const COMMON_REGION_QUALIFIERS = new Set(
  [
    "australia",
    "brazil",
    "canada",
    "china",
    "france",
    "germany",
    "india",
    "indonesia",
    "italy",
    "japan",
    "mexico",
    "netherlands",
    "new zealand",
    "singapore",
    "south africa",
    "south korea",
    "spain",
    "switzerland",
    "taiwan",
    "thailand",
    "united arab emirates",
    "united kingdom",
    "united states",
    "vietnam",
    "中国",
    "中國",
    "日本",
    "韩国",
    "韓國",
    "新加坡",
    "法国",
    "法國",
    "德国",
    "德國",
    "英国",
    "英國",
    "美国",
    "美國",
    "加拿大",
    "澳大利亚",
    "澳大利亞"
  ].map((value) => value.toLocaleLowerCase())
);

// Text geocoding is deliberately allow-list based. Map labels are free-form and
// a string that merely lacks an address keyword is not necessarily a city
// (for example, "Tavern on the Green"). Unknown localities are skipped.
const COMMON_CITY_NAMES = new Set(
  [
    "amsterdam",
    "beijing",
    "berlin",
    "boston",
    "cambridge",
    "chicago",
    "dubai",
    "hong kong",
    "london",
    "los angeles",
    "madrid",
    "melbourne",
    "new haven",
    "new york",
    "paris",
    "rome",
    "san francisco",
    "seattle",
    "seoul",
    "shanghai",
    "singapore",
    "sydney",
    "taipei",
    "tokyo",
    "toronto",
    "vancouver",
    "washington",
    "北京",
    "上海",
    "香港",
    "台北",
    "新加坡"
  ].map((value) => value.toLocaleLowerCase())
);

// 区 / 區 also ends the names of apartment compounds, campuses and individual
// attractions. Only recognize known districts when that is the sole suffix.
const KNOWN_DISTRICTS = new Set([
  "浦东新区", "浦東新區", "黄浦区", "黃浦區", "徐汇区", "徐匯區",
  "静安区", "靜安區", "朝阳区", "朝陽區", "海淀区", "海淀區"
]);

function explicitlyAdministrative(value: string): boolean {
  return (
    /^(?:city|county|state|province|region|prefecture|municipality)\s+of\b/i.test(
      value
    ) ||
    /\b(?:city|county|province|region|prefecture|municipality)$/.test(
      value.toLocaleLowerCase()
    ) ||
    KNOWN_DISTRICTS.has(value) ||
    /(?:市|省|州|县|縣|自治区|自治區|特别行政区|特別行政區)$/.test(
      value
    )
  );
}

function clearlyCoarseLocality(value: string): boolean {
  return (
    !looksPrecise(value) &&
    (explicitlyAdministrative(value) ||
      COMMON_CITY_NAMES.has(value.toLocaleLowerCase()))
  );
}

function looksLikeRegionQualifier(value: string): boolean {
  return (
    (!looksPrecise(value) && explicitlyAdministrative(value)) ||
    /^[A-Z]{2,3}$/.test(value) ||
    COMMON_REGION_QUALIFIERS.has(value.toLocaleLowerCase())
  );
}

/**
 * Returns only text that is clearly city/region-level. A single free-form place,
 * POI, or street address is deliberately rejected instead of being geocoded.
 */
export function coarseLocationText(value: string): string | null {
  const parts = value
    .split(/[,，]/)
    .map(normalizedPlacePart)
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    const only = parts[0];
    return !looksPrecise(only) && explicitlyAdministrative(only) ? only : null;
  }

  if (parts.length === 2) {
    const [first, second] = parts;
    if (looksLikeRegionQualifier(second) && clearlyCoarseLocality(first)) {
      return first + ", " + second;
    }
    return clearlyCoarseLocality(second) ? second : null;
  }

  const regionParts = parts.slice(-2);
  if (
    looksLikeRegionQualifier(regionParts[1]) &&
    clearlyCoarseLocality(regionParts[0])
  ) {
    return regionParts.join(", ");
  }
  return clearlyCoarseLocality(regionParts[1]) ? regionParts[1] : null;
}

function endpointReference(location: LocationInput): EndpointReference | null {
  const coordinates = validCoordinates(location.latitude, location.longitude);
  if (coordinates) {
    return {
      cachePart:
        "c:" +
        coordinates.latitude.toFixed(4) +
        "," +
        coordinates.longitude.toFixed(4),
      coordinates,
      coarseText: null
    };
  }
  const coarseText = coarseLocationText(location.text);
  return coarseText
    ? {
        cachePart:
          "g:" +
          coarseText
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/\s+/g, " "),
        coordinates: null,
        coarseText
      }
    : null;
}

function routeWeatherCacheKey(
  origin: EndpointReference,
  destination: EndpointReference
): string {
  return CACHE_PREFIX + [origin.cachePart, destination.cachePart].sort().join("|");
}

export function geographicEndpointMidpoint(
  start: Coordinates,
  end: Coordinates
): Coordinates {
  const longitudeDifference =
    ((end.longitude - start.longitude + 540) % 360) - 180;
  const longitude = start.longitude + longitudeDifference / 2;
  return {
    latitude: (start.latitude + end.latitude) / 2,
    longitude: ((longitude + 540) % 360) - 180
  };
}

async function fetchJson(
  url: string,
  signal: AbortSignal
): Promise<Record<string, unknown> | null> {
  if (signal.aborted) return null;
  try {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) return null;
    const value = (await response.json()) as unknown;
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function geocode(
  coarseText: string,
  signal: AbortSignal
): Promise<Coordinates | null> {
  const query = new URLSearchParams({
    name: coarseText,
    count: "1",
    language: "en",
    format: "json"
  });
  const payload = await fetchJson(
    GEOCODING_URL + "?" + query.toString(),
    signal
  );
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const first = results[0] as Record<string, unknown> | undefined;
  return validCoordinates(first?.latitude, first?.longitude);
}

function condition(code: number): { risk: number; type: string; text: string } {
  if (code === 0) return { risk: 0, type: "CLEAR", text: "Clear" };
  if (code <= 3) return { risk: 8, type: "CLOUDY", text: "Cloudy" };
  if (code <= 48) return { risk: 65, type: "FOG", text: "Fog" };
  if (code <= 57) return { risk: 30, type: "DRIZZLE", text: "Drizzle" };
  if (code <= 67) return { risk: 58, type: "RAIN", text: "Rain" };
  if (code <= 77) return { risk: 68, type: "SNOW", text: "Snow" };
  if (code <= 82) return { risk: 62, type: "RAIN_SHOWERS", text: "Rain showers" };
  if (code <= 86) return { risk: 72, type: "SNOW_SHOWERS", text: "Snow showers" };
  if (code >= 95) return { risk: 92, type: "THUNDERSTORM", text: "Thunderstorm" };
  return { risk: 15, type: "MIXED", text: "Mixed conditions" };
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseOpenMeteoWeather(
  payload: Record<string, unknown>
): WeatherFeatures | null {
  const current = payload.current;
  if (typeof current !== "object" || current === null) return null;
  const values = current as Record<string, unknown>;
  const weatherCode = numeric(values.weather_code);
  if (weatherCode === null) return null;
  const summary = condition(weatherCode);
  const visibilityMeters = numeric(values.visibility);
  const visibilityKilometers =
    visibilityMeters === null ? null : Math.max(0, visibilityMeters / 1000);
  const windGustKph = numeric(values.wind_gusts_10m);
  const apparentTemperature = numeric(values.apparent_temperature);
  const precipitation = numeric(values.precipitation);
  const visibilityRisk =
    visibilityKilometers === null
      ? 0
      : visibilityKilometers <= 1
        ? 100
        : visibilityKilometers <= 3
          ? 65
          : visibilityKilometers <= 5
            ? 35
            : 0;
  const gustRisk =
    windGustKph === null ? 0 : clamp(((windGustKph - 25) / 55) * 100);
  const temperatureRisk =
    apparentTemperature === null
      ? 0
      : apparentTemperature < -5
        ? clamp((-5 - apparentTemperature) * 4)
        : apparentTemperature > 35
          ? clamp((apparentTemperature - 35) * 6)
          : 0;
  const precipitationRisk =
    precipitation === null ? 0 : clamp(precipitation * 18);
  const risk = clamp(
    Math.max(
      summary.risk * 0.7,
      summary.risk * 0.45 +
        precipitationRisk * 0.25 +
        visibilityRisk * 0.15 +
        gustRisk * 0.1 +
        temperatureRisk * 0.05
    )
  );
  return {
    risk: Math.round(risk * 10) / 10,
    conditionType: summary.type,
    conditionDescription: summary.text,
    precipitationProbability: null,
    visibilityKilometers,
    windGustKph,
    feelsLikeCelsius: apparentTemperature,
    observedAt: typeof values.time === "string" ? values.time : null
  };
}

async function currentWeatherAt(
  coordinates: Coordinates,
  signal: AbortSignal
): Promise<WeatherFeatures | null> {
  const query = new URLSearchParams({
    latitude: coordinates.latitude.toFixed(4),
    longitude: coordinates.longitude.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,wind_gusts_10m",
    timezone: "auto"
  });
  const payload = await fetchJson(
    WEATHER_URL + "?" + query.toString(),
    signal
  );
  return payload ? parseOpenMeteoWeather(payload) : null;
}

async function safeSessionGet(key: string): Promise<unknown> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      chrome.storage.session
        .get(key)
        .then((stored) => stored[key])
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), CACHE_READ_DEADLINE_MS);
      })
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeSessionRemove(key: string): Promise<void> {
  try {
    await chrome.storage.session.remove(key);
  } catch {
    // Weather caching is optional and must never block local scoring.
  }
}

async function safeSessionSet(
  key: string,
  entry: WeatherCacheEntry
): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: entry });
  } catch {
    // Weather caching is optional and must never block local scoring.
  }
}

function cachedWeather(value: unknown): WeatherCacheEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  if (record.value === null) {
    return { expiresAt: record.expiresAt, value: null };
  }
  if (typeof record.value !== "object" || record.value === null) return null;
  const weather = record.value as Record<string, unknown>;
  if (
    typeof weather.risk !== "number" ||
    !Number.isFinite(weather.risk) ||
    weather.risk < 0 ||
    weather.risk > 100 ||
    typeof weather.conditionType !== "string"
  ) {
    return null;
  }
  return {
    expiresAt: record.expiresAt,
    value: record.value as WeatherFeatures
  };
}

async function resolveEndpoint(
  endpoint: EndpointReference,
  signal: AbortSignal
): Promise<Coordinates | null> {
  if (endpoint.coordinates) return endpoint.coordinates;
  return endpoint.coarseText ? geocode(endpoint.coarseText, signal) : null;
}

async function lookupEndpointMidpointWeather(
  origin: EndpointReference,
  destination: EndpointReference,
  signal: AbortSignal
): Promise<WeatherFeatures | null> {
  const key = routeWeatherCacheKey(origin, destination);
  const storedValue = await safeSessionGet(key);
  const stored = cachedWeather(storedValue);
  if (signal.aborted) return null;
  if (stored?.expiresAt && stored.expiresAt > Date.now()) {
    return stored.value;
  }
  if (storedValue !== undefined) void safeSessionRemove(key);
  if (signal.aborted) return null;

  const [start, end] = await Promise.all([
    resolveEndpoint(origin, signal),
    resolveEndpoint(destination, signal)
  ]);
  if (signal.aborted || !start || !end) return null;

  // This is the midpoint of the two resolved endpoints, not a midpoint sampled
  // from the route geometry.
  const endpointMidpoint = geographicEndpointMidpoint(start, end);
  const weather = await currentWeatherAt(endpointMidpoint, signal);
  if (signal.aborted) return null;
  void safeSessionSet(key, {
    value: weather,
    expiresAt:
      Date.now() + (weather ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)
  });
  return weather;
}

async function withWeatherDeadline(
  operation: (signal: AbortSignal) => Promise<WeatherFeatures | null>
): Promise<WeatherFeatures | null> {
  const controller = new AbortController();
  let timeoutId: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, WEATHER_LOOKUP_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      operation(controller.signal).catch(() => null),
      timeout
    ]);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

/**
 * Returns current weather sampled at the midpoint of the resolved origin and
 * destination coordinates. It does not claim to sample the route geometry.
 */
export async function getEndpointMidpointWeather(
  origin: LocationInput,
  destination: LocationInput
): Promise<WeatherFeatures | null> {
  const start = endpointReference(origin);
  const end = endpointReference(destination);
  if (!start || !end) return null;
  return withWeatherDeadline((signal) =>
    lookupEndpointMidpointWeather(start, end, signal)
  );
}
