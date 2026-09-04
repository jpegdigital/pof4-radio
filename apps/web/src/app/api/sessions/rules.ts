import type { Written } from "./shapes";

/**
 * The law over one slot, pure: judgment lives in the model, this turns what it wrote into a slot
 * that can play. The clock says whether a slot is the break (`isBreak`) and whether the legal
 * ID is due (`legalIdDue`); the writer's kind is held to that — a break where the clock says
 * none is a sweeper, anything else where the clock says break is the break. A talk-up needs a
 * ramp of MIN_TALKUP_INTRO_MS the writer is sure of; a talk-up or sweeper with nothing to say
 * is a segue; a segue says nothing at all. Every step down is kept on the slot as its fallback.
 * The writer's two timing numbers are kept where they mean something — the song starting under
 * a break's lead line, the voice coming in on a talk-up — clamped to sense, and dropped
 * elsewhere; the chart's ramp and outro are clamped to the hit's length. Everything else about
 * the mix is a house constant in the player.
 */

export type SlotKind = Written["kind"];

export interface SlotFallback {
  from: SlotKind;
  to: SlotKind;
  reason: string;
}

/** Every written column of one session_slot row, camelCase, ready for the one update. */
export interface WrittenSlot {
  qobuzId: string;
  rampMs: number;
  sure: boolean;
  post: string;
  outro: Written["outro"];
  outroMs: number;
  energy: number;
  tempo: Written["tempo"];
  mood: string;
  kind: SlotKind;
  words: string | null;
  leadLine: string | null;
  legalId: string | null;
  treatment: string;
  fallback: SlotFallback | null;
  /** Breaks: how long before the voice ends the song starts under it. */
  recordUnderMs: number | null;
  /** Talk-ups: how far into the song the voice comes in. */
  voiceInMs: number | null;
}

/** A talk-up needs a real instrumental ramp: at least this long. */
export const MIN_TALKUP_INTRO_MS = 7000;
/** A break's song can start no earlier than this before the voice ends, whatever the writer says. */
export const MAX_RECORD_UNDER_MS = 10_000;
/** A talk-up's voice can wait no longer than this into the song. */
export const MAX_VOICE_IN_MS = 10_000;

const HOUR_MS = 3_600_000;

const clampMs = (sec: number, max: number) =>
  Number.isFinite(sec) ? Math.round(Math.min(max, Math.max(0, sec * 1000))) : 0;

/** Slot 1 is the break, and every `breakEvery` after it: 1, 1 + k, 1 + 2k… */
export const isBreak = (seq: number, breakEvery: number) => seq === 1 || (seq - 1) % breakEvery === 0;

/**
 * The legal ID is said on slot 1 and again on the first break of every hour: when the hour of
 * this slot's clock differs from the hour of the last break's, or when no earlier break is known.
 */
export function legalIdDue(seq: number, clockMs: number, lastBreakClockMs: number | null): boolean {
  if (seq === 1 || lastBreakClockMs === null) return true;
  return Math.floor(clockMs / HOUR_MS) !== Math.floor(lastBreakClockMs / HOUR_MS);
}

export const RULES_TEXT = [
  "Rules of the clock (the hard ones are enforced after you answer):",
  "- The brief says whether this slot is the break. If it is, the kind is break: the DJ over a bed, then the lead line into the song. If it is not, the kind is a talk-up, a segue or a sweeper — never a break.",
  `- A talk-up only over a version whose ramp runs ${MIN_TALKUP_INTRO_MS / 1000} s or more, and only when you are sure of that ramp to within a second or two — say so with sure. Never over a song that starts on the vocal. Keep it short enough to end a beat before the vocal.`,
  "- A segue straight out of a fade into a strong start; a sweeper where the energy jumps or a reset is wanted.",
  "- Length is time on air, at about 2.5 words a second. The break: 40 to 60 words, never more, and then the lead line — one sentence. A talk-up: as many words as fit the ramp with a beat to spare, so an 8 s ramp holds 15 words and a 20 s ramp 40; count them. A sweeper: 3 to 8 words.",
  "- Never quote a lyric. Never read the legal ID yourself: when the brief gives one, it is said before your words.",
].join("\n");

/** The hard rules on the kind: the clock first, then the ramp. The step down, if any, is the fallback. */
function checkKind(clockSaysBreak: boolean, w: Written): { kind: SlotKind; fallback: SlotFallback | null } {
  if (clockSaysBreak) {
    return w.kind === "break"
      ? { kind: "break", fallback: null }
      : {
          kind: "break",
          fallback: { from: w.kind, to: "break", reason: "the clock says this slot is the break" },
        };
  }
  if (w.kind === "break") {
    return {
      kind: "sweeper",
      fallback: { from: "break", to: "sweeper", reason: "the clock says this slot is not a break" },
    };
  }
  if (w.kind !== "talkup") return { kind: w.kind, fallback: null };
  const rampMs = clampMs(w.rampSec, Number.POSITIVE_INFINITY);
  if (!w.sure)
    return { kind: "segue", fallback: { from: "talkup", to: "segue", reason: "unsure of the ramp" } };
  if (rampMs < MIN_TALKUP_INTRO_MS)
    return {
      kind: "segue",
      fallback: {
        from: "talkup",
        to: "segue",
        reason: `ramp too short: ${rampMs} ms is under ${MIN_TALKUP_INTRO_MS} ms`,
      },
    };
  return { kind: "talkup", fallback: null };
}

/**
 * One slot as the writer returned it, held to the law: `clockSaysBreak` is the clock's word on
 * this slot, `hit` the version the writer picked, `legalId` the station's when it is due here
 * (null otherwise — it lands only on a break).
 */
export function checkSlot(
  clockSaysBreak: boolean,
  w: Written,
  hit: { durationMs: number },
  legalId: string | null,
): WrittenSlot {
  const checked = checkKind(clockSaysBreak, w);
  let kind = checked.kind;
  let fallback = checked.fallback;
  const words = w.words.trim();
  if ((kind === "talkup" || kind === "sweeper") && !words) {
    fallback = { from: kind, to: "segue", reason: "no words" };
    kind = "segue";
  }
  return {
    qobuzId: w.pick,
    rampMs: clampMs(w.rampSec, hit.durationMs),
    sure: w.sure,
    post: w.post,
    outro: w.outro,
    outroMs: clampMs(w.outroSec, hit.durationMs),
    energy: w.energy,
    tempo: w.tempo,
    mood: w.mood,
    kind,
    words: kind === "segue" ? null : words,
    leadLine: kind === "break" && w.leadLine.trim() ? w.leadLine.trim() : null,
    legalId: kind === "break" ? legalId : null,
    treatment: w.treatment,
    fallback,
    recordUnderMs: kind === "break" ? clampMs(w.recordUnderSec, MAX_RECORD_UNDER_MS) : null,
    voiceInMs: kind === "talkup" ? clampMs(w.voiceInSec, MAX_VOICE_IN_MS) : null,
  };
}
