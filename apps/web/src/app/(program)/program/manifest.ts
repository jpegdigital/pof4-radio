import type { Element, Track } from "./reducer";

/**
 * What `scripts/program-prep.mjs` wrote to /program/manifest.json, and how it becomes the practice
 * program's element list. The layout is fixed here for now — the 8:43 Saturday-night segment; a
 * DJ-planned program would produce the same `Element[]` some other way.
 */
export interface Manifest {
  station: string;
  dj: string;
  voiceId: string;
  songs: Track[];
  bed: Track;
  /** Clip name → its text and timings (from ElevenLabs' character alignment). */
  clips: Record<string, Clip>;
}

export interface Clip {
  text: string;
  durationMs: number;
  /** The bed comes in here; before it the clip is dry (a legal ID). */
  bedInMs?: number;
  /** The next song starts this long before the clip ends, under its last line. */
  leadMs?: number;
}

export const MANIFEST_URL = "/program/manifest.json";
export const clipUrl = (clip: string) => `/program/${clip}.mp3`;

/** The program clock starts here: 8:43:00 pm, as ms since midnight. */
export const PROGRAM_START_MS = (20 * 60 + 43) * 60 * 1000;

export function toElements(m: Manifest): Element[] {
  const [s1, s2, s3, s4, s5] = m.songs;
  if (!s1 || !s2 || !s3 || !s4 || !s5) throw new Error("the manifest needs five songs");
  const small = m.clips["break-small"];
  const big = m.clips["break-big"];
  if (!small || !big) throw new Error("the manifest needs break-small and break-big");
  return [
    { kind: "break", clip: "break-small", bed: m.bed, leadMs: small.leadMs ?? 0, label: "Full break" },
    { kind: "song", track: s1 },
    { kind: "song", track: s2, talk: { clip: "talkup-2", over: "intro" } },
    { kind: "song", track: s3, talk: { clip: "talkup-3", over: "intro" } },
    { kind: "song", track: s4, talk: { clip: "talkup-4", over: "intro" } },
    {
      kind: "break",
      clip: "break-big",
      bed: m.bed,
      bedInMs: big.bedInMs,
      leadMs: big.leadMs ?? 0,
      label: "Legal ID · top of the hour",
    },
    { kind: "song", track: s5 },
  ];
}
