/** Railway runs one bounded job and exits. No HTTP server or queue. */
import pg from "pg";
import { NEWS_DEFAULTS, NEWS_KEY, NewsConfig } from "../src/lib/news.ts";
import {
  editionDate,
  NEWS_VALID_MS,
  PREP_PLACE,
  PREP_TIME_ZONE,
  PreparedHeadline,
} from "../src/lib/prepared.ts";
import { prepareNews } from "./prep-news.mts";
import { prepareWeather } from "./prep-weather.mts";

const kind = process.argv[2];
if (kind !== "news" && kind !== "weather") throw new Error("usage: prep.mts news|weather [--dry-run]");
const dryRun = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (kind === "news" && (!process.env.CLAUDE_KEY || !process.env.CLAUDE_MODEL))
  throw new Error("CLAUDE_KEY and CLAUDE_MODEL are required for news preparation");
const controller = new AbortController();
const stop = () => controller.abort(new Error("Preparation interrupted"));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
// A wedged driver must not keep Railway from starting the next scheduled run.
const watchdog = setTimeout(() => {
  console.error("[prep] hard deadline exceeded");
  process.exit(1);
}, 300_000);
const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]);
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000,
  query_timeout: 25_000,
});
try {
  const client = await pool.connect();
  let locked = false;
  let transaction = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [`radio-prep:${kind}:${PREP_PLACE}`],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) console.log(`[prep:${kind}] another run owns this location; skipped`);
    else {
      const started = new Date();
      const id = crypto.randomUUID();
      const date = editionDate(started, PREP_TIME_ZONE);
      if (kind === "news") {
        const { rows } = await client.query<{ value: string }>("select value from settings where key = $1", [
          NEWS_KEY,
        ]);
        const config = NewsConfig.parse(rows[0] ? JSON.parse(rows[0].value) : NEWS_DEFAULTS);
        if (
          config.city.toLowerCase() !== "dallas" ||
          config.region.toUpperCase() !== "TX" ||
          config.timeZone !== PREP_TIME_ZONE
        )
          throw new Error("Scheduled news currently supports Dallas, TX / America/Chicago only");
        if (!config.enabled) console.log("[prep:news] station news disabled; skipped");
        else {
          const result = await prepareNews(
            config,
            process.env.CLAUDE_KEY!,
            process.env.CLAUDE_MODEL!,
            deadline,
          );
          const options = PreparedHeadline.array().parse(result.options);
          const prepared = new Date();
          deadline.throwIfAborted();
          const expires = new Date(
            Math.min(
              started.getTime() + NEWS_VALID_MS,
              options.length ? Math.max(...options.map((o) => Date.parse(o.expiresAt))) : Infinity,
            ),
          );
          if (expires <= prepared) throw new Error("News edition expired before publication");
          if (!dryRun) {
            await client.query("begin");
            transaction = true;
            await client.query("insert into headline_snapshot (id, snapshot, audit) values ($1, $2, $3)", [
              id,
              JSON.stringify({ ...result.snapshot, id }),
              JSON.stringify(result.audit),
            ]);
            await client.query(
              `insert into news_entries (id, edition_date, place, time_zone, started_at, prepared_at, expires_at, options)
              values ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [id, date, PREP_PLACE, PREP_TIME_ZONE, started, prepared, expires, JSON.stringify(options)],
            );
            await client.query("commit");
            transaction = false;
          }
          console.log(
            JSON.stringify({
              job: kind,
              dryRun,
              id,
              date,
              options: options.length,
              sources: result.snapshot.sources,
              expiresAt: expires,
            }),
          );
        }
      } else {
        const result = await prepareWeather(deadline);
        deadline.throwIfAborted();
        if (!dryRun)
          await client.query(
            `insert into weather_entries (id, edition_date, place, time_zone, started_at, prepared_at, expires_at, weather, evidence)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              id,
              date,
              PREP_PLACE,
              PREP_TIME_ZONE,
              started,
              new Date(),
              result.expiresAt,
              JSON.stringify(result.weather),
              JSON.stringify(result.evidence),
            ],
          );
        console.log(
          JSON.stringify({
            job: kind,
            dryRun,
            id,
            date,
            observedAt: result.weather.observedAt,
            periods: result.weather.periods.length,
            alerts: result.weather.alerts.length,
            expiresAt: result.expiresAt,
          }),
        );
      }
    }
  } finally {
    try {
      if (transaction) await client.query("rollback");
      if (locked)
        await client.query("select pg_advisory_unlock(hashtext($1))", [`radio-prep:${kind}:${PREP_PLACE}`]);
    } finally {
      client.release();
    }
  }
} catch (error) {
  console.error(`[prep:${kind}] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
  clearTimeout(watchdog);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
