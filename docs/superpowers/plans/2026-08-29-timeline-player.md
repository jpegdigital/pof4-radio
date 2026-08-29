# Timeline Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The show becomes an ordered list of metatracks (talk + tracks); one cursor walks it, one transport moves the cursor, any segment can be tapped to rewind — including on a cold-start resume, because talk audio is fetched by position, not by arrival.

**Architecture:** The reducer (`reducer.ts`, pure, tested) holds `segments[]` + `cursor {seg, item}` and decides *what* plays; the effects hook (`use-station.ts`) owns a per-session talk-audio cache keyed by `voiceId:segmentId` and makes sure the cursor segment and the one after it are voiced; the page renders one `Player` that never unmounts plus the show as a cue sheet. No server changes.

**Tech Stack:** Next 15 app router, React 19, TypeScript, Tailwind 4, vitest, Biome. Spotify Web Playback SDK via `use-spotify-device.ts`; ElevenLabs via `GET /api/tts`.

**Spec:** `docs/superpowers/specs/2026-08-29-timeline-player-design.md`

## Global Constraints

- Scope is `apps/web/src/components/station/*` plus one rule in `apps/web/src/app/globals.css` and a paragraph in `CLAUDE.md`. No server, schema, or `packages/*` changes.
- Segment list capped at 20 (`MAX_SEGMENTS = 20`), oldest trimmed.
- Talk audio: never revoke a blob while its segment is in the list. Cache key `${voiceId}:${segmentId}`.
- Planning is requested only when the cursor lands on the **talk** of the **tail** segment (or on `RUN` at the tail).
- Line endings LF; `pnpm check` (lint + format + typecheck + test) must pass before every commit; `pnpm --filter web build` before the final push.
- Copy: sentence case, plain verbs; the vocabulary of the page is "block" for a segment, "on the mic" for talk.
- Tests run from the repo root: `pnpm vitest run apps/web/src/components/station/reducer.test.ts`.

## File Structure

| File | Responsibility |
|---|---|
| `components/station/reducer.ts` | State machine: `segments`, `cursor`, phases, events. Exports `Cursor`, `cursorSegment`, `atTail`, `itemCount`, `MAX_SEGMENTS`. |
| `components/station/reducer.test.ts` | Rewritten for the cursor model. |
| `components/station/use-station.ts` | Effects: plan, voice (cache), talk on air, tracks on air, stop, `toggle()`, `prev()`, talk playback clock. |
| `components/station/player.tsx` (new, replaces `now-playing.tsx`) | One transport for talk and track items, plus planning/empty faces. |
| `components/station/show.tsx` (new) | The cue sheet: every segment as a metatrack, tappable, with the lit rail. |
| `components/station/station.tsx` | Page wiring; loses `history`, "Now playing", "Next up", "Earlier tonight", "Skip talk". |
| `app/globals.css` | Rail styles; iOS no-zoom rule. |
| `CLAUDE.md` | "The loop lives in the browser" paragraph updated. |

---

### Task 1: Reducer — the cursor model

**Files:**
- Modify: `apps/web/src/components/station/reducer.ts` (full rewrite)
- Test: `apps/web/src/components/station/reducer.test.ts` (full rewrite)

**Interfaces:**
- Produces (used by Tasks 2–4):
  ```ts
  export interface Cursor { seg: number; item: number }
  export type Phase = "idle" | "planning" | "playing";
  export interface StationState { loop; phase; segments: SegmentView[]; cursor: Cursor | null; pending; requestSeq; retried; playSeq; error }
  export type StationEvent = RUN | STOP | HALT | LOAD_SHOW | CLEAR_SHOW | SEGMENT_READY | SEGMENT_FAILED | TALK_FAILED | ENDED | TRACK_CHANGED | NEXT | PREV | JUMP | CLEAR_ERROR
  export const MAX_SEGMENTS = 20;
  export function itemCount(seg: SegmentView): number;          // 1 + tracks.length
  export function cursorSegment(s: StationState): SegmentView | null;
  export function atTail(s: StationState): boolean;
  ```

- [ ] **Step 1: Replace the test file with the cursor-model tests**

```ts
import { describe, expect, it } from "vitest";
import {
  atTail,
  cursorSegment,
  initialState,
  MAX_SEGMENTS,
  reducer,
  type SegmentView,
  type StationEvent,
  type StationState,
} from "./reducer.ts";

const seg = (n: number): SegmentView => ({
  id: `s${n}`,
  seq: n,
  prompt: "soul",
  talk: `talk ${n}`,
  tracks: [1, 2, 3].map((i) => ({
    id: `t${n}${i}`,
    uri: `spotify:track:t${n}${i}`,
    name: `song ${i}`,
    artists: ["a"],
    album: "b",
    durationMs: 1000,
  })),
});

const run = (events: StationEvent[], from: StationState = initialState) => events.reduce(reducer, from);

/** A running show with blocks 1 and 2 loaded, cursor on block 1's talk. */
const twoBlocks = () =>
  run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }, { type: "SEGMENT_READY", segment: seg(2) }]);

describe("run / segments", () => {
  it("RUN from empty asks for a segment and waits", () => {
    const s = run([{ type: "RUN" }]);
    expect(s).toMatchObject({ loop: "running", phase: "planning", pending: true, requestSeq: 1, cursor: null });
  });

  it("SEGMENT_READY while planning goes on air at its talk and requests the next one", () => {
    const s = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }]);
    expect(s).toMatchObject({ phase: "playing", cursor: { seg: 0, item: 0 }, pending: true, requestSeq: 2 });
    expect(cursorSegment(s)?.id).toBe("s1");
    expect(atTail(s)).toBe(true);
  });

  it("SEGMENT_READY while playing is appended, cursor unmoved", () => {
    const s = twoBlocks();
    expect(s.segments.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(s).toMatchObject({ cursor: { seg: 0, item: 0 }, pending: false });
    expect(atTail(s)).toBe(false);
  });

  it("the list is capped: the oldest block is trimmed and the cursor shifts with it", () => {
    let s = run([{ type: "RUN" }]);
    for (let i = 1; i <= MAX_SEGMENTS + 1; i++) s = reducer(s, { type: "SEGMENT_READY", segment: seg(i) });
    expect(s.segments).toHaveLength(MAX_SEGMENTS);
    expect(s.segments[0]?.id).toBe("s2");
    expect(s.cursor).toEqual({ seg: 0, item: 0 }); // was on s1 (now gone) → clamped to the new head
  });

  it("a failure retries once, then stops with the error", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_FAILED", error: "boom" }]);
    expect(s).toMatchObject({ loop: "running", pending: true, retried: true, requestSeq: 2 });
    s = reducer(s, { type: "SEGMENT_FAILED", error: "boom again" });
    expect(s).toMatchObject({ loop: "stopped", phase: "planning", pending: false, error: "boom again" });
  });

  it("a successful retry clears the error", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_FAILED", error: "boom" }]);
    expect(s.error).toBe("boom");
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(1) });
    expect(s.error).toBeNull();
    expect(s.retried).toBe(false);
  });

  it("RUN while planning after a halt asks again", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_FAILED", error: "a" }, { type: "SEGMENT_FAILED", error: "b" }]);
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({ loop: "running", phase: "planning", pending: true, requestSeq: 3, error: null });
  });
});

describe("walking the show", () => {
  it("NEXT walks talk → tracks → next block's talk", () => {
    let s = twoBlocks();
    const seq0 = s.playSeq;
    s = reducer(s, { type: "NEXT" });
    expect(s.cursor).toEqual({ seg: 0, item: 1 });
    expect(s.playSeq).toBe(seq0 + 1);
    s = run([{ type: "NEXT" }, { type: "NEXT" }], s);
    expect(s.cursor).toEqual({ seg: 0, item: 3 });
    s = reducer(s, { type: "NEXT" });
    expect(s.cursor).toEqual({ seg: 1, item: 0 });
  });

  it("ENDED is NEXT", () => {
    const s = reducer(twoBlocks(), { type: "ENDED" });
    expect(s.cursor).toEqual({ seg: 0, item: 1 });
  });

  it("landing on the tail's talk asks for one more block, once", () => {
    let s = twoBlocks();
    s = run([{ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }], s);
    expect(s.cursor).toEqual({ seg: 1, item: 0 });
    expect(s).toMatchObject({ pending: true, requestSeq: 2 });
    s = reducer(s, { type: "NEXT" }); // onto a track of the tail — no second request
    expect(s.requestSeq).toBe(2);
  });

  it("NEXT past the last item of the tail waits on the DJ", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }]);
    s = run([{ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }], s);
    expect(s).toMatchObject({ phase: "planning", pending: true, requestSeq: 2 });
    expect(s.cursor).toEqual({ seg: 0, item: 3 }); // the cursor stays put until the block lands
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(2) });
    expect(s).toMatchObject({ phase: "playing", cursor: { seg: 1, item: 0 }, requestSeq: 3 });
  });

  it("PREV walks back across a block boundary and stops at the first talk", () => {
    let s = twoBlocks();
    s = run([{ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }], s);
    expect(s.cursor).toEqual({ seg: 1, item: 0 });
    s = reducer(s, { type: "PREV" });
    expect(s.cursor).toEqual({ seg: 0, item: 3 });
    s = run([{ type: "PREV" }, { type: "PREV" }, { type: "PREV" }], s);
    expect(s.cursor).toEqual({ seg: 0, item: 0 });
    const before = s;
    s = reducer(s, { type: "PREV" });
    expect(s).toBe(before);
  });

  it("rewinding never plans; playing through to the tail plans exactly once", () => {
    let s = twoBlocks();
    s = run([{ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }], s); // s2 talk → request #2
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(3) });
    expect(s).toMatchObject({ pending: false, requestSeq: 2 });
    s = reducer(s, { type: "JUMP", seg: 0, item: 0 });
    expect(s).toMatchObject({ cursor: { seg: 0, item: 0 }, pending: false, requestSeq: 2 });
    for (let i = 0; i < 8; i++) s = reducer(s, { type: "NEXT" }); // through s1 and s2 → s3 talk
    expect(s.cursor).toEqual({ seg: 2, item: 0 });
    expect(s).toMatchObject({ pending: true, requestSeq: 3 });
  });

  it("TRACK_CHANGED follows Spotify without restarting playback", () => {
    let s = reducer(twoBlocks(), { type: "NEXT" });
    const seq = s.playSeq;
    s = reducer(s, { type: "TRACK_CHANGED", uri: "spotify:track:t12" });
    expect(s.cursor).toEqual({ seg: 0, item: 2 });
    expect(s.playSeq).toBe(seq);
    const before = s;
    expect(reducer(s, { type: "TRACK_CHANGED", uri: "spotify:track:nope" })).toBe(before);
  });

  it("TRACK_CHANGED during a talk is ignored", () => {
    const s = twoBlocks();
    expect(reducer(s, { type: "TRACK_CHANGED", uri: "spotify:track:t12" })).toBe(s);
  });

  it("TALK_FAILED under the cursor moves on to the first track", () => {
    let s = twoBlocks();
    s = reducer(s, { type: "TALK_FAILED", segmentId: "s1" });
    expect(s.cursor).toEqual({ seg: 0, item: 1 });
    const before = s;
    expect(reducer(s, { type: "TALK_FAILED", segmentId: "s2" })).toBe(before);
  });
});

describe("stop / run / jump", () => {
  it("STOP keeps the cursor; RUN resumes there and restarts the item", () => {
    let s = run([{ type: "NEXT" }, { type: "STOP" }], twoBlocks());
    expect(s).toMatchObject({ loop: "stopped", phase: "playing", cursor: { seg: 0, item: 1 } });
    const seq = s.playSeq;
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({ loop: "running", phase: "playing", cursor: { seg: 0, item: 1 } });
    expect(s.playSeq).toBe(seq + 1);
    expect(s.pending).toBe(false); // s2 is buffered — nothing to ask for
  });

  it("RUN at the tail with nothing buffered asks for the next block", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }, { type: "SEGMENT_FAILED", error: "x" }]);
    s = run([{ type: "SEGMENT_FAILED", error: "y" }], s); // halted, cursor on s1 talk
    expect(s.loop).toBe("stopped");
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({ loop: "running", pending: true, cursor: { seg: 0, item: 0 } });
  });

  it("a segment landing while stopped is appended, not started", () => {
    let s = run([{ type: "STOP" }], twoBlocks());
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(3) });
    expect(s.segments).toHaveLength(3);
    expect(s.cursor).toEqual({ seg: 0, item: 0 });
  });

  it("HALT stops with the error and clears it on the next RUN", () => {
    let s = reducer(twoBlocks(), { type: "HALT", error: "device gone" });
    expect(s).toMatchObject({ loop: "stopped", error: "device gone" });
    s = reducer(s, { type: "RUN" });
    expect(s.error).toBeNull();
  });

  it("LOAD_SHOW then JUMP starts the show at that block's talk", () => {
    let s = reducer(initialState, { type: "LOAD_SHOW", segments: [seg(1), seg(2), seg(3)] });
    expect(s).toMatchObject({ loop: "stopped", phase: "idle", cursor: null });
    expect(s.segments).toHaveLength(3);
    s = reducer(s, { type: "JUMP", seg: 1, item: 0 });
    expect(s).toMatchObject({ loop: "running", phase: "playing", cursor: { seg: 1, item: 0 }, pending: false });
  });

  it("JUMP to the tail's talk on a loaded show plans the next block", () => {
    let s = reducer(initialState, { type: "LOAD_SHOW", segments: [seg(1), seg(2)] });
    s = reducer(s, { type: "JUMP", seg: 1, item: 0 });
    expect(s).toMatchObject({ pending: true, requestSeq: 1 });
  });

  it("JUMP out of bounds is ignored", () => {
    const s = twoBlocks();
    expect(reducer(s, { type: "JUMP", seg: 5, item: 0 })).toBe(s);
    expect(reducer(s, { type: "JUMP", seg: 0, item: 9 })).toBe(s);
  });

  it("RUN on a loaded show with no cursor starts planning at the tail", () => {
    let s = reducer(initialState, { type: "LOAD_SHOW", segments: [seg(1)] });
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({ phase: "planning", pending: true, cursor: null });
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(2) });
    expect(s.cursor).toEqual({ seg: 1, item: 0 });
  });

  it("LOAD_SHOW and CLEAR_SHOW are ignored while running", () => {
    const s = twoBlocks();
    expect(reducer(s, { type: "LOAD_SHOW", segments: [seg(9)] })).toBe(s);
    expect(reducer(s, { type: "CLEAR_SHOW" })).toBe(s);
    const cleared = reducer(reducer(s, { type: "STOP" }), { type: "CLEAR_SHOW" });
    expect(cleared).toMatchObject({ segments: [], cursor: null, phase: "idle" });
  });

  it("CLEAR_ERROR", () => {
    const s = reducer(reducer(twoBlocks(), { type: "HALT", error: "x" }), { type: "CLEAR_ERROR" });
    expect(s.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/components/station/reducer.test.ts`
Expected: FAIL — type errors / `atTail is not a function`, `MAX_SEGMENTS` undefined.

- [ ] **Step 3: Rewrite `reducer.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/web/src/components/station/reducer.test.ts`
Expected: all PASS. (`station.tsx` / `use-station.ts` will not typecheck yet — that's Tasks 2–3; do not run `pnpm check` here.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/station/reducer.ts apps/web/src/components/station/reducer.test.ts
git commit -m "Reducer: the show is a list of metatracks walked by one cursor"
```

---

### Task 2: Effects hook — talk cache by position, one transport

**Files:**
- Modify: `apps/web/src/components/station/use-station.ts` (full rewrite)

**Interfaces:**
- Consumes: Task 1's reducer and helpers; `SpotifyDevice` (`play(uris, position)`, `pause()`, `resume()`, `setVolume(v)`, `playback`), `USER_VOLUME` from `use-spotify-device.ts`; `ttsUrl(text, voice)` and `Dj` from `voice-store.ts`.
- Produces (used by Tasks 3–4):
  ```ts
  export type TalkEntry = { url: string } | { error: string };
  export interface TalkPlayback { paused: boolean; position: number; duration: number; at: number } // ms
  export interface UseStationOptions { device; stationId; dj: Dj; getPrompt: () => string; onStation: (id) => void }
  export function useStation(opts): {
    state: StationState; dispatch;
    /** Talk audio under the current DJ for a segment id, if fetched. */
    talk: (segmentId: string) => TalkEntry | undefined;
    talkPlayback: TalkPlayback | null;   // non-null while the cursor is on a talk
    toggle(): void; prev(): void; next(): void; unlock(): void;
  }
  ```

- [ ] **Step 1: Rewrite `use-station.ts`**

```ts
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { guarded } from "@/lib/guard-client";
import {
  atTail,
  cursorSegment,
  initialState,
  reducer,
  type SegmentView,
  type StationState,
} from "./reducer";
import type { SpotifyDevice } from "./use-spotify-device";
import { USER_VOLUME } from "./use-spotify-device";
import { type Dj, ttsUrl } from "./voice-store";

/**
 * The effects behind the state machine. Each effect reads the state and does exactly one thing;
 * the reducer decides everything else.
 *
 * Talk audio is its own pipeline, separate from segment text: the hook keeps a per-session cache
 * (`voiceId:segmentId` → blob url) and makes sure the segment under the cursor and the one after
 * it are voiced. Fetched by *position*, never by arrival — so a resumed show's past blocks are
 * voiced the moment they're tapped, and a rewind in a live show is instant. Nothing is revoked
 * while its segment is in the list.
 */

const DUCK_VOLUME = 0.15;
/** A few ms of silence (WAV); playing it inside a tap unlocks the element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const REQUEST_TIMEOUT_MS = 120_000;
/** Prev on a track this far in restarts it instead (the Spotify convention). */
const RESTART_AFTER_MS = 3000;

export type TalkEntry = { url: string } | { error: string };

export interface TalkPlayback {
  paused: boolean;
  /** ms as of `at` (performance.now()). */
  position: number;
  duration: number;
  at: number;
}

export interface UseStationOptions {
  device: SpotifyDevice;
  stationId: string | null;
  /** The DJ on the mic: the voice for talk audio and the name sent with each planning request. */
  dj: Dj;
  /** Read at request time, so a changed prompt applies to the next block. */
  getPrompt: () => string;
  onStation: (id: string) => void;
}

const talkKey = (voiceId: string, segmentId: string) => `${voiceId}:${segmentId}`;

export function useStation(opts: UseStationOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const o = useRef(opts);
  const stateRef = useRef<StationState>(state);
  useEffect(() => {
    o.current = opts;
    stateRef.current = state;
  });
  const inFlight = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [talks, setTalks] = useState<ReadonlyMap<string, TalkEntry>>(new Map());
  const fetchingTalk = useRef(new Set<string>());
  const [talkPlayback, setTalkPlayback] = useState<TalkPlayback | null>(null);

  const voiceId = opts.dj.id;
  const running = state.loop === "running";
  const cur = cursorSegment(state);
  const nextSeg = state.cursor ? (state.segments[state.cursor.seg + 1] ?? null) : null;
  const onTalk = running && state.phase === "playing" && state.cursor?.item === 0 ? cur : null;

  // 1. Ask the DJ for the next segment whenever the state wants one.
  useEffect(() => {
    if (!state.pending || inFlight.current) return;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await guarded("/api/station/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationId: o.current.stationId,
            prompt: o.current.getPrompt(),
            dj: o.current.dj.name,
          }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { error?: string; stationId?: string; segment?: SegmentView };
        if (res.status === 409) {
          dispatch({ type: "HALT", error: "another tab is running this station" });
          return;
        }
        if (data.stationId && data.stationId !== o.current.stationId) o.current.onStation(data.stationId);
        if (!res.ok || !data.segment) {
          dispatch({ type: "SEGMENT_FAILED", error: data.error ?? `request failed (${res.status})` });
          return;
        }
        dispatch({ type: "SEGMENT_READY", segment: data.segment });
      } catch (err) {
        const message = ctrl.signal.aborted
          ? "the DJ took too long"
          : err instanceof Error
            ? err.message
            : String(err);
        dispatch({ type: "SEGMENT_FAILED", error: message });
      } finally {
        clearTimeout(timer);
        inFlight.current = null;
      }
    })();
  }, [state.pending, state.requestSeq]);

  // 2. Voice: the segment under the cursor and the one after it, in the current DJ's voice.
  const curId = cur?.id;
  const nextId = nextSeg?.id;
  useEffect(() => {
    if (!running) return;
    for (const seg of [cur, nextSeg]) {
      if (!seg) continue;
      const key = talkKey(voiceId, seg.id);
      if (talks.has(key) || fetchingTalk.current.has(key)) continue;
      fetchingTalk.current.add(key);
      const voice = o.current.dj.voice;
      void (async () => {
        let entry: TalkEntry;
        try {
          const res = await guarded(ttsUrl(seg.talk, voice));
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `tts ${res.status}`);
          }
          entry = { url: URL.createObjectURL(await res.blob()) };
        } catch (err) {
          entry = { error: err instanceof Error ? err.message : String(err) };
        } finally {
          fetchingTalk.current.delete(key);
        }
        setTalks((m) => new Map(m).set(key, entry));
      })();
    }
    // `talks` is read, not depended on: a landed blob must not re-run the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, curId, nextId, voiceId]);

  // Blobs of segments no longer in the list are dropped (the 20-cap, Start fresh).
  useEffect(() => {
    const ids = new Set(state.segments.map((s) => s.id));
    setTalks((m) => {
      let changed = false;
      const kept = new Map<string, TalkEntry>();
      for (const [key, entry] of m) {
        const id = key.slice(key.indexOf(":") + 1);
        if (ids.has(id)) kept.set(key, entry);
        else {
          changed = true;
          if ("url" in entry) URL.revokeObjectURL(entry.url);
        }
      }
      return changed ? kept : m;
    });
  }, [state.segments]);

  // 3. Talk on air: duck Spotify, play the clip, hand over when it ends.
  const onTalkId = onTalk?.id;
  const onTalkEntry = onTalkId ? talks.get(talkKey(voiceId, onTalkId)) : undefined;
  const onTalkUrl = onTalkEntry && "url" in onTalkEntry ? onTalkEntry.url : undefined;
  const onTalkError = onTalkEntry && "error" in onTalkEntry ? onTalkEntry.error : undefined;
  useEffect(() => {
    if (!onTalkId) {
      setTalkPlayback(null);
      return;
    }
    if (onTalkError) {
      dispatch({ type: "TALK_FAILED", segmentId: onTalkId });
      return;
    }
    if (!onTalkUrl) {
      setTalkPlayback({ paused: false, position: 0, duration: 0, at: performance.now() });
      return; // still fetching — the player shows "loading voice…"
    }
    const el = (audio.current ??= new Audio());
    const device = o.current.device;
    void device.pause().catch(() => {});
    void device.setVolume(DUCK_VOLUME).catch(() => {});
    const report = () =>
      setTalkPlayback({
        paused: el.paused,
        position: el.currentTime * 1000,
        duration: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
        at: performance.now(),
      });
    el.src = onTalkUrl;
    el.onended = () => dispatch({ type: "ENDED" });
    el.onerror = () => dispatch({ type: "TALK_FAILED", segmentId: onTalkId });
    el.onplay = report;
    el.onpause = report;
    el.ondurationchange = report;
    el.play().catch(() => dispatch({ type: "TALK_FAILED", segmentId: onTalkId }));
    const tick = setInterval(() => {
      if (!el.paused) report();
    }, 500);
    return () => {
      clearInterval(tick);
      el.onended = null;
      el.onerror = null;
      el.onplay = null;
      el.onpause = null;
      el.ondurationchange = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
      void device.setVolume(USER_VOLUME).catch(() => {});
    };
  }, [onTalkId, onTalkUrl, onTalkError, state.playSeq]);

  // 4. Tracks on air: (re)start the block at the cursor's track whenever playSeq bumps.
  const onTrack = running && state.phase === "playing" && (state.cursor?.item ?? 0) > 0;
  const playSeq = onTrack ? state.playSeq : -1;
  useEffect(() => {
    if (playSeq < 0) return;
    const s = stateRef.current;
    const seg = cursorSegment(s);
    if (!seg || !s.cursor) return;
    o.current.device
      .play(
        seg.tracks.map((t) => t.uri),
        s.cursor.item - 1,
      )
      .catch((err: unknown) =>
        dispatch({ type: "HALT", error: err instanceof Error ? err.message : String(err) }),
      );
  }, [playSeq]);

  // 5. Stop: silence everything (in-flight requests are allowed to land in the list).
  useEffect(() => {
    if (running) return;
    audio.current?.pause();
    void o.current.device.pause().catch(() => {});
  }, [running]);

  // The transport. Talk and track are the same three buttons; only what they touch differs.
  const toggle = useCallback(() => {
    const s = stateRef.current;
    if (s.loop !== "running" || !s.cursor) return;
    if (s.cursor.item === 0) {
      const el = audio.current;
      if (!el?.src) return;
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
      return;
    }
    const d = o.current.device;
    void (d.playback?.paused ? d.resume() : d.pause()).catch(() => {});
  }, []);

  const prev = useCallback(() => {
    const s = stateRef.current;
    if (!s.cursor || s.cursor.item === 0) {
      dispatch({ type: "PREV" });
      return;
    }
    const p = o.current.device.playback;
    const pos = p ? (p.paused ? p.position : p.position + (performance.now() - p.at)) : 0;
    if (pos > RESTART_AFTER_MS) dispatch({ type: "JUMP", ...s.cursor });
    else dispatch({ type: "PREV" });
  }, []);

  const next = useCallback(() => dispatch({ type: "NEXT" }), []);

  /**
   * Call synchronously from the tap that starts the show. iOS Safari only lets an
   * `HTMLMediaElement` play if *that element* first played inside a user gesture; the talk plays
   * from an effect later, so the element is created and unlocked here, then reused.
   */
  const unlock = useCallback(() => {
    const el = (audio.current ??= new Audio());
    if (el.src) return; // already unlocked (or mid-talk)
    el.src = SILENCE;
    void el.play().then(
      () => el.pause(),
      () => {},
    );
  }, []);

  const talk = useCallback((segmentId: string) => talks.get(talkKey(voiceId, segmentId)), [talks, voiceId]);

  return { state, dispatch, talk, talkPlayback, toggle, prev, next, unlock, atTail: atTail(state) };
}
```

- [ ] **Step 2: Typecheck this file alone**

Run: `pnpm --filter web exec tsc --noEmit -p . 2>&1 | grep -v station.tsx | grep -v now-playing`
Expected: no errors from `use-station.ts` (errors in `station.tsx` are expected until Task 3).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/station/use-station.ts
git commit -m "Station hook: talk audio cached by position; one toggle/prev/next for talk and tracks"
```

---

### Task 3: Player and Show components; page wiring

Visual direction (kept inside the page's existing vocabulary — Barlow Condensed signage, Plex Mono script, lamp amber, zinc ground; no new colours, no new faces):

- **Talk as a track.** In the art slot, a talk shows a square on a lamp-amber ground with the DJ's initial in Barlow Condensed at the same size album art occupies; it breathes (the existing `.lamp.talking` keyframe) while the voice is playing. Title: `{dj} on the mic`; subtitle: `Block {seq}`; third line: the first sentence of the talk in Plex Mono. Progress line from the audio element; an indeterminate shimmer while "loading voice…".
- **The signature: the cue sheet with a lit rail.** Below the player, the show is one list, every segment a metatrack: a talk row (mic mark, the talk clamped to two lines, mono) then its track rows (mono index, artist — title, duration). A 2px rail runs down the left edge of the whole list; it is amber from the top to the row under the cursor and zinc after — a vertical progress line through the show, the one thing the eye needs to see where tonight is. Rows are buttons; the cursor row is `text-lamp`; a segment after the cursor with no voice yet gets a quiet "up next" eyebrow. Tapping any row jumps there.
- **The player never leaves.** It renders four faces from the same frame: track, talk, planning (the lamp breathes in the art slot, "The DJ is planning…", play disabled), and empty (only on a page with nothing loaded — then the card is not rendered at all).

**Files:**
- Create: `apps/web/src/components/station/player.tsx`
- Create: `apps/web/src/components/station/show.tsx`
- Delete: `apps/web/src/components/station/now-playing.tsx`
- Modify: `apps/web/src/components/station/station.tsx` (full rewrite)
- Modify: `apps/web/src/app/globals.css` (rail + shimmer)

**Interfaces:**
- Consumes: Task 1 (`StationState`, `Cursor`, `SegmentView`, `cursorSegment`, `itemCount`), Task 2 (`useStation` return: `talk`, `talkPlayback`, `toggle`, `prev`, `next`, `unlock`, `dispatch`), `Playback`/`NowPlaying` types from `use-spotify-device.ts`.
- Produces:
  ```ts
  // player.tsx
  export type PlayerFace =
    | { kind: "track"; name: string; artists: string[]; album: string; image: string | null; playback: Clock }
    | { kind: "talk"; dj: string; initial: string; seq: number; excerpt: string; playback: Clock | null } // null = loading voice
    | { kind: "planning"; dj: string };
  export interface Clock { paused: boolean; position: number; duration: number; at: number }
  export function Player(p: { face: PlayerFace; running: boolean; canPrev: boolean; canNext: boolean; onPrev; onNext; onToggle }): JSX.Element
  // show.tsx
  export function Show(p: { segments: SegmentView[]; cursor: Cursor | null; voiced: (id: string) => boolean; onJump: (seg: number, item: number) => void }): JSX.Element
  ```

- [ ] **Step 1: Add the rail and shimmer styles to `globals.css`** (append after the `.lamp` block)

```css
/* The cue sheet's rail: amber down to the row on air, dark glass past it. */
.rail-row {
  position: relative;
}
.rail-row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #27272a;
  transition: background 300ms;
}
.rail-row.lit::before {
  background: var(--color-lamp);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-lamp) 45%, transparent);
}

/* A progress line with nothing to measure yet: the voice is still on its way. */
.shimmer {
  background: linear-gradient(90deg, #27272a 0%, #52525b 50%, #27272a 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
    background: #3f3f46;
  }
}
```

- [ ] **Step 2: Create `player.tsx`**

```tsx
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { focusRing } from "./ui";

/**
 * The transport. Talk and track are the same frame — art slot, three lines, a progress line,
 * three buttons — so the show reads as one sequence. Position is interpolated from the last
 * report while playing; both Spotify and the audio element only report on change.
 */

export interface Clock {
  paused: boolean;
  /** ms as of `at` (performance.now()). */
  position: number;
  duration: number;
  at: number;
}

export type PlayerFace =
  | { kind: "track"; name: string; artists: string[]; album: string; image: string | null; playback: Clock }
  /** `playback` null = the voice is still loading. */
  | { kind: "talk"; dj: string; initial: string; seq: number; excerpt: string; playback: Clock | null }
  | { kind: "planning"; dj: string };

export function Player({
  face,
  running,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onToggle,
}: {
  face: PlayerFace;
  running: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  const clock = face.kind === "planning" ? null : face.playback;
  const paused = !running || (clock?.paused ?? true);
  const canToggle = running && face.kind !== "planning" && clock !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Art face={face} playing={!paused} />
        <div className="min-w-0 flex-1">
          {face.kind === "track" && (
            <>
              <div className="truncate text-base font-medium">{face.name}</div>
              <div className="truncate text-sm text-zinc-400">{face.artists.join(", ")}</div>
              <div className="truncate text-xs text-zinc-500">{face.album}</div>
            </>
          )}
          {face.kind === "talk" && (
            <>
              <div className="truncate text-base font-medium">{face.dj} on the mic</div>
              <div className="truncate text-sm text-zinc-400">Block {face.seq}</div>
              <div className="truncate font-mono text-xs text-zinc-500">{face.excerpt}</div>
            </>
          )}
          {face.kind === "planning" && (
            <>
              <div className="truncate text-base font-medium">The DJ is planning…</div>
              <div className="truncate text-sm text-zinc-400">{face.dj} is picking the next block</div>
            </>
          )}
        </div>
      </div>

      {clock ? <Progress clock={clock} live={!paused} /> : <Loading label={face.kind === "talk" ? "loading voice…" : ""} />}

      <div className="flex items-center justify-center gap-6">
        <button type="button" onClick={onPrev} disabled={!running || !canPrev} aria-label="Previous" className={iconBtn}>
          <SkipBack className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={!canToggle}
          aria-label={paused ? "Play" : "Pause"}
          className={`flex size-14 items-center justify-center rounded-full bg-zinc-100 text-black transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 ${focusRing}`}
        >
          {paused ? (
            <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
          ) : (
            <Pause className="size-6" fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button type="button" onClick={onNext} disabled={!running || !canNext} aria-label="Next" className={iconBtn}>
          <SkipForward className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = `rounded-full p-2 text-zinc-300 transition hover:text-white active:scale-95 disabled:opacity-30 disabled:hover:text-zinc-300 ${focusRing}`;

/** The art slot: album art for a track; the DJ's initial on amber for a talk; the lamp while planning. */
function Art({ face, playing }: { face: PlayerFace; playing: boolean }) {
  if (face.kind === "track") {
    return face.image ? (
      // biome-ignore lint/performance/noImgElement: album art is a remote Spotify CDN url
      <img src={face.image} alt="" className="size-20 shrink-0 rounded-lg bg-zinc-800 object-cover" />
    ) : (
      <div className="size-20 shrink-0 rounded-lg bg-zinc-800" />
    );
  }
  if (face.kind === "talk") {
    return (
      <div
        aria-hidden="true"
        className={`lamp on ${playing ? "talking" : ""} flex size-20 shrink-0 items-center justify-center rounded-lg font-display text-5xl font-semibold text-black`}
      >
        {face.initial}
      </div>
    );
  }
  return (
    <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
      <span aria-hidden="true" className="lamp on talking size-3 rounded-full" />
    </div>
  );
}

function Progress({ clock, live }: { clock: Clock; live: boolean }) {
  const position = useLivePosition(clock, live);
  const pct = clock.duration > 0 ? Math.min(100, (position / clock.duration) * 100) : 0;
  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-zinc-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
        <span>{fmt(position)}</span>
        <span>{fmt(clock.duration)}</span>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div>
      <div className="shimmer h-1 rounded-full" />
      <div className="mt-1 flex justify-between font-mono text-[11px] text-zinc-500">
        <span>{label}</span>
        <span>—</span>
      </div>
    </div>
  );
}

function useLivePosition(c: Clock, live: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [live, c.at]);
  return live ? Math.min(c.duration, c.position + (now - c.at)) : c.position;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 3: Create `show.tsx`**

```tsx
import { Mic } from "lucide-react";
import type { Cursor, SegmentView } from "./reducer";
import { focusRing, Label } from "./ui";

/**
 * The cue sheet: the whole show, every block a metatrack — its talk, then its tracks — each row
 * a place you can jump to. The rail down the left is amber to the row on air and dark past it:
 * where tonight is, at a glance.
 */
export function Show({
  segments,
  cursor,
  voiced,
  onJump,
}: {
  segments: SegmentView[];
  cursor: Cursor | null;
  /** Whether a block's talk audio is already fetched (an "up next" block that isn't shows quietly). */
  voiced: (segmentId: string) => boolean;
  onJump: (seg: number, item: number) => void;
}) {
  if (segments.length === 0) return null;
  const lit = (seg: number, item: number) =>
    cursor !== null && (seg < cursor.seg || (seg === cursor.seg && item <= cursor.item));
  const on = (seg: number, item: number) => cursor?.seg === seg && cursor.item === item;

  return (
    <div className="flex flex-col gap-3">
      <Label>The show</Label>
      <ol className="flex flex-col">
        {segments.map((s, seg) => {
          const upNext = cursor !== null && seg === cursor.seg + 1;
          return (
            <li key={s.id} className="flex flex-col">
              <div className="rail-row pl-4 pt-3 pb-1">
                <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-500">
                  <span className="truncate">
                    Block {s.seq} · “{s.prompt}”
                  </span>
                  {upNext && (
                    <span className="shrink-0 font-display uppercase tracking-[0.18em] text-zinc-600">
                      {voiced(s.id) ? "up next" : "up next · voicing"}
                    </span>
                  )}
                </div>
              </div>
              <Row lit={lit(seg, 0)} on={on(seg, 0)} onClick={() => onJump(seg, 0)}>
                <Mic className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="line-clamp-2 min-w-0 flex-1 font-mono text-sm leading-relaxed">{s.talk}</span>
              </Row>
              {s.tracks.map((t, i) => (
                <Row key={t.id} lit={lit(seg, i + 1)} on={on(seg, i + 1)} onClick={() => onJump(seg, i + 1)}>
                  <span className="w-4 shrink-0 font-mono text-xs text-zinc-600">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.artists.join(", ")} — {t.name}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-zinc-600">{clock(t.durationMs)}</span>
                </Row>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Row({
  lit,
  on,
  onClick,
  children,
}: {
  lit: boolean;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rail-row ${lit ? "lit" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        aria-current={on ? "true" : undefined}
        className={`flex w-full items-start gap-2 rounded-lg py-1.5 pr-2 pl-4 text-left transition hover:bg-zinc-800/50 ${
          on ? "text-lamp" : "text-zinc-400"
        } ${focusRing}`}
      >
        {children}
      </button>
    </div>
  );
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Rewrite `station.tsx`**

```tsx
"use client";

import { Radio, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { guarded, keepGuardAlive } from "@/lib/guard-client";
import { DjPicker } from "./dj-picker";
import { Player, type PlayerFace } from "./player";
import { cursorSegment, type SegmentView } from "./reducer";
import { ResumePicker } from "./resume-picker";
import { Show } from "./show";
import { Card, focusRing, Label } from "./ui";
import { useSpotifyDevice } from "./use-spotify-device";
import { useStation } from "./use-station";
import { DEFAULT_DJ, type Dj, loadDj, saveDj } from "./voice-store";

/**
 * The station, on one page: on air (the lamp, the DJ, the device), the request, the player, the
 * show. The browser is the whole state machine — nothing happens when this component isn't running.
 */
export function Station({ enabled, clientId }: { enabled: boolean; clientId: string }) {
  const [prompt, setPrompt] = useState("");
  const [dj, setDj] = useState<Dj>(DEFAULT_DJ);
  const [stationId, setStationId] = useState<string | null>(null);
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const dispatchRef = useRef<
    (e: { type: "ENDED" } | { type: "TRACK_CHANGED"; uri: string } | { type: "HALT"; error: string }) => void
  >(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "ENDED" }),
    onTrackChanged: (uri) => dispatchRef.current({ type: "TRACK_CHANGED", uri }),
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });

  const { state, dispatch, talk, talkPlayback, toggle, prev, next, unlock } = useStation({
    device,
    stationId,
    dj,
    getPrompt: () => promptRef.current,
    onStation: setStationId,
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // The DJ is remembered per browser. The station is not: a page load is a fresh show —
  // Stop/Run inside the page keeps the DJ's memory, a reload starts over.
  useEffect(() => {
    const stored = loadDj();
    queueMicrotask(() => setDj(stored)); // after hydration, not during it
  }, []);

  // Resume a past show: its prompt and blocks load into the show; tap any block, or Run at the tail.
  const resume = async (id: string) => {
    const res = await guarded(`/api/station/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { stationId: string; prompt: string; segments: SegmentView[] };
    setStationId(data.stationId);
    setPrompt(data.prompt);
    dispatch({ type: "LOAD_SHOW", segments: [...data.segments].sort((a, b) => a.seq - b.seq) });
  };

  // The Guard cookie lasts 15 minutes; a show lasts hours. Keep it fresh without reloading.
  useEffect(keepGuardAlive, []);

  const changeDj = (d: Dj) => {
    setDj(d);
    saveDj(d);
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const fresh = !running && state.segments.length === 0;
  const canRun = enabled && ready && prompt.trim() !== "";
  const cur = cursorSegment(state);
  const cursor = state.cursor;
  const talking = running && state.phase === "playing" && cursor?.item === 0;

  const face: PlayerFace | null = (() => {
    if (state.phase === "planning") return { kind: "planning", dj: dj.name };
    if (!cur || !cursor) return null;
    if (cursor.item === 0) {
      return {
        kind: "talk",
        dj: dj.name,
        initial: dj.name.charAt(0).toUpperCase(),
        seq: cur.seq,
        excerpt: firstSentence(cur.talk),
        playback: talkPlayback && talkPlayback.duration > 0 ? talkPlayback : null,
      };
    }
    const t = cur.tracks[cursor.item - 1];
    if (!t) return null;
    const p = device.playback;
    const live = p?.uri === t.uri ? p : null;
    return {
      kind: "track",
      name: t.name,
      artists: t.artists,
      album: t.album,
      image: live?.track?.image ?? null,
      playback: live
        ? { paused: live.paused, position: live.position, duration: live.duration, at: live.at }
        : { paused: true, position: 0, duration: t.durationMs, at: performance.now() },
    };
  })();

  const status = (() => {
    if (!running) return state.segments.length > 0 ? "Stopped" : "Off air";
    if (state.phase === "planning") return "The DJ is planning…";
    if (talking) return `${dj.name} on the mic`;
    if (cur && cursor) return `Track ${cursor.item} of ${cur.tracks.length}`;
    return "On air";
  })();

  const canPrev = cursor !== null && !(cursor.seg === 0 && cursor.item === 0);
  const canNext = cursor !== null && state.phase === "playing";

  return (
    <>
      {/* on air: the lamp, the DJ, the device */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
            />
            <Label className={running ? "text-lamp" : ""}>On air</Label>
          </div>
          <DjPicker value={dj} onChange={changeDj} />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {ready ? (
            <span className="flex items-center gap-2 text-zinc-400">
              <Radio className="size-4 text-[#1DB954]" strokeWidth={1.75} aria-hidden="true" />
              This tab is the player
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                device.activate();
                void device.connect();
              }}
              disabled={!enabled || device.status.kind === "connecting"}
              className={`flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 font-medium text-zinc-100 transition hover:border-zinc-500 disabled:opacity-40 ${focusRing}`}
            >
              <Radio className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {device.status.kind === "connecting" ? "Activating…" : "Activate this tab as the player"}
            </button>
          )}
          {device.status.kind === "error" && <span className="text-red-400">{device.status.message}</span>}
          {!enabled && <span className="text-xs text-zinc-500">Connect a Premium account first.</span>}
        </div>
      </Card>

      {/* the request */}
      <Card className="flex flex-col gap-3">
        <Label>The request</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What do you want to hear tonight? e.g. late-night soul with horns"
          maxLength={500}
          rows={3}
          className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm leading-relaxed placeholder:text-zinc-600 ${focusRing}`}
        />
        {running && prompt.trim() !== (cur?.prompt ?? prompt.trim()) && (
          <p className="-mt-1 text-xs text-zinc-500">The new request reaches the DJ on the next block.</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {fresh && enabled && !stationId && <ResumePicker onPick={(id) => void resume(id)} />}
            {!running && stationId && cursor === null && state.segments.length > 0 && (
              <p className="text-xs text-zinc-500">
                Resuming ({state.segments.length} block{state.segments.length === 1 ? "" : "s"}) — tap a block, or
                go on air.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setStationId(null);
                    dispatch({ type: "CLEAR_SHOW" });
                  }}
                  className="underline underline-offset-2 hover:text-zinc-300"
                >
                  Start fresh
                </button>
              </p>
            )}
          </div>
          {running ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "STOP" })}
              className={`flex items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-semibold text-black ${focusRing}`}
            >
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                unlock();
                device.activate();
                dispatch({ type: "RUN" });
              }}
              disabled={!canRun}
              className={`rounded-full bg-lamp px-5 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
            >
              Go on air
            </button>
          )}
        </div>
      </Card>

      {state.error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          <span>{state.error}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: "CLEAR_ERROR" })}
            aria-label="Dismiss"
            className="text-red-400"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* the player: mounted from the first block on, never unmounts */}
      {face && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Now playing</Label>
            <span className={`text-xs ${running ? "text-zinc-300" : "text-zinc-500"}`}>{status}</span>
          </div>
          <Player
            face={face}
            running={running}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={prev}
            onNext={next}
            onToggle={toggle}
          />
        </Card>
      )}

      {/* the show */}
      <Show
        segments={state.segments}
        cursor={cursor}
        voiced={(id) => {
          const t = talk(id);
          return t !== undefined && "url" in t;
        }}
        onJump={(seg, item) => {
          if (!ready) return;
          unlock();
          device.activate();
          dispatch({ type: "JUMP", seg, item });
        }}
      />
    </>
  );
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?…](\s|$)/);
  return (m ? m[0] : text).trim();
}

```

