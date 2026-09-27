import { micFrame } from "./rhythm";

/**
 * The duo's choreography, pure: where each robot's shoulders, head and sprite are this frame.
 * The scene cuts each sprite in three — the head, the torso, and the hands on the decks, which
 * never move — and lays them by the `Pose` this file answers. Both dance from one book of moves,
 * each on its own running order, changing every sixteen beats half a section apart, so the booth
 * is never two robots doing one loop. On the mic, gold steps up to the middle and talks with its
 * whole body — a dip on every syllable, a new angle for every phrase, the chin up when it
 * projects — while silver makes room and turns to listen. When the record comes back in, both
 * hit harder for a bar or two. Stopped, they breathe.
 */

export type Who = "gold" | "silver";

/** What the room is doing, as the dancers feel it. */
export interface Stage {
  /** Seconds, for breathing and the slow drifts. */
  t: number;
  /** The beat count, locked to the bass (`lockBeats`): the whole part counts beats, the fraction is where in one. */
  beats: number;
  playing: boolean;
  talking: boolean;
  /** Ms since the mic last opened or closed; Infinity before it ever has. */
  micMs: number;
  /** The voice's level, 0–1. */
  voice: number;
  /** 1 on a syllable's onset, easing to 0. */
  syllable: number;
  /** Syllables so far, and phrases so far (one per pause). */
  syllables: number;
  phrase: number;
  /** How hard the room hits, 0–1. */
  bass: number;
}

export interface Pose {
  sheet: "groove" | "mic";
  frame: number;
  /** The whole figure's step across the stage, px. */
  x: number;
  /** The shoulders down (+) or up (−), px; the hands stay on the decks. */
  y: number;
  /** The shoulders to the side, px: the torso shears from the hips. */
  lean: number;
  /** The head on the neck, px. */
  headX: number;
  headY: number;
  /** The crown's shift against the chin, px: a tilt, drawn as a shear. */
  tilt: number;
}

type Body = Pick<Pose, "x" | "y" | "lean" | "headX" | "headY" | "tilt">;

const STILL: Body = { x: 0, y: 0, lean: 0, headX: 0, headY: 0, tilt: 0 };
/** The fraction of a beat the head takes to go down; it comes back up over the rest. */
const HIT = 0.1;
/** The head trails the shoulders by a little. */
const LAG = 0.05;

const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const swing = (beats: number, period: number) => Math.sin((Math.PI * 2 * beats) / period);

/** A nod: down hard just after the beat, back up slow; 1 at the bottom, 0 at the top. */
export function nod(beats: number): number {
  const q = frac(beats);
  return q < HIT ? q / HIT : ((1 - q) / (1 - HIT)) ** 2;
}

/** The book: each move is a body as a function of the beat. */
export const MOVES = {
  /** The head does the work; the shoulders follow a little. */
  nod: (b: number): Body => ({ ...STILL, y: nod(b), headY: 2.5 * nod(b - LAG) }),
  /** Side to side over two beats, the head counter-tilting a beat behind. */
  sway: (b: number): Body => ({
    ...STILL,
    y: 0.8 * nod(b),
    lean: 3 * swing(b, 2),
    headX: swing(b - 0.25, 2),
    headY: 1.5 * nod(b - LAG),
    tilt: -1.5 * swing(b - 0.3, 2),
  }),
  /** Head down, shoulders pumping, alternating sides. */
  pump: (b: number): Body => ({
    ...STILL,
    y: 2 * nod(b),
    lean: (Math.floor(b) % 2 ? 1 : -1) * nod(b),
    headY: 3.5 * nod(b - LAG),
  }),
  /** Crouched into the mix, quick nods on the eighths, drifting. */
  dig: (b: number): Body => ({
    ...STILL,
    y: 2,
    lean: 1.2 * swing(b, 4),
    headY: 2 + 1.5 * nod(2 * b),
    tilt: swing(b, 8),
  }),
  /** Half time: a big bounce every other beat, the body rolling. */
  bounce: (b: number): Body => ({
    ...STILL,
    y: 3 * nod(b / 2),
    lean: 2 * swing(b, 4),
    headY: 2 * nod(b - LAG),
    tilt: -swing(b, 4),
  }),
};
type Move = keyof typeof MOVES;

/** Each robot's running order; a move lasts a section, and silver's sections start half one later. */
const SETS: Record<Who, readonly Move[]> = {
  gold: ["nod", "sway", "pump", "dig", "bounce", "sway", "nod", "pump"],
  silver: ["sway", "dig", "nod", "bounce", "sway", "pump", "dig", "nod"],
};
const SECTION = 16;
const OFFSET: Record<Who, number> = { gold: 0, silver: SECTION / 2 };
/** The last beats of a section build into the next: bigger. */
const FILL_BEATS = 2;
const FILL = 1.4;

/** The move on now, the one before, and how far into the change (0 → 1 over the first beat). */
export function moveAt(who: Who, beats: number): { move: Move; from: Move; blend: number; fill: boolean } {
  const set = SETS[who];
  const b = Math.max(0, beats) + OFFSET[who];
  const i = Math.floor(b / SECTION);
  const into = b - i * SECTION;
  return {
    move: set[i % set.length],
    from: set[i > 0 ? (i - 1) % set.length : 0],
    blend: smooth(into),
    fill: into >= SECTION - FILL_BEATS,
  };
}

/** Stepping up to the mic and back: how long it takes and how far each goes, px (toward stage right). */
export const TALK_STEP = { ms: 600, gold: 14, silver: 8 } as const;
/** How long the record hits harder once the mic closes. */
const DROP_MS = 4000;
const DROP = 0.8;
/** The voice is speaking above this; below it, a rest between words. */
const SPEAKING = 0.15;
/** One mouth per syllable, never the same twice running. */
const MOUTHS = [8, 10, 9, 11, 8, 9, 11, 10] as const;
/** Each phrase says it from another angle: the head's tilt and the shoulders' lean. */
const ANGLES = [
  { tilt: 1.5, lean: 1 },
  { tilt: -1, lean: 2 },
  { tilt: 0, lean: -1 },
  { tilt: 2, lean: 0 },
  { tilt: -1.5, lean: 1.5 },
] as const;

/** The talk loop's cell on the mic sheet: a mouth per syllable, a rest between words. */
export function talkFrame(voice: number, syllables: number, phrase: number): number {
  if (voice < SPEAKING) return phrase % 2 ? 12 : 7;
  return MOUTHS[syllables % MOUTHS.length];
}

const mix = (a: Body, b: Body, w: number): Body => ({
  x: a.x + (b.x - a.x) * w,
  y: a.y + (b.y - a.y) * w,
  lean: a.lean + (b.lean - a.lean) * w,
  headX: a.headX + (b.headX - a.headX) * w,
  headY: a.headY + (b.headY - a.headY) * w,
  tilt: a.tilt + (b.tilt - a.tilt) * w,
});
const scale = (a: Body, k: number): Body => mix(STILL, a, k);

/** The groove sheet cycles its eight frames over two beats. */
const grooveCell = (beats: number) => 1 + Math.floor(frac(beats / 2) * 8);

export function pose(who: Who, s: Stage): Pose {
  // Stopped: breathing, the head looking round the room.
  if (!s.playing && !s.talking) {
    const k = who === "gold" ? 0 : 2.1;
    return {
      sheet: "groove",
      frame: 0,
      x: 0,
      y: 0.6 * Math.sin(s.t * 1.5 + k),
      lean: 0,
      headX: 1.2 * Math.sin(s.t * 0.35 + k),
      headY: 0,
      tilt: Math.sin(s.t * 0.23 + k),
    };
  }

  // The dance, from the book, blended across a change of move.
  const at = moveAt(who, s.beats);
  const b = s.beats + OFFSET[who];
  let amp = 0.75 + 0.5 * clamp01(s.bass);
  if (at.fill) amp *= FILL;
  if (!s.talking && s.micMs < DROP_MS) amp *= 1 + DROP * (1 - s.micMs / DROP_MS);
  const dance = scale(mix(MOVES[at.from](b), MOVES[at.move](b), at.blend), amp);

  // How far into the talk: steps up over TALK_STEP.ms, back down the same.
  const opened = s.micMs / TALK_STEP.ms;
  const w = s.talking ? smooth(opened) : Number.isFinite(s.micMs) ? 1 - smooth(opened) : 0;

  if (who === "silver") {
    // Listening: turned to gold, a slow nod every other beat, a nod along with the words.
    const listen: Body = {
      x: TALK_STEP.silver,
      y: 0.5 * nod(s.beats / 2),
      lean: -2 + 0.5 * swing(s.beats, 8),
      headX: -1,
      headY: 1.2 * nod(s.beats / 2 - LAG) + 0.8 * s.syllable,
      tilt: -1.5 + 0.4 * swing(s.beats, 8),
    };
    return {
      sheet: "groove",
      frame: s.talking ? grooveCell(s.beats / 2) : grooveCell(b),
      ...mix(dance, listen, w),
    };
  }

  const mic = micFrame(s.talking, s.micMs);
  const raised = s.talking && mic !== null && mic >= 7;
  const angle = ANGLES[s.phrase % ANGLES.length];
  const voice = clamp01(s.voice);
  const talk: Body = {
    x: TALK_STEP.gold,
    y: 1.2 * s.syllable + 0.3 * Math.sin(s.t * 1.7),
    lean: angle.lean * smooth(voice * 3) + 0.8 * Math.sin(s.t * 1.1),
    headX: 0.8 * s.syllable,
    headY: 1.8 * s.syllable - voice + 0.6 * nod(s.beats - LAG),
    tilt: angle.tilt * smooth(voice * 3),
  };
  return {
    sheet: mic === null ? "groove" : "mic",
    frame: mic === null ? grooveCell(b) : raised ? talkFrame(voice, s.syllables, s.phrase) : mic,
    ...mix(dance, talk, w),
  };
}
