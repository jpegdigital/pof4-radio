import type { PreparedWeather } from "../../../lib/prepared.ts";

const OBSERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const WEATHER_WORDS = { full: 60, hourly: 30, alerts: 15 } as const;

/** Freeze the forecast valid at generation, never the song clock or a retry's time. */
export function weatherReport(weather: PreparedWeather, at: string, opening: boolean) {
  const time = Date.parse(at);
  const hour = weather.hourly?.find((p) => Date.parse(p.startTime) <= time && time < Date.parse(p.endTime));
  const observed = Date.parse(weather.observedAt);
  const current =
    opening && observed <= time && time - observed <= OBSERVATION_MAX_AGE_MS
      ? { basis: "observation" as const, at: weather.observedAt, ...weather.now }
      : hour
        ? {
            basis: "forecast" as const,
            startTime: hour.startTime,
            endTime: hour.endTime,
            text: hour.short,
            tempF: hour.tempF,
            precipitationPercent: hour.precipitationPercent,
            windSpeed: hour.windSpeed,
            windDirection: hour.windDirection,
          }
        : null;
  const outlook = opening
    ? weather.periods
        .filter((p) => Date.parse(p.endTime) > time)
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
        .slice(0, 2)
    : [];
  const alerts = weather.alerts.filter(
    (a) => Date.parse(a.effective) <= time && time < Date.parse(a.expires),
  );
  if (!current && !outlook.length && !alerts.length) return null;
  return {
    mode: opening ? ("full" as const) : ("hourly" as const),
    city: weather.location.city,
    timeZone: weather.location.timeZone,
    at,
    current,
    outlook,
    alerts,
  };
}
export type WeatherReport = NonNullable<ReturnType<typeof weatherReport>>;
