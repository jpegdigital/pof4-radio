import type { Element, Record, SegmentView } from "@radio/dj";

/**
 * The station's state machine. Pure. The show is an ordered list of elements; each element says
 * what happens on three lanes — `music` (the Spotify device: songs only), `mic` (the voice) and
 * `bed` (a looped instrumental under the voice; mic and bed are mixed in a Web Audio graph). The
 * reducer emits the *desired* lane state; use-program.ts makes the device and the graph match it.
 *
 *   cursor    — the element on air; past the end (or null) while running = the gap: waiting for
 *               the next slot, playing a clean segue into its record if the show is already on air
 *   segments  — the kept segments, each an index range into `elements`. The last one may still be
 *               growing: a slot at a time lands at its end (SEGMENT_SLOT) until it is complete
 *   producing — a production request is in flight
 *   music     — what the device should play and how loud: off | duck | full
 *   mic       — the clip URL the voice should be playing, or null
 *   bed       — the bed URL under it, or null (when it comes in and fades out is timing, in the hook)
 *   playSeq   — bumps whenever the music lane must (re)start
 *   micSeq    — bumps whenever the mic lane must (re)start (a lead keeps the clip running)
 *   startedAt — wall ms when RUN was first pressed
 */

export type { Element, Talk, Track } from "@radio/dj";

export type Level = "off" | "duck" | "full";

export interface SegmentRef {
  id: string;
  seq: number;
  /** Element index range: [from, to). Grows while the segment is produced. */
  from: number;
  to: number;
  complete: boolean;
  view: SegmentView;
}

export interface ProgramState {
  loop: "stopped" | "running";
  elements: Element[];
  segments: SegmentRef[];
  producing: boolean;
  cursor: number | null;
  music: { uri: string | null; level: Level };
  mic: string | null;
  bed: string | null;
  playSeq: number;
  micSeq: number;
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
  /** The timer for a waiting talk fired: an outro's back-timer, or a delayed intro's. */
  | { type: "TALK_DUE" }
  /** A break's lead is due: the next song starts under the clip's last line. */
  | { type: "LEAD_DUE" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "JUMP"; index: number }
  /** A kept station's segments. Only while stopped. */
  | { type: "LOAD_SHOW"; segments: SegmentView[] }
  | { type: "CLEAR_SHOW" }
  /** A production request went out. */
  | { type: "PRODUCING" }
  /** A segment is opened: its records are known, its rows can be painted. */
  | { type: "SEGMENT_OPENED"; view: SegmentView }
  /** A slot landed: the segment as kept now — its new elements join the show. */
  | { type: "SEGMENT_SLOT"; view: SegmentView }
  | { type: "SEGMENT_FAILED"; error: string }
  | { type: "CLEAR_ERROR" };

const SILENT = { uri: null, level: "off" } as const;

export const initialState: ProgramState = {
  loop: "stopped",
  elements: [],
  segments: [],
  producing: false,
  cursor: null,
  music: SILENT,
  mic: null,
  bed: null,
  playSeq: 0,
  micSeq: 0,
  startedAt: null,
  error: null,
};

export function onAir(s: ProgramState): Element | null {
  return s.cursor === null ? null : (s.elements[s.cursor] ?? null);
}

/** Running with nothing under the cursor: waiting for the next slot. */
export function inGap(s: ProgramState): boolean {
  return s.loop === "running" && (s.cursor === null || s.cursor >= s.elements.length);
}

/** The segment an element index falls in. */
export function segmentAt(s: ProgramState, index: number | null): SegmentRef | null {
  if (index === null) return null;
  return s.segments.find((g) => index >= g.from && index < g.to) ?? null;
}

/** The clip an element puts on the mic, if any. */
export function clipOf(el: Element): string | null {
  return el.kind === "song" ? (el.talk?.clip ?? null) : el.clip;
}

/** The records of the last segment whose slots haven't landed yet, in order. */
export function ahead(s: ProgramState): Record[] {
  const last = s.segments.at(-1);
  if (!last || last.complete) return [];
  return last.view.records.slice(last.view.log.slots.length);
}

/** The record the next slot will bring, if one is known. */
export function nextRecord(s: ProgramState): Record | null {
  return ahead(s)[0] ?? null;
}

/** Something is on its way: a request in flight, or a segment with slots still to come. */
export function awaiting(s: ProgramState): boolean {
  return s.producing || ahead(s).length > 0;
}

/** The lanes as an element wants them the moment it starts. */
function lanesFor(el: Element): Pick<ProgramState, "music" | "mic" | "bed"> {
  switch (el.kind) {
    case "song":
      return el.talk?.over === "intro" && !el.talk.atMs
        ? { music: { uri: el.track.uri, level: "duck" }, mic: el.talk.clip, bed: null }
        : { music: { uri: el.track.uri, level: "full" }, mic: null, bed: null };
    case "break":
      return { music: SILENT, mic: el.clip, bed: el.bed ?? null };
  }
}

const refOf = (v: SegmentView, from: number): SegmentRef => ({
  id: v.id,
  seq: v.seq,
  from,
  to: from + v.elements.length,
  complete: v.complete,
  view: v,
});

/** Every kept segment's elements, appended in order; the last may still be growing. */
function loadShow(segments: SegmentView[]): Pick<ProgramState, "elements" | "segments"> {
  const elements: Element[] = [];
  const refs: SegmentRef[] = [];
  for (const v of [...segments].sort((a, b) => a.seq - b.seq)) {
    refs.push(refOf(v, elements.length));
    elements.push(...v.elements);
  }
  return { elements, segments: refs };
}

/**
 * Put the cursor on an element and start it. Past the end: the gap — on a show already on air, a
 * clean segue into the record the next slot will bring while it is produced; silence while
 * something is on its way (the opening: the break is worth waiting for); the end of the show
 * when nothing is.
 */
function moveTo(s: ProgramState, index: number): ProgramState {
  const el = s.elements[index];
  if (!el) {
    const next = s.elements.length ? nextRecord(s) : null;
    if (next)
      return {
        ...s,
        loop: "running",
        cursor: s.elements.length,
        music: { uri: next.uri, level: "full" },
        mic: null,
        bed: null,
        playSeq: s.playSeq + 1,
        micSeq: s.micSeq + 1,
        error: null,
      };
    if (awaiting(s))
      return {
        ...s,
        loop: "running",
        cursor: s.elements.length,
        music: SILENT,
        mic: null,
        bed: null,
        micSeq: s.micSeq + 1,
      };
    return { ...s, loop: "stopped", music: SILENT, mic: null, bed: null };
  }
  return {
    ...s,
    loop: "running",
    cursor: index,
    ...lanesFor(el),
    playSeq: s.playSeq + 1,
    micSeq: s.micSeq + 1,
    error: null,
  };
}

export function reducer(s: ProgramState, e: ProgramEvent): ProgramState {
  switch (e.type) {
    case "RUN": {
      if (s.loop === "running") return s;
      if (!s.elements.length && !awaiting(s)) return s;
      return moveTo({ ...s, startedAt: s.startedAt ?? Date.now() }, s.cursor ?? 0);
    }

    case "STOP":
      return s.loop === "stopped" ? s : { ...s, loop: "stopped", music: SILENT, mic: null, bed: null };

    case "HALT":
      return { ...s, loop: "stopped", music: SILENT, mic: null, bed: null, error: e.error };

    case "CLIP_ENDED":
    case "CLIP_FAILED": {
      const el = onAir(s);
      if (s.loop !== "running" || s.cursor === null || !el || s.mic !== e.clip) return s;
      if (el.kind !== "song") return moveTo(s, s.cursor + 1);
      // The clip was the song's intro (its own, or a break's lead): the music comes back up.
      if (el.talk?.over !== "outro")
        return { ...s, mic: null, bed: null, music: { ...s.music, level: "full" } };
      return { ...s, mic: null }; // an outro: the track's end moves the cursor
    }

    case "TRACK_ENDED":
      if (s.loop !== "running" || s.cursor === null) return s;
      // The gap's segue song ran out and the slot still isn't here: silence, still on air.
      if (inGap(s)) return { ...s, music: SILENT };
      return moveTo(s, s.cursor + 1);

    case "TALK_DUE": {
      const el = onAir(s);
      if (s.loop !== "running" || el?.kind !== "song" || !el.talk || s.mic) return s;
      if (el.talk.over === "intro" && !el.talk.atMs) return s; // that talk started with the song
      return { ...s, mic: el.talk.clip, music: { ...s.music, level: "duck" } };
    }

    case "LEAD_DUE": {
      const el = onAir(s);
      const next = s.cursor === null ? undefined : s.elements[s.cursor + 1];
      if (s.loop !== "running" || s.cursor === null || el?.kind !== "break" || !el.leadMs) return s;
      if (next?.kind !== "song") return s; // nothing to lead into; the clip's end moves on
      return {
        ...s,
        cursor: s.cursor + 1,
        music: { uri: next.track.uri, level: "duck" },
        playSeq: s.playSeq + 1, // the mic keeps the break's clip (and its fading bed): micSeq stays
      };
    }

    case "NEXT":
      return s.loop !== "running" || s.cursor === null || inGap(s) ? s : moveTo(s, s.cursor + 1);

    case "PREV":
      return s.loop !== "running" || !s.cursor ? s : moveTo(s, Math.min(s.cursor, s.elements.length) - 1);

    case "JUMP":
      if (!s.elements[e.index]) return s;
      return moveTo({ ...s, startedAt: s.startedAt ?? Date.now() }, e.index);

    case "LOAD_SHOW":
      if (s.loop === "running") return s;
      return { ...s, ...loadShow(e.segments), producing: false, cursor: null, error: null };

    case "CLEAR_SHOW":
      if (s.loop === "running") return s;
      return { ...initialState, startedAt: s.startedAt };

    case "PRODUCING":
      return s.producing ? s : { ...s, producing: true, error: null };

    case "SEGMENT_OPENED": {
      if (s.segments.some((g) => g.id === e.view.id)) return { ...s, producing: false };
      const next: ProgramState = {
        ...s,
        segments: [...s.segments, refOf(e.view, s.elements.length)],
        elements: [...s.elements, ...e.view.elements],
        producing: false,
        error: null,
      };
      // Waiting in silence on a show already on air: the segue into its first record starts now.
      if (inGap(s) && s.music.level === "off") return moveTo(next, s.elements.length);
      return next;
    }

    case "SEGMENT_SLOT": {
      const at = s.segments.findIndex((g) => g.id === e.view.id);
      if (at < 0) return reducer(reducer(s, { type: "SEGMENT_OPENED", view: e.view }), e);
      const ref = s.segments[at];
      if (!ref) return s;
      const fresh = e.view.elements.slice(ref.to - ref.from);
      // Only the last segment grows; anything else would break the index ranges.
      if (at !== s.segments.length - 1 && fresh.length) return { ...s, producing: false };
      const grown: SegmentRef = {
        ...ref,
        to: ref.to + fresh.length,
        complete: e.view.complete,
        view: e.view,
      };
      const next: ProgramState = {
        ...s,
        elements: [...s.elements, ...fresh],
        segments: s.segments.map((g, i) => (i === at ? grown : g)),
        producing: false,
      };
      if (!inGap(s) || !fresh.length) return next;
      // The gap's segue song is this slot's song: keep it playing, just move the cursor onto it.
      const song = fresh.findIndex((el) => el.kind === "song");
      const first = song >= 0 ? fresh[song] : undefined;
      if (first?.kind === "song" && s.music.uri === first.track.uri && s.music.level !== "off")
        return { ...next, cursor: ref.to + song, mic: null, bed: null };
      return moveTo(next, ref.to);
    }

    case "SEGMENT_FAILED": {
      const failed: ProgramState = { ...s, producing: false, error: e.error };
      // In the silent gap, the show is over until Run is pressed again.
      return inGap(s) && s.music.level === "off" ? { ...failed, loop: "stopped" } : failed;
    }

    case "CLEAR_ERROR":
      return s.error ? { ...s, error: null } : s;
  }
}
