import { mapProviderName } from "./map-provider";
import type {
  MapProvider,
  MoodScoreComponentKey,
  RouteRecommendation,
  ScoreReason
} from "./types";

const MOOD_LABELS_ZH: Record<string, string> = {
  "Very Calm": "非常平静",
  Calm: "平静",
  Balanced: "均衡",
  Stressful: "压力较高",
  "Very Stressful": "压力很高"
};

const COMPONENT_LABELS_ZH: Record<MoodScoreComponentKey, string> = {
  traffic: "交通",
  delay: "延误",
  maneuver: "复杂度",
  duration: "时长",
  weather: "天气"
};

const ROLE_LABELS_ZH: Record<RouteRecommendation, string> = {
  Fastest: "最快路线",
  Balanced: "均衡选择",
  Calmest: "最平静路线"
};

export type UiLanguage = "en" | "zh-CN";

export const UI_LANGUAGE_STORAGE_KEY = "moodmapsUiLanguage";

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh-CN";
}

export function defaultUiLanguage(provider: MapProvider): UiLanguage {
  return provider === "amap" ? "zh-CN" : "en";
}

export function usesChineseUi(language: UiLanguage): boolean {
  return language === "zh-CN";
}

export function localizedProviderName(
  provider: MapProvider,
  language: UiLanguage
): string {
  if (!usesChineseUi(language)) return mapProviderName(provider);
  if (provider === "google") return "Google 地图";
  if (provider === "apple") return "Apple 地图";
  if (provider === "waze") return "Waze";
  if (provider === "amap") return "高德地图";
  return "当前地图";
}

export function localizedMoodLabel(
  label: string,
  language: UiLanguage
): string {
  return usesChineseUi(language) ? MOOD_LABELS_ZH[label] ?? label : label;
}

export function localizedComponentLabel(
  key: MoodScoreComponentKey,
  fallback: string,
  language: UiLanguage
): string {
  return usesChineseUi(language) ? COMPONENT_LABELS_ZH[key] : fallback;
}

export function localizedRoleLabel(
  roles: RouteRecommendation[],
  language: UiLanguage
): string {
  const orderedRoles = (
    ["Fastest", "Balanced", "Calmest"] as const
  ).filter((role) => roles.includes(role));
  if (orderedRoles.length === 0) {
    return usesChineseUi(language) ? "路线选项" : "Route option";
  }
  return orderedRoles
    .map((role) =>
      usesChineseUi(language)
        ? ROLE_LABELS_ZH[role]
        : role === "Balanced"
          ? "Balanced choice"
          : role === "Calmest"
            ? "Calmest option"
            : "Fastest option"
    )
    .join(" · ");
}

export function localizedScoreReason(
  reason: ScoreReason,
  language: UiLanguage
): string {
  return usesChineseUi(language) ? reason.messageZh : reason.message;
}
