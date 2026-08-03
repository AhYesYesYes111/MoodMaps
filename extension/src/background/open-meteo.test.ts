import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coarseLocationText,
  geographicEndpointMidpoint,
  getEndpointMidpointWeather,
  parseOpenMeteoWeather,
  WEATHER_LOOKUP_DEADLINE_MS
} from "./open-meteo";

function response(value: unknown): Response {
  return {
    ok: true,
    json: async () => value
  } as Response;
}

function installSessionStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const get = vi.fn(async (key: string) => ({ [key]: values[key] }));
  const set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(values, items);
  });
  const remove = vi.fn(async (key: string) => {
    delete values[key];
  });
  vi.stubGlobal("chrome", {
    storage: { session: { get, set, remove } }
  });
  return { values, get, set, remove };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Open-Meteo weather normalization", () => {
  it("turns current rain, visibility, wind, and temperature into weather stress", () => {
    const weather = parseOpenMeteoWeather({
      current: {
        time: "2026-07-18T20:00",
        weather_code: 63,
        precipitation: 2.1,
        visibility: 4200,
        wind_gusts_10m: 44,
        apparent_temperature: 18
      }
    });
    expect(weather).toMatchObject({
      conditionType: "RAIN",
      conditionDescription: "Rain",
      visibilityKilometers: 4.2,
      windGustKph: 44,
      feelsLikeCelsius: 18
    });
    expect(weather?.risk).toBeGreaterThan(30);
  });

  it("only derives explicitly coarse place text", () => {
    expect(coarseLocationText("123 Main Street")).toBeNull();
    expect(coarseLocationText("Boston")).toBeNull();
    expect(coarseLocationText("123 Main Street, Boston, MA")).toBe(
      "Boston, MA"
    );
    expect(coarseLocationText("Penn Station, New York")).toBe("New York");
    expect(coarseLocationText("Paris, France")).toBe("Paris, France");
    expect(coarseLocationText("Central Park, New York")).toBe("New York");
    expect(coarseLocationText("Times Square, New York")).toBe("New York");
    expect(coarseLocationText("The Louvre, Paris")).toBe("Paris");
    expect(coarseLocationText("Central Park, Tavern on the Green")).toBeNull();
    expect(coarseLocationText("Unknown Landmark, Winter Village")).toBeNull();
    expect(coarseLocationText("Unknown Place, Boston, MA")).toBe(
      "Boston, MA"
    );
    expect(coarseLocationText("Home, Work")).toBeNull();
    expect(coarseLocationText("北京市")).toBe("北京市");
    expect(coarseLocationText("北京南站")).toBeNull();
  });

  it("does not geocode an ambiguous trailing point-of-interest name", async () => {
    installSessionStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getEndpointMidpointWeather(
        { text: "Central Park, Tavern on the Green" },
        { text: "Paris, France" }
      )
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards an unknown POI name from a two-part location", async () => {
    installSessionStorage();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.hostname === "geocoding-api.open-meteo.com"
        ? response({ results: [{ latitude: 40.71, longitude: -74 }] })
        : response({ current: { weather_code: 0 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await getEndpointMidpointWeather(
      { text: "The Louvre, Paris" },
      { text: "Central Park, New York" }
    );

    const geocodedNames = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.hostname === "geocoding-api.open-meteo.com")
      .map((url) => url.searchParams.get("name"));
    expect(geocodedNames).toEqual(expect.arrayContaining(["Paris", "New York"]));
    expect(geocodedNames.join(" ")).not.toMatch(/Louvre|Central Park/i);
  });

  it("never sends a full street address to geocoding", async () => {
    installSessionStorage();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "geocoding-api.open-meteo.com") {
        const name = url.searchParams.get("name");
        return response({
          results: [
            name === "Boston, MA"
              ? { latitude: 42.36, longitude: -71.06 }
              : { latitude: 42.37, longitude: -71.1 }
          ]
        });
      }
      return response({ current: { weather_code: 0 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const weather = await getEndpointMidpointWeather(
      { text: "123 Main Street, Boston, MA" },
      { text: "456 Secret Road, Cambridge, MA" }
    );

    expect(weather?.conditionType).toBe("CLEAR");
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("123+Main"))).toBe(false);
    expect(urls.some((url) => url.includes("456+Secret"))).toBe(false);
    expect(urls.some((url) => url.includes("Boston%2C+MA"))).toBe(true);
    expect(urls.some((url) => url.includes("Cambridge%2C+MA"))).toBe(true);
  });

  it("refuses free-form endpoints when coordinates are unavailable", async () => {
    installSessionStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getEndpointMidpointWeather(
        { text: "123 Main Street" },
        { text: "456 Secret Road" }
      )
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes normalized coordinates in cache identity", async () => {
    const storage = installSessionStorage();
    const fetchMock = vi.fn(async () =>
      response({ current: { weather_code: 0 } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getEndpointMidpointWeather(
      { text: "Home", latitude: 40, longitude: -70 },
      { text: "Work", latitude: 41, longitude: -71 }
    );
    await getEndpointMidpointWeather(
      { text: "Home", latitude: 10, longitude: 20 },
      { text: "Work", latitude: 11, longitude: 21 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = Object.keys(storage.values);
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => !key.includes("home") && !key.includes("work"))).toBe(
      true
    );
  });

  it("wraps longitude when endpoints cross the international date line", () => {
    const midpoint = geographicEndpointMidpoint(
      { latitude: 10, longitude: 179 },
      { latitude: 12, longitude: -179 }
    );

    expect(midpoint.latitude).toBe(11);
    expect(Math.abs(midpoint.longitude)).toBe(180);
  });

  it("removes expired entries and treats cache writes as best-effort", async () => {
    const expiredKey = "openMeteo:v2:c:40.0000,-70.0000|c:41.0000,-71.0000";
    const storage = installSessionStorage({
      [expiredKey]: {
        expiresAt: Date.now() - 1,
        value: { risk: 99, conditionType: "THUNDERSTORM" }
      }
    });
    storage.set.mockRejectedValueOnce(new Error("quota"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ current: { weather_code: 0 } }))
    );

    const weather = await getEndpointMidpointWeather(
      { text: "Home", latitude: 40, longitude: -70 },
      { text: "Work", latitude: 41, longitude: -71 }
    );

    expect(weather?.conditionType).toBe("CLEAR");
    expect(storage.remove).toHaveBeenCalledWith(expiredKey);
  });

  it("applies one deadline to the complete lookup", async () => {
    vi.useFakeTimers();
    installSessionStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          })
      )
    );

    const pending = getEndpointMidpointWeather(
      { text: "Boston, MA" },
      { text: "Cambridge, MA" }
    );
    await vi.advanceTimersByTimeAsync(WEATHER_LOOKUP_DEADLINE_MS);
    await expect(pending).resolves.toBeNull();
  });
});
