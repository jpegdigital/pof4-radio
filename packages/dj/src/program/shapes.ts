import { z } from "zod";

/**
 * The shapes of the produced show (specs/003-segment-station/data-model.md): what the producer
 * keeps on a station and a segment, what the player plays, and what the page is shown. Lifted
 * from the sandbox's stage files and cut to the segment. Everything a route reads or writes
 * is validated with these.
 */

// ── the player's contract ─────────────────────────────────────────────────────────────────────

export interface Track {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
}

export interface Talk {
  /** The clip's play URL. */
  clip: string;
  /** Over the song's first seconds (ducked from the start) or back-timed over its last. */
  over: "intro" | "outro";
  /**
   * An intro talk that waits: the song starts full and the voice comes in this far into it (ducking
   * it), timed so the clip ends at the post. Absent or 0: the voice starts with the song.
   */
  atMs?: number;
}

/**
 * One thing on air. A song, with an optional talk over it; or a break — a clip over a bed (a
 * looped instrumental, by URL) or dry. `bedInMs`: the bed waits this long (the words before it —
 * a legal ID — are dry). `leadMs`: the next song starts this long before the clip ends, ducked
 * under it, so the clip's last line is its talk-up; 0 = a hard intro.
 */
export type Element =
  | { kind: "song"; track: Track; talk?: Talk }
  | { kind: "break"; clip: string; bed?: string; bedInMs?: number; leadMs: number; label: string };

const isElement = (e: unknown): e is Element =>
  typeof e === "object" && e !== null && "kind" in e && (e.kind === "song" || e.kind === "break");

export const ElementShape = z.custom<Element>(isElement, { message: "not an element" });

// ── the station ───────────────────────────────────────────────────────────────────────────────

/** Call letters, city, and the name as said on air — `settings.station.identity`. */
export const Identity = z.object({
  calls: z.string().min(1),
  city: z.string().min(1),
  onAir: z.string().min(1),
});
export type Identity = z.infer<typeof Identity>;

export const Pick = z.object({ artist: z.string().min(1), title: z.string().min(1), why: z.string() });
export type Pick = z.infer<typeof Pick>;

/** A resolved record: the player's Track plus its Spotify id and which pick it came from. */
export const Record = z.object({
  id: z.string().min(1),
  uri: z.string().startsWith("spotify:track:"),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  image: z.string().nullable(),
  durationMs: z.number().int().positive(),
  pick: z.number().int().min(0),
  /** The pick's one line: why this record, here. */
  why: z.string().optional(),
  /** How the search hit was chosen when it wasn't the first one, e.g. "shortest of 5". */
  resolved: z.string().optional(),
});
export type Record = z.infer<typeof Record>;

const uniqueIds = (rs: { id: string }[]) => new Set(rs.map((r) => r.id)).size === rs.length;

export const Dropped = z.object({ pick: z.number().int().min(0), reason: z.string() });
export type Dropped = z.infer<typeof Dropped>;

/** The hour's plan on the station row: records in play order, where each segment starts. */
export const Skeleton = z.object({
  rationale: z.string(),
  records: z.array(Record).refine(uniqueIds, { message: "records must be unique by id" }),
  /** Indexes into `records` where a segment starts. */
  breaks: z.array(z.number().int().min(0)),
  /** How many records have been placed into segments. */
  consumed: z.number().int().min(0),
  plannedAt: z.string(),
  /** Picks that could not be resolved in the catalogue, with why. */
  dropped: z.array(Dropped).optional(),
});
export type Skeleton = z.infer<typeof Skeleton>;

// ── the record's card ─────────────────────────────────────────────────────────────────────────

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
  model: z.string(),
});
export type Card = z.infer<typeof Card>;

/** What the page is shown of a card: enough to read a row's timing, none of the reasoning. */
export const CardFacts = Card.pick({
  introMs: true,
  sure: true,
  post: true,
  outro: true,
  energy: true,
  notes: true,
});
export type CardFacts = z.infer<typeof CardFacts>;

// ── the segment's log and lines ───────────────────────────────────────────────────────────────

export const Intro = z.enum(["break", "talkup", "segue", "sweeper"]);
export type Intro = z.infer<typeof Intro>;
export const Treatment = Intro;
export type Treatment = Intro;

/** One record's slot in the segment: its treatment and why. Seq 0 is the break. Produced one at a time. */
export const LogSlot = z.object({
  seq: z.number().int().min(0),
  id: z.string().min(1),
  intro: Intro,
  why: z.string(),
});
export type LogSlot = z.infer<typeof LogSlot>;

export const LogFallback = z.object({ seq: z.number().int(), from: Intro, to: Intro, reason: z.string() });
export type LogFallback = z.infer<typeof LogFallback>;

export const SegmentLog = z.object({
  slots: z.array(LogSlot),
  fallbacks: z.array(LogFallback),
  /** This segment's break carries the legal ID (the opening, or the hour turned). */
  topOfHour: z.boolean(),
});
export type SegmentLog = z.infer<typeof SegmentLog>;

/** What is said at one slot. A segue has no line. */
export const Line = z.object({
  seq: z.number().int().min(0),
  treatment: Treatment,
  /** The legal ID said dry before the bed comes in — top-of-the-hour breaks only. */
  legalId: z.string().optional(),
  words: z.string(),
  /** Breaks only: the one sentence that leads into the record, said last, the record under it. */
  leadLine: z.string().optional(),
});
export type Line = z.infer<typeof Line>;

// ── the assembled segment ─────────────────────────────────────────────────────────────────────

export const Fallback = z.object({ from: z.string(), to: z.string(), reason: z.string() });
export type Fallback = z.infer<typeof Fallback>;

/** One per element that carries a clip: what it is, what it says, how it was timed. */
export const Note = z.object({
  element: z.number().int().min(0),
  seq: z.number().int().min(0),
  treatment: Treatment,
  words: z.string(),
  /** The clip's key: the slot's seq for a voiced clip, a sweeper's URL for a produced one, "" for none. */
  clip: z.string(),
  clipMs: z.number().min(0).optional(),
  bedInMs: z.number().min(0).optional(),
  leadMs: z.number().min(0).optional(),
  atMs: z.number().min(0).optional(),
  fallback: Fallback.optional(),
});
export type Note = z.infer<typeof Note>;

/**
 * A segment as the page sees it (contracts/api.md). It grows one slot at a time: `log.slots`,
 * `lines`, `elements` and `notes` cover the slots produced so far; `records` past
 * `log.slots.length` are still to come. `complete` once every record has its slot.
 */
export const SegmentView = z.object({
  id: z.string().min(1),
  seq: z.number().int().min(1),
  prompt: z.string(),
  complete: z.boolean(),
  records: z.array(Record).refine(uniqueIds, { message: "records must be unique by id" }),
  lines: z.array(Line),
  log: SegmentLog,
  cards: z.record(z.string(), CardFacts),
  dropped: z.array(Dropped),
  elements: z.array(ElementShape),
  notes: z.array(Note),
});
export type SegmentView = z.infer<typeof SegmentView>;
