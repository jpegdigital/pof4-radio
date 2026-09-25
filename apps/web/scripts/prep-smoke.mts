/** Read-only production verification after running both preparation jobs. */
import assert from "node:assert/strict";
import pg from "pg";
import { NEWS_DEFAULTS, NEWS_KEY, NewsConfig } from "../src/lib/news.ts";
import { readNews, readPreparedWeather } from "../src/lib/prepared.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10_000,
});
try {
  const { rows } = await pool.query<{ value: string }>("select value from settings where key = $1", [
    NEWS_KEY,
  ]);
  const config = NewsConfig.parse(rows[0] ? JSON.parse(rows[0].value) : NEWS_DEFAULTS);
  const news = await readNews(pool, config);
  const weather = await readPreparedWeather(pool);
  assert(news && news.data.length, "Run prep:news first: no usable news edition");
  assert(weather && weather.data.periods.length, "Run prep:weather first: no usable weather edition");
  assert.equal((await readNews(pool, config, [], news.date))?.id, news.id);
  assert.equal((await readPreparedWeather(pool, weather.date))?.id, weather.id);
  assert.equal(await readNews(pool, config, news.data), null, "Exact used revisions must be omitted");
  assert.equal(await readNews(pool, { ...config, enabled: false }), null);
  const evidence = await pool.query<{ articles: number }>(
    "select jsonb_array_length(snapshot->'articles') as articles from headline_snapshot where id = $1",
    [news.id],
  );
  assert(evidence.rows[0]?.articles, "News must link to its retained source snapshot");
  for (const article of news.data) {
    assert(!("facts" in article) && !("checkedAt" in article), "Only raw headlines may be selected");
    assert(typeof article.excerpt === "string");
  }
  console.log(
    JSON.stringify(
      {
        verified: true,
        news: {
          id: news.id,
          date: news.date,
          options: news.data.length,
          expiresAt: news.expiresAt,
          sources: [...new Set(news.data.map((o) => o.source))],
        },
        weather: {
          id: weather.id,
          date: weather.date,
          observedAt: weather.data.observedAt,
          periods: weather.data.periods.length,
          alerts: weather.data.alerts.length,
          expiresAt: weather.expiresAt,
        },
        checks: ["database round trip", "date lookup", "source evidence", "used revisions", "disabled news"],
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
