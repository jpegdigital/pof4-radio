/**
 * The booth's sense of time, pure: what tempo a chart implies, which sprite frame the duo is on,
 * how the gold one raises and lowers the mic, where the bass hits, and how big the world is.
 * The scene reads these every frame; nothing here touches the canvas or the audio graph.
 */

import type { Chart } from "../../../(app)/sessions/[id]/types";

/** The chart's tempo word as beats per minute, until the bass says otherwise. */
const TEMPO_BPM: Record<Chart["tempo"], number> = { down: 92, mid: 112, up: 126, unknown: 118 };

export function tempoOf(tempo: Chart["tempo"] | undefined): number {
  return TEMPO_BPM[tempo ?? "unknown"];
}

/** One groove loop is two beats: the head goes down and up on each. */
const BEATS_PER_LOOP = 2;

export function grooveFrame(ms: number, bpm: number, frames: number): number {
  const loopMs = (60_000 / bpm) * BEATS_PER_LOOP;
  return Math.floor(((Math.max(0, ms) % loopMs) / loopMs) * frames);
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
