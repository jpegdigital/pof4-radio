import type { Slot } from "./shapes";

/**
 * The law over the writer's program, pure: judgment lives in the model, this turns what it
 * wrote into slots that can play. Slot 1 is the break, a break anywhere else is a sweeper, a
 * talk-up needs a card with a ≥ MIN_TALKUP_INTRO_MS intro, a talk-up or sweeper with nothing
 * to say is a segue, and a segue says nothing at all. Every step down is kept on the slot as
 * its fallback. The legal ID is the server's, not the writer's: it lands on slot 1 when given.
 * The writer's two timing numbers are kept where they mean something — the record starting
 * under a break's lead line, the voice coming in on a talk-up — clamped to sense, and dropped
 * elsewhere: everything else about the mix is a house constant in the player.
 */

export type SlotKind = Slot["kind"];

export interface SlotFallback {
  from: SlotKind;
  to: SlotKind;
  reason: string;
}

/** The program half of one session_slot row, ready to insert. */
export interface ProgramSlot {
  seq: number;
  trackId: string;
  kind: SlotKind;
  words: string | null;
  leadLine: string | null;
  legalId: string | null;
  /** Breaks: how long before the voice ends the record starts under it. */
  recordUnderMs: number | null;
  /** Talk-ups: how far into the record the voice comes in. */
  voiceInMs: number | null;
  why: string;
  fallback?: SlotFallback;
}

/** A talk-up needs a real instrumental intro: at least this long. */
export const MIN_TALKUP_INTRO_MS = 7000;
/** A break's record can start no earlier than this before the voice ends, whatever the writer says. */
export const MAX_RECORD_UNDER_MS = 10_000;
/** A talk-up's voice can wait no longer than this into the record. */
export const MAX_VOICE_IN_MS = 10_000;

const clampMs = (sec: number, max: number) =>
  Number.isFinite(sec) ? Math.round(Math.min(max, Math.max(0, sec * 1000))) : 0;

export const RULES_TEXT = [
  "Rules of the clock (the hard ones are enforced after you answer):",
  "- Slot 1 is the break: the DJ over a bed, then the lead line into the first record. Every other slot is a talk-up, a segue or a sweeper — never a break; a segment is one break and its songs.",
  `- A talk-up only over a record whose intro runs ${MIN_TALKUP_INTRO_MS / 1000} s or more, and only when its card says so. Never over a record that starts on the vocal, never without a card. Keep it short enough to end a beat before the vocal.`,
  "- A segue straight out of a fade into a strong start; a sweeper where the energy jumps or a reset is wanted.",
  "- Length is time on air, at about 2.5 words a second. The break: 40 to 60 words, never more, and then the lead line — one sentence. A talk-up: as many words as fit the intro with a beat to spare, so an 8 s intro holds 15 words and a 20 s intro 40; count them. A sweeper: 3 to 8 words.",
  "- Never quote a lyric. Never read the legal ID yourself: when the brief gives one, it is said before your words.",
].join("\n");

/**
 * The hard rules on one slot's kind: slot 1 is the break; a break anywhere else is a sweeper; a
 * talk-up needs a card with an intro long enough. The step down, if any, is the fallback.
 */
function checkKind(
  seq: number,
  kind: SlotKind,
  card: { introMs: number } | undefined,
): { kind: SlotKind; fallback?: SlotFallback } {
  if (seq === 1) {
    return kind === "break"
      ? { kind }
      : { kind: "break", fallback: { from: kind, to: "break", reason: "the first slot is the break" } };
  }
  if (kind === "break") {
    return {
      kind: "sweeper",
      fallback: { from: "break", to: "sweeper", reason: "a segment has one break, at its top" },
    };
  }
  if (kind !== "talkup") return { kind };
  if (card && card.introMs >= MIN_TALKUP_INTRO_MS) return { kind };
  const reason = !card ? "no card" : `${card.introMs} ms intro is under ${MIN_TALKUP_INTRO_MS} ms`;
  return { kind: "segue", fallback: { from: "talkup", to: "segue", reason } };
}

export function checkProgram(
  raw: Slot[],
  tracks: { id: string }[],
  cards: Map<string, { introMs: number }>,
  legalId: string | null,
): ProgramSlot[] {
  if (raw.length !== tracks.length)
    throw new Error(`the writer returned ${raw.length} slots for ${tracks.length} tracks`);
  return raw.map((r, i) => {
    const seq = i + 1;
    const track = tracks[i];
    const checked = checkKind(seq, r.kind, cards.get(track.id));
    let kind: SlotKind = checked.kind;
    let fallback: SlotFallback | undefined = checked.fallback;
    const words = r.words.trim();
    if ((kind === "talkup" || kind === "sweeper") && !words) {
      fallback = { from: kind, to: "segue", reason: "no words" };
      kind = "segue";
    }
    const slot: ProgramSlot = {
      seq,
      trackId: track.id,
      kind,
      words: kind === "segue" ? null : words,
      leadLine: kind === "break" && r.leadLine.trim() ? r.leadLine.trim() : null,
      legalId: kind === "break" && seq === 1 ? legalId : null,
      recordUnderMs: kind === "break" ? clampMs(r.recordUnderSec, MAX_RECORD_UNDER_MS) : null,
      voiceInMs: kind === "talkup" ? clampMs(r.voiceInSec, MAX_VOICE_IN_MS) : null,
      why: r.why,
    };
    if (fallback) slot.fallback = fallback;
    return slot;
  });
}
