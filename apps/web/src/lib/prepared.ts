/** Scheduled preparation contract. Database reads only: no research or model calls here. */
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { NewsConfig } from "./news.ts";

export const PREP_PLACE = "dallas-tx";
export const PREP_TIME_ZONE = "America/Chicago";
export const NEWS_VALID_MS = 4 * 60 * 60 * 1000;
export const WEATHER_VALID_MS = 60 * 60 * 1000;
/** Worker publication margin only; never gates session generation or playback. */
export const PREP_AIR_MARGIN_MS = 5 * 60 * 1000;
const Iso = z.iso.datetime({ offset: true });

export const PreparedHeadline = z.object({
  articleId: z.string(),
  storyId: z.string(),
  revision: z.string(),
  title: z.string(),
  topic: z.string(),
  sourceId: z.string(),
  source: z.string(),
  url: z.url(),
  scope: z.enum(["local", "culture", "nation", "world"]),
  publishedAt: Iso,
  fetchedAt: Iso,
  checkedAt: Iso,
  expiresAt: Iso,
  evidence: z.string(),
  facts: z.array(z.object({ text: z.string(), quote: z.string() })),
});
export type PreparedHeadline = z.infer<typeof PreparedHeadline>;

export const PreparedWeather = z.object({
  location: z.object({
    city: z.string(),
    zip: z.string(),
    timeZone: z.string(),
    station: z.string(),
    grid: z.string(),
  }),
  sources: z.object({ observation: z.url(), forecast: z.url(), alerts: z.url() }),
  units: z.object({
    temperature: z.literal("F"),
    wind: z.literal("mph"),
    precipitation: z.literal("percent"),
  }),
  observedAt: Iso,
  forecastUpdatedAt: Iso,
  now: z.object({
    text: z.string(),
    tempF: z.number().nullable(),
    feelsLikeF: z.number().nullable(),
    humidity: z.number().nullable(),
    windMph: z.number().nullable(),
  }),
  periods: z
    .array(
      z.object({
        name: z.string(),
        isDaytime: z.boolean(),
        startTime: Iso,
        endTime: Iso,
        tempF: z.number(),
        short: z.string(),
        detailed: z.string(),
        precipitationPercent: z.number().min(0).max(100).nullable(),
        windSpeed: z.string(),
        windDirection: z.string(),
      }),
    )
    .min(1),
  alerts: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      headline: z.string().nullable(),
      severity: z.string(),
      effective: Iso,
      expires: Iso,
      description: z.string(),
      instruction: z.string().nullable(),
    }),
  ),
});
export type PreparedWeather = z.infer<typeof PreparedWeather>;

export function editionDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Exact-repeat removal is deterministic; Jev must also compare events across publishers/history. */
export function usableNews<T extends { articleId: string; revision: string; expiresAt: string }>(
  options: T[],
  used: { articleId: string; revision: string }[],
): T[] {
  return options.filter((o) => !used.some((h) => h.articleId === o.articleId));
}

export interface PreparedEntry<T> {
  id: string;
  date: string;
  preparedAt: Date;
  expiresAt: Date;
  data: T;
}

/** Read the latest saved edition; preparation owns freshness, sessions retain their inputs. */
export async function readPreparedNews(
  db: Pool | PoolClient,
  config: NewsConfig,
  used: { articleId: string; revision: string }[] = [],
  date?: string,
): Promise<PreparedEntry<PreparedHeadline[]> | null> {
  if (
    !config.enabled ||
    config.city.toLowerCase() !== "dallas" ||
    config.region.toUpperCase() !== "TX" ||
    config.timeZone !== PREP_TIME_ZONE
  )
    return null;
  const { rows } = await db.query<PreparedEntry<unknown>>(
    `select id, edition_date::text as date, prepared_at as "preparedAt", expires_at as "expiresAt", options as data
     from news_entries where place = $1 and ($2::date is null or edition_date = $2::date)
     order by edition_date desc, prepared_at desc, id desc limit 1`,
    [PREP_PLACE, date ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  const data = usableNews(PreparedHeadline.array().parse(row.data), used).filter((o) =>
    config.sources.includes(o.sourceId),
  );
  return data.length ? { ...row, data } : null;
}

export async function readPreparedWeather(
  db: Pool | PoolClient,
  date?: string,
): Promise<PreparedEntry<PreparedWeather> | null> {
  const { rows } = await db.query<PreparedEntry<unknown>>(
    `select id, edition_date::text as date, prepared_at as "preparedAt", expires_at as "expiresAt", weather as data
     from weather_entries where place = $1 and ($2::date is null or edition_date = $2::date)
     order by edition_date desc, prepared_at desc, id desc limit 1`,
    [PREP_PLACE, date ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, data: PreparedWeather.parse(row.data) };
}
