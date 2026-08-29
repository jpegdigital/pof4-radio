import type { SegmentTrack } from "@radio/db";

/**
 * The station's state machine. Pure: every decision about what plays next lives here; the
 * effects hook (use-station.ts) only carries out what the state says.
 *
 *   loop   — Run/Stop. Absolute. Stopping keeps the buffered segment and the DJ's memory.
 *   phase  — idle | planning (waiting on the DJ, nothing to play) | talk | tracks
 *   current/next — what's on air and the one segment buffered behind it
 *   pending — a /api/station/next request is wanted/in flight (requestSeq bumps per request)
 *
 * A request for the next segment goes out the moment a segment's talk starts, so N+1 arrives
 * while N plays. One buffered segment, one request at a time.
 */

export interface SegmentView {
  id: string;
  seq: number;
  prompt: string;
  talk: string;
  tracks: SegmentTrack[];
}

export interface Loaded {
  segment: SegmentView;
  /** Object URL of the fetched talk audio; null until the prefetch lands. */
  talkUrl: string | null;
  talkFailed: boolean;
}

export type Phase = "idle" | "planning" | "talk" | "tracks";

export interface StationState {
  loop: "stopped" | "running";
  phase: Phase;
  current: Loaded | null;
  trackIndex: number;
  next: Loaded | null;
  pending: boolean;
  requestSeq: number;
  retried: boolean;
  /** Bumps whenever the tracks effect must (re)start playback of `trackIndex`. */
  playSeq: number;
  /** Where to pick up on Run after a Stop mid-segment. */
  resume: "talk" | "tracks" | null;
  error: string | null;
}

export type StationEvent =
  | { type: "RUN" }
  | { type: "STOP" }
  | { type: "SEGMENT_READY"; segment: SegmentView }
  | { type: "SEGMENT_FAILED"; error: string }
  | { type: "TALK_READY"; segmentId: string; url: string }
  | { type: "TALK_AUDIO_FAILED"; segmentId: string; error: string }
  | { type: "TALK_ENDED" }
  | { type: "SKIP_TALK" }
  | { type: "TRACK_LIST_ENDED" }
  /** Spotify moved on to another track of the block by itself (no NEXT/PREV from us). */
  | { type: "TRACK_CHANGED"; uri: string }
  | { type: "NEXT" }
  | { type: "PREV" }
  /** Something the loop can't continue through (device gone, another tab owns the station). */
  | { type: "HALT"; error: string }
  | { type: "CLEAR_ERROR" };

export const initialState: StationState = {
  loop: "stopped",
  phase: "idle",
  current: null,
  trackIndex: 0,
  next: null,
  pending: false,
  requestSeq: 0,
  retried: false,
  playSeq: 0,
  resume: null,
  error: null,
};

const load = (segment: SegmentView): Loaded => ({ segment, talkUrl: null, talkFailed: false });

/** Ask for the next segment unless one is already on its way. */
function requestNext(s: StationState): StationState {
  return s.pending ? s : { ...s, pending: true, requestSeq: s.requestSeq + 1 };
}

/** Put a segment on air, starting with its talk. Requests the one after it. */
function startSegment(s: StationState, loaded: Loaded, fromNext: boolean): StationState {
  const next = fromNext ? null : s.next;
  const base: StationState = { ...s, phase: "talk", current: loaded, trackIndex: 0, next, resume: null };
  return next ? base : requestNext(base);
}

/** The block is over: on to the buffered segment, or wait for the DJ. */
function advance(s: StationState): StationState {
  if (s.next) return startSegment(s, s.next, true);
  return requestNext({ ...s, phase: "planning", current: null, trackIndex: 0 });
}

function halt(s: StationState, error: string | null): StationState {
  return {
    ...s,
    loop: "stopped",
    phase: "idle",
    resume: s.phase === "talk" || s.phase === "tracks" ? s.phase : null,
    error,
  };
}

function patchLoaded(s: StationState, segmentId: string, patch: Partial<Loaded>): StationState {
  const fix = (l: Loaded | null) => (l && l.segment.id === segmentId ? { ...l, ...patch } : l);
  return { ...s, current: fix(s.current), next: fix(s.next) };
}

export function reducer(s: StationState, e: StationEvent): StationState {
  switch (e.type) {
    case "RUN": {
      if (s.loop === "running") return s;
      const running: StationState = { ...s, loop: "running", retried: false, error: null };
      if (s.next && (s.resume === null || s.current === null)) return startSegment(running, s.next, true);
      if (s.current && s.resume) {
        const resumed: StationState = {
          ...running,
          phase: s.resume,
          resume: null,
          playSeq: s.resume === "tracks" ? s.playSeq + 1 : s.playSeq,
        };
        return s.next ? resumed : requestNext(resumed);
      }
      if (s.next) return startSegment(running, s.next, true);
      return requestNext({ ...running, phase: "planning", current: null, trackIndex: 0 });
    }

    case "STOP":
      return s.loop === "stopped" ? s : halt(s, s.error);

    case "HALT":
      return { ...halt(s, e.error), resume: null };

    case "SEGMENT_READY": {
      const loaded = load(e.segment);
      const settled: StationState = { ...s, pending: false, retried: false, error: null };
      if (s.loop === "running" && (s.phase === "idle" || s.phase === "planning")) {
        return startSegment(settled, loaded, false);
      }
      return { ...settled, next: loaded };
    }

    case "SEGMENT_FAILED": {
      const failed: StationState = { ...s, pending: false, error: e.error };
      if (s.loop === "stopped") return failed;
      if (!s.retried) return requestNext({ ...failed, retried: true });
      return halt({ ...failed, retried: false }, e.error);
    }

    case "TALK_READY":
      return patchLoaded(s, e.segmentId, { talkUrl: e.url });

    case "TALK_AUDIO_FAILED": {
      const marked = { ...patchLoaded(s, e.segmentId, { talkFailed: true }), error: e.error };
      if (s.phase === "talk" && s.current?.segment.id === e.segmentId) {
        return { ...marked, phase: "tracks", trackIndex: 0, playSeq: s.playSeq + 1 };
      }
      return marked;
    }

    case "TALK_ENDED":
    case "SKIP_TALK":
      if (s.phase !== "talk") return s;
      return { ...s, phase: "tracks", trackIndex: 0, playSeq: s.playSeq + 1 };

    case "TRACK_LIST_ENDED":
      if (s.phase !== "tracks") return s;
      return advance(s);

    case "TRACK_CHANGED": {
      if (s.phase !== "tracks" || !s.current) return s;
      const i = s.current.segment.tracks.findIndex((t) => t.uri === e.uri);
      return i < 0 || i === s.trackIndex ? s : { ...s, trackIndex: i };
    }

    case "NEXT": {
      if (s.loop !== "running") return s;
      if (s.phase === "talk") return { ...s, phase: "tracks", trackIndex: 0, playSeq: s.playSeq + 1 };
      if (s.phase !== "tracks" || !s.current) return s;
      if (s.trackIndex < s.current.segment.tracks.length - 1) {
        return { ...s, trackIndex: s.trackIndex + 1, playSeq: s.playSeq + 1 };
      }
      return advance(s);
    }

    case "PREV":
      if (s.loop !== "running" || s.phase !== "tracks") return s;
      return { ...s, trackIndex: Math.max(0, s.trackIndex - 1), playSeq: s.playSeq + 1 };

    case "CLEAR_ERROR":
      return s.error ? { ...s, error: null } : s;
  }
}
