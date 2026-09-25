import { describe, expect, it } from "vitest";
import { prepareWeatherData } from "./prep-weather.mts";

const now = Date.parse("2026-09-19T15:00:00Z");
const quantity = (value: number | null, unitCode: string) => ({ value, unitCode });
const observation = {
  properties: {
    timestamp: "2026-09-19T14:45:00Z",
    textDescription: "Clear",
    temperature: quantity(30, "wmoUnit:degC"),
    heatIndex: quantity(null, "wmoUnit:degC"),
    windChill: quantity(null, "wmoUnit:degC"),
    relativeHumidity: quantity(50, "wmoUnit:percent"),
    windSpeed: quantity(16, "wmoUnit:km_h-1"),
  },
};
const forecast = {
  properties: {
    updateTime: "2026-09-19T14:00:00Z",
    periods: [
      {
        name: "Today",
        isDaytime: true,
        startTime: "2026-09-19T12:00:00Z",
        endTime: "2026-09-20T00:00:00Z",
        temperature: 92,
        temperatureUnit: "F",
        shortForecast: "Sunny",
        detailedForecast: "Sunny. High near 92.",
        probabilityOfPrecipitation: quantity(10, "wmoUnit:percent"),
        windSpeed: "5 to 10 mph",
        windDirection: "S",
      },
    ],
  },
};
const hourly = {
  properties: {
    ...forecast.properties,
    periods: [
      {
        ...forecast.properties.periods[0],
        name: "",
        startTime: "2026-09-19T15:00:00Z",
        endTime: "2026-09-19T16:00:00Z",
        temperature: 87,
      },
    ],
  },
};
const alerts = { features: [] };

describe("scheduled weather", () => {
  it("keeps observation and forecast times, units, precipitation and attribution", () => {
    const result = prepareWeatherData(observation, forecast, alerts, now, hourly);
    expect(result.weather.hourly?.[0]).toMatchObject({ startTime: "2026-09-19T15:00:00Z", tempF: 87 });
    expect(result.weather.hourlyUpdatedAt).toBe(hourly.properties.updateTime);
    expect(result.weather.now.tempF).toBe(86);
    expect(result.weather.now.windMph).toBe(10);
    expect(result.weather.periods[0].precipitationPercent).toBe(10);
    expect(result.weather.observedAt).toBe(observation.properties.timestamp);
    expect(result.weather.forecastUpdatedAt).toBe(forecast.properties.updateTime);
    expect(result.weather.alerts).toEqual([]);
    expect(result.expiresAt).toBe(new Date(now + 3_600_000).toISOString());
  });
  it.each([
    [
      "stale observation",
      { ...observation, properties: { ...observation.properties, timestamp: "2026-09-19T10:00:00Z" } },
      forecast,
      alerts,
    ],
    [
      "wrong units",
      { properties: { ...observation.properties, temperature: quantity(86, "wmoUnit:degF") } },
      forecast,
      alerts,
    ],
    [
      "stale forecast",
      observation,
      { properties: { ...forecast.properties, updateTime: "2026-09-17T14:00:00Z" } },
      alerts,
    ],
    ["no forecast", observation, { properties: { ...forecast.properties, periods: [] } }, alerts],
    ["missing alerts", observation, forecast, {}],
  ])("refuses %s without publishing a replacement", (_, o, f, a) => {
    expect(() => prepareWeatherData(o, f, a, now, hourly)).toThrow();
  });
  it.each([
    ["missing hours", { ...hourly, properties: { ...hourly.properties, periods: [] } }],
    [
      "stale hourly forecast",
      { ...hourly, properties: { ...hourly.properties, updateTime: "2026-09-17T14:00:00Z" } },
    ],
    [
      "future hourly forecast",
      { ...hourly, properties: { ...hourly.properties, updateTime: "2026-09-19T16:00:00Z" } },
    ],
  ])("refuses %s", (_, give) => {
    expect(() => prepareWeatherData(observation, forecast, alerts, now, give)).toThrow();
  });
  it("caps freshness by the observation time, not just when the job ran", () => {
    const old = { properties: { ...observation.properties, timestamp: "2026-09-19T13:30:00Z" } };
    expect(prepareWeatherData(old, forecast, alerts, now, hourly).expiresAt).toBe("2026-09-19T15:30:00.000Z");
  });
});
