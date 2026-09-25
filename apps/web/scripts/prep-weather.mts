import { z } from "zod";
import { readWeather, WEATHER_PLACE, WEATHER_URLS } from "../src/app/api/sessions/weather.ts";
import { PreparedWeather, WEATHER_VALID_MS, PREP_AIR_MARGIN_MS } from "../src/lib/prepared.ts";

const OBSERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FORECAST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const ALERTS_URL = "https://api.weather.gov/alerts/active?point=32.90,-96.86";
const Iso = z.iso.datetime({ offset: true });
const measurement = (unit: string) => z.object({ value: z.number().nullable(), unitCode: z.literal(unit) });
const Observation = z.object({
  properties: z.object({
    timestamp: Iso,
    textDescription: z.string(),
    temperature: measurement("wmoUnit:degC"),
    heatIndex: measurement("wmoUnit:degC"),
    windChill: measurement("wmoUnit:degC"),
    relativeHumidity: measurement("wmoUnit:percent"),
    windSpeed: measurement("wmoUnit:km_h-1"),
  }),
});
const Forecast = z.object({
  properties: z.object({
    updateTime: Iso,
    periods: z.array(
      z.object({
        name: z.string(),
        isDaytime: z.boolean(),
        startTime: Iso,
        endTime: Iso,
        temperature: z.number(),
        temperatureUnit: z.literal("F"),
        shortForecast: z.string(),
        detailedForecast: z.string(),
        probabilityOfPrecipitation: measurement("wmoUnit:percent"),
        windSpeed: z.string(),
        windDirection: z.string(),
      }),
    ),
  }),
});
const Alerts = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        id: z.string(),
        event: z.string(),
        headline: z.string().nullable(),
        severity: z.string(),
        effective: Iso,
        expires: Iso,
        description: z.string(),
        instruction: z.string().nullable(),
      }),
    }),
  ),
});

export function prepareWeatherData(
  observation: unknown,
  forecast: unknown,
  alerts: unknown,
  now: number,
  hourly: unknown,
) {
  const o = Observation.parse(observation);
  const f = Forecast.parse(forecast);
  const a = Alerts.parse(alerts);
  const h = Forecast.parse(hourly);
  const hourlyUpdated = Date.parse(h.properties.updateTime);
  const observed = Date.parse(o.properties.timestamp);
  const updated = Date.parse(f.properties.updateTime);
  if (
    observed > now + FUTURE_TOLERANCE_MS ||
    updated > now + FUTURE_TOLERANCE_MS ||
    hourlyUpdated > now + FUTURE_TOLERANCE_MS
  )
    throw new Error("NWS timestamps are in the future");
  const periods = f.properties.periods.filter(
    (p) => Date.parse(p.endTime) > now && Date.parse(p.startTime) < Date.parse(p.endTime),
  );
  if (!periods.length || !periods.some((p) => Date.parse(p.startTime) <= now))
    throw new Error("NWS forecast does not cover the current time");
  const hours = h.properties.periods.filter(
    (p) => Date.parse(p.endTime) > now && Date.parse(p.startTime) < Date.parse(p.endTime),
  );
  if (!hours.some((p) => Date.parse(p.startTime) <= now))
    throw new Error("NWS hourly forecast does not cover the current time");
  const expires = Math.min(
    now + WEATHER_VALID_MS,
    observed + OBSERVATION_MAX_AGE_MS,
    updated + FORECAST_MAX_AGE_MS,
    hourlyUpdated + FORECAST_MAX_AGE_MS,
  );
  if (expires <= now + PREP_AIR_MARGIN_MS) throw new Error("NWS observation or forecast is stale");
  const normalized = readWeather(o, { properties: { ...f.properties, periods } });
  const weather = PreparedWeather.parse({
    ...normalized,
    location: WEATHER_PLACE,
    sources: { ...WEATHER_URLS, alerts: ALERTS_URL },
    units: { temperature: "F", wind: "mph", precipitation: "percent" },
    forecastUpdatedAt: f.properties.updateTime,
    hourlyUpdatedAt: h.properties.updateTime,
    hourly: hours.slice(0, 48).map((p) => ({
      name: p.name,
      isDaytime: p.isDaytime,
      startTime: p.startTime,
      endTime: p.endTime,
      tempF: p.temperature,
      short: p.shortForecast,
      detailed: p.detailedForecast,
      precipitationPercent: p.probabilityOfPrecipitation.value,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
    })),
    periods: periods.slice(0, 4).map((p) => ({
      name: p.name,
      isDaytime: p.isDaytime,
      startTime: p.startTime,
      endTime: p.endTime,
      tempF: p.temperature,
      short: p.shortForecast,
      detailed: p.detailedForecast,
      precipitationPercent: p.probabilityOfPrecipitation.value,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
    })),
    alerts: a.features.map((a) => a.properties).filter((a) => Date.parse(a.expires) > now),
  });
  return { weather, expiresAt: new Date(expires).toISOString() };
}

export async function prepareWeather(signal: AbortSignal) {
  const responses = await Promise.all(
    [WEATHER_URLS.observation, WEATHER_URLS.forecast, ALERTS_URL, WEATHER_URLS.hourly].map(async (url) => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "pof4-radio (jpegdigital@users.noreply.github.com)",
          Accept: "application/geo+json",
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error(`NWS HTTP ${response.status} ${url}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`NWS empty body ${url}`);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 2_000_000) throw new Error(`NWS response too large ${url}`);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    }),
  );
  const [observation, forecast, alerts, hourly] = responses;
  return {
    ...prepareWeatherData(observation, forecast, alerts, Date.now(), hourly),
    evidence: { observation, forecast, alerts, hourly },
  };
}
