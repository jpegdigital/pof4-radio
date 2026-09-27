/**
 * The booth's sense of time, pure: what tempo a chart implies, how the gold one raises and lowers
 * the mic, where the bass hits and the beat count locked to it, where the voice's syllables and
 * phrases start, and how big the world is. The scene and the dance read these every frame;
 * nothing here touches the canvas or the audio graph.
 */

import type { Chart } from "../../../(app)/sessions/[id]/types";

/** The chart's tempo word as beats per minute, until the bass says otherwise. */
const TEMPO_BPM: Record<Chart["tempo"], number> = { down: 92, mid: 112, up: 126, unknown: 118 };

export function tempoOf(tempo: Chart["tempo"] | undefined): number {
  return TEMPO_BPM[tempo ?? "unknown"];
}

/** The gold DJ's mic sheet: frames 0–7 raise it, 7–12 are the talk, bounced. */
export const GOLD_MIC = { raise: 7, loopFrom: 7, loopTo: 12, raiseMs: 80, talkMs: 120 } as const;

/** The mic sheet frame `sinceMs` after the mic opened (talking) or closed; null once it is down. */
export function micFrame(talking: boolean, sinceMs: number): number | null {
  const { raise, loopFrom, loopTo, raiseMs, talkMs } = GOLD_MIC;
  const raising = raise * raiseMs;
  if (!talking) return sinceMs < raising ? loopFrom - Math.floor(sinceMs / raiseMs) : null;
  if (sinceMs < raising) return Math.floor(sinceMs / raiseMs);
  const span = loopTo - loopFrom;
  const step = Math.floor((sinceMs - raising) / talkMs) % (span * 2);
  return loopFrom + (step <= span ? step : span * 2 - step);
}

/** Bass energy (0–1) below this is never a beat: silence and the voice alone stay still. */
export const BEAT_FLOOR = 0.18;
const BEAT_RISE = 1.4;
const BEAT_HOLD_MS = 280;
const LEVEL_EASE = 0.1;
const TEMPO_MEMORY = 8;
const TEMPO_MIN_SAMPLES = 4;
const BPM_LOW = 85;
const BPM_HIGH = 170;

export interface Beat {
  /** The running bass level a hit must rise over. */
  level: number;
  lastMs: number | null;
  /** Recent inter-beat tempos, folded into the dance range. */
  tempos: number[];
  bpm: number | null;
}

export const newBeat = (): Beat => ({ level: 0, lastMs: null, tempos: [], bpm: null });

const fold = (bpm: number) => {
  let b = bpm;
  while (b < BPM_LOW) b *= 2;
  while (b > BPM_HIGH) b /= 2;
  return b;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** One analyser frame: whether the bass just hit, and the tempo the hits so far imply. */
export function beatStep(state: Beat, energy: number, nowMs: number): { beat: boolean; state: Beat } {
  const beat =
    energy > BEAT_FLOOR &&
    energy > state.level * BEAT_RISE &&
    (state.lastMs === null || nowMs - state.lastMs > BEAT_HOLD_MS);
  const level = state.level + (energy - state.level) * LEVEL_EASE;
  if (!beat) return { beat, state: { ...state, level } };
  const tempos =
    state.lastMs === null
      ? state.tempos
      : [...state.tempos, fold(60_000 / (nowMs - state.lastMs))].slice(-TEMPO_MEMORY);
  const bpm = tempos.length >= TEMPO_MIN_SAMPLES ? median(tempos) : state.bpm;
  return { beat, state: { level, lastMs: nowMs, tempos, bpm } };
}

/** How far a bass hit pulls the running beat count toward the nearest whole beat. */
const LOCK_PULL = 0.5;

/** The beat count `dtMs` on at `bpm`, pulled toward the beat when the bass hits: the dancers' clock. */
export function lockBeats(beats: number, dtMs: number, bpm: number, hit: boolean): number {
  const next = beats + (dtMs * bpm) / 60_000;
  return hit ? next - (next - Math.round(next)) * LOCK_PULL : next;
}

/** The voice's RMS (0–1) below this is silence; a level this high is full voice. */
export const SPEECH_FLOOR = 0.04;
export const SPEECH_FULL = 0.3;
const SPEECH_ATTACK = 0.6;
const SPEECH_RELEASE = 0.2;
/** A syllable is re-armed once the level falls this far under its peak. */
const SPEECH_REARM = 0.6;
const SYLLABLE_MS = 100;
/** Quiet this long between words is a pause: the next word starts a new phrase. */
const PAUSE_MS = 350;

export interface Speech {
  level: number;
  peak: number;
  armed: boolean;
  lastMs: number | null;
  quietSince: number | null;
  syllables: number;
  phrase: number;
}

export const newSpeech = (): Speech => ({
  level: 0,
  peak: 0,
  armed: true,
  lastMs: null,
  quietSince: null,
  syllables: 0,
  phrase: 0,
});

/** One frame of the voice lane: whether a syllable just started, counting syllables and phrases. */
export function speechStep(state: Speech, rms: number, nowMs: number): { onset: boolean; state: Speech } {
  const level = state.level + (rms - state.level) * (rms > state.level ? SPEECH_ATTACK : SPEECH_RELEASE);
  const quiet = level < SPEECH_FLOOR;
  const quietSince = quiet ? (state.quietSince ?? nowMs) : state.quietSince;
  const armed = state.armed || quiet || level < state.peak * SPEECH_REARM;
  const rising = level > state.level;
  const onset = armed && rising && !quiet && (state.lastMs === null || nowMs - state.lastMs >= SYLLABLE_MS);
  if (!onset)
    return {
      onset,
      state: { ...state, level, quietSince, armed, peak: quiet ? 0 : Math.max(state.peak, level) },
    };
  const paused = state.syllables > 0 && quietSince !== null && nowMs - quietSince >= PAUSE_MS;
  return {
    onset,
    state: {
      level,
      peak: level,
      armed: false,
      lastMs: nowMs,
      quietSince: null,
      syllables: state.syllables + 1,
      phrase: state.phrase + (paused ? 1 : 0),
    },
  };
}

/** The world is 450 px tall at 16:9; wider screens see more city, tall ones more sky. */
const WORLD_HEIGHT = 450;
const WORLD_MIN_WIDTH = 360;
const WORLD_MAX_WIDTH = 1100;

export function sceneSize(viewWidth: number, viewHeight: number): { width: number; height: number } {
  if (!viewWidth || !viewHeight) return { width: 800, height: WORLD_HEIGHT };
  const aspect = viewWidth / viewHeight;
  const width = Math.min(WORLD_MAX_WIDTH, Math.max(WORLD_MIN_WIDTH, Math.round(WORLD_HEIGHT * aspect)));
  return { width, height: Math.max(WORLD_HEIGHT, Math.round(width / aspect)) };
}
