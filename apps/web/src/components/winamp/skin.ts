import type { CSSProperties } from "react";
import base from "./skins/base.json";

/**
 * The skin: which sprite sheet each thing is cut from, and where. Coordinates are Winamp 2's,
 * as catalogued by Webamp (`skinSprites.ts`, `main-window.css`, `playlist-window.css`) — the
 * sheets themselves are whatever `scripts/winamp-skin.mts` unpacked into `public/winamp/<name>`.
 * The window is 275 logical px wide; the page zooms it to the phone (use-zoom.ts).
 */

export const SKIN = base;
export const ASSETS = `/winamp/${base.name}`;

export type Sheet =
  | "main"
  | "titlebar"
  | "cbuttons"
  | "numbers"
  | "text"
  | "posbar"
  | "volume"
  | "balance"
  | "monoster"
  | "playpaus"
  | "shufrep"
  | "pledit";

export const sheetUrl = (sheet: Sheet) => `url(${ASSETS}/${sheet}.bmp)`;

/** A cut of a sheet as a background: `w`×`h` px at `(x, y)` of the sheet. */
export function cut(sheet: Sheet, x: number, y: number, w: number, h: number): CSSProperties {
  return {
    backgroundImage: sheetUrl(sheet),
    backgroundPosition: `${-x}px ${-y}px`,
    width: w,
    height: h,
  };
}

export const MAIN = { width: 275, height: 116 } as const;

/** Where each control sits in the main window, and what it is cut from. */
export const MAIN_WINDOW = {
  titleBar: { left: 0, top: 0, cut: cut("titlebar", 27, 0, 275, 14) },
  clutterBar: { left: 10, top: 22, cut: cut("titlebar", 304, 0, 8, 43) },
  indicator: {
    left: 26,
    top: 28,
    playing: cut("playpaus", 0, 0, 9, 9),
    paused: cut("playpaus", 9, 0, 9, 9),
    stopped: cut("playpaus", 18, 0, 9, 9),
  },
  /** The four time digits: minute tens/ones, second tens/ones. */
  time: { top: 26, digits: [48, 60, 78, 90] },
  marquee: { left: 112, top: 27, width: 150, chars: 30 },
  kbps: { left: 111, top: 43 },
  khz: { left: 156, top: 43 },
  mono: { left: 212, top: 41, on: cut("monoster", 29, 0, 27, 12), off: cut("monoster", 29, 12, 27, 12) },
  stereo: { left: 239, top: 41, on: cut("monoster", 0, 0, 29, 12), off: cut("monoster", 0, 12, 29, 12) },
  volume: { left: 107, top: 57, width: 68, frames: 28, thumb: cut("volume", 15, 422, 14, 11) },
  balance: { left: 177, top: 57, width: 38, thumb: cut("balance", 15, 422, 14, 11) },
  eqButton: { left: 219, top: 58, cut: cut("shufrep", 0, 61, 23, 12) },
  plButton: { left: 242, top: 58, cut: cut("shufrep", 23, 73, 23, 12) },
  position: {
    left: 16,
    top: 72,
    width: 248,
    track: cut("posbar", 0, 0, 248, 10),
    thumb: cut("posbar", 248, 0, 29, 10),
  },
  buttons: {
    prev: { left: 16, top: 88, up: cut("cbuttons", 0, 0, 23, 18), down: cut("cbuttons", 0, 18, 23, 18) },
    play: { left: 39, top: 88, up: cut("cbuttons", 23, 0, 23, 18), down: cut("cbuttons", 23, 18, 23, 18) },
    pause: { left: 62, top: 88, up: cut("cbuttons", 46, 0, 23, 18), down: cut("cbuttons", 46, 18, 23, 18) },
    stop: { left: 85, top: 88, up: cut("cbuttons", 69, 0, 23, 18), down: cut("cbuttons", 69, 18, 23, 18) },
    next: { left: 108, top: 88, up: cut("cbuttons", 92, 0, 22, 18), down: cut("cbuttons", 92, 18, 22, 18) },
    eject: {
      left: 136,
      top: 89,
      up: cut("cbuttons", 114, 0, 22, 16),
      down: cut("cbuttons", 114, 16, 22, 16),
    },
  },
  shuffle: { left: 164, top: 89, cut: cut("shufrep", 28, 0, 47, 15) },
  repeat: { left: 210, top: 89, cut: cut("shufrep", 0, 0, 28, 15) },
} as const;

/** The volume trough's frame for a level 0..1 (the sheet stacks 28 of them, 15 px apart). */
export function volumeFrame(level: number): CSSProperties {
  const i = Math.round(Math.max(0, Math.min(1, level)) * (MAIN_WINDOW.volume.frames - 1));
  return cut("volume", 0, i * 15, 68, 13);
}
export const balanceFrame = (): CSSProperties => cut("balance", 9, 0, 38, 13);

/** The playlist window's frame pieces. Width 275: the bottom corners meet exactly (125 + 150). */
export const PLAYLIST = {
  topLeft: cut("pledit", 0, 0, 25, 20),
  title: cut("pledit", 26, 0, 100, 20),
  topRight: cut("pledit", 153, 0, 25, 20),
  // the repeating edges (top tile 127,0 25×20; left 0,42 12×29; right 31,42 20×29) are cut
  // onto a canvas at runtime — use-tile.ts — since background-repeat can't repeat a cut
  bottomLeft: cut("pledit", 0, 72, 125, 38),
  bottomRight: cut("pledit", 126, 72, 150, 38),
} as const;

/** The 5×6 bitmap font (text.bmp): row and column of each glyph. */
const GLYPHS: Record<string, [number, number]> = {
  '"': [0, 26],
  "@": [0, 27],
  " ": [0, 30],
  "…": [1, 10],
  ".": [1, 11],
  ":": [1, 12],
  "(": [1, 13],
  ")": [1, 14],
  "-": [1, 15],
  "'": [1, 16],
  "!": [1, 17],
  _: [1, 18],
  "+": [1, 19],
  "\\": [1, 20],
  "/": [1, 21],
  "[": [1, 22],
  "]": [1, 23],
  "<": [1, 22],
  ">": [1, 23],
  "{": [1, 22],
  "}": [1, 23],
  "^": [1, 24],
  "&": [1, 25],
  "%": [1, 26],
  ",": [1, 27],
  "=": [1, 28],
  $: [1, 29],
  "#": [1, 30],
  å: [2, 0],
  ö: [2, 1],
  ä: [2, 2],
  "?": [2, 3],
  "*": [2, 4],
};
for (let i = 0; i < 26; i++) GLYPHS[String.fromCharCode(97 + i)] = [0, i];
for (let i = 0; i < 10; i++) GLYPHS[String(i)] = [1, i];

export const CHAR = { width: 5, height: 6 } as const;

/** The glyph for a character: lowercased, diacritics stripped, anything unknown a space. */
export function glyph(ch: string): CSSProperties {
  const c = ch.toLowerCase();
  const [row, col] = GLYPHS[c] ?? GLYPHS[c.normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? [0, 30];
  return cut("text", col * CHAR.width, row * CHAR.height, CHAR.width, CHAR.height);
}

export const DIGIT = { width: 9, height: 13 } as const;
export const digit = (d: number): CSSProperties =>
  cut("numbers", d * DIGIT.width, 0, DIGIT.width, DIGIT.height);
