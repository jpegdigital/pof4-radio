/**
 * The program's state machine. Pure. A program is an ordered list of elements; each element says
 * what happens on two lanes — `music` (the Spotify device) and `mic` (one <audio> element). The
 * reducer emits the *desired* lane state; use-program.ts makes the device and the element match it.
 *
 *   cursor    — the element on air
 *   music     — what the device should play and how loud: off | bed | duck | full
 *   mic       — the clip the <audio> should be playing, or null
 *   playSeq   — bumps whenever the element must (re)start its music
 *   startedAt — wall ms when RUN was first pressed; the program clock reads from it
 */

export interface Track {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
}

export interface Talk {
  /** A clip name in /program (no extension). */
  clip: string;
  /** Over the song's first seconds (ducked from the start) or back-timed over its last. */
  over: "intro" | "outro";
}

export type Element =
  | { kind: "song"; track: Track; talk?: Talk }
  /** Music stopped; the clip over a bed (a ducked instrumental) or nothing. */
  | { kind: "break"; clip: string; bed?: Track; label: string }
  /** Dry: the clip alone. */
  | { kind: "id"; clip: string; label: string };

export type Level = "off" | "bed" | "duck" | "full";

export interface ProgramState {
  loop: "stopped" | "running";
  elements: Element[];
  cursor: number | null;
  music: { uri: string | null; level: Level };
  mic: string | null;
  playSeq: number;
  startedAt: number | null;
  error: string | null;
}

export type ProgramEvent =
  | { type: "RUN" }
  | { type: "STOP" }
  /** Something the loop can't continue through (device gone, play() refused). */
  | { type: "HALT"; error: string }
  | { type: "CLIP_ENDED"; clip: string }
  /** The clip could not be fetched or played; treated as ended so a broken voice never stalls. */
  | { type: "CLIP_FAILED"; clip: string }
  /** The device ran out of list. */
  | { type: "TRACK_ENDED" }
  /** The back-timer for an outro talk fired. */
  | { type: "OUTRO_DUE" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "JUMP"; index: number };

const SILENT = { uri: null, level: "off" } as const;

export const initialState: ProgramState = {
  loop: "stopped",
  elements: [],
  cursor: null,
  music: SILENT,
  mic: null,
  playSeq: 0,
  startedAt: null,
  error: null,
};

export function onAir(s: ProgramState): Element | null {
  return s.cursor === null ? null : (s.elements[s.cursor] ?? null);
}

/** The clip an element puts on the mic, if any. */
export function clipOf(el: Element): string | null {
  return el.kind === "song" ? (el.talk?.clip ?? null) : el.clip;
}

/** The lanes as an element wants them the moment it starts. */
function lanesFor(el: Element): Pick<ProgramState, "music" | "mic"> {
  switch (el.kind) {
    case "song":
      return el.talk?.over === "intro"
        ? { music: { uri: el.track.uri, level: "duck" }, mic: el.talk.clip }
        : { music: { uri: el.track.uri, level: "full" }, mic: null };
    case "break":
      return { music: el.bed ? { uri: el.bed.uri, level: "bed" } : SILENT, mic: el.clip };
    case "id":
      return { music: SILENT, mic: el.clip };
  }
}

/** Put the cursor on an element and start it; past the end, the program is over. */
function moveTo(s: ProgramState, index: number): ProgramState {
  const el = s.elements[index];
  if (!el) return { ...s, loop: "stopped", music: SILENT, mic: null };
  return { ...s, loop: "running", cursor: index, ...lanesFor(el), playSeq: s.playSeq + 1, error: null };
}

export function reducer(s: ProgramState, e: ProgramEvent): ProgramState {
  switch (e.type) {
    case "RUN":
      if (s.loop === "running") return s;
      return moveTo({ ...s, startedAt: s.startedAt ?? Date.now() }, s.cursor ?? 0);

    case "STOP":
      return s.loop === "stopped" ? s : { ...s, loop: "stopped", music: SILENT, mic: null };

    case "HALT":
      return { ...s, loop: "stopped", music: SILENT, mic: null, error: e.error };

    case "CLIP_ENDED":
    case "CLIP_FAILED": {
      const el = onAir(s);
      if (s.loop !== "running" || s.cursor === null || !el || s.mic !== e.clip) return s;
      if (el.kind !== "song") return moveTo(s, s.cursor + 1);
      if (el.talk?.over === "intro") return { ...s, mic: null, music: { ...s.music, level: "full" } };
      return { ...s, mic: null }; // an outro: the track's end moves the cursor
    }

    case "TRACK_ENDED":
      return s.loop !== "running" || s.cursor === null ? s : moveTo(s, s.cursor + 1);

    case "OUTRO_DUE": {
      const el = onAir(s);
      if (s.loop !== "running" || el?.kind !== "song" || el.talk?.over !== "outro" || s.mic) return s;
      return { ...s, mic: el.talk.clip, music: { ...s.music, level: "duck" } };
    }

    case "NEXT":
      return s.loop !== "running" || s.cursor === null ? s : moveTo(s, s.cursor + 1);

    case "PREV":
      return s.loop !== "running" || !s.cursor ? s : moveTo(s, s.cursor - 1);

    case "JUMP":
      if (!s.elements[e.index]) return s;
      return moveTo({ ...s, startedAt: s.startedAt ?? Date.now() }, e.index);
  }
}
