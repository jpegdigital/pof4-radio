import type { Card, Log, LogSlot, Record } from "./shapes";

/**
 * The house rules of the clock: the constants every stage reads, the same rules in prose for the
 * log brief (so the prompt and the validator cannot drift), and `checkLog()` — the pure check
 * that turns a creative log into a playable one, downgrading what breaks a hard rule and
 * recording each downgrade as a fallback.
 */

/** Discovery must resolve at least this many records or the run stops. */
export const MIN_RECORDS = 6;
/** A talk-up needs a real instrumental intro: at least this long (sure or not — unsure lands late). */
export const MIN_TALKUP_INTRO_MS = 7000;
/** Breaks come no closer than this many songs apart… */
export const MIN_SONGS_BETWEEN_BREAKS = 3;
/** …and no farther than this (soft: a warning, not a fallback). */
export const MAX_SONGS_BETWEEN_BREAKS = 4;
/** A talk-up ends this long before the post. */
export const BEAT_MS = 400;
/** The fallback talk-up: the voice comes in this far into a song when the post can't be landed. */
export const TALKUP_LATE_MS = 1500;
/** The fallback hand-off: the next song starts when the clip ends. */
export const LEAD_FALLBACK_MS = 0;
/** How many records are enriched at once. */
export const ENRICH_CONCURRENCY = 5;
/** What a break costs on the clock when computing where the hour turns. */
export const BREAK_MS = 30_000;

export const RULES_TEXT = [
  "Rules of the clock (the validator enforces the hard ones after you answer):",
  "- The first slot is a break: the opening, the DJ over a bed, leading into the first song.",
  `- A talk-up only over a record whose intro runs ${MIN_TALKUP_INTRO_MS / 1000} s or more. Never over a record that starts on the vocal. (Where the card is unsure of the length, the voice comes in a beat after the record starts instead of landing the post — still a talk-up.)`,
  "- A segue straight out of a fade into a strong start; a sweeper where the energy jumps or a reset is wanted.",
  `- Breaks come every ${MIN_SONGS_BETWEEN_BREAKS}-${MAX_SONGS_BETWEEN_BREAKS} songs: never closer than ${MIN_SONGS_BETWEEN_BREAKS} songs apart.`,
  "- If the program crosses the top of the hour, the first slot that starts past the hour is the top-of-the-hour break (legal ID, then the big break). Mark it topOfHour; the validator recomputes where the hour falls in your order and moves it if needed. At most one slot is topOfHour.",
].join("\n");

export interface Fallback {
  seq: number;
  from: LogSlot["intro"];
  to: LogSlot["intro"];
  reason: string;
}

type Placed = { id: string; intro: LogSlot["intro"] };

/** When each slot starts (ms since midnight) given the order and the treatments. */
export function slotStarts(slots: Placed[], byId: Map<string, number>, startMs: number): number[] {
  const starts: number[] = [];
  let t = startMs;
  for (const s of slots) {
    starts.push(t);
    t += (s.intro === "break" ? BREAK_MS : 0) + (byId.get(s.id) ?? 0);
  }
  return starts;
}

/** The first slot that starts past the next hour boundary, or null when the program ends before it. */
export function hourAtSeqOf(slots: Placed[], byId: Map<string, number>, startMs: number): number | null {
  const hour = Math.ceil(startMs / 3_600_000) * 3_600_000;
  if (hour === startMs) return null;
  const i = slotStarts(slots, byId, startMs).findIndex((t) => t >= hour);
  return i < 0 ? null : i;
}

/** How long until the hour turns — what the log brief tells the model. */
export function msToHour(startMs: number): number {
  return Math.ceil(startMs / 3_600_000) * 3_600_000 - startMs;
}

export interface Checked {
  log: Log;
  fallbacks: Fallback[];
  warnings: string[];
}

/** A slot as the model returns it: an id, a treatment, a claim about the hour, a reason. */
export type RawSlot = { id: string; intro: LogSlot["intro"]; topOfHour: boolean; why: string };

/**
 * Enforce the hard rules on a log from the model. Slots come in the model's order with ids;
 * `seq` is assigned here. Records without a slot are appended as segues; ids not in the set are
 * dropped; duplicates keep their first appearance.
 */
export function checkLog(
  raw: RawSlot[],
  cards: Map<string, Card>,
  records: Record[],
  startMs: number,
): Checked {
  const fallbacks: Fallback[] = [];
  const warnings: string[] = [];
  const known = new Map(records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const slots: LogSlot[] = [];
  for (const s of raw) {
    if (!known.has(s.id)) {
      warnings.push(`slot for ${s.id} dropped: not in the set`);
      continue;
    }
    if (seen.has(s.id)) {
      warnings.push(`slot for ${s.id} dropped: already placed`);
      continue;
    }
    seen.add(s.id);
    slots.push({ seq: slots.length, id: s.id, intro: s.intro, topOfHour: s.topOfHour, why: s.why });
  }
  for (const r of records) {
    if (seen.has(r.id)) continue;
    warnings.push(`${r.name} was not placed: appended as a segue`);
    slots.push({
      seq: slots.length,
      id: r.id,
      intro: "segue",
      topOfHour: false,
      why: "not placed by the log",
    });
  }
  const first = slots[0];
  if (!first) return { log: { slots, fallbacks, crossesHour: false, hourAtSeq: null }, fallbacks, warnings };

  if (first.intro !== "break") {
    fallbacks.push({ seq: 0, from: first.intro, to: "break", reason: "the first slot is the opening" });
    first.intro = "break";
  }

  for (const s of slots) {
    if (s.intro !== "talkup") continue;
    // The card's `sure` is the assembly's business (post-landed vs. a late start), not the log's.
    const c = cards.get(s.id);
    if (c && c.introMs >= MIN_TALKUP_INTRO_MS) continue;
    const reason = !c ? "no card" : `${c.introMs} ms intro is under ${MIN_TALKUP_INTRO_MS} ms`;
    fallbacks.push({ seq: s.seq, from: "talkup", to: "segue", reason });
    s.intro = "segue";
  }

  // The top of the hour is the big break, wherever the hour actually turns in this order.
  const byId = new Map(records.map((r) => [r.id, r.durationMs]));
  const hourAtSeq = hourAtSeqOf(slots, byId, startMs);
  for (const s of slots) {
    if (s.seq === hourAtSeq) {
      if (s.intro !== "break") {
        fallbacks.push({ seq: s.seq, from: s.intro, to: "break", reason: "the hour turns here: legal ID" });
        s.intro = "break";
      }
      s.topOfHour = true;
    } else if (s.topOfHour) {
      warnings.push(`slot ${s.seq}: topOfHour cleared — the hour turns at ${hourAtSeq ?? "no slot"}`);
      s.topOfHour = false;
    }
  }

  // Breaks keep their distance; when the legal ID is the one too close, the earlier break gives way.
  let lastBreak: LogSlot | null = null;
  for (const s of slots) {
    if (s.intro !== "break") continue;
    const prev: LogSlot | null = lastBreak;
    const gap = prev === null ? null : s.seq - prev.seq;
    if (gap !== null && gap < MIN_SONGS_BETWEEN_BREAKS) {
      const loser: LogSlot = s.topOfHour && prev !== null && prev.seq > 0 ? prev : s;
      fallbacks.push({
        seq: loser.seq,
        from: "break",
        to: "sweeper",
        reason: loser === s ? `${gap} songs after the last break` : `${gap} songs before the top of the hour`,
      });
      loser.intro = "sweeper";
      if (loser !== s) lastBreak = s;
      continue;
    }
    if (gap !== null && gap > MAX_SONGS_BETWEEN_BREAKS) {
      warnings.push(`slot ${s.seq}: ${gap} songs since the last break`);
    }
    lastBreak = s;
  }

  return { log: { slots, fallbacks, crossesHour: hourAtSeq !== null, hourAtSeq }, fallbacks, warnings };
}
