/**
 * `node apps/web/scripts/weather-smoke.mts` — the real pull from api.weather.gov for 75229, no
 * env needed: the observation and the forecast as the producer reads them, then the text the
 * brief would carry. Proves the User-Agent, the URLs and the shapes against the live feeds.
 */
import { weatherText } from "@radio/dj";
import { fetchWeather, WEATHER_PLACE, WEATHER_URLS } from "../src/lib/producer/weather.ts";

console.log(
  `${WEATHER_PLACE.city} ${WEATHER_PLACE.zip} — ${WEATHER_URLS.observation}\n${" ".repeat(WEATHER_PLACE.city.length + WEATHER_PLACE.zip.length + 4)}${WEATHER_URLS.forecast}\n`,
);
const t = Date.now();
const w = await fetchWeather();
console.log(`pulled in ${Date.now() - t} ms\n`);
console.log(JSON.stringify(w, null, 2));
console.log(`\n--- as the brief carries it ---\n${weatherText(w, WEATHER_PLACE.timeZone)}`);
const again = Date.now();
await fetchWeather();
console.log(`\ncached: second call ${Date.now() - again} ms`);
