import { z } from "zod";
import type { Element } from "../reducer";

/**
 * The shapes of the stage files under public/program/make/ (see specs/002-program-pipeline/
 * data-model.md). Every stage validates what it reads and what it writes with these.
 */

/** The pipeline, in order. */
export const STAGES = ["discover", "enrich", "log", "script", "voice"] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);

export const DEFAULT_STATION = { onAir: "56.6, Claude Radio", calls: "WFAI", city: "Dallas" };
export const MIN_COUNT = 10;
export const MAX_COUNT = 14;

export const Station = z.object({
  onAir: z.string().min(1),
  calls: z.string().min(1),
  city: z.string().min(1),
});
export type Station = z.infer<typeof Station>;

/** request.json — written by the page (via discover), read by discover. */
export const Request = z.object({
  request: z.string().min(1),
  station: Station,
  dj: z.string().min(1),
  /** The program clock's start, ms since midnight. */
  startMs: z.number().int().min(0).max(86_400_000),
  count: z.number().int().min(MIN_COUNT).max(MAX_COUNT),
});
export type Request = z.infer<typeof Request>;

export const Pick = z.object({ artist: z.string().min(1), title: z.string().min(1), why: z.string() });
export type Pick = z.infer<typeof Pick>;

/** A resolved record: the reducer's Track plus its Spotify id and which pick it came from. */
export const Record = z.object({
  id: z.string().min(1),
  uri: z.string().startsWith("spotify:track:"),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  image: z.string().nullable(),
  durationMs: z.number().int().positive(),
  pick: z.number().int().min(0),
});
export type Record = z.infer<typeof Record>;

export const Dropped = z.object({ pick: z.number().int().min(0), reason: z.string() });
export type Dropped = z.infer<typeof Dropped>;

/** picks.json — written by discover, read by enrich (which may rewrite `dropped`). */
export const Picks = z.object({
  rationale: z.string(),
  picks: z.array(Pick),
  records: z.array(Record).refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, {
    message: "records must be unique by id",
  }),
  dropped: z.array(Dropped),
});
export type Picks = z.infer<typeof Picks>;

/** cards/<id>.json — one per record, written by enrich. */
export const Card = z.object({
  id: z.string().min(1),
  name: z.string(),
  artists: z.array(z.string()),
  /** The instrumental intro; 0 = starts on the vocal. */
  introMs: z.number().int().min(0),
  sure: z.boolean(),
  /** The first sung words, "" if none. */
  post: z.string(),
  outro: z.enum(["cold", "fade"]),
  /** When the fade starts (= durationMs for a cold ending). */
  outroMs: z.number().int().min(0),
  energy: z.number().int().min(1).max(5),
  tempo: z.enum(["down", "mid", "up"]),
  mood: z.string(),
  notes: z.array(z.string()),
  thinking: z.string(),
  enrichedAt: z.string(),
  model: z.string(),
});
export type Card = z.infer<typeof Card>;

export const Intro = z.enum(["break", "talkup", "segue", "sweeper"]);
export type Intro = z.infer<typeof Intro>;

export const LogSlot = z.object({
  seq: z.number().int().min(0),
  id: z.string().min(1),
  intro: Intro,
  topOfHour: z.boolean(),
  why: z.string(),
});
export type LogSlot = z.infer<typeof LogSlot>;

export const LogFallback = z.object({ seq: z.number().int(), from: Intro, to: Intro, reason: z.string() });

/** log.json — written by log, read by script and voice. */
export const Log = z.object({
  slots: z.array(LogSlot),
  fallbacks: z.array(LogFallback),
  crossesHour: z.boolean(),
  hourAtSeq: z.number().int().nullable(),
});
export type Log = z.infer<typeof Log>;

export const Line = z.object({
  seq: z.number().int().min(0),
  legalId: z.string().optional(),
  words: z.string(),
  leadLine: z.string().optional(),
});
export type Line = z.infer<typeof Line>;

/** script.json — written by script, read by voice. */
export const Script = z.object({ lines: z.array(Line) });
export type Script = z.infer<typeof Script>;

export const Treatment = Intro;

export const Fallback = z.object({ from: z.string(), to: z.string(), reason: z.string() });
export type Fallback = z.infer<typeof Fallback>;

/** One per element that carries a clip: what it is, what it says, how it was timed. */
export const Note = z.object({
  element: z.number().int().min(0),
  seq: z.number().int().min(0),
  treatment: Treatment,
  words: z.string(),
  clip: z.string(),
  clipMs: z.number().min(0).optional(),
  bedInMs: z.number().min(0).optional(),
  leadMs: z.number().min(0).optional(),
  atMs: z.number().min(0).optional(),
  fallback: Fallback.optional(),
});
export type Note = z.infer<typeof Note>;

const isElement = (e: unknown): e is Element =>
  typeof e === "object" && e !== null && "kind" in e && (e.kind === "song" || e.kind === "break");

/** program.json — written by voice (via assemble), read by program.tsx. */
export const Program = z.object({
  station: z.string(),
  dj: z.string(),
  voiceId: z.string(),
  startMs: z.number().int(),
  /** The reducer's Element[]: the player's input, checked structurally, not re-modelled. */
  elements: z.array(z.custom<Element>(isElement, { message: "not an element" })),
  notes: z.array(Note),
  madeAt: z.string(),
});
export type Program = z.infer<typeof Program>;
