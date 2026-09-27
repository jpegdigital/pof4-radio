import { type Pose, pose, type Stage } from "./dance";
import { aim, type Cue, cue, type Rgb } from "./lights";

/**
 * The booth, painted: one low-resolution canvas the page scales up with crisp pixels. Back to
 * front — the sky and its stars, the skyline and its striped sun (PixelLab), the LED pyramid
 * behind the duo, the floor fixtures firing into the sky, the outrun floor, the truss with its
 * moving heads and blinders, the speaker stacks, the LED walls with the record's cover, the duo
 * (gold and silver, PixelLab sprite sheets, cut into head, torso and hands and danced by
 * dance.ts), the decks with their platters and meters, the flame and CO2 jets on the lip, the
 * haze, the crowd with its phones, the confetti, and the light over everything — the hung beams,
 * the laser sheet, the blinders, the strobe. What the rig does is the lighting desk's call
 * (lights.ts); the scene only paints it. Every frame is a function of `Frame`: the clock, whether
 * the show runs, whether the mic is open, the tempo, the section and what the analyser hears. The
 * scene keeps only what it must remember between frames — the images and their cuts, the stars
 * and the phones, when the mic changed and where gold stands, where each moving head points, and
 * the flames, smoke and confetti in the air.
 */

export interface Frame {
  nowMs: number;
  width: number;
  height: number;
  /** World px to raise the stage by, so a tall screen shows it above the HUD. */
  lift: number;
  playing: boolean;
  talking: boolean;
  bpm: number;
  /** The beat count locked to the bass (`lockBeats`). */
  beats: number;
  /** 1 on a hit, easing to 0. */
  pulse: number;
  /** The voice alone: its level 0–1, 1 on a syllable easing to 0, and the syllables and phrases so far. */
  voice: number;
  syllable: number;
  syllables: number;
  phrase: number;
  /** The desk's reading of the bass (`energyStep`): in a breakdown, and ms since the last drop (Infinity before one). */
  breakdown: boolean;
  dropMs: number;
  bass: number;
  mid: number;
  high: number;
  /** Bands for the meters, 0–1 each. */
  bands: number[];
  cover: HTMLImageElement | null;
}

const SHEETS = {
  skyline: "/booth/skyline.png",
  decks: "/booth/decks.png",
  crowd: "/booth/crowd.png",
  speaker: "/booth/speaker.png",
  gold: "/booth/gold-groove.png",
  silver: "/booth/silver-groove.png",
  goldMic: "/booth/gold-mic.png",
} as const;
type Sheet = keyof typeof SHEETS;

/** A sprite sheet's cell; the groove sheets hold the pose then eight loop frames. */
const CELL = 128;

/**
 * Where each duo sheet is cut, in its cell: the head's box (lifted off and laid by the pose), and
 * the torso's span — rows above `shoulders` move whole, rows below `hips` (the hands on the decks)
 * never move, and between them the body shears and stretches. The body keeps the head's last
 * `NECK` rows, so a head bobbing up shows a neck, not a gap.
 */
type Cut = { head: { x: number; w: number; h: number }; shoulders: number; hips: number };
const CUTS = {
  gold: { head: { x: 42, w: 60, h: 41 }, shoulders: 44, hips: 100 },
  goldMic: { head: { x: 45, w: 57, h: 45 }, shoulders: 48, hips: 100 },
  silver: { head: { x: 32, w: 66, h: 51 }, shoulders: 56, hips: 104 },
} as const satisfies Partial<Record<Sheet, Cut>>;
type Figure = keyof typeof CUTS;
const NECK = 4;

const SKY_TOP = "#0a0120";
const SKY_JOIN = "rgb(17 3 51)";
const MAGENTA = [255, 43, 214] as const;
const CYAN = [60, 240, 255] as const;
const WORLD = 450;
const HORIZON = 300;
const DECKS_Y = 290;
/** Where the decks' platters and meters sit in their own sprite. */
const PLATTERS = [
  { x: 71, y: 42 },
  { x: 248, y: 42 },
];
const METERS = [
  { x: 22, y: 61, w: 80 },
  { x: 218, y: 61, w: 80 },
];
const LED_CELLS = 20;

/** The rig: the truss's top and how far out its towers stand (never off a narrow screen). */
const TRUSS_Y = 12;
const TOWER_X = 372;
/** The moving heads: hung on the truss, and on the floor behind the decks firing up. */
const HUNG = 8;
const FLOOR_HEADS = [-230, -150, -70, 70, 150, 230];
/** Where the hung beams land: the crowd. */
const CROWD_Y = 400;
/** A moving head's pan takes this long to settle (ms): the motors have weight. */
const PAN_MS = 90;
/** The blinder pods on the truss, as fractions of its half-span. */
const BLINDERS = [-0.78, -0.36, 0.36, 0.78];
/** The LED pyramid behind the duo: its base's half-width and height, and its nested frames. */
const PYRAMID = { half: 196, height: 250, frames: 4, pitch: 4 } as const;
/** The jets on the stage lip, either side of the decks. */
const JETS = [-176, 176];
const LIP_Y = 384;
/** The laser sheet's source, above the decks. */
const SHEET_Y = 262;
const SHEET_LINES = 26;
/** Per ms of a jet at full, and the most in the air at once. */
const EMIT = { flame: 0.45, smoke: 0.5, confetti: 0.3 } as const;
const MAX_PARTICLES = 1800;
const GRAVITY = 0.0004;
const PHONES = 46;
/** How far the backdrop darkens under the rig: at full, and more as the rig dims. */
const BACKDROP = { dim: 0.18, range: 0.5 } as const;

type Particle = {
  kind: "flame" | "smoke" | "confetti";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: Rgb;
  phase: number;
};

const rgba = (c: readonly number[], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

export class BoothScene {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<Sheet, HTMLImageElement>();
  private stars: { x: number; y: number; phase: number; size: number }[] = [];
  private parts = new Map<Figure, { body: HTMLCanvasElement; head: HTMLCanvasElement }>();
  private micChangedAt = -Infinity;
  private micOpen = false;
  /** Gold's step toward the middle, for the key light to follow. */
  private goldX = 0;
  private coverCells: { src: string; data: ImageData | null } | null = null;
  /** The rig's own clock (beats at the desk's speed), and each moving head's pan, eased. */
  private rigBeats = 0;
  private lastBeats: number | null = null;
  private lastMs: number | null = null;
  private hung = new Array<number>(HUNG).fill(0);
  private floorHeads = new Array<number>(FLOOR_HEADS.length).fill(0);
  private level = 0;
  private particles: Particle[] = [];
  private phones: { x: number; y: number; phase: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The booth needs a 2D canvas");
    this.ctx = ctx;
    for (const [key, src] of Object.entries(SHEETS)) {
      const img = new Image();
      img.src = src;
      this.images.set(key as Sheet, img);
    }
    for (let i = 0; i < 140; i++)
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        phase: Math.random() * Math.PI * 2,
        size: Math.random() < 0.12 ? 2 : 1,
      });
    for (let i = 0; i < PHONES; i++)
      this.phones.push({ x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2 });
  }

  private img(key: Sheet): HTMLImageElement | null {
    const img = this.images.get(key);
    return img?.complete && img.naturalWidth > 0 ? img : null;
  }

  draw(f: Frame) {
    const { canvas, ctx } = this;
    if (canvas.width !== f.width || canvas.height !== f.height) {
      canvas.width = f.width;
      canvas.height = f.height;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const cx = Math.round(f.width / 2);
    const oy = f.height - WORLD - Math.round(f.lift);
    const t = f.nowMs / 1000;
    const drive = f.playing ? (f.talking ? 0.35 : 1) : 0.12;
    const dt = this.lastMs === null ? 0 : Math.min(50, Math.max(0, f.nowMs - this.lastMs));
    this.lastMs = f.nowMs;

    if (f.talking !== this.micOpen) {
      this.micOpen = f.talking;
      this.micChangedAt = f.nowMs;
    }

    // The desk's call, and the rig catching up to it: its clock at the cue's speed, the brightness
    // eased (the strobe and the blinders never are), every head panning toward its mark.
    const c = cue({
      beats: f.beats,
      playing: f.playing,
      talking: this.micOpen,
      micMs: f.nowMs - this.micChangedAt,
      breakdown: f.breakdown,
      dropMs: f.dropMs,
      bass: f.bass,
    });
    const dBeats = this.lastBeats === null ? 0 : Math.max(0, f.beats - this.lastBeats);
    this.lastBeats = f.beats;
    this.rigBeats += dBeats * c.speed;
    const ease = 1 - Math.exp(-dt / PAN_MS);
    this.level += (c.level - this.level) * (1 - Math.exp(-dt / 200));
    const half = Math.min(TOWER_X, cx - 14) - 40;
    const gold = this.goldSpot(cx, oy);
    for (let i = 0; i < HUNG; i++) {
      const x = cx - half + (i * half * 2) / (HUNG - 1);
      const follow = Math.atan2(gold.x - x, gold.y - (oy + TRUSS_Y + 12));
      this.hung[i] += (aim(c.beams, i, HUNG, this.rigBeats, follow) - this.hung[i]) * ease;
    }
    // The floor heads fire into the sky; on the mic they stand up and wait.
    const up = c.beams === "follow" ? "rest" : c.beams;
    for (let i = 0; i < FLOOR_HEADS.length; i++)
      this.floorHeads[i] +=
        (aim(up, i, FLOOR_HEADS.length, this.rigBeats + 1, 0) * 0.8 - this.floorHeads[i]) * ease;
    this.air(c, cx, oy, dt);

    // The drop shakes the room for a moment.
    const shake = c.blinders > 0.4 ? Math.round(Math.sin(f.nowMs * 0.09) * 2 * c.blinders) : 0;
    ctx.setTransform(1, 0, 0, 1, 0, shake);

    this.sky(f, oy, t);
    this.skyline(f, cx, oy, drive);
    // The house lights down: the backdrop darkens under the rig so the beams read.
    if (f.playing) {
      ctx.fillStyle = rgba([6, 0, 18], BACKDROP.dim + BACKDROP.range * (1 - this.level));
      ctx.fillRect(0, 0, f.width, oy + HORIZON + 2);
    }
    this.pyramid(f, c, cx, oy, t);
    this.skyBeams(c, cx, oy);
    this.floor(f, cx, oy, t, drive);
    this.truss(f, c, cx, oy, half);
    this.speakers(f, cx, oy);
    this.walls(f, cx, oy, t);
    this.duo(f, cx, oy);
    this.decks(f, cx, oy, t);
    this.jets(cx, oy);
    this.haze(f, c, oy, t);
    this.crowd(f, c, oy, t);
    this.confetti();
    this.light(f, c, cx, oy, half);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Gold's face, where the follow beams meet on the mic. */
  private goldSpot(cx: number, oy: number) {
    return { x: cx - 18 - CELL / 2 + this.goldX, y: oy + 236 };
  }

  /** The flames, the smoke and the confetti: fired by the cue, flown by the frame's `dt`. */
  private air(c: Cue, cx: number, oy: number, dt: number) {
    const fire = (
      kind: Particle["kind"],
      rate: number,
      make: (x: number) => Omit<Particle, "kind" | "age">,
    ) => {
      for (const jet of JETS) {
        let n = rate * EMIT[kind] * dt;
        while (n > 0 && this.particles.length < MAX_PARTICLES) {
          if (n < 1 && Math.random() > n) break;
          this.particles.push({ kind, age: 0, ...make(cx + jet) });
          n -= 1;
        }
      }
    };
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
    fire("flame", c.pyro, (x) => ({
      x: x + (Math.random() - 0.5) * 6,
      y: oy + LIP_Y,
      vx: (Math.random() - 0.5) * 0.03,
      vy: -0.5 - Math.random() * 0.2,
      life: 420 + Math.random() * 320,
      color: [255, 255, 255],
      phase: 0,
    }));
    fire("smoke", c.co2, (x) => ({
      x: x + (Math.random() - 0.5) * 4,
      y: oy + LIP_Y,
      vx: (Math.random() - 0.5) * 0.04,
      vy: -0.9 - Math.random() * 0.3,
      life: 700 + Math.random() * 700,
      color: [235, 240, 255],
      phase: Math.random(),
    }));
    // The cannons fire only on the drop's first moment; the paper takes its time coming down.
    fire("confetti", Math.max(0, c.confetti - 0.8) * 5, (x) => ({
      x,
      y: oy + LIP_Y - 10,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.55 - Math.random() * 0.25,
      life: 9000,
      color: pick([...c.colors, [255, 214, 80], [255, 255, 255]] as const),
      phase: Math.random() * Math.PI * 2,
    }));
    const floor = oy + WORLD + 20;
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.kind === "confetti") {
        // Up on the blast, then fluttering down slow.
        p.vy = Math.min(0.035, p.vy + GRAVITY * dt * 2);
        p.vx *= 1 - 0.002 * dt;
        p.x += (p.vx + Math.sin(p.age * 0.004 + p.phase) * 0.02) * dt;
      } else {
        p.vy *= 1 - (p.kind === "smoke" ? 0.003 : 0.0008) * dt;
        p.vx += (Math.random() - 0.5) * 0.002 * dt;
        p.x += p.vx * dt;
      }
      p.y += p.vy * dt;
      return p.age < p.life && p.y < floor;
    });
  }

  /** The LED pyramid behind the duo: nested frames of lamps, played by the cue's portal. */
  private pyramid(f: Frame, c: Cue, cx: number, oy: number, t: number) {
    const { ctx } = this;
    const base = oy + HORIZON;
    const beat = this.rigBeats;
    const q = beat - Math.floor(beat);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < PYRAMID.frames; k++) {
      const s = 1 - k * 0.2;
      const hw = PYRAMID.half * s;
      const h = PYRAMID.height * s;
      const side = Math.hypot(hw, h);
      const dots = Math.floor(side / PYRAMID.pitch);
      const color = c.colors[k % 2];
      let frame: number;
      switch (c.portal) {
        case "breathe":
          frame = 0.28 + 0.14 * Math.sin(t * 1.3 - k * 0.8);
          break;
        case "pulse":
          frame = Math.max(0.15, 1 - Math.abs(q * PYRAMID.frames - (PYRAMID.frames - 1 - k)) * 0.9);
          break;
        case "spectrum":
          frame = 0.2 + 0.9 * (f.bands[k * 2] ?? 0);
          break;
        default:
          frame = 1;
      }
      for (let d = 0; d <= dots; d++) {
        const u = d / dots;
        for (const dir of [-1, 1]) {
          // The perimeter's coordinate, 0 at the left foot to 2 at the right.
          const along = dir < 0 ? u : 2 - u;
          let lamp = frame;
          if (c.portal === "chase") lamp = (along * 3 - beat * 0.5 + k * 0.3) % 1 < 0.3 ? 1 : 0.18;
          if (c.portal === "burst") lamp = ((d + k) % 2 === Math.floor(beat * 4) % 2 ? 1 : 0.35) * this.level;
          const x = Math.round(cx + dir * hw * (1 - u));
          const y = Math.round(base - h * u);
          ctx.fillStyle = rgba(color, lamp * 0.2 * this.level);
          ctx.fillRect(x - 2, y - 2, 5, 5);
          ctx.fillStyle = rgba(color, lamp * (0.5 + 0.5 * this.level));
          ctx.fillRect(x - 1, y - 1, 2, 2);
          if (lamp > 0.8) {
            ctx.fillStyle = rgba([255, 255, 255], 0.6 * this.level);
            ctx.fillRect(x - 1, y - 1, 1, 1);
          }
        }
      }
    }
    // The apex lamp.
    ctx.fillStyle = rgba(c.colors[1], 0.5 + 0.5 * this.level);
    ctx.fillRect(cx - 1, base - PYRAMID.height - 1, 3, 3);
    ctx.globalCompositeOperation = "source-over";
  }

  /** One beam: a cone from (x, y) along `angle` (0 = straight down, or up with `dir` −1). */
  private beam(
    x: number,
    y: number,
    angle: number,
    len: number,
    dir: 1 | -1,
    color: Rgb,
    alpha: number,
    spread = 12,
  ) {
    if (alpha <= 0.005) return;
    const { ctx } = this;
    const dx = Math.sin(angle);
    const dy = Math.cos(angle) * dir;
    const tx = x + dx * len;
    const ty = y + dy * len;
    // The cone's edges, perpendicular to its axis.
    const px = -dy;
    const py = dx;
    const g = ctx.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - px, y - py);
    ctx.lineTo(x + px, y + py);
    ctx.lineTo(tx + px * spread, ty + py * spread);
    ctx.lineTo(tx - px * spread, ty - py * spread);
    ctx.closePath();
    ctx.fill();
    // The hot core.
    const core = ctx.createLinearGradient(x, y, tx, ty);
    core.addColorStop(0, rgba([255, 255, 255], alpha * 1.4));
    core.addColorStop(0.6, rgba(color, 0));
    ctx.strokeStyle = core;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  /** The floor heads behind the decks, firing into the sky. */
  private skyBeams(c: Cue, cx: number, oy: number) {
    if (c.level < 0.2) return;
    this.ctx.globalCompositeOperation = "lighter";
    for (const [i, off] of FLOOR_HEADS.entries()) {
      const flick = c.strobe > 0 && i % 2 ? 1 - c.strobe : 1;
      this.beam(
        cx + off,
        oy + HORIZON,
        this.floorHeads[i],
        520,
        -1,
        c.colors[i % 2],
        0.42 * this.level * flick,
        11,
      );
    }
    this.ctx.globalCompositeOperation = "source-over";
  }

  /** The truss across the top on its two towers, the moving heads hung under it, the blinder pods on its face. */
  private truss(f: Frame, c: Cue, cx: number, oy: number, half: number) {
    const { ctx } = this;
    const reach = half + 40;
    const top = oy + TRUSS_Y;
    const steel = "#2b2440";
    const edge = rgba(c.colors[0], 0.25 + 0.35 * this.level);
    const lattice = (x: number, y: number, w: number, h: number, across: boolean) => {
      ctx.fillStyle = steel;
      if (across) {
        ctx.fillRect(x, y, w, 1);
        ctx.fillRect(x, y + h - 1, w, 1);
        for (let i = 0; i < w; i++) ctx.fillRect(x + i, y + Math.abs(((i % 8) - 4) * ((h - 1) / 4)), 1, 1);
        ctx.fillStyle = edge;
        ctx.fillRect(x, y + h, w, 1);
      } else {
        ctx.fillRect(x, y, 1, h);
        ctx.fillRect(x + w - 1, y, 1, h);
        for (let j = 0; j < h; j++) ctx.fillRect(x + Math.abs(((j % 8) - 4) * ((w - 1) / 4)), y + j, 1, 1);
      }
    };
    // The towers stand behind the speakers, down to the floor.
    for (const side of [-1, 1]) lattice(cx + side * reach - 4, top, 9, CROWD_Y - TRUSS_Y, false);
    lattice(cx - reach - 4, top, reach * 2 + 9, 8, true);
    // Cables down to the LED walls.
    if (f.width >= 640) {
      ctx.fillStyle = "#1a1428";
      for (const side of [-1, 1])
        for (const x of side < 0 ? [cx - 327, cx - 253] : [cx + 253, cx + 327])
          ctx.fillRect(x, top + 8, 1, 70 - TRUSS_Y - 11);
    }
    // The heads: a yoke and a lens, the lens lit in the beam's colour.
    for (let i = 0; i < HUNG; i++) {
      const x = Math.round(cx - half + (i * half * 2) / (HUNG - 1));
      ctx.fillStyle = "#15101f";
      ctx.fillRect(x - 3, top + 8, 7, 2);
      ctx.fillRect(x - 2, top + 10, 5, 4);
      const lens = Math.round(this.hung[i] * 3);
      ctx.fillStyle = rgba(c.colors[i % 2], 0.4 + 0.6 * this.level);
      ctx.fillRect(x - 1 + Math.max(-1, Math.min(1, lens)), top + 13, 3, 1);
    }
    // The blinder pods: four lamps each, dark until the desk hits them.
    for (const b of BLINDERS) {
      const x = Math.round(cx + b * half) - 4;
      ctx.fillStyle = "#15101f";
      ctx.fillRect(x - 1, top - 1, 10, 10);
      for (let k = 0; k < 4; k++) {
        const lx = x + (k % 2) * 5;
        const ly = top + Math.floor(k / 2) * 5;
        ctx.fillStyle = c.blinders > 0.05 ? rgba([255, 214, 150], 0.4 + 0.6 * c.blinders) : "#3a2c30";
        ctx.fillRect(lx, ly, 3, 3);
      }
    }
    // Strobe bars at the tower tops.
    for (const side of [-1, 1]) {
      ctx.fillStyle = c.strobe > 0.5 ? "#ffffff" : "#2c2c3c";
      ctx.fillRect(cx + side * reach - 5, top + 10, 11, 2);
    }
  }

  /** The flames and the CO2 on the lip. */
  private jets(cx: number, oy: number) {
    const { ctx } = this;
    // The jets' nozzles.
    for (const jet of JETS) {
      ctx.fillStyle = "#15101f";
      ctx.fillRect(cx + jet - 3, oy + LIP_Y, 7, 4);
      ctx.fillStyle = "#3b3050";
      ctx.fillRect(cx + jet - 2, oy + LIP_Y - 1, 5, 1);
    }
    for (const p of this.particles) {
      if (p.kind !== "smoke") continue;
      const k = p.age / p.life;
      ctx.fillStyle = rgba(p.color, 0.1 * (1 - k) ** 1.5);
      ctx.beginPath();
      ctx.arc(Math.round(p.x), Math.round(p.y), 2 + k * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (p.kind !== "flame") continue;
      const k = p.age / p.life;
      // White at the nozzle, yellow, orange, a red tip.
      const color: Rgb =
        k < 0.15 ? [255, 250, 220] : k < 0.4 ? [255, 210, 60] : k < 0.7 ? [255, 120, 20] : [200, 40, 20];
      const size = k < 0.3 ? 6 : k < 0.6 ? 4 : 3;
      ctx.fillStyle = rgba(color, 0.9 * (1 - k * 0.7));
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y), size, size);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** Haze hanging over the crowd, lit by the rig. */
  private haze(f: Frame, c: Cue, oy: number, t: number) {
    const { ctx } = this;
    ctx.globalCompositeOperation = "lighter";
    const top = oy + HORIZON + 30;
    for (let y = top; y < f.height; y += 4) {
      const band = 0.5 + 0.5 * Math.sin(y * 0.09 + t * 0.6);
      ctx.fillStyle = rgba(c.colors[Math.floor(y / 24) % 2], 0.035 * this.level * band);
      const drift = Math.round(Math.sin(t * 0.3 + y * 0.05) * 40);
      ctx.fillRect(drift - 40, y, f.width + 80, 4);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private confetti() {
    const { ctx } = this;
    for (const p of this.particles) {
      if (p.kind !== "confetti") continue;
      // A paper turning over: wide, edge on, wide.
      const turn = Math.sin(p.age * 0.012 + p.phase);
      const fade = Math.min(1, (p.life - p.age) / 1500);
      ctx.fillStyle = rgba(p.color, fade * (0.55 + 0.45 * Math.abs(turn)));
      if (Math.abs(turn) > 0.4) ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 2);
      else ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 3);
    }
  }

  private sky(f: Frame, oy: number, t: number) {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, oy + 40);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_JOIN);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.width, oy + 40);
    const skyH = oy + 150;
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.sin(t * (1.2 + s.size) + s.phase);
      ctx.fillStyle = `rgba(255,236,255,${(tw * 0.8).toFixed(2)})`;
      ctx.fillRect(Math.floor(s.x * f.width), Math.floor(s.y * skyH), s.size, s.size);
    }
  }

  private skyline(f: Frame, cx: number, oy: number, drive: number) {
    const { ctx } = this;
    const img = this.img("skyline");
    if (img) {
      const w = img.width * 2;
      const h = img.height * 2;
      const x0 = cx - w / 2;
      // Mirrored copies either side, so a wide screen sees one continuous city.
      for (let i = -2; i <= 2; i++) {
        const x = x0 + i * w;
        if (x > f.width || x + w < 0) continue;
        if (i % 2 === 0) ctx.drawImage(img, x, oy, w, h);
        else {
          ctx.save();
          ctx.translate(x + w, oy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0, w, h);
          ctx.restore();
        }
      }
    }
    // The sun breathes with the bass.
    ctx.globalCompositeOperation = "lighter";
    const r = 150 + f.bass * 40 * drive;
    const glow = ctx.createRadialGradient(cx, oy + 140, 40, cx, oy + 140, r);
    glow.addColorStop(0, rgba([255, 120, 90], 0.1 + 0.22 * f.bass * drive));
    glow.addColorStop(1, "rgba(255,40,160,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r, oy + 140 - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "source-over";
  }

  private floor(f: Frame, cx: number, oy: number, t: number, drive: number) {
    const { ctx } = this;
    const top = oy + HORIZON;
    const depth = f.height - top;
    const g = ctx.createLinearGradient(0, top, 0, f.height);
    g.addColorStop(0, "#1d0636");
    g.addColorStop(1, "#07010f");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, f.width, depth);
    // Horizontal lines rush toward the viewer, one per beat.
    const beat = 60 / f.bpm;
    const travel = f.playing ? (t / beat) % 1 : 0;
    ctx.fillStyle = rgba(MAGENTA, 0.55 + 0.35 * f.pulse * drive);
    for (let i = 0; i < 12; i++) {
      const z = (i + 1 - travel) / 12;
      const y = Math.round(top + depth * z * z);
      ctx.globalAlpha = Math.min(1, z * 1.6);
      ctx.fillRect(0, y, f.width, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(MAGENTA, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -24; i <= 24; i++) {
      ctx.moveTo(cx + i * 6 + 0.5, top);
      ctx.lineTo(cx + i * 90 + 0.5, f.height);
    }
    ctx.stroke();
    ctx.fillStyle = rgba(CYAN, 0.8);
    ctx.fillRect(0, top, f.width, 1);
    ctx.globalCompositeOperation = "lighter";
    const haze = ctx.createLinearGradient(0, top - 30, 0, top + 20);
    haze.addColorStop(0, "rgba(255,43,214,0)");
    haze.addColorStop(0.6, rgba(MAGENTA, 0.18 + 0.2 * f.bass * drive));
    haze.addColorStop(1, "rgba(255,43,214,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, top - 30, f.width, 50);
    ctx.globalCompositeOperation = "source-over";
  }

  private speakers(f: Frame, cx: number, oy: number) {
    const { ctx } = this;
    const img = this.img("speaker");
    if (!img) return;
    const bump = f.playing && f.pulse > 0.6 ? 1 : 0;
    const y = oy + 410 - img.height - bump;
    for (const side of [-1, 1]) {
      const x = side < 0 ? cx - 160 - 20 - img.width - 10 : cx + 160 + 30;
      if (x > f.width || x + img.width < 0) continue;
      ctx.save();
      if (side > 0) {
        ctx.translate(x + img.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
      } else ctx.drawImage(img, x, y);
      ctx.restore();
      // Stacks one further out on a wide screen.
      const far = side < 0 ? x - img.width - 6 : x + img.width + 6;
      if (f.width > 700) {
        ctx.globalAlpha = 0.75;
        ctx.drawImage(img, far, y + 12, img.width * 0.875, img.height * 0.875);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Two LED walls high in the sky either side of the sun: the cover, one lamp per cell. */
  private walls(f: Frame, cx: number, oy: number, t: number) {
    if (f.width < 640) return;
    const cells = this.cover(f.cover);
    const n = 20;
    const pitch = 4;
    const size = n * pitch;
    const y = oy + 70;
    const { ctx } = this;
    for (const side of [-1, 1]) {
      const x = side < 0 ? cx - 330 : cx + 330 - size;
      ctx.fillStyle = "#05010c";
      ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
      ctx.fillStyle = rgba(side < 0 ? MAGENTA : CYAN, 0.9);
      ctx.fillRect(x - 3, y - 3, size + 6, 1);
      ctx.fillRect(x - 3, y + size + 2, size + 6, 1);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          let r: number;
          let g: number;
          let b: number;
          if (cells) {
            const k = (j * n + i) * 4;
            r = cells.data[k];
            g = cells.data[k + 1];
            b = cells.data[k + 2];
          } else {
            // No cover yet: a slow plasma in the station's colours.
            const v = Math.sin(i * 0.5 + t) + Math.sin(j * 0.4 - t * 1.3) + Math.sin((i + j) * 0.3 + t * 0.7);
            const m = (v + 3) / 6;
            r = 255 * m;
            g = 43 + 180 * (1 - m) * 0.6;
            b = 214;
          }
          const scan = (f.playing ? 1.15 + 0.2 * Math.sin(t * 6 - j * 0.6) : 0.8) * (cells ? 1.2 : 1);
          ctx.fillStyle = `rgb(${Math.min(255, Math.round(r * scan))},${Math.min(255, Math.round(g * scan))},${Math.min(255, Math.round(b * scan))})`;
          ctx.fillRect(x + i * pitch, y + j * pitch, pitch - 1, pitch - 1);
        }
    }
  }

  /** The cover shrunk to one sample per lamp, once per record. */
  private cover(img: HTMLImageElement | null): ImageData | null {
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    if (this.coverCells?.src === img.src) return this.coverCells.data;
    let data: ImageData | null = null;
    try {
      const small = document.createElement("canvas");
      small.width = small.height = 20;
      const pixel = small.getContext("2d", { willReadFrequently: true });
      if (pixel) {
        pixel.drawImage(img, 0, 0, 20, 20);
        data = pixel.getImageData(0, 0, 20, 20);
      }
    } catch (err) {
      // A cover served without CORS taints the canvas: the walls keep their plasma.
      if (!(err instanceof DOMException)) throw err;
    }
    this.coverCells = { src: img.src, data };
    return data;
  }

  /** A sheet split once into its head and its body without it (see `CUTS`). */
  private cut(key: Figure): { body: HTMLCanvasElement; head: HTMLCanvasElement } | null {
    const done = this.parts.get(key);
    if (done) return done;
    const img = this.img(key);
    if (!img) return null;
    const { head: box } = CUTS[key];
    const layer = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("The booth needs a 2D canvas");
      return { c, ctx };
    };
    const body = layer();
    const head = layer();
    body.ctx.drawImage(img, 0, 0);
    for (let x = 0; x < img.width; x += CELL) {
      body.ctx.clearRect(x + box.x, 0, box.w, box.h - NECK);
      head.ctx.drawImage(img, x + box.x, 0, box.w, box.h, x + box.x, 0, box.w, box.h);
    }
    const parts = { body: body.c, head: head.c };
    this.parts.set(key, parts);
    return parts;
  }

  /**
   * One robot at cell (fx, fy), laid row by row by its pose: the whole figure stepped by `x`; the
   * body's rows carried by the shoulders' `y` and `lean` in full above them, fading to nothing at
   * the hips (each row drawn tall enough to meet the next, so a stretch leaves no gap); the head on
   * top, sheared by its tilt.
   */
  private figure(key: Figure, p: Pose, fx: number, fy: number) {
    const parts = this.cut(key);
    if (!parts) return;
    const { ctx } = this;
    const { head, shoulders, hips } = CUTS[key];
    const sx = p.frame * CELL;
    const x = fx + Math.round(p.x);
    const carry = (row: number) =>
      row <= shoulders ? 1 : row >= hips ? 0 : (hips - row) / (hips - shoulders);
    const down = (row: number) => row + Math.round(p.y * carry(row));
    for (let row = 0; row < CELL; row++) {
      const d = down(row);
      const h = row + 1 < CELL ? Math.max(1, down(row + 1) - d) : 1;
      ctx.drawImage(parts.body, sx, row, CELL, 1, x + Math.round(p.lean * carry(row)), fy + d, CELL, h);
    }
    const hx = x + Math.round(p.lean) + Math.round(p.headX) + head.x;
    const hy = fy + Math.round(p.y) + Math.round(p.headY);
    for (let row = 0; row < head.h; row++) {
      const shear = Math.round((p.tilt * (head.h - row)) / head.h);
      ctx.drawImage(parts.head, sx + head.x, row, head.w, 1, hx + shear, hy + row, head.w, 1);
    }
  }

  private duo(f: Frame, cx: number, oy: number) {
    const baseY = oy + DECKS_Y + 35 - 112;
    const stage: Stage = {
      t: f.nowMs / 1000,
      beats: f.beats,
      playing: f.playing,
      talking: this.micOpen,
      micMs: f.nowMs - this.micChangedAt,
      voice: f.voice,
      syllable: f.syllable,
      syllables: f.syllables,
      phrase: f.phrase,
      bass: f.bass,
    };
    this.figure("silver", pose("silver", stage), cx + 18, baseY);
    const gold = pose("gold", stage);
    this.goldX = gold.x;
    this.figure(gold.sheet === "mic" ? "goldMic" : "gold", gold, cx - 18 - CELL, baseY);
  }

  private decks(f: Frame, cx: number, oy: number, t: number) {
    const { ctx } = this;
    const img = this.img("decks");
    if (!img) return;
    const x = cx - img.width / 2;
    const y = oy + DECKS_Y;
    ctx.drawImage(img, x, y);
    // The platters turn at 33⅓: a glint going round each record.
    const turn = f.playing ? t * ((33.333 / 60) * Math.PI * 2) : 0.6;
    for (const [n, p] of PLATTERS.entries()) {
      const a = turn + n * 1.7;
      for (let k = 0; k < 3; k++) {
        const ak = a - k * 0.18;
        ctx.fillStyle = k === 0 ? "rgba(255,255,255,0.95)" : rgba(CYAN, 0.6 - k * 0.2);
        ctx.fillRect(Math.round(x + p.x + Math.cos(ak) * 26), Math.round(y + p.y + Math.sin(ak) * 5), 2, 1);
      }
    }
    // The meters across the front panels: the analyser's bands, lamp by lamp.
    for (const [side, m] of METERS.entries()) {
      const cell = m.w / LED_CELLS;
      for (let i = 0; i < LED_CELLS; i++) {
        const band = f.bands[Math.floor((i / LED_CELLS) * f.bands.length)] ?? 0;
        const level =
          side === 0
            ? band
            : (f.bands[f.bands.length - 1 - Math.floor((i / LED_CELLS) * f.bands.length)] ?? 0);
        const lit = f.playing && level > 0.25 + (i % 5) * 0.05;
        const hue = i < LED_CELLS * 0.6 ? CYAN : i < LED_CELLS * 0.85 ? [255, 214, 80] : MAGENTA;
        ctx.fillStyle = lit ? rgba(hue, 1) : "rgba(40,30,70,1)";
        ctx.fillRect(Math.round(x + m.x + i * cell), y + m.y, Math.max(1, Math.floor(cell) - 1), 2);
      }
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = rgba(CYAN, 0.2 + 0.5 * f.pulse * (f.playing ? 1 : 0));
    ctx.fillRect(x + 10, y + 73, img.width - 20, 1);
    ctx.globalCompositeOperation = "source-over";
  }

  private crowd(f: Frame, c: Cue, oy: number, t: number) {
    const { ctx } = this;
    const img = this.img("crowd");
    if (!img) return;
    // They jump on the beat the duo dances to, higher when the desk says hands up.
    const jump = (p: number) =>
      f.playing && !f.talking
        ? Math.round(Math.abs(Math.sin((f.beats + p) * Math.PI)) * (2 + 3 * c.hands) * (0.4 + f.bass))
        : 0;
    // The back row, reversed and darker, half a beat out of step.
    ctx.save();
    ctx.filter = "brightness(0.55) saturate(1.3)";
    ctx.scale(-1, 1);
    for (let x = -((f.width + 150) % img.width) - img.width; x < f.width + img.width; x += img.width)
      ctx.drawImage(img, -(x + img.width), oy + WORLD - img.height - 16 - jump(0.5));
    ctx.restore();
    // The front row, and on a tall screen more rows toward the viewer, each darker and nearer.
    const start = -(((f.width - img.width) / 2) % img.width) - img.width;
    for (let row = 0; oy + WORLD - img.height + 4 + row * 56 < f.height; row++) {
      if (row > 0) ctx.filter = `brightness(${Math.max(0.25, 0.8 - row * 0.2)})`;
      const y = oy + WORLD - img.height + 4 + row * 56 - jump(row * 0.25);
      for (let x = start + (row % 2) * 170; x < f.width; x += img.width) ctx.drawImage(img, Math.round(x), y);
      ctx.filter = "none";
    }
    // Phones up in the quiet parts, each one's screen swaying a little.
    if (c.phones <= 0) return;
    ctx.globalCompositeOperation = "lighter";
    const top = oy + WORLD - img.height + 10;
    for (const p of this.phones) {
      const x = Math.round(p.x * f.width + Math.sin(t * 0.8 + p.phase) * 2);
      const y = Math.round(top + p.y * Math.min(90, f.height - top));
      const a = c.phones * (0.55 + 0.45 * Math.sin(t * 1.7 + p.phase));
      ctx.fillStyle = rgba([200, 225, 255], a * 0.25);
      ctx.fillRect(x - 3, y - 3, 8, 9);
      ctx.fillStyle = rgba([235, 245, 255], a);
      ctx.fillRect(x, y, 2, 3);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * The light over everything: the hung beams and the pools they throw on the crowd, the laser
   * sheet, the blinders' glare, the strobe, the flames' heat, and on the mic the key light on gold.
   */
  private light(f: Frame, c: Cue, cx: number, oy: number, half: number) {
    const { ctx } = this;
    ctx.globalCompositeOperation = "lighter";
    const top = oy + TRUSS_Y + 14;
    const gold = this.goldSpot(cx, oy);
    for (let i = 0; i < HUNG; i++) {
      const x = cx - half + (i * half * 2) / (HUNG - 1);
      const a = this.hung[i];
      // On the mic the heads stop at the DJ; otherwise they reach the crowd.
      const len =
        c.beams === "follow"
          ? Math.hypot(gold.x - x, gold.y - top)
          : (oy + CROWD_Y - top) / Math.max(0.3, Math.cos(a));
      const flick = c.strobe > 0 && i % 2 === 0 ? 1 - c.strobe : 1;
      const alpha = (c.beams === "follow" ? 0.2 : 0.22) * this.level * flick;
      this.beam(x, top, a, len, 1, c.colors[i % 2], alpha, 16);
      if (c.beams === "follow") continue;
      // Where it lands on the crowd.
      const lx = x + Math.sin(a) * len;
      const ly = oy + CROWD_Y;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.scale(1, 0.3);
      const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      pool.addColorStop(0, rgba(c.colors[i % 2], alpha * 1.6));
      pool.addColorStop(1, rgba(c.colors[i % 2], 0));
      ctx.fillStyle = pool;
      ctx.fillRect(-34, -34, 68, 68);
      ctx.restore();
    }
    // The laser sheet: a fan of hairlines from above the decks, raking the crowd.
    if (c.lasers > 0 && f.playing) {
      const sy = oy + SHEET_Y;
      const sweep = Math.sin((this.rigBeats * Math.PI) / 4) * 0.35;
      const on = c.strobe > 0 ? 1 - c.strobe * 0.8 : 1;
      ctx.lineWidth = 1;
      for (let i = 0; i < SHEET_LINES; i++) {
        const a = sweep + (i / (SHEET_LINES - 1) - 0.5) * 1.9;
        const len = f.height * 1.2;
        const g = ctx.createLinearGradient(cx, sy, cx + Math.sin(a) * len, sy + Math.cos(a) * len);
        g.addColorStop(0, rgba(c.colors[1], 0.5 * c.lasers * on));
        g.addColorStop(1, rgba(c.colors[1], 0.05 * c.lasers * on));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx + 0.5, sy);
        ctx.lineTo(cx + 0.5 + Math.sin(a) * len, sy + Math.cos(a) * len);
        ctx.stroke();
      }
      ctx.fillStyle = rgba([255, 255, 255], 0.9 * c.lasers * on);
      ctx.fillRect(cx - 1, sy - 1, 3, 2);
    }
    // The blinders: a warm glare off each pod, and the whole room washed with it.
    if (c.blinders > 0) {
      for (const b of BLINDERS) {
        const x = cx + b * half;
        const g = ctx.createRadialGradient(x, oy + TRUSS_Y + 4, 0, x, oy + TRUSS_Y + 4, 90);
        g.addColorStop(0, rgba([255, 230, 180], 0.8 * c.blinders));
        g.addColorStop(1, rgba([255, 150, 60], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 90, oy + TRUSS_Y - 86, 180, 180);
      }
      ctx.fillStyle = rgba([255, 200, 140], 0.12 * c.blinders);
      ctx.fillRect(0, 0, f.width, f.height);
    }
    // The flames' heat on everything near them.
    const flames = this.particles.reduce((n, p) => n + (p.kind === "flame" ? 1 : 0), 0);
    if (flames > 0)
      for (const jet of JETS) {
        const x = cx + jet;
        const y = oy + LIP_Y - 40;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 160);
        g.addColorStop(0, rgba([255, 140, 40], Math.min(0.35, flames * 0.002)));
        g.addColorStop(1, rgba([255, 60, 20], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 160, y - 160, 320, 320);
      }
    // The strobe.
    if (c.strobe > 0) {
      ctx.fillStyle = rgba([255, 255, 255], 0.2 * c.strobe);
      ctx.fillRect(0, 0, f.width, f.height);
    }
    // On the mic: a warm key light on the gold DJ.
    if (f.talking) {
      const gx = cx - 82 + Math.round(this.goldX);
      const g = ctx.createRadialGradient(gx, oy + 240, 5, gx, oy + 240, 90);
      g.addColorStop(0, "rgba(255,190,90,0.34)");
      g.addColorStop(1, "rgba(255,190,90,0)");
      ctx.fillStyle = g;
      ctx.fillRect(gx - 98, oy + 150, 200, 180);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
