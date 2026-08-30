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
  /** The bed is generated audio in /program (Eleven Music), not a Spotify track; this is unused. */
  bed?: Track;
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
export const CLOCK_URL = "/program/clock.json";
export const clipUrl = (clip: string) => `/program/${clip}.mp3`;
/** The one talk bed, a looped instrumental: /program/bed.mp3. */
export const BED = "bed";

/** The program clock starts here: 8:43:00 pm, as ms since midnight. */
export const PROGRAM_START_MS = (20 * 60 + 43) * 60 * 1000;

export function toElements(m: Manifest): Element[] {
  const [s1, s2, s3, s4, s5] = m.songs;
  if (!s1 || !s2 || !s3 || !s4 || !s5) throw new Error("the manifest needs five songs");
  const small = m.clips["break-small"];
  const big = m.clips["break-big"];
  if (!small || !big) throw new Error("the manifest needs break-small and break-big");
  return [
    { kind: "break", clip: "break-small", bed: BED, leadMs: small.leadMs ?? 0, label: "Full break" },
    { kind: "song", track: s1 },
    { kind: "song", track: s2, talk: { clip: "talkup-2", over: "intro" } },
    { kind: "song", track: s3, talk: { clip: "talkup-3", over: "intro" } },
    { kind: "song", track: s4, talk: { clip: "talkup-4", over: "intro" } },
    {
      kind: "break",
      clip: "break-big",
      bed: BED,
      bedInMs: big.bedInMs,
      leadMs: big.leadMs ?? 0,
      label: "Legal ID · top of the hour",
    },
    { kind: "song", track: s5 },
  ];
}

/**
 * What `scripts/clock-prep.mjs` wrote to /program/clock.json: Claude's plan for the set (from
 * /api/program/clock), its words, and the clip made of each — with the timings that come from
 * the two together (`introMs` from Claude, the clip's length from ElevenLabs).
 */
export interface Clock {
  station: string;
  dj: string;
  voiceId: string;
  songs: Track[];
  /** The parts in order (open → top …), each its own pair of calls; slots index into `songs`. */
  slots: ClockSlot[];
}

export interface ClockSlot {
  song: number;
  intro: "talkup" | "sweeper" | "segue" | "break";
  introMs: number;
  sure: boolean;
  post: string;
  why: string;
  words: string;
  /** The top-of-the-hour break's legal ID, said dry before the bed. */
  legalId?: string;
  /** The clip name, when there are words. */
  clip?: string;
  durationMs?: number;
  /** break: the bed waits this long (the legal ID before it is dry). */
  bedInMs?: number;
  /** break: the next song starts this long before the clip ends (under its last line). */
  leadMs?: number;
  /** talkup: the voice starts this far into the song, so it ends a beat before the post. */
  atMs?: number;
}

/** Claude's clock as the player's element list: what it decided at each song's top, then the song. */
export function toClockElements(c: Clock): Element[] {
  const els: Element[] = [];
  for (const slot of c.slots) {
    const track = c.songs[slot.song];
    if (!track) throw new Error(`clock slot points at song ${slot.song}, which is not in the set`);
    const label = `${track.artists.join(", ")} — ${track.name}`;
    switch (slot.intro) {
      case "break":
        els.push({
          kind: "break",
          clip: slot.clip ?? "",
          bed: BED,
          bedInMs: slot.bedInMs,
          leadMs: slot.leadMs ?? 0,
          label: `${slot.legalId ? "Top of the hour" : "Break"} → ${label}`,
        });
        els.push({ kind: "song", track });
        break;
      case "sweeper":
        els.push({ kind: "break", clip: slot.clip ?? "", leadMs: 0, label: `Sweeper → ${label}` });
        els.push({ kind: "song", track });
        break;
      case "talkup":
        els.push({ kind: "song", track, talk: { clip: slot.clip ?? "", over: "intro", atMs: slot.atMs } });
        break;
      case "segue":
        els.push({ kind: "song", track });
        break;
    }
  }
  return els;
}
