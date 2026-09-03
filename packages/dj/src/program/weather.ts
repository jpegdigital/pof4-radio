import { z } from "zod";

/**
 * The weather as the station reads it, cut from two National Weather Service feeds
 * (api.weather.gov): the latest observation at the nearest station and the 12-hour forecast
 * periods for the grid. Pure — the pull lives in apps/web (lib/producer/weather.ts); this file
 * reads the JSON and rounds it to what a DJ would say: whole °F and mph, because that is what is
 * said on air, and the forecast prose exactly as NWS wrote it.
 */

/** How many forecast periods the brief carries: today and tonight (after dark, tonight and tomorrow). */
export const WEATHER_PERIODS = 2;

/** An NWS measurement: SI, with a null when the station did not report it. */
const Quantity = z.object({ value: z.number().nullable() });

/** `GET /stations/:id/observations/latest`, the part we read. */
export const Observation = z.object({
  properties: z.object({
    timestamp: z.string(),
    textDescription: z.string(),
    temperature: Quantity,
    relativeHumidity: Quantity,
    windSpeed: Quantity,
    heatIndex: Quantity,
    windChill: Quantity,
  }),
});

/** `GET /gridpoints/:grid/forecast`, the part we read. */
export const Forecast = z.object({
  properties: z.object({
    updateTime: z.string(),
    periods: z.array(
      z.object({
        name: z.string(),
        isDaytime: z.boolean(),
        temperature: z.number(),
        temperatureUnit: z.string(),
        shortForecast: z.string(),
        detailedForecast: z.string(),
      }),
    ),
  }),
});

export interface Period {
  /** As NWS names it: "Today", "Tonight", "Friday", "Friday Night". */
  name: string;
  isDaytime: boolean;
  /** The high by day, the low by night. */
  tempF: number;
  /** "Chance Showers And Thunderstorms". */
  short: string;
  /** A sentence or two, ready to read. */
  detailed: string;
}

export interface Weather {
  /** When the observation was taken, ISO. */
  observedAt: string;
  /** At the station now; a null is a value the station did not report. */
  now: {
    text: string;
    tempF: number | null;
    /** The heat index in summer, the wind chill in winter, else nothing. */
    feelsLikeF: number | null;
    humidity: number | null;
    windMph: number | null;
  };
  /** The next periods, in order. */
  periods: Period[];
}

const fahrenheit = (c: number | null) => (c === null ? null : Math.round((c * 9) / 5 + 32));
const mph = (kmh: number | null) => (kmh === null ? null : Math.round(kmh / 1.609344));
const whole = (n: number | null) => (n === null ? null : Math.round(n));

/** The two feeds, as fetched, to the weather; anything not shaped as NWS ships it throws. */
export function readWeather(observation: unknown, forecast: unknown): Weather {
  const o = Observation.parse(observation).properties;
  const f = Forecast.parse(forecast).properties;
  return {
    observedAt: o.timestamp,
    now: {
      text: o.textDescription,
      tempF: fahrenheit(o.temperature.value),
      feelsLikeF: fahrenheit(o.heatIndex.value ?? o.windChill.value),
      humidity: whole(o.relativeHumidity.value),
      windMph: mph(o.windSpeed.value),
    },
    periods: f.periods.slice(0, WEATHER_PERIODS).map((p) => ({
      name: p.name,
      isDaytime: p.isDaytime,
      tempF: p.temperature,
      short: p.shortForecast,
      detailed: p.detailedForecast,
    })),
  };
}

/** The weather as the brief carries it: one line for now, one per period. */
export function weatherText(w: Weather, timeZone: string): string {
  const at = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(w.observedAt),
  );
  const facts = [
    w.now.text,
    w.now.tempF === null ? null : `${w.now.tempF}°F`,
    w.now.feelsLikeF === null ? null : `feels like ${w.now.feelsLikeF}`,
    w.now.humidity === null ? null : `humidity ${w.now.humidity}%`,
    w.now.windMph === null ? null : `wind ${w.now.windMph} mph`,
  ].filter((s): s is string => s !== null);
  const now = `Now (${at}): ${facts.join(", ")}.`;
  const periods = w.periods.map(
    (p) =>
      `${p.name}: ${p.short}, ${p.isDaytime ? "high" : "low"} ${p.isDaytime ? "near" : "around"} ${p.tempF}. ${p.detailed}`,
  );
  return [now, ...periods].join("\n");
}
