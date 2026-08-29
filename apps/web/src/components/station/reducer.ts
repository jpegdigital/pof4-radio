import type { SegmentTrack } from "@radio/db";

/**
 * The station's state machine. Pure: every decision about what plays next lives here; the
 * effects hook (use-station.ts) only carries out what the state says.
 *
 * The show is an ordered list of *metatracks*: a segment is its talk, then its 3–4 tracks. One
 * cursor walks it — `{seg, item}` where item 0 is the talk and 1..n the tracks. Any position can
 * be jumped to; the DJ is only asked for more when the cursor lands on the talk of the *last*
 * segment (or on RUN at the tail), so rewinding never plans.
 *
 *   loop    — Run/Stop. Absolute. Stopping keeps the cursor and the DJ's memory.
 *   phase   — idle (nothing yet) | planning (waiting on the DJ for the block to start) | playing
 *   pending — a /api/station/next request is wanted/in flight (requestSeq bumps per request)
 *   playSeq — bumps whenever the item under the cursor must (re)start
 *
 * Talk *audio* is not state here: the hook caches it by position (use-station.ts). The only audio
 * fact the reducer needs is TALK_FAILED, so a broken voice never stalls the show.
 */

export interface SegmentView {
  id: string;
  seq: number;
  prompt: string;
  talk: string;
  tracks: SegmentTrack[];
}

export interface Cursor {
  seg: number;
  /** 0 = the talk; 1..n = tracks[item - 1]. */
  item: number;
}

export type Phase = "idle" | "planning" | "playing";

export interface StationState {
  loop: "stopped" | "running";
  phase: Phase;
  segments: SegmentView[];
  cursor: Cursor | null;
  pending: boolean;
  requestSeq: number;
  retried: boolean;
  playSeq: number;
  error: string | null;
}

export type StationEvent =
  | { type: "RUN" }
  | { type: "STOP" }
  /** Something the loop can't continue through (device gone, another tab owns the station). */
  | { type: "HALT"; error: string }
  /** A resumed station's past blocks. Only while stopped. */
  | { type: "LOAD_SHOW"; segments: SegmentView[] }
  | { type: "CLEAR_SHOW" }
  | { type: "SEGMENT_READY"; segment: SegmentView }
  | { type: "SEGMENT_FAILED"; error: string }
  /** The talk audio for a segment could not be fetched or played. */
  | { type: "TALK_FAILED"; segmentId: string }
  /** The item under the cursor finished (talk audio ended, or Spotify ran out of list). */
  | { type: "ENDED" }
  /** Spotify moved on to another track of the block by itself. */
  | { type: "TRACK_CHANGED"; uri: string }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "JUMP"; seg: number; item: number }
  | { type: "CLEAR_ERROR" };

export const MAX_SEGMENTS = 20;

export const initialState: StationState = {
  loop: "stopped",
  phase: "idle",
  segments: [],
  cursor: null,
  pending: false,
  requestSeq: 0,
  retried: false,
  playSeq: 0,
  error: null,
};

export const itemCount = (seg: SegmentView): number => 1 + seg.tracks.length;

export function cursorSegment(s: StationState): SegmentView | null {
  return s.cursor ? (s.segments[s.cursor.seg] ?? null) : null;
}

export function atTail(s: StationState): boolean {
  return s.cursor !== null && s.cursor.seg === s.segments.length - 1;
}

/** Ask for the next segment unless one is already on its way. */
function requestNext(s: StationState): StationState {
  return s.pending ? s : { ...s, pending: true, requestSeq: s.requestSeq + 1 };
}

/** Put the cursor somewhere and (re)start what's there. Landing on the tail's talk plans. */
function moveTo(s: StationState, cursor: Cursor): StationState {
  const moved: StationState = { ...s, phase: "playing", cursor, playSeq: s.playSeq + 1 };
  const plans = s.loop === "running" && cursor.item === 0 && cursor.seg === s.segments.length - 1;
  return plans ? requestNext(moved) : moved;
}

function inBounds(s: StationState, c: Cursor): boolean {
  const seg = s.segments[c.seg];
  return seg !== undefined && c.item >= 0 && c.item < itemCount(seg);
}

/** The item after the cursor, or null past the end of the show. */
function after(s: StationState, c: Cursor): Cursor | null {
  const seg = s.segments[c.seg];
  if (!seg) return null;
  if (c.item < itemCount(seg) - 1) return { seg: c.seg, item: c.item + 1 };
  return c.seg < s.segments.length - 1 ? { seg: c.seg + 1, item: 0 } : null;
}

/** The item before the cursor, or null at the first talk. */
function before(s: StationState, c: Cursor): Cursor | null {
  if (c.item > 0) return { seg: c.seg, item: c.item - 1 };
  const prev = s.segments[c.seg - 1];
  return prev ? { seg: c.seg - 1, item: itemCount(prev) - 1 } : null;
}

function halt(s: StationState, error: string | null): StationState {
  return { ...s, loop: "stopped", error };
}

export function reducer(s: StationState, e: StationEvent): StationState {
  switch (e.type) {
    case "RUN": {
      if (s.loop === "running") return s;
      const running: StationState = { ...s, loop: "running", retried: false, error: null };
      if (s.cursor && s.phase === "playing") {
        const resumed: StationState = { ...running, playSeq: s.playSeq + 1 };
        return atTail(resumed) ? requestNext(resumed) : resumed;
      }
      return requestNext({ ...running, phase: "planning" });
    }

    case "STOP":
      return s.loop === "stopped" ? s : halt(s, s.error);

    case "HALT":
      return halt(s, e.error);

    case "LOAD_SHOW":
      if (s.loop === "running") return s;
      return { ...s, phase: "idle", segments: e.segments.slice(-MAX_SEGMENTS), cursor: null, error: null };

    case "CLEAR_SHOW":
      if (s.loop === "running") return s;
      return { ...s, phase: "idle", segments: [], cursor: null, error: null };

    case "SEGMENT_READY": {
      let segments = [...s.segments, e.segment];
      let cursor = s.cursor;
      if (segments.length > MAX_SEGMENTS) {
        segments = segments.slice(1);
        if (cursor) cursor = { ...cursor, seg: Math.max(0, cursor.seg - 1) };
      }
      const settled: StationState = { ...s, segments, cursor, pending: false, retried: false, error: null };
      if (s.phase !== "planning") return settled;
      return moveTo(settled, { seg: segments.length - 1, item: 0 });
    }

    case "SEGMENT_FAILED": {
      const failed: StationState = { ...s, pending: false, error: e.error };
      if (s.loop === "stopped") return failed;
      if (!s.retried) return requestNext({ ...failed, retried: true });
      return halt({ ...failed, retried: false }, e.error);
    }

    case "TALK_FAILED": {
      const seg = cursorSegment(s);
      if (!s.cursor || s.cursor.item !== 0 || seg?.id !== e.segmentId) return s;
      return moveTo(s, { seg: s.cursor.seg, item: 1 });
    }

    case "ENDED":
    case "NEXT": {
      if (s.loop !== "running" || s.phase !== "playing" || !s.cursor) return s;
      const to = after(s, s.cursor);
      return to ? moveTo(s, to) : requestNext({ ...s, phase: "planning" });
    }

    case "PREV": {
      if (s.loop !== "running" || s.phase !== "playing" || !s.cursor) return s;
      const to = before(s, s.cursor);
      return to ? moveTo(s, to) : s;
    }

    case "JUMP": {
      const to = { seg: e.seg, item: e.item };
      if (!inBounds(s, to)) return s;
      return moveTo({ ...s, loop: "running", retried: false, error: null }, to);
    }

    case "TRACK_CHANGED": {
      const seg = cursorSegment(s);
      if (s.phase !== "playing" || !s.cursor || s.cursor.item === 0 || !seg) return s;
      const i = seg.tracks.findIndex((t) => t.uri === e.uri);
      if (i < 0 || i + 1 === s.cursor.item) return s;
      return { ...s, cursor: { seg: s.cursor.seg, item: i + 1 } };
    }

    case "CLEAR_ERROR":
      return s.error ? { ...s, error: null } : s;
  }
}
