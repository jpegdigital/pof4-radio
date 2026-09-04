/**
 * The mix on paper, pure: from the kind, the clip's length (read when it loaded), the writer's
 * two numbers and the chart's ramp, when the mic, the bed and the track start and stop —
 * every time in ms from the moment play is pressed. Opportunistic by design: nothing is
 * measured in the audio, the numbers are the writer's and the house's, and the player
 * follows them. A slot with no clip is the track alone.
 */

export type SlotKind = "break" | "talkup" | "sweeper" | "segue";

export interface PlanInput {
  kind: SlotKind;
  /** The clip's length, or null when there is none. */
  clipMs: number | null;
  /** Breaks: how long before the voice ends the track starts under it. */
  recordUnderMs?: number;
  /** Talk-ups: how far into the track the voice comes in. */
  voiceInMs?: number;
  /** The chart's ramp, when known: a talk-up must be done a beat before it ends. */
  rampMs?: number;
  /** The legal ID's length in characters: said dry, the bed waits for it. */
  legalIdChars: number;
}

export interface Plan {
  /** How long the timeline runs: the track's start plus a tail. */
  lengthMs: number;
  mic: { atMs: number; endMs: number } | null;
  /** The bed's gain: up from atMs to fullMs, down from downMs to outMs. */
  bed: { atMs: number; fullMs: number; downMs: number; outMs: number } | null;
  music: { atMs: number };
  /** The track under the voice: down as the voice comes in over it, back up once it is done. */
  duck: { atMs: number; endMs: number } | null;
  /** Where the vocal comes in, when the chart knows the ramp. */
  vocalMs?: number;
  /** Where the plan could not do what was asked, in words. */
  note?: string;
}

/** The bed's level under the voice: about -18 dB below it (a talk bed is felt, not heard). */
export const BED_GAIN = 0.12;
/** The bed's ramp up. */
export const BED_IN_MS = 800;
/** The bed's ramp down, ending as the track starts. */
export const BED_FADE_MS = 1500;
/** A talk-up ends this long before the vocal. */
export const BEAT_MS = 400;
/** The dry legal ID's length, estimated from its characters. */
export const LEGAL_ID_MS_PER_CHAR = 70;
/** How much of the track the timeline shows after it starts, at least. */
export const TAIL_MS = 8000;
/** How far past the vocal the timeline shows, when the ramp is known. */
export const VOCAL_TAIL_MS = 3000;
/** The track's level on its own (the device's volume, 0–1). */
export const TRACK_FULL = 0.8;
/** The track's level under the voice. */
export const TRACK_DUCK = 0.3;
/** The track goes down over this long, landed as the voice comes in. */
export const DUCK_MS = 600;
/** The track comes back up over this long, from the moment the voice is done. */
export const RISE_MS = 1200;

/** The track under the voice, when they overlap: from the later start to the voice's end. */
function duckOf(mic: Plan["mic"], musicAt: number): Plan["duck"] {
  if (!mic || mic.endMs <= musicAt) return null;
  return { atMs: Math.max(mic.atMs, musicAt), endMs: mic.endMs };
}

/** The track's level at a moment: full, down over DUCK_MS into the duck, back up over RISE_MS after it. */
export function trackLevelAt(duck: Plan["duck"], ms: number): number {
  if (!duck) return TRACK_FULL;
  const downFrom = duck.atMs - DUCK_MS;
  if (ms <= downFrom || ms >= duck.endMs + RISE_MS) return TRACK_FULL;
  if (ms < duck.atMs) return TRACK_FULL - ((TRACK_FULL - TRACK_DUCK) * (ms - downFrom)) / DUCK_MS;
  if (ms <= duck.endMs) return TRACK_DUCK;
  return TRACK_DUCK + ((TRACK_FULL - TRACK_DUCK) * (ms - duck.endMs)) / RISE_MS;
}

/** How long the timeline runs past the track's start, and where its vocal is. */
function past(musicAt: number, rampMs: number | undefined): { lengthMs: number; vocalMs?: number } {
  if (rampMs === undefined) return { lengthMs: musicAt + TAIL_MS };
  const vocalMs = musicAt + rampMs;
  return { lengthMs: Math.max(musicAt + TAIL_MS, vocalMs + VOCAL_TAIL_MS), vocalMs };
}

/** The bed's gain at a moment, from its ramps: what a scrub into the middle of it must land on. */
export function bedGainAt(bed: NonNullable<Plan["bed"]>, ms: number): number {
  if (ms <= bed.atMs || ms >= bed.outMs) return 0;
  if (ms < bed.fullMs) return (BED_GAIN * (ms - bed.atMs)) / (bed.fullMs - bed.atMs);
  if (ms <= bed.downMs) return BED_GAIN;
  return (BED_GAIN * (bed.outMs - ms)) / (bed.outMs - bed.downMs);
}

export function planSlot(input: PlanInput): Plan {
  const { kind, clipMs } = input;
  if (clipMs === null || kind === "segue")
    return { ...past(0, input.rampMs), mic: null, bed: null, music: { atMs: 0 }, duck: null };

  if (kind === "break") {
    const musicAt = Math.max(0, clipMs - (input.recordUnderMs ?? 0));
    const bedAt = input.legalIdChars * LEGAL_ID_MS_PER_CHAR;
    const fullMs = bedAt + BED_IN_MS;
    const bed =
      musicAt > fullMs
        ? { atMs: bedAt, fullMs, downMs: Math.max(fullMs, musicAt - BED_FADE_MS), outMs: musicAt }
        : null;
    const mic = { atMs: 0, endMs: clipMs };
    return {
      ...past(musicAt, input.rampMs),
      mic,
      bed,
      music: { atMs: musicAt },
      duck: duckOf(mic, musicAt),
    };
  }

  if (kind === "talkup") {
    let at = input.voiceInMs ?? 0;
    let note: string | undefined;
    if (input.rampMs !== undefined) {
      const latest = input.rampMs - BEAT_MS - clipMs;
      if (at > latest) at = Math.max(0, latest);
      const over = at + clipMs - (input.rampMs - BEAT_MS);
      if (over > 0) note = `the talk-up runs ${(over / 1000).toFixed(1)} s past the vocal`;
    }
    const p = past(0, input.rampMs);
    const mic = { atMs: at, endMs: at + clipMs };
    const plan: Plan = {
      ...p,
      lengthMs: Math.max(p.lengthMs, at + clipMs),
      mic,
      bed: null,
      music: { atMs: 0 },
      duck: duckOf(mic, 0),
    };
    if (note) plan.note = note;
    return plan;
  }

  // sweeper: dry, then a hard start
  return {
    ...past(clipMs, input.rampMs),
    mic: { atMs: 0, endMs: clipMs },
    bed: null,
    music: { atMs: clipMs },
    duck: null,
  };
}
