import { readWeather, type Weather } from "@radio/dj";

/**
 * The weather pull: two National Weather Service calls — no key, no package, plain fetch with
 * the User-Agent NWS asks for — cached for ten minutes so every slot of a show reads one pull.
 * The place is fixed: ZIP 75229, northwest Dallas. Its grid and nearest station were resolved
 * once from `GET /points/32.90,-96.86` and baked in; the grid never moves.
 */

export const WEATHER_PLACE = {
  zip: "75229",
  city: "Dallas",
  timeZone: "America/Chicago",
  /** Fort Worth forecast office, grid cell 87,109. */
  grid: "FWD/87,109",
  /** Dallas Love Field. */
  station: "KDAL",
} as const;

const NWS = "https://api.weather.gov";
export const WEATHER_URLS = {
  observation: `${NWS}/stations/${WEATHER_PLACE.station}/observations/latest`,
  forecast: `${NWS}/gridpoints/${WEATHER_PLACE.grid}/forecast`,
} as const;

/** NWS refuses anonymous callers: an app name and a way to reach whoever runs it. */
const USER_AGENT = "pof4-radio (jpegdigital@users.noreply.github.com)";
export const WEATHER_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;

let cached: { at: number; weather: Weather } | null = null;

async function pull(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`nws ${res.status} ${url}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json();
}

/** The weather now, from the cache inside its window, else pulled fresh. A failed pull throws. */
export async function fetchWeather(opts: { fetchFn?: typeof fetch; now?: number } = {}): Promise<Weather> {
  const now = opts.now ?? Date.now();
  if (cached && now - cached.at < WEATHER_TTL_MS) return cached.weather;
  const fetchFn = opts.fetchFn ?? fetch;
  const [observation, forecast] = await Promise.all([
    pull(WEATHER_URLS.observation, fetchFn),
    pull(WEATHER_URLS.forecast, fetchFn),
  ]);
  const weather = readWeather(observation, forecast);
  cached = { at: now, weather };
  return weather;
}
