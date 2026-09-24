/**
 * The mix on paper, pure: from the kind, the clip's length (read when it loaded), Jev's
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
  /** Maximum overlap: breaks, or short talk-ups with a post beyond five seconds. */
  recordUnderMs?: number;
  /** Talk-ups: how far into the track the voice comes in. */
  voiceInMs?: number;
  /** Finish speech just before this estimated song-relative post; absent on legacy plans. */
  finishAtMs?: number;
  /** Estimated first vocal, shown on the timeline; not a deadline for the DJ. */
  rampMs?: number;
  /** The legal ID's length in characters: said dry, the bed waits for it. */
  legalIdChars: number;
}

export interface Plan {
  /** Mixer viewport only, never the duration of the song or a playback limit. */
  previewEndMs: number;
  mic: { atMs: number; endMs: number } | null;
  /** The bed's gain: up from atMs to fullMs, down from downMs to outMs. */
  bed: { atMs: number; fullMs: number; downMs: number; outMs: number } | null;
  music: { atMs: number };
  /** The track under the voice: down as the voice comes in over it, back up once it is done. */
  duck: { atMs: number; endMs: number; riseMs?: number } | null;
  /** Where the vocal comes in, when the chart knows the ramp. */
  vocalMs?: number;
}

/** The bed's level under the voice: about -18 dB below it (a talk bed is felt, not heard). */
export const BED_GAIN = 0.12;
/** The bed's ramp up. */
export const BED_IN_MS = 800;
/** The bed's ramp down, ending as the track starts. */
export const BED_FADE_MS = 1500;
/** The dry legal ID's length, estimated from its characters. */
export const LEGAL_ID_MS_PER_CHAR = 70;
/** How much of the track the timeline shows after it starts, at least. */
export const TAIL_MS = 8000;
/** How far past the vocal the timeline shows, when the ramp is known. */
export const VOCAL_TAIL_MS = 3000;
/** The track's level on its own (the device's volume, 0–1). */
export const TRACK_FULL = 0.8;
/** The track's level under the voice. */
export const TRACK_DUCK = 0.4;
/** The track goes down over this long, landed as the voice comes in. */
export const DUCK_MS = 800;
/** The track comes back up over this long, from the moment the voice is done. */
export const RISE_MS = 1800;
export const VOICE_IN_MS = 8;
export const VOICE_OUT_MS = 25;
export const POST_MARGIN_MS = 150;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** The track under the voice, when they overlap: from the later start to the voice's end. */
function duckOf(mic: Plan["mic"], musicAt: number): Plan["duck"] {
  if (!mic || mic.endMs <= musicAt) return null;
  return { atMs: Math.max(mic.atMs, musicAt), endMs: mic.endMs };
}

/** The track's level at a moment: full, down over DUCK_MS into the duck, back up over RISE_MS after it. */
export function trackLevelAt(duck: Plan["duck"], ms: number): number {
  if (!duck) return TRACK_FULL;
  const downFrom = duck.atMs - DUCK_MS;
  const riseMs = duck.riseMs ?? RISE_MS;
  if (ms <= downFrom || ms >= duck.endMs + riseMs) return TRACK_FULL;
  if (ms < duck.atMs) return TRACK_FULL - (TRACK_FULL - TRACK_DUCK) * smooth((ms - downFrom) / DUCK_MS);
  if (ms <= duck.endMs) return TRACK_DUCK;
  return TRACK_DUCK + (TRACK_FULL - TRACK_DUCK) * smooth((ms - duck.endMs) / riseMs);
}

/** Sample the same eased curve used for seeks; schedule its remaining points on the audio clock. */
export function trackGainPoints(duck: Plan["duck"]): [number, number][] {
  if (!duck) return [];
  return [
    ...Array.from({ length: 17 }, (_, i) => duck.atMs - DUCK_MS + (DUCK_MS * i) / 16),
    ...Array.from({ length: 17 }, (_, i) => duck.endMs + ((duck.riseMs ?? RISE_MS) * i) / 16),
  ].map((ms) => [ms, trackLevelAt(duck, ms)]);
}

export function voiceLevelAt(mic: NonNullable<Plan["mic"]>, ms: number): number {
  if (ms <= mic.atMs || ms >= mic.endMs) return 0;
  const half = (mic.endMs - mic.atMs) / 2;
  return Math.min(
    1,
    (ms - mic.atMs) / Math.min(VOICE_IN_MS, half),
    (mic.endMs - ms) / Math.min(VOICE_OUT_MS, half),
  );
}

export function voiceGainPoints(mic: NonNullable<Plan["mic"]>): [number, number][] {
  const half = (mic.endMs - mic.atMs) / 2;
  return [
    [mic.atMs, 0],
    [mic.atMs + Math.min(VOICE_IN_MS, half), 1],
    [mic.endMs - Math.min(VOICE_OUT_MS, half), 1],
    [mic.endMs, 0],
  ];
}

/** How long the timeline runs past the track's start, and where its vocal is. */
function past(musicAt: number, rampMs: number | undefined): { previewEndMs: number; vocalMs?: number } {
  if (rampMs === undefined) return { previewEndMs: musicAt + TAIL_MS };
  const vocalMs = musicAt + rampMs;
  return { previewEndMs: Math.max(musicAt + TAIL_MS, vocalMs + VOCAL_TAIL_MS), vocalMs };
}

/** The bed's gain at a moment, from its ramps: what a scrub into the middle of it must land on. */
export function bedGainAt(bed: NonNullable<Plan["bed"]>, ms: number): number {
  if (ms <= bed.atMs || ms >= bed.outMs) return 0;
  if (ms < bed.fullMs) return (BED_GAIN * (ms - bed.atMs)) / (bed.fullMs - bed.atMs);
  if (ms <= bed.downMs) return BED_GAIN;
  return (BED_GAIN * (bed.outMs - ms)) / (bed.outMs - bed.downMs);
}

/** The last moment any intro lane or duck-release automation is still active. */
export function mixEnd(plan: Plan): number {
  return Math.max(
    plan.mic?.endMs ?? 0,
    plan.bed?.outMs ?? 0,
    plan.duck ? plan.duck.endMs + (plan.duck.riseMs ?? RISE_MS) : 0,
  );
}

export function planSlot(input: PlanInput): Plan {
  const plan = buildPlan(input);
  return { ...plan, previewEndMs: Math.max(plan.previewEndMs, mixEnd(plan)) };
}

function buildPlan(input: PlanInput): Plan {
  const { kind, clipMs } = input;
  if (clipMs === null || kind === "segue")
    return { ...past(0, input.rampMs), mic: null, bed: null, music: { atMs: 0 }, duck: null };

  if (kind === "break") {
    const bedAt = input.legalIdChars * LEGAL_ID_MS_PER_CHAR;
    // A short take may not have all the requested overlap available after its dry legal ID.
    const overlapMs =
      input.finishAtMs === undefined
        ? (input.recordUnderMs ?? 0)
        : Math.max(0, input.finishAtMs - POST_MARGIN_MS);
    const musicAt = Math.max(Math.min(clipMs, bedAt), clipMs - overlapMs);
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
      duck: postDuck(mic, musicAt, input.finishAtMs),
    };
  }

  if (kind === "talkup") {
    if (input.finishAtMs !== undefined || input.recordUnderMs !== undefined) {
      // Start the voice immediately. Bring in the song late enough for a long clip to finish
      // before the post; short clips finish early without padding or delaying the voice.
      const overlapMs =
        input.finishAtMs === undefined
          ? input.recordUnderMs!
          : Math.max(0, input.finishAtMs - POST_MARGIN_MS);
      const musicAt = Math.max(0, clipMs - overlapMs);
      const mic = { atMs: 0, endMs: clipMs };
      return {
        ...past(musicAt, input.rampMs),
        mic,
        bed: null,
        music: { atMs: musicAt },
        duck: postDuck(mic, musicAt, input.finishAtMs),
      };
    }
    const at = input.voiceInMs ?? 0;
    // Jev can deliberately cross an opening word. Play the natural take at its chosen start;
    // the catalog's estimated vocal cue must not veto or move that decision.
    const p = past(0, input.rampMs);
    const mic = { atMs: at, endMs: at + clipMs };
    const plan: Plan = {
      ...p,
      previewEndMs: Math.max(p.previewEndMs, at + clipMs),
      mic,
      bed: null,
      music: { atMs: 0 },
      duck: duckOf(mic, 0),
    };
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

function postDuck(mic: NonNullable<Plan["mic"]>, musicAt: number, finishAtMs?: number): Plan["duck"] {
  const duck = duckOf(mic, musicAt);
  if (!duck || finishAtMs === undefined) return duck;
  // Restore the music by the post so the vocal or hit lands at full level.
  return { ...duck, riseMs: Math.min(RISE_MS, Math.max(POST_MARGIN_MS, musicAt + finishAtMs - mic.endMs)) };
}
