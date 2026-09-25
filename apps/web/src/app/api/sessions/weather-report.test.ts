import { describe, expect, it } from "vitest";
import type { PreparedWeather } from "../../../lib/prepared";
import { weatherReport } from "./weather-report";
const at = "2026-09-24T05:30:00Z"; // 00:30 in Dallas
const period = {
  name: "Tonight",
  isDaytime: false,
  startTime: "2026-09-24T00:00:00Z",
  endTime: "2026-09-24T12:00:00Z",
  tempF: 70,
  short: "Cloudy",
  detailed: "Cloudy overnight.",
  precipitationPercent: 10,
  windSpeed: "5 mph",
  windDirection: "S",
};
const weather: PreparedWeather = {
  location: {
    city: "Dallas",
    zip: "75229",
    timeZone: "America/Chicago",
    station: "KDAL",
    grid: "FWD/87,109",
  },
  sources: {
    observation: "https://example.com/o",
    forecast: "https://example.com/f",
    alerts: "https://example.com/a",
  },
  units: { temperature: "F", wind: "mph", precipitation: "percent" },
  observedAt: "2026-09-24T05:00:00Z",
  forecastUpdatedAt: "2026-09-24T04:00:00Z",
  now: { text: "Clear", tempF: 80, feelsLikeF: 81, humidity: 50, windMph: 5 },
  periods: [
    period,
    {
      ...period,
      name: "Thursday",
      isDaytime: true,
      startTime: "2026-09-24T12:00:00Z",
      endTime: "2026-09-25T00:00:00Z",
      tempF: 92,
    },
  ],
  hourly: [
    { ...period, startTime: "2026-09-24T00:00:00-05:00", endTime: "2026-09-24T01:00:00-05:00", tempF: 78 },
    { ...period, startTime: "2026-09-24T01:00:00-05:00", endTime: "2026-09-24T02:00:00-05:00", tempF: 76 },
  ],
  alerts: [],
};
describe("weather at slot generation", () => {
  it("gives the opening fresh conditions and the current/next outlook", () => {
    const report = weatherReport(weather, at, true)!;
    expect(report.mode).toBe("full");
    expect(report.current).toMatchObject({ basis: "observation", tempF: 80 });
    expect(report.outlook.map((p) => p.name)).toEqual(["Tonight", "Thursday"]);
  });
  it.each([
    ["2026-09-24T05:30:00Z", 78],
    ["2026-09-24T06:00:00Z", 76],
  ])("selects the containing hour at %s, including midnight and exact boundaries", (time, tempF) => {
    const report = weatherReport(weather, time, false)!;
    expect(report.mode).toBe("hourly");
    expect(report.at).toBe(time);
    expect(report.current).toMatchObject({ basis: "forecast", tempF });
    expect(report.outlook).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("92");
  });
  it("does not substitute an old observation or a daily high when the hour is missing", () => {
    expect(weatherReport({ ...weather, hourly: [] }, at, false)).toBeNull();
    expect(weatherReport(weather, "2026-09-24T07:00:00Z", false)).toBeNull();
  });
  it("uses hourly conditions in the opening when the observation is stale", () => {
    expect(
      weatherReport({ ...weather, observedAt: "2026-09-23T23:00:00Z" }, at, true)?.current,
    ).toMatchObject({ basis: "forecast", tempF: 78 });
  });
  it("includes only alerts active at the generation instant", () => {
    const alert = {
      id: "a",
      event: "Heat Advisory",
      headline: null,
      severity: "Moderate",
      description: "Hot",
      instruction: null,
      effective: "2026-09-24T05:00:00Z",
      expires: "2026-09-24T06:00:00Z",
    };
    const data = {
      ...weather,
      alerts: [
        alert,
        { ...alert, id: "old", expires: at },
        { ...alert, id: "future", effective: "2026-09-24T06:00:00Z" },
      ],
    };
    expect(weatherReport(data, at, false)?.alerts.map((a) => a.id)).toEqual(["a"]);
  });
});
