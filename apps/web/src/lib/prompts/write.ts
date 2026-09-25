import { z } from "zod";
import { WEATHER_WORDS, type WeatherReport } from "../../app/api/sessions/weather-report.ts";
import { template } from "./template.ts";
import type { RawHeadline, LegacyPreparedHeadline, PreparedWeather } from "../prepared.ts";
import type { Identity } from "../identity.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import type { MixPlan } from "../../app/api/sessions/planning.ts";
import { Written } from "../../app/api/sessions/shapes.ts";
import { ChatPrompt } from "./contract.ts";

/** A slot already written in this show: what was said there. */
export interface RecentSlot {
  seq: number;
  kind: string;
  words: string | null;
  leadLine: string | null;
  title: string;
  artist: string;
}

export interface WriteInput {
  prompt: string;
  dj: string | null;
  /** The selected TTS voice supports Eleven v3 inline audio directions. */
  audioTags?: boolean;
  identity: Identity;
  /** "8:43 pm". */
  clock: string;
  seq: number;
  clockSaysBreak: boolean;
  proposal: { title: string; artist: string; why: string };
  /** The recording Jev selected. The writer cannot replace it. */
  hit: Hit;
  /** The last few written slots before this one, in show order. */
  recent: RecentSlot[];
  /** Everything written before this one, in show order. */
  played: { title: string; artist: string }[];
  /** Fixed Jev chart, mixer action, and spoken word budgets. */
  plan: MixPlan;
  /** The legal ID to open with, or null when it is not due (or this is not a break). */
  legalId: string | null;
  /** Structured, previously fetched facts; no request-time research. */
  weather: PreparedWeather | null;
  /** Frozen at first generation; absent only on historical saved inputs. */
  weatherReport?: WeatherReport | null;
  headlines: (RawHeadline | LegacyPreparedHeadline)[];
}

const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

const recentLine = (r: RecentSlot) => {
  const said = [r.words, r.leadLine].filter(Boolean).join(" ");
  return `${r.seq}. ${r.artist} — ${r.title}: ${r.kind}${said ? ` — "${said}"` : " (nothing said)"}`;
};

const renderSystem = template(
  "write-system",
  z.strictObject({
    dj: z.string().nullable(),
    station: z.string().min(1),
    calls: z.string().min(1),
    city: z.string().min(1),
  }),
);
/** Only the weather facts the DJ needs; freshness belongs to preparation. */
export const WeatherBrief = z.object({
  city: z.string().min(1),
  current: z.object({
    text: z.string(),
    tempF: z.number().nullable(),
    feelsLikeF: z.number().nullable(),
    windMph: z.number().nullable(),
  }),
  forecast: z.object({
    name: z.string(),
    tempF: z.number(),
    short: z.string(),
    precipitationPercent: z.number().min(0).max(100).nullable(),
  }),
  alerts: z.array(
    z.object({
      event: z.string(),
      headline: z.string().nullable(),
      severity: z.string(),
      description: z.string(),
      instruction: z.string().nullable(),
    }),
  ),
});
export type WeatherBrief = z.infer<typeof WeatherBrief>;
const renderBrief = template(
  "write-brief",
  z.strictObject({
    direction: z.string(),
    clock: z.string(),
    recent: z.string(),
    played: z.string(),
    artist: z.string(),
    title: z.string(),
    why: z.string(),
    recording: z.string(),
    plan: z.string(),
    seq: z.number().int().positive(),
    isBreak: z.boolean(),
    legalId: z.string().nullable(),
    wordsMax: z.number().int().nonnegative(),
    leadWordsMax: z.number().int().nonnegative(),
    targetWords: z.number().int().nonnegative(),
    opening: z.boolean(),
    dj: z.string().nullable(),
    talkup: z.boolean(),
    talkSeconds: z.number().nonnegative(),
    hasWordsMin: z.boolean(),
    wordsMin: z.number().int().nonnegative(),
    headlines: z.string(),
    weather: z.string(),
    audioTags: z.boolean(),
    fullWeather: z.boolean(),
    hourlyWeather: z.boolean(),
    weatherWords: z.number(),
  }),
);

export const system = (dj: string | null, identity: Identity) =>
  renderSystem({ dj, station: identity.onAir, calls: identity.calls, city: identity.city });

export const weatherBrief = (weather: PreparedWeather): WeatherBrief =>
  WeatherBrief.parse({
    city: weather.location.city,
    current: weather.now,
    // Preparation orders the forecast with the current period first (including overnight).
    forecast: weather.periods[0],
    alerts: weather.alerts,
  });

export function writeBrief(input: WriteInput): string {
  const { proposal, hit, plan } = input;
  return renderBrief({
    direction: input.prompt,
    clock: input.clock,
    recent: input.recent.map(recentLine).join("\n"),
    played: input.played.map((p) => `- ${p.artist} — ${p.title}`).join("\n"),
    artist: proposal.artist,
    title: proposal.title,
    why: proposal.why,
    recording: `${hit.id} | ${hit.title} — ${hit.artists.join(", ")} | ${hit.album} | ${mmss(hit.durationMs)}`,
    plan: JSON.stringify(plan),
    seq: input.seq,
    isBreak: input.clockSaysBreak,
    legalId: input.legalId,
    wordsMax: plan.wordsMax,
    leadWordsMax: plan.leadWordsMax,
    targetWords: Math.floor(plan.wordsMax * 0.75),
    opening: input.seq === 1,
    dj: input.dj,
    talkup: plan.kind === "talkup" && plan.talkOverMs !== undefined,
    talkSeconds: (plan.talkOverMs ?? 0) / 1000,
    hasWordsMin: plan.wordsMin !== undefined,
    wordsMin: plan.wordsMin ?? 0,
    headlines: input.headlines.length
      ? JSON.stringify(
          input.headlines.map((headline) => {
            if ("excerpt" in headline) return headline;
            // A retry of an old generation keeps its original checked facts.
            const { articleId, source, title, facts, publishedAt, expiresAt } = headline;
            return { articleId, source, title, facts, publishedAt, expiresAt };
          }),
        )
      : "",
    audioTags: input.audioTags === true,
    fullWeather: input.weatherReport?.mode === "full",
    hourlyWeather: input.weatherReport?.mode === "hourly",
    weatherWords: input.weatherReport ? WEATHER_WORDS[input.weatherReport.mode] : 25,
    weather:
      input.weatherReport !== undefined
        ? input.weatherReport
          ? JSON.stringify(input.weatherReport)
          : ""
        : input.weather
          ? JSON.stringify(weatherBrief(input.weather))
          : "",
  });
}

export const writePrompt = {
  output: Written,
  render(input: WriteInput): ChatPrompt {
    return ChatPrompt.parse({ system: system(input.dj, input.identity), brief: writeBrief(input) });
  },
};
