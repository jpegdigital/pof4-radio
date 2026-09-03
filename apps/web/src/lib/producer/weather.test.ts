import { describe, expect, it } from "vitest";
import forecast from "./weather.fixtures/forecast.json";
import observation from "./weather.fixtures/observation.json";
import { fetchWeather, WEATHER_TTL_MS, WEATHER_URLS } from "./weather";

/**
 * The pull against recorded NWS responses (weather.fixtures/, as api.weather.gov answered on
 * 2026-09-03): the two URLs, the User-Agent NWS insists on, the shape out, the cache and a
 * failure. The live pull is scripts/weather-smoke.mts.
 */

/** A clock of our own, far from now, so the module cache starts cold in each window used below. */
const T0 = Date.UTC(2030, 0, 1);

type Call = { url: string; headers: Record<string, string> };
const fetchOf = (status = 200) => {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (status !== 200) return Promise.resolve(new Response("Service Unavailable", { status }));
    const body =
      url === WEATHER_URLS.observation ? observation : url === WEATHER_URLS.forecast ? forecast : null;
    if (!body) return Promise.resolve(new Response("Not Found", { status: 404 }));
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  return { calls, fetchFn };
};

describe("fetchWeather", () => {
  it("pulls the observation and the forecast with the User-Agent NWS asks for", async () => {
    const { calls, fetchFn } = fetchOf();
    const w = await fetchWeather({ fetchFn, now: T0 });
    expect(calls.map((c) => c.url).sort()).toEqual([WEATHER_URLS.forecast, WEATHER_URLS.observation].sort());
    for (const c of calls) {
      expect(c.headers["user-agent"]).toMatch(/^pof4-radio \(.+@.+\)$/);
      expect(c.headers.accept).toBe("application/geo+json");
    }
    expect(w.now).toEqual({ text: "Cloudy", tempF: 81, feelsLikeF: 85, humidity: 79, windMph: 9 });
    expect(w.periods.map((p) => p.name)).toEqual(["Today", "Tonight"]);
    expect(w.periods[0].detailed).toMatch(/^A slight chance of rain showers before 10am/);
  });
  it("answers from the cache inside the window and pulls again after it", async () => {
    const { calls, fetchFn } = fetchOf();
    await fetchWeather({ fetchFn, now: T0 + 1 });
    await fetchWeather({ fetchFn, now: T0 + WEATHER_TTL_MS - 1 });
    expect(calls).toHaveLength(0);
    await fetchWeather({ fetchFn, now: T0 + WEATHER_TTL_MS + 1 });
    expect(calls).toHaveLength(2);
  });
  it("a failed pull is an error naming the status and the URL, not a silent blank", async () => {
    const { fetchFn } = fetchOf(503);
    await expect(fetchWeather({ fetchFn, now: T0 + 2 * WEATHER_TTL_MS + 1 })).rejects.toThrow(
      /nws 503 https:\/\/api\.weather\.gov\//,
    );
  });
});
