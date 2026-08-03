// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  detectTravelMode,
  extractAmapFromDom,
  extractAmapFromUrl,
  extractAppleFromDom,
  extractAppleFromUrl,
  extractFromDom,
  extractFromUrl,
  extractRouteContext,
  extractWazeFromDom,
  extractWazeFromUrl
} from "./route-extractor";

describe("Google Maps route extraction", () => {
  it("extracts encoded English places from a directions URL", () => {
    const result = extractFromUrl(
      "https://www.google.com/maps/dir/Boston+South+Station/Yale+University/@41,-72,8z/data=!4m2"
    );
    expect(result.origin?.text).toBe("Boston South Station");
    expect(result.destination?.text).toBe("Yale University");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("extracts international text", () => {
    const result = extractFromUrl(
      "https://www.google.com/maps/dir/%E6%B3%A2%E5%A3%AB%E9%A1%BF/%E7%BA%BD%E7%BA%A6/"
    );
    expect(result.origin?.text).toBe("波士顿");
    expect(result.destination?.text).toBe("纽约");
  });

  it("uses endpoint coordinates already present in a Google Maps URL", () => {
    const result = extractFromUrl(
      "https://www.google.com/maps/dir/New+York/Boston/data=!1d-74.00597!2d40.71427!1d-71.0589!2d42.3601"
    );
    expect(result.origin).toMatchObject({
      text: "New York",
      latitude: 40.71427,
      longitude: -74.00597
    });
    expect(result.destination).toMatchObject({
      text: "Boston",
      latitude: 42.3601,
      longitude: -71.0589
    });
  });

  it("preserves an empty URL slot instead of treating the destination as the origin", () => {
    const result = extractFromUrl(
      "https://www.google.com/maps/dir//Yale+University/data=!4m2"
    );
    expect(result.origin).toBeNull();
    expect(result.destination?.text).toBe("Yale University");
  });

  it("fails conservatively outside directions pages", () => {
    const result = extractFromUrl("https://www.google.com/maps/search/coffee");
    expect(result.origin).toBeNull();
    expect(result.destination).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("uses semantic DOM labels as a fallback", () => {
    document.body.innerHTML =
      '<input aria-label="Choose starting point" value="Cambridge, MA">' +
      '<input aria-label="Choose destination" value="Providence, RI">';
    const result = extractFromDom(document);
    expect(result.origin?.text).toBe("Cambridge, MA");
    expect(result.destination?.text).toBe("Providence, RI");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("does not analyze explicitly non-driving directions", () => {
    expect(
      detectTravelMode(
        "https://www.google.com/maps/dir/Boston/Yale/data=!4m2!3e2",
        document
      )
    ).toBe("UNKNOWN");
    expect(
      detectTravelMode(
        "https://www.google.com/maps/dir/Boston/Yale/data=!4m2!3e0",
        document
      )
    ).toBe("DRIVE");
  });
});

describe("Apple Maps route extraction", () => {
  it("extracts the route endpoints and driving mode from the web URL", () => {
    const url =
      "https://maps.apple.com/directions?source=Penn+Station%2C+New+York%2C+NY&destination=Yale+University%2C+New+Haven%2C+CT&mode=driving";
    const result = extractAppleFromUrl(url);
    expect(result.origin?.text).toBe("Penn Station, New York, NY");
    expect(result.destination?.text).toBe(
      "Yale University, New Haven, CT"
    );
    expect(detectTravelMode(url, document)).toBe("DRIVE");
  });

  it("uses Apple Maps From and To fields as a fallback", () => {
    document.body.innerHTML =
      '<input role="combobox" placeholder="From" value="Penn Station">' +
      '<input role="combobox" placeholder="To" value="Yale University">';
    const result = extractAppleFromDom(document);
    expect(result.origin?.text).toBe("Penn Station");
    expect(result.destination?.text).toBe("Yale University");
  });

  it("uses localized Apple Maps endpoint fields", () => {
    document.body.innerHTML =
      '<input role="combobox" placeholder="起点" value="北京南站">' +
      '<input role="combobox" placeholder="终点" value="清华大学">';
    const result = extractAppleFromDom(document);
    expect(result.origin?.text).toBe("北京南站");
    expect(result.destination?.text).toBe("清华大学");
  });
});

describe("Waze route extraction", () => {
  it("reads selected Waze route endpoints from the route form", () => {
    document.body.innerHTML =
      '<div class="wm-search is-read-only"><div class="wm-search__selected">' +
      '<span class="wm-search__primary">Penn Station</span>' +
      '<span class="wm-search__secondary">New York, NY</span></div></div>' +
      '<div class="wm-search is-read-only"><div class="wm-search__selected">' +
      '<span class="wm-search__primary">Yale University</span>' +
      '<span class="wm-search__secondary">New Haven, CT</span></div></div>';
    const result = extractWazeFromDom(document);
    expect(result.origin?.text).toBe("Penn Station, New York, NY");
    expect(result.destination?.text).toBe(
      "Yale University, New Haven, CT"
    );
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("uses coordinate deep links when Waze exposes them", () => {
    const result = extractWazeFromUrl(
      "https://www.waze.com/live-map/directions?from=ll.40.7506%2C-73.9935&to=ll.41.3163%2C-72.9244"
    );
    expect(result.origin).toMatchObject({
      latitude: 40.7506,
      longitude: -73.9935
    });
    expect(result.destination).toMatchObject({
      latitude: 41.3163,
      longitude: -72.9244
    });
  });

  it("marks Waze Live Map directions as driving routes", () => {
    const context = extractRouteContext(
      "https://www.waze.com/live-map/directions",
      document
    );
    expect(context.provider).toBe("waze");
    expect(context.travelMode).toBe("DRIVE");
  });
});

describe("Amap route extraction", () => {
  it("reads named endpoints and coordinates from a driving-route URL", () => {
    const url =
      "https://amap.com/dir?from%5Bname%5D=%E5%8C%97%E4%BA%AC%E5%8D%97%E7%AB%99&" +
      "from%5Blnglat%5D=116.378517%2C39.865246&" +
      "to%5Bname%5D=%E6%B8%85%E5%8D%8E%E5%A4%A7%E5%AD%A6&" +
      "to%5Blnglat%5D=116.326936%2C40.003213&type=car&policy=1";
    const result = extractAmapFromUrl(url);
    expect(result.origin).toMatchObject({
      text: "北京南站",
      latitude: 39.865246,
      longitude: 116.378517
    });
    expect(result.destination).toMatchObject({
      text: "清华大学",
      latitude: 40.003213,
      longitude: 116.326936
    });
    expect(result.confidence).toBeGreaterThan(0.95);
    expect(detectTravelMode(url, document)).toBe("DRIVE");
  });

  it("uses the visible Amap route fields while the URL is still updating", () => {
    document.body.innerHTML =
      '<input id="dir_from_ipt" placeholder="请输入起点" value="北京南站">' +
      '<input id="dir_to_ipt" placeholder="请输入终点" value="清华大学">';
    const result = extractAmapFromDom(document);
    expect(result.origin?.text).toBe("北京南站");
    expect(result.destination?.text).toBe("清华大学");

    const context = extractRouteContext(
      "https://ditu.amap.com/dir?type=car",
      document
    );
    expect(context.provider).toBe("amap");
    expect(context.travelMode).toBe("DRIVE");
  });

  it("does not treat Amap transit directions as driving", () => {
    expect(
      detectTravelMode("https://amap.com/dir?type=bus", document)
    ).toBe("UNKNOWN");
  });

  it("does not assume an unspecified Amap direction mode is driving", () => {
    expect(detectTravelMode("https://amap.com/dir", document)).toBe("UNKNOWN");
  });
});

describe("conservative travel-mode detection", () => {
  it("does not treat an unrecognized localized mode as driving", () => {
    document.body.innerHTML =
      '<button aria-pressed="true" aria-label="Zu Fuß"></button>';
    expect(
      detectTravelMode(
        "https://www.google.com/maps/dir/Berlin/Potsdam",
        document
      )
    ).toBe("UNKNOWN");
  });
});
