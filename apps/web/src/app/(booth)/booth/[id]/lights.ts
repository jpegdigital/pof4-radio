/**
 * The lighting desk, pure: what the rig does this frame. The booth is a stage — a truss with
 * moving heads and blinders, floor fixtures firing into the sky, a laser sheet over the crowd, the
 * LED pyramid behind the duo, flame and CO2 jets on the lip, confetti cannons — and this file is
 * the operator: it reads the room's bass for breakdowns and the drop that ends one (`energyStep`),
 * and answers a `Cue` from the beat, the section and the mic. The groove changes its look every
 * phrase and strobes into the next; a breakdown goes slow and blue with the phones up and rolls
 * the strobe up over its last bars; the drop (or the record slamming back in after the DJ talks)
 * fires everything at once; on the mic every head swings onto the gold DJ and the rig goes warm.
 * The scene paints whatever this says; nothing here touches the canvas.
 */

export type Rgb = readonly [number, number, number];

/** How the room's bass has been going. */
export interface Energy {
  /** The bass, eased over a quarter second. */
  fast: number;
  /** The groove's level: frozen while the bass is gone, so the drop has something to come back to. */
  room: number;
  /** Since when the bass has been low; null while it is in. */
  lowSince: number | null;
  lastMs: number | null;
  /** When the last drop landed. */
  dropAt: number | null;
}

export const newEnergy = (): Energy => ({ fast: 0, room: 0, lowSince: null, lastMs: null, dropAt: null });

const FAST_MS = 250;
const ROOM_MS = 4000;
/** The bass under this share of the room's level has gone out… */
const LOW = 0.55;
/** …and over this share it is back. */
const BACK = 0.85;
/** Out this long is a breakdown, and its coming back a drop. */
const BREAKDOWN_MS = 2500;
/** Out this long is the record's new normal, not a breakdown. */
const RESET_MS = 24_000;
/** A room this quiet has nothing to break down from. */
const QUIET = 0.08;

/** One analyser frame of the room's bass (0–1). */
export function energyStep(s: Energy, bass: number, nowMs: number): Energy {
  const dt = s.lastMs === null ? 0 : nowMs - s.lastMs;
  const fast = s.fast + (bass - s.fast) * (1 - Math.exp(-dt / FAST_MS));
  if (s.lowSince !== null) {
    const out = nowMs - s.lowSince;
    if (fast > s.room * BACK)
      return {
        fast,
        room: s.room,
        lowSince: null,
        lastMs: nowMs,
        dropAt: out >= BREAKDOWN_MS ? nowMs : s.dropAt,
      };
    if (out >= RESET_MS) return { fast, room: fast, lowSince: null, lastMs: nowMs, dropAt: s.dropAt };
    return { ...s, fast, lastMs: nowMs };
  }
  if (s.room > QUIET && fast < s.room * LOW) return { ...s, fast, lowSince: nowMs, lastMs: nowMs };
  const room = s.room + (fast - s.room) * (1 - Math.exp(-dt / ROOM_MS));
  return { fast, room, lowSince: null, lastMs: nowMs, dropAt: s.dropAt };
}

export const inBreakdown = (s: Energy, nowMs: number) =>
  s.lowSince !== null && nowMs - s.lowSince >= BREAKDOWN_MS;

/** The moving heads' patterns. */
export const BEAMS = ["rest", "fan", "cross", "sweep", "wave", "tunnel", "follow"] as const;
export type Beams = (typeof BEAMS)[number];

/**
 * Fixture `i` of `n`'s angle off straight (radians, + toward stage right) at `beats` on the rig's
 * clock; `follow` is the angle that puts this fixture on the DJ.
 */
export function aim(beams: Beams, i: number, n: number, beats: number, follow: number): number {
  const u = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
  const turn = (period: number, phase = 0) => Math.sin((Math.PI * 2 * beats) / period + phase);
  switch (beams) {
    case "rest":
      return u * 0.15;
    case "fan":
      return u * (0.25 + 0.45 * (0.5 + 0.5 * turn(8)));
    case "cross":
      return (i % 2 ? 1 : -1) * (0.35 + 0.2 * turn(4));
    case "sweep":
      return 0.6 * turn(8);
    case "wave":
      return 0.5 * turn(8, -u * 2.5);
    case "tunnel":
      return -u * (0.3 + 0.1 * turn(4));
    case "follow":
      return follow + 0.04 * Math.sin(beats + i);
  }
}

/** What the LED pyramid behind the duo shows. */
export type Portal = "breathe" | "chase" | "pulse" | "spectrum" | "burst";

export interface Cue {
  colors: readonly [Rgb, Rgb];
  beams: Beams;
  /** The rig's clock against the beat: slower in a breakdown, slower still on the mic. */
  speed: number;
  /** The rig's brightness. */
  level: number;
  /** Every effect 0–1: the strobe's flash, the blinders' glare, and how hard the jets and cannons fire. */
  strobe: number;
  blinders: number;
  pyro: number;
  co2: number;
  confetti: number;
  /** The laser sheet over the crowd. */
  lasers: number;
  portal: Portal;
  /** The crowd: phone lights up, hands up. */
  phones: number;
  hands: number;
}

/** What the room is doing, as the desk reads it. */
export interface Show {
  beats: number;
  playing: boolean;
  talking: boolean;
  /** Ms since the mic last opened or closed; Infinity before it ever has. */
  micMs: number;
  breakdown: boolean;
  /** Ms since the last drop; Infinity before one. */
  dropMs: number;
  bass: number;
}

const STATION: readonly [Rgb, Rgb] = [
  [255, 43, 214],
  [60, 240, 255],
];
const WARM: readonly [Rgb, Rgb] = [
  [255, 176, 80],
  [255, 228, 190],
];
const DEEP: readonly [Rgb, Rgb] = [
  [70, 90, 255],
  [150, 60, 255],
];
/** The groove's looks, one a phrase, in turn. */
const LOOKS: readonly { beams: Beams; colors: readonly [Rgb, Rgb]; portal: Portal; lasers: number }[] = [
  { beams: "fan", colors: STATION, portal: "chase", lasers: 0.6 },
  {
    beams: "cross",
    colors: [
      [255, 40, 60],
      [255, 170, 40],
    ],
    portal: "pulse",
    lasers: 0,
  },
  {
    beams: "wave",
    colors: [
      [150, 60, 255],
      [80, 255, 120],
    ],
    portal: "spectrum",
    lasers: 1,
  },
  {
    beams: "sweep",
    colors: [
      [60, 240, 255],
      [255, 255, 255],
    ],
    portal: "chase",
    lasers: 0.4,
  },
  {
    beams: "tunnel",
    colors: [
      [255, 43, 214],
      [255, 200, 60],
    ],
    portal: "pulse",
    lasers: 0.8,
  },
];
const PHRASE = 32;
/** The last beats of a phrase strobe into the next. */
const FILL_BEATS = 2;
/** A breakdown rolls the strobe up over the last beats of every sixteen. */
const ROLL = { every: 16, beats: 4 } as const;
/** How long a drop runs its effects, and each effect's share of it. */
const DROP_MS = 8000;
const PYRO_MS = 900;
const CO2_MS = 1600;
const BLINDER_MS = 700;
const CONFETTI_MS = 6000;
/** Flames on the downbeat of every two bars through the drop, and every fourth phrase of a loud groove. */
const PYRO_EVERY = 8;
const PYRO_PHRASES = 4;
const LOUD = 0.45;

const frac = (x: number) => x - Math.floor(x);
/** On for the first `duty` of every `per` beats. */
const gate = (beats: number, per: number, duty: number) => (frac(beats / per) < duty ? 1 : 0);

const NOTHING = { strobe: 0, blinders: 0, pyro: 0, co2: 0, confetti: 0 };

export function cue(s: Show): Cue {
  if (!s.playing)
    return {
      ...NOTHING,
      colors: STATION,
      beams: "rest",
      speed: 0.2,
      level: 0.15,
      lasers: 0,
      portal: "breathe",
      phones: 0,
      hands: 0,
    };
  if (s.talking)
    return {
      ...NOTHING,
      colors: WARM,
      beams: "follow",
      speed: 0.25,
      level: 0.45,
      lasers: 0,
      portal: "breathe",
      phones: 1,
      hands: 0.2,
    };

  const phrase = Math.floor(Math.max(0, s.beats) / PHRASE);
  const into = s.beats - phrase * PHRASE;
  const look = LOOKS[phrase % LOOKS.length];
  const dropMs = Math.min(s.dropMs, s.micMs);

  if (dropMs < DROP_MS)
    return {
      colors: look.colors,
      beams: look.beams,
      speed: 1,
      level: 1,
      strobe: dropMs < CO2_MS ? gate(s.beats, 0.25, 0.4) : 0,
      blinders: Math.max(0, 1 - dropMs / BLINDER_MS),
      pyro: dropMs < PYRO_MS ? 1 : gate(s.beats, PYRO_EVERY, 0.06),
      co2: dropMs < CO2_MS ? 1 : 0,
      confetti: Math.max(0, 1 - dropMs / CONFETTI_MS),
      lasers: 1,
      portal: "burst",
      phones: 0,
      hands: 1,
    };

  if (s.breakdown) {
    const bar = frac(s.beats / ROLL.every) * ROLL.every;
    const roll = Math.max(0, (bar - (ROLL.every - ROLL.beats)) / ROLL.beats);
    return {
      ...NOTHING,
      colors: DEEP,
      beams: "wave",
      speed: 0.5,
      level: 0.45 + 0.3 * roll,
      strobe: roll * gate(s.beats, 0.25, 0.25),
      lasers: 0.4,
      portal: "breathe",
      phones: 0.8,
      hands: 0.3 + 0.6 * roll,
    };
  }

  const loud = s.bass > LOUD;
  return {
    colors: look.colors,
    beams: look.beams,
    speed: 1,
    level: into >= PHRASE - FILL_BEATS ? 1 : 0.7 + 0.3 * s.bass,
    strobe: into >= PHRASE - FILL_BEATS ? gate(s.beats, 0.25, 0.5) : 0,
    blinders: phrase > 0 ? Math.max(0, 1 - into * 2) : 0,
    pyro: phrase > 0 && phrase % PYRO_PHRASES === 0 && into < 0.75 && loud ? 1 : 0,
    co2: phrase > 0 && phrase % 2 === 1 && into < 1 && loud ? 1 : 0,
    confetti: 0,
    lasers: look.lasers,
    portal: look.portal,
    phones: 0.1,
    hands: 0.5,
  };
}
