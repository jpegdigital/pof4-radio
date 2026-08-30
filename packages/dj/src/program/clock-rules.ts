import type { Card, Intro, LogFallback, LogSlot, SegmentLog } from "./shapes.ts";

/**
 * The house rules of the clock, per segment: the constants the producer reads, the same rules in
 * prose for the write brief (so the prompt and the validator cannot drift), and
 * `checkSegmentLog()` — the pure check that turns the model's treatments into playable ones,
 * downgrading what breaks a hard rule and recording each downgrade as a fallback.
 *
 * Structure does most of the work: a segment *is* a break followed by its songs, so breaks come
 * every 3–5 songs by construction (`layBreaks`), and the legal ID lands on the first break after
 * the hour turns (`hourTurnedBetween`) — nothing here has to search for the hour.
 */

/** A segment holds this many songs… */
export const SEGMENT_MIN = 3;
/** …to this many. */
export const SEGMENT_MAX = 5;
/** Discovery must resolve at least this many records for an hour, or the request fails… */
export const SKELETON_MIN = 6;
/** …and asks for at most this many. */
export const SKELETON_MAX = 14;
/** A talk-up needs a real instrumental intro: at least this long (sure or not — unsure lands late). */
export const MIN_TALKUP_INTRO_MS = 7000;
/** A talk-up ends this long before the post. */
export const BEAT_MS = 400;
/** The fallback talk-up: the voice comes in this far into a song when the post can't be landed. */
export const TALKUP_LATE_MS = 1500;
/** The fallback hand-off: the next song starts when the clip ends. */
export const LEAD_FALLBACK_MS = 0;
/** What a break costs on the clock. */
export const BREAK_MS = 30_000;

export const RULES_TEXT = [
  "Rules of the clock (the validator enforces the hard ones after you answer):",
  "- Slot 0 is the break: the DJ over a bed, then the lead line into the first record. Every other slot is a talk-up, a segue or a sweeper — never a break; a segment is one break and its songs.",
  `- A talk-up only over a record whose intro runs ${MIN_TALKUP_INTRO_MS / 1000} s or more. Never over a record that starts on the vocal, and never without a card. (Where the card is unsure of the length, the voice comes in a beat after the record starts instead of landing the post — still a talk-up.)`,
  "- A segue straight out of a fade into a strong start; a sweeper where the energy jumps or a reset is wanted.",
  "- When the break is the top of the hour, the legal ID is said first, dry, then the bed comes in.",
].join("\n");

/** A slot as the model returns it, in segment order: a record id, a treatment, a reason. */
export interface RawSlot {
  id: string;
  intro: Intro;
  why: string;
}

export interface CheckInput {
  /** The station's first segment: the opening. */
  first: boolean;
  /** The wall clock crossed an hour boundary since the previous break. */
  hourTurned: boolean;
}

/**
 * Enforce the hard rules on one slot's treatment: slot 0 is the break; any other break is a
 * sweeper; a talk-up needs a card with an intro long enough. The downgrade, if any, is the fallback.
 */
export function checkSlot(
  seq: number,
  intro: Intro,
  card: Pick<Card, "introMs"> | undefined,
): { intro: Intro; fallback?: LogFallback } {
  if (seq === 0) {
    return intro === "break"
      ? { intro }
      : {
          intro: "break",
          fallback: { seq, from: intro, to: "break", reason: "the first slot is the break" },
        };
  }
  if (intro === "break") {
    return {
      intro: "sweeper",
      fallback: { seq, from: "break", to: "sweeper", reason: "a segment has one break, at its top" },
    };
  }
  if (intro !== "talkup") return { intro };
  // The card's `sure` is the assembly's business (post-landed vs. a late start), not the log's.
  if (card && card.introMs >= MIN_TALKUP_INTRO_MS) return { intro };
  const reason = !card ? "no card" : `${card.introMs} ms intro is under ${MIN_TALKUP_INTRO_MS} ms`;
  return { intro: "segue", fallback: { seq, from: "talkup", to: "segue", reason } };
}

/** `checkSlot` over a whole segment's treatments, in play order; `seq` is assigned here. */
export function checkSegmentLog(raw: RawSlot[], cards: Map<string, Card>, input: CheckInput): SegmentLog {
  const fallbacks: LogFallback[] = [];
  const slots: LogSlot[] = raw.map((s, seq) => {
    const c = checkSlot(seq, s.intro, cards.get(s.id));
    if (c.fallback) fallbacks.push(c.fallback);
    return { seq, id: s.id, intro: c.intro, why: s.why };
  });
  return { slots, fallbacks, topOfHour: input.first || input.hourTurned };
}

const HOUR_MS = 3_600_000;

/**
 * Did the wall clock cross an hour boundary between two instants (epoch ms)? Boundaries are
 * taken on the epoch, which coincide with local ones wherever the zone offset is whole hours.
 */
export function hourTurnedBetween(fromMs: number, toMs: number): boolean {
  return toMs > fromMs && Math.floor(fromMs / HOUR_MS) !== Math.floor(toMs / HOUR_MS);
}

/**
 * Where the segments start in a run of `count` records: about every four, spread so no segment
 * is under SEGMENT_MIN or over SEGMENT_MAX (a tail too short is folded into its neighbours).
 */
export function layBreaks(count: number): number[] {
  if (count <= 0) return [];
  const segments = Math.max(1, Math.round(count / 4));
  const base = Math.floor(count / segments);
  const extra = count % segments;
  const breaks: number[] = [];
  let at = 0;
  for (let i = 0; i < segments; i++) {
    breaks.push(at);
    at += base + (i < extra ? 1 : 0);
  }
  return breaks;
}
