/** Live NWS validation through the scheduled worker's only fetch path. */
import { prepareWeather } from "./prep-weather.mts";
const result = await prepareWeather(AbortSignal.timeout(30_000));
console.log(JSON.stringify({ weather: result.weather, expiresAt: result.expiresAt }, null, 2));
