import { describe, expect, it } from "vitest";
import { initialState, reducer, type SegmentView, type StationEvent, type StationState } from "./reducer.ts";

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

describe("run / segments", () => {
  it("RUN from empty asks for a segment and waits", () => {
    const s = run([{ type: "RUN" }]);
    expect(s).toMatchObject({ loop: "running", phase: "planning", pending: true, requestSeq: 1 });
  });

  it("SEGMENT_READY while planning goes on air and requests the next one", () => {
    const s = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }]);
    expect(s.phase).toBe("talk");
    expect(s.current?.segment.id).toBe("s1");
    expect(s.pending).toBe(true);
    expect(s.requestSeq).toBe(2);
  });

  it("SEGMENT_READY while on air is buffered as next", () => {
    const s = run([
      { type: "RUN" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "SEGMENT_READY", segment: seg(2) },
    ]);
    expect(s.current?.segment.id).toBe("s1");
    expect(s.next?.segment.id).toBe("s2");
    expect(s.pending).toBe(false);
  });

  it("talk → tracks → end of list → buffered segment, then a new request", () => {
    let s = run([
      { type: "RUN" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "SEGMENT_READY", segment: seg(2) },
    ]);
    s = reducer(s, { type: "TALK_ENDED" });
    expect(s).toMatchObject({ phase: "tracks", trackIndex: 0 });
    s = reducer(s, { type: "TRACK_LIST_ENDED" });
    expect(s).toMatchObject({ phase: "talk", pending: true });
    expect(s.current?.segment.id).toBe("s2");
    expect(s.next).toBeNull();
  });

  it("end of list with nothing buffered waits on the DJ", () => {
    const s = run([
      { type: "RUN" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "TALK_ENDED" },
      { type: "TRACK_LIST_ENDED" },
    ]);
    expect(s).toMatchObject({ phase: "planning", pending: true, current: null });
    expect(s.requestSeq).toBe(2); // the request sent at talk start is still the one in flight
  });

  it("a failure retries once, then stops with the error", () => {
    let s = run([{ type: "RUN" }, { type: "SEGMENT_FAILED", error: "boom" }]);
    expect(s).toMatchObject({ loop: "running", pending: true, retried: true, requestSeq: 2 });
    s = reducer(s, { type: "SEGMENT_FAILED", error: "boom again" });
    expect(s).toMatchObject({ loop: "stopped", phase: "idle", pending: false, error: "boom again" });
  });
});

describe("stop / resume", () => {
  const onAir = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }, { type: "TALK_ENDED" }]);

  it("STOP keeps current, next and the pending request", () => {
    const s = reducer(
      { ...onAir, next: { segment: seg(2), talkUrl: null, talkFailed: false } },
      { type: "STOP" },
    );
    expect(s).toMatchObject({ loop: "stopped", phase: "idle", resume: "tracks" });
    expect(s.current?.segment.id).toBe("s1");
    expect(s.next?.segment.id).toBe("s2");
    expect(s.pending).toBe(onAir.pending);
  });

  it("RUN after STOP mid-song resumes the song when nothing is buffered", () => {
    const s = run([{ type: "STOP" }, { type: "RUN" }], onAir);
    expect(s).toMatchObject({ loop: "running", phase: "tracks", trackIndex: 0 });
    expect(s.current?.segment.id).toBe("s1");
  });

  it("a segment arriving while stopped is buffered and RUN uses it without planning", () => {
    let s = run([{ type: "STOP" }], onAir);
    s = reducer(s, { type: "SEGMENT_READY", segment: seg(2) });
    expect(s.loop).toBe("stopped");
    expect(s.next?.segment.id).toBe("s2");
    s = reducer(s, { type: "RUN" });
    expect(s).toMatchObject({ loop: "running", phase: "tracks" }); // resumes s1 first; s2 stays buffered
    expect(s.next?.segment.id).toBe("s2");
  });

  it("RUN with a buffered segment and nothing to resume starts it immediately", () => {
    const s = run([
      { type: "RUN" },
      { type: "STOP" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "RUN" },
    ]);
    expect(s).toMatchObject({ loop: "running", phase: "talk" });
    expect(s.current?.segment.id).toBe("s1");
    expect(s.pending).toBe(true);
  });

  it("HALT stops and drops the resume point", () => {
    const s = reducer(onAir, { type: "HALT", error: "device went offline" });
    expect(s).toMatchObject({ loop: "stopped", phase: "idle", resume: null, error: "device went offline" });
  });
});

describe("transport", () => {
  const inTracks = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }, { type: "TALK_ENDED" }]);

  it("skip talk goes to the first song", () => {
    const s = run([{ type: "RUN" }, { type: "SEGMENT_READY", segment: seg(1) }, { type: "SKIP_TALK" }]);
    expect(s).toMatchObject({ phase: "tracks", trackIndex: 0 });
  });

  it("NEXT / PREV move within the block; PREV at 0 restarts", () => {
    let s = reducer(inTracks, { type: "NEXT" });
    expect(s.trackIndex).toBe(1);
    const seq = s.playSeq;
    s = reducer(s, { type: "PREV" });
    expect(s.trackIndex).toBe(0);
    s = reducer(s, { type: "PREV" });
    expect(s.trackIndex).toBe(0);
    expect(s.playSeq).toBe(seq + 2);
  });

  it("NEXT past the last song advances to the next segment or planning", () => {
    const s = run([{ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }], inTracks);
    expect(s).toMatchObject({ phase: "planning", pending: true });
  });

  it("transport is ignored while stopped", () => {
    const s = reducer({ ...inTracks, loop: "stopped", phase: "idle" }, { type: "NEXT" });
    expect(s.trackIndex).toBe(0);
  });

  it("talk audio failure during talk skips straight to the songs", () => {
    const s = run([
      { type: "RUN" },
      { type: "SEGMENT_READY", segment: seg(1) },
      { type: "TALK_AUDIO_FAILED", segmentId: "s1", error: "no voice" },
    ]);
    expect(s).toMatchObject({ phase: "tracks", trackIndex: 0, error: "no voice" });
    expect(s.current?.talkFailed).toBe(true);
  });
});
