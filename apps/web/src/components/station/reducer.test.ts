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
  run([
    { type: "RUN" },
    { type: "SEGMENT_READY", segment: seg(1) },
    { type: "SEGMENT_READY", segment: seg(2) },
  ]);

describe("run / segments", () => {
  it("RUN from empty asks for a segment and waits", () => {
    const s = run([{ type: "RUN" }]);
    expect(s).toMatchObject({
      loop: "running",
      phase: "planning",
      pending: true,
      requestSeq: 1,
      cursor: null,
    });
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
    let s = run([
      { type: "RUN" },
      { type: "SEGMENT_FAILED", error: "a" },
      { type: "SEGMENT_FAILED", error: "b" },
    ]);
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({
      loop: "running",
      phase: "planning",
      pending: true,
      requestSeq: 3,
      error: null,
    });
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
    expect(s).toMatchObject({ pending: true, requestSeq: 3 });
    s = reducer(s, { type: "NEXT" }); // onto a track of the tail — no second request
    expect(s.requestSeq).toBe(3);
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
    expect(s).toMatchObject({ pending: false, requestSeq: 3 });
    s = reducer(s, { type: "JUMP", seg: 0, item: 0 });
    expect(s).toMatchObject({ cursor: { seg: 0, item: 0 }, pending: false, requestSeq: 3 });
    for (let i = 0; i < 8; i++) s = reducer(s, { type: "NEXT" }); // through s1 and s2 → s3 talk
    expect(s.cursor).toEqual({ seg: 2, item: 0 });
    expect(s).toMatchObject({ pending: true, requestSeq: 4 });
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
    let s = run([
      { type: "RUN" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "SEGMENT_FAILED", error: "x" },
    ]);
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
    expect(s).toMatchObject({
      loop: "running",
      phase: "playing",
      cursor: { seg: 1, item: 0 },
      pending: false,
    });
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
