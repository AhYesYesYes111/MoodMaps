import type { MapProvider } from "./types";

export function detectMapProvider(pageUrl: string): MapProvider {
  try {
    const hostname = new URL(pageUrl).hostname.toLocaleLowerCase();
    if (
      hostname === "maps.apple.com" ||
      hostname === "maps.apple.com.cn" ||
      hostname === "beta.maps.apple.com"
    ) {
      return "apple";
    }
    if (hostname === "waze.com" || hostname.endsWith(".waze.com")) {
      return "waze";
    }
    if (hostname === "amap.com" || hostname.endsWith(".amap.com")) {
      return "amap";
    }
    if (
      hostname === "maps.google.com" ||
      (hostname.endsWith(".google.com") &&
        new URL(pageUrl).pathname.startsWith("/maps"))
    ) {
      return "google";
    }
  } catch {
    // Invalid or incomplete URLs are treated as unsupported.
  }
  return "unknown";
}

export function mapProviderName(provider: MapProvider): string {
  if (provider === "apple") return "Apple Maps";
  if (provider === "waze") return "Waze";
  if (provider === "amap") return "Amap";
  if (provider === "google") return "Google Maps";
  return "supported map";
}

export function routeDataProviderLabel(provider: MapProvider): string {
  const name = mapProviderName(provider);
  return provider === "unknown"
    ? "Visible route details · local estimate"
    : "Visible " + name + " route details · local estimate";
}
