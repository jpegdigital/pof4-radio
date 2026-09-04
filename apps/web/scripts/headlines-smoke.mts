/**
 * `node apps/web/scripts/headlines-smoke.mts` — the real pull from Google News RSS for the
 * station's city, the nation and the world, no env needed: the headlines as the producer reads
 * them, then the text the brief would carry. Proves the redirects, the parser and the shapes
 * against the live feeds.
 */
import { fetchHeadlines, HEADLINES_URLS, headlinesText } from "../src/app/api/sessions/headlines.ts";

for (const [k, u] of Object.entries(HEADLINES_URLS)) console.log(`${k.padEnd(7)} ${u}`);
const t = Date.now();
const h = await fetchHeadlines();
console.log(`\npulled in ${Date.now() - t} ms\n`);
console.log(JSON.stringify(h, null, 2));
console.log(`\n--- as the brief carries it ---\n${headlinesText(h, "Dallas")}`);
const again = Date.now();
await fetchHeadlines();
console.log(`\ncached: second call ${Date.now() - again} ms`);
