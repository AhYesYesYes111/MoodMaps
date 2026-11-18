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

// Only values from these tables may reach the geocoder or its cache key.
function knownNames(names: string[]): Map<string, string> {
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

const REGION_QUALIFIERS = knownNames([
  "Australia", "Brazil", "Canada", "China", "France", "Germany", "India",
  "Indonesia", "Italy", "Japan", "Mexico", "Netherlands", "New Zealand",
  "Singapore", "South Africa", "South Korea", "Spain", "Switzerland", "Taiwan",
  "Thailand", "United Arab Emirates", "United Kingdom", "United States", "Vietnam",
  "中国", "中國", "日本", "韩国", "韓國", "新加坡", "法国", "法國", "德国", "德國",
  "英国", "英國", "美国", "美國", "加拿大", "澳大利亚", "澳大利亞",
  "US", "USA", "UK", "CN",
  ...("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN " +
    "MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" ")
]);

const CITY_NAMES = knownNames([
  "Amsterdam", "Beijing", "Berlin", "Boston", "Cambridge", "Chicago", "Dubai",
  "Hong Kong", "London", "Los Angeles", "Madrid", "Melbourne", "New Haven",
  "New York", "Paris", "Rome", "San Francisco", "Seattle", "Seoul", "Shanghai",
  "Singapore", "Sydney", "Taipei", "Tokyo", "Toronto", "Vancouver", "Washington",
  "北京", "上海", "香港", "台北", "新加坡"
]);

// An unqualified label needs an explicit, known administrative name. POIs
// also use words like "City of", "County", 市, 区, and 州 in their names.
const ADMINISTRATIVE_NAMES = knownNames([
  "City of London", "New York City", "City of Boston", "Los Angeles County",
  "北京市", "上海市", "天津市", "重庆市", "重慶市", "广州市", "廣州市",
  "深圳市", "杭州市", "南京市", "台北市", "臺北市",
  "香港特别行政区", "香港特別行政區", "澳门特别行政区", "澳門特別行政區",
  "内蒙古自治区", "內蒙古自治區", "广西壮族自治区", "廣西壯族自治區",
  "西藏自治区", "西藏自治區", "宁夏回族自治区", "寧夏回族自治區",
  "新疆维吾尔自治区", "新疆維吾爾自治區",
  "浦东新区", "浦東新區", "黄浦区", "黃浦區", "徐汇区", "徐匯區",
  "静安区", "靜安區", "朝阳区", "朝陽區", "海淀区", "海淀區"
]);

export function coarseLocationText(value: string): string | null {
  const parts = value.split(/[,，]/)
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean);
  const last = parts.at(-1) ?? "";
  const administrative = ADMINISTRATIVE_NAMES.get(last);
  if (parts.length < 2) return administrative ?? null;

  const previous = parts[parts.length - 2];
  const locality = ADMINISTRATIVE_NAMES.get(previous) ?? CITY_NAMES.get(previous);
  const region = administrative ?? REGION_QUALIFIERS.get(last);
  if (locality && region) return locality + ", " + region;
  return administrative ?? CITY_NAMES.get(last) ?? null;
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
