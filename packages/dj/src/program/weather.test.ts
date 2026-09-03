import { describe, expect, it } from "vitest";
import { readWeather, type Weather, weatherText } from "./weather.ts";

/** The slice of the two NWS feeds we read, as recorded from api.weather.gov on 2026-09-03. */
const quantity = (value: number | null) => ({ unitCode: "wmoUnit:x", value, qualityControl: "V" });
const observation = (over: Record<string, unknown> = {}) => ({
  properties: {
    timestamp: "2026-09-03T12:20:00+00:00",
    textDescription: "Cloudy",
    temperature: quantity(27),
    relativeHumidity: quantity(78.78),
    windSpeed: quantity(14.832),
    heatIndex: quantity(29.63),
    windChill: quantity(null),
    ...over,
  },
});
const period = (name: string, temperature: number, isDaytime: boolean, short: string, detailed: string) => ({
  name,
  isDaytime,
  temperature,
  temperatureUnit: "F",
  shortForecast: short,
  detailedForecast: detailed,
});
const forecast = (periods = 5) => ({
  properties: {
    updateTime: "2026-09-03T11:06:38+00:00",
    periods: [
      period("Today", 93, true, "Chance Showers And Thunderstorms", "Partly sunny. High near 93."),
      period("Tonight", 76, false, "Slight Chance Showers", "Mostly cloudy. Low around 76."),
      period("Friday", 96, true, "Mostly Sunny", "Mostly sunny, with a high near 96."),
      period("Friday Night", 77, false, "Mostly Clear", "Mostly clear, with a low around 77."),
      period("Saturday", 97, true, "Sunny", "Sunny, with a high near 97."),
    ].slice(0, periods),
  },
});

describe("readWeather", () => {
  it("rounds the observation to whole °F and mph and keeps today and tonight", () => {
    expect(readWeather(observation(), forecast())).toEqual<Weather>({
      observedAt: "2026-09-03T12:20:00+00:00",
      now: { text: "Cloudy", tempF: 81, feelsLikeF: 85, humidity: 79, windMph: 9 },
      periods: [
        {
          name: "Today",
          isDaytime: true,
          tempF: 93,
          short: "Chance Showers And Thunderstorms",
          detailed: "Partly sunny. High near 93.",
        },
        {
          name: "Tonight",
          isDaytime: false,
          tempF: 76,
          short: "Slight Chance Showers",
          detailed: "Mostly cloudy. Low around 76.",
        },
      ],
    });
  });
  it.each([
    ["a null temperature (a station gap) is null, not 32", { temperature: quantity(null) }, { tempF: null }],
    [
      "wind chill stands in for the heat index in winter",
      { heatIndex: quantity(null), windChill: quantity(-5) },
      { feelsLikeF: 23 },
    ],
    [
      "neither heat index nor wind chill → feels like nothing",
      { heatIndex: quantity(null) },
      { feelsLikeF: null },
    ],
    ["a calm station reports 0 mph", { windSpeed: quantity(0) }, { windMph: 0 }],
  ])("%s", (_, over, want) => {
    expect(readWeather(observation(over), forecast()).now).toMatchObject(want);
  });
  it("fewer than two periods is fine", () => {
    expect(readWeather(observation(), forecast(1)).periods).toHaveLength(1);
  });
  it.each([
    ["an observation without properties", {}, forecast()],
    [
      "a forecast whose period lacks its prose",
      observation(),
      { properties: { updateTime: "x", periods: [{ name: "Today" }] } },
    ],
    ["not JSON objects at all", "cloudy", null],
  ])("%s is refused, loudly", (_, obs, fc) => {
    expect(() => readWeather(obs, fc)).toThrow();
  });
});

describe("weatherText", () => {
  it("says now in the place's local time, then each period as NWS wrote it", () => {
    const w = readWeather(observation(), forecast(2));
    expect(weatherText(w, "America/Chicago")).toBe(
      [
        "Now (7:20 AM): Cloudy, 81°F, feels like 85, humidity 79%, wind 9 mph.",
        "Today: Chance Showers And Thunderstorms, high near 93. Partly sunny. High near 93.",
        "Tonight: Slight Chance Showers, low around 76. Mostly cloudy. Low around 76.",
      ].join("\n"),
    );
  });
  it("leaves out what the station did not report", () => {
    const gap = readWeather(
      observation({ temperature: quantity(null), heatIndex: quantity(null), windSpeed: quantity(null) }),
      forecast(0),
    );
    expect(weatherText(gap, "America/Chicago")).toBe("Now (7:20 AM): Cloudy, humidity 79%.");
  });
});
