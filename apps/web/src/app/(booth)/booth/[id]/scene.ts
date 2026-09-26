import { grooveFrame, micFrame } from "./rhythm";

/**
 * The booth, painted: one low-resolution canvas the page scales up with crisp pixels. Back to
 * front — the sky and its stars, the skyline and its striped sun (PixelLab), the lasers, the
 * outrun floor, the speaker stacks, the LED walls with the record's cover, the duo (gold and
 * silver, PixelLab sprite sheets), the decks with their platters and meters, the crowd in two
 * rows, and the light over everything. Every frame is a function of `Frame`: the clock, whether
 * the show runs, whether the mic is open, the tempo and what the analyser hears. The scene keeps
 * only what it must remember between frames — the images, the stars, and when the mic changed.
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
  /** 1 on a hit, easing to 0. */
  pulse: number;
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
const GROOVE_FRAMES = 8;

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

const rgba = (c: readonly number[], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

export class BoothScene {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<Sheet, HTMLImageElement>();
  private stars: { x: number; y: number; phase: number; size: number }[] = [];
  private micChangedAt = -Infinity;
  private micOpen = false;
  private coverCells: { src: string; data: ImageData | null } | null = null;

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

    if (f.talking !== this.micOpen) {
      this.micOpen = f.talking;
      this.micChangedAt = f.nowMs;
    }

    this.sky(f, oy, t);
    this.skyline(f, cx, oy, drive);
    this.lasers(f, cx, oy, t, drive);
    this.floor(f, cx, oy, t, drive);
    this.speakers(f, cx, oy);
    this.walls(f, cx, oy, t);
    this.duo(f, cx, oy);
    this.decks(f, cx, oy, t);
    this.crowd(f, oy, t);
    this.light(f, cx, oy, t, drive);
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

  private lasers(f: Frame, cx: number, oy: number, t: number, drive: number) {
    if (!f.playing) return;
    const { ctx } = this;
    ctx.globalCompositeOperation = "lighter";
    const beams = 7;
    const fan = Math.sin(t * 0.7) * 0.5;
    for (const side of [-1, 1]) {
      const ox = cx + side * 110;
      const oyy = oy + HORIZON + 4;
      for (let i = 0; i < beams; i++) {
        const a = -Math.PI / 2 + side * (0.12 + i * 0.13 + fan * side) + Math.sin(t * 1.3 + i) * 0.06;
        const len = f.height * 1.4;
        const color = (i + (side > 0 ? 1 : 0)) % 2 ? CYAN : MAGENTA;
        const alpha = (0.18 + 0.5 * f.pulse + 0.25 * f.high) * drive;
        const tx = ox + Math.cos(a) * len;
        const ty = oyy + Math.sin(a) * len;
        // A soft halo, then the hot core.
        for (const [width, strength] of [
          [5, 0.18],
          [1, 1],
        ] as const) {
          ctx.strokeStyle = rgba(color, alpha * strength);
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(ox, oyy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      }
    }
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

  private duo(f: Frame, cx: number, oy: number) {
    const { ctx } = this;
    const baseY = oy + DECKS_Y + 35 - 112;
    const ms = f.nowMs;
    const groove = f.playing ? 1 + grooveFrame(ms, f.bpm, GROOVE_FRAMES) : 0;
    const silver = this.img("silver");
    if (silver) {
      const off = f.playing ? 1 + grooveFrame(ms + 250, f.bpm, GROOVE_FRAMES) : 0;
      ctx.drawImage(silver, off * CELL, 0, CELL, CELL, cx + 18, baseY, CELL, CELL);
    }
    const mic = micFrame(this.micOpen, ms - this.micChangedAt);
    const gold = mic !== null ? this.img("goldMic") : this.img("gold");
    if (gold) ctx.drawImage(gold, (mic ?? groove) * CELL, 0, CELL, CELL, cx - 18 - CELL, baseY, CELL, CELL);
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

  private crowd(f: Frame, oy: number, t: number) {
    const { ctx } = this;
    const img = this.img("crowd");
    if (!img) return;
    const beat = 60 / f.bpm;
    const phase = f.playing ? (t / beat) % 1 : 0;
    const jump = (p: number) =>
      f.playing && !f.talking ? Math.round(Math.abs(Math.sin(p * Math.PI)) * 3 * (0.4 + f.bass)) : 0;
    // The back row, reversed and darker, half a beat out of step.
    ctx.save();
    ctx.filter = "brightness(0.55) saturate(1.3)";
    ctx.scale(-1, 1);
    for (let x = -((f.width + 150) % img.width) - img.width; x < f.width + img.width; x += img.width)
      ctx.drawImage(img, -(x + img.width), oy + WORLD - img.height - 16 - jump(phase + 0.5));
    ctx.restore();
    // The front row, and on a tall screen more rows toward the viewer, each darker and nearer.
    const start = -(((f.width - img.width) / 2) % img.width) - img.width;
    for (let row = 0; oy + WORLD - img.height + 4 + row * 56 < f.height; row++) {
      if (row > 0) ctx.filter = `brightness(${Math.max(0.25, 0.8 - row * 0.2)})`;
      const y = oy + WORLD - img.height + 4 + row * 56 - jump(phase + row * 0.25);
      for (let x = start + (row % 2) * 170; x < f.width; x += img.width) ctx.drawImage(img, Math.round(x), y);
      ctx.filter = "none";
    }
  }

  private light(f: Frame, cx: number, oy: number, t: number, drive: number) {
    const { ctx } = this;
    ctx.globalCompositeOperation = "lighter";
    // Two spots from the rig above, sweeping the floor.
    if (f.playing) {
      for (const side of [-1, 1]) {
        const sx = cx + side * f.width * 0.35;
        const aim = cx + Math.sin(t * 0.6 + (side > 0 ? Math.PI : 0)) * f.width * 0.3;
        const g = ctx.createLinearGradient(sx, 0, aim, oy + WORLD);
        const c = side < 0 ? MAGENTA : CYAN;
        g.addColorStop(0, rgba(c, 0.18 * drive));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx - 4, 0);
        ctx.lineTo(sx + 4, 0);
        ctx.lineTo(aim + 60, oy + WORLD);
        ctx.lineTo(aim - 60, oy + WORLD);
        ctx.closePath();
        ctx.fill();
      }
    }
    // The strobe: a breath of white on the hardest hits.
    if (f.playing && !f.talking && f.pulse > 0.85) {
      ctx.fillStyle = `rgba(255,255,255,${(0.07 * (f.pulse - 0.85) * 6.6).toFixed(3)})`;
      ctx.fillRect(0, 0, f.width, f.height);
    }
    // On the mic: a warm key light on the gold DJ.
    if (f.talking) {
      const g = ctx.createRadialGradient(cx - 82, oy + 240, 5, cx - 82, oy + 240, 90);
      g.addColorStop(0, "rgba(255,190,90,0.22)");
      g.addColorStop(1, "rgba(255,190,90,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - 180, oy + 150, 200, 180);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
