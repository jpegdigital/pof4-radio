import type { SegmentView } from "@radio/dj";
import { describe, expect, it } from "vitest";
import {
  ahead,
  awaiting,
  type Element,
  inGap,
  initialState,
  nextRecord,
  type ProgramState,
  reducer,
  segmentAt,
} from "./reducer";

const track = (id: string, durationMs = 200_000) => ({
  uri: `spotify:track:${id}`,
  name: id,
  artists: [id],
  album: id,
  image: null,
  durationMs,
});
const elements: Element[] = [
  { kind: "break", clip: "break-small", bed: "bed", leadMs: 0, label: "Break" },
  { kind: "song", track: track("a") },
  { kind: "song", track: track("b"), talk: { clip: "talkup-2", over: "intro" } },
  { kind: "song", track: track("c"), talk: { clip: "outro-c", over: "outro" } },
  { kind: "break", clip: "break-big", bed: "bed", bedInMs: 5000, leadMs: 6000, label: "Top" },
  { kind: "song", track: track("d"), talk: { clip: "talkup-d", over: "intro" } },
  { kind: "break", clip: "tail", leadMs: 0, label: "Dry" },
];
const loaded: ProgramState = { ...initialState, elements };
const run = (s = loaded) => reducer(s, { type: "RUN" });
const at = (index: number) => reducer(loaded, { type: "JUMP", index });

const rec = (id: string) => ({ id, ...track(id), pick: 0 });
/** The elements `landed` slots make: the break, then a song per slot. */
const segElements = (seq: number, ids: string[]): Element[] =>
  ids.length
    ? [
        { kind: "break", clip: `/api/clip/seg-${seq}/0`, bed: "/bed.mp3", leadMs: 0, label: "Break" },
        ...ids.map((id): Element => ({ kind: "song", track: track(id) })),
      ]
    : [];
/** A segment view with its first `landed` slots produced (all of them when omitted). */
const view = (seq: number, ids: string[], landed = ids.length): SegmentView => ({
  id: `seg-${seq}`,
  seq,
  prompt: "p",
  complete: landed >= ids.length,
  records: ids.map(rec),
  lines: landed ? [{ seq: 0, treatment: "break", words: "hi" }] : [],
  log: {
    slots: ids.slice(0, landed).map((id, i) => ({ seq: i, id, intro: i ? "segue" : "break", why: "" })),
    fallbacks: [],
    topOfHour: seq === 1,
  },
  cards: {},
  dropped: [],
  elements: segElements(seq, ids.slice(0, landed)),
  notes: [],
});

describe("run", () => {
  it("starts element 0 with the lanes set: Spotify off, bed under, clip on the mic", () => {
    const s = run();
    expect(s.loop).toBe("running");
    expect(s.cursor).toBe(0);
    expect(s.music).toEqual({ uri: null, level: "off" });
    expect(s.bed).toBe("bed");
    expect(s.mic).toBe("break-small");
    expect(s.playSeq).toBe(1);
    expect(s.startedAt).not.toBeNull();
  });
  it("restarts the element at the cursor after a stop", () => {
    const s = run(reducer(at(1), { type: "STOP" }));
    expect(s.cursor).toBe(1);
    expect(s.music).toEqual({ uri: "spotify:track:a", level: "full" });
  });
  it("is a no-op while running, and on an empty show with nothing on its way", () => {
    const s = run();
    expect(run(s)).toBe(s);
    expect(run(initialState)).toBe(initialState);
  });
  it("on an empty show with a request in flight, goes on air into the gap", () => {
    const s = run(reducer(initialState, { type: "PRODUCING" }));
    expect(s.loop).toBe("running");
    expect(inGap(s)).toBe(true);
    expect(s.music.level).toBe("off");
  });
});

describe("lanes", () => {
  it("a song without talk plays at full with the mic off", () => {
    expect(at(1).music).toEqual({ uri: "spotify:track:a", level: "full" });
    expect(at(1).mic).toBeNull();
  });
  it("a song with an intro talk starts ducked with the clip on", () => {
    expect(at(2).music).toEqual({ uri: "spotify:track:b", level: "duck" });
    expect(at(2).mic).toBe("talkup-2");
  });
  it("a song with an outro talk starts full; TALK_DUE ducks and puts the clip on", () => {
    const s = at(3);
    expect(s.music.level).toBe("full");
    expect(s.mic).toBeNull();
    const due = reducer(s, { type: "TALK_DUE" });
    expect(due.music.level).toBe("duck");
    expect(due.mic).toBe("outro-c");
    expect(reducer(due, { type: "TALK_DUE" })).toBe(due);
  });
  it("a break without a bed is dry: music off, clip on", () => {
    expect(at(6).music).toEqual({ uri: null, level: "off" });
    expect(at(6).mic).toBe("tail");
  });
  it("a new element bumps both lanes' sequences", () => {
    expect(at(1).playSeq).toBe(1);
    expect(at(1).micSeq).toBe(1);
  });
});

describe("clip ended", () => {
  it("on an intro talk: mic off, music to full, cursor stays", () => {
    const s = reducer(at(2), { type: "CLIP_ENDED", clip: "talkup-2" });
    expect(s.cursor).toBe(2);
    expect(s.mic).toBeNull();
    expect(s.music).toEqual({ uri: "spotify:track:b", level: "full" });
    expect(s.playSeq).toBe(at(2).playSeq);
  });
  it("on a break: next element", () => {
    const s = reducer(run(), { type: "CLIP_ENDED", clip: "break-small" });
    expect(s.cursor).toBe(1);
    expect(s.music).toEqual({ uri: "spotify:track:a", level: "full" });
  });
  it("ignores a stale clip; CLIP_FAILED behaves like CLIP_ENDED", () => {
    const s = at(2);
    expect(reducer(s, { type: "CLIP_ENDED", clip: "break-small" })).toBe(s);
    expect(reducer(run(), { type: "CLIP_FAILED", clip: "break-small" }).cursor).toBe(1);
  });
});

describe("lead", () => {
  it("LEAD_DUE on a break starts the next song ducked and keeps the clip on the mic", () => {
    const s = reducer(at(4), { type: "LEAD_DUE" });
    expect(s.cursor).toBe(5);
    expect(s.music).toEqual({ uri: "spotify:track:d", level: "duck" });
    expect(s.mic).toBe("break-big");
    expect(s.bed).toBe("bed");
    expect(s.playSeq).toBe(at(4).playSeq + 1);
    expect(s.micSeq).toBe(at(4).micSeq);
  });
  it("then the break clip's end brings the song to full", () => {
    const s = reducer(reducer(at(4), { type: "LEAD_DUE" }), { type: "CLIP_ENDED", clip: "break-big" });
    expect(s.cursor).toBe(5);
    expect(s.mic).toBeNull();
    expect(s.music).toEqual({ uri: "spotify:track:d", level: "full" });
  });
});

describe("the end of the kept show", () => {
  it("with nothing on its way, stops and keeps the cursor", () => {
    const s = reducer(at(6), { type: "CLIP_ENDED", clip: "tail" });
    expect(s.loop).toBe("stopped");
    expect(s.cursor).toBe(6);
    expect(s.music.level).toBe("off");
  });
  it("with a request in flight, waits in the gap in silence; an opened segment starts its segue", () => {
    const waiting = reducer(reducer(at(6), { type: "PRODUCING" }), { type: "CLIP_ENDED", clip: "tail" });
    expect(waiting.loop).toBe("running");
    expect(inGap(waiting)).toBe(true);
    expect(waiting.music.level).toBe("off");
    const seg = reducer(waiting, { type: "SEGMENT_OPENED", view: view(2, ["x", "y", "z"], 0) });
    expect(seg.music).toEqual({ uri: "spotify:track:x", level: "full" });
    expect(seg.segments.at(-1)).toMatchObject({ id: "seg-2", from: 7, to: 7, complete: false });
    expect(nextRecord(seg)?.id).toBe("x");
    expect(seg.producing).toBe(false);
  });
  it("with a segment opened, plays a clean segue into the record its next slot brings (R8)", () => {
    const s = reducer(reducer(at(6), { type: "SEGMENT_OPENED", view: view(2, ["x", "y"], 0) }), {
      type: "CLIP_ENDED",
      clip: "tail",
    });
    expect(s.loop).toBe("running");
    expect(s.cursor).toBe(7);
    expect(s.music).toEqual({ uri: "spotify:track:x", level: "full" });
    expect(s.mic).toBeNull();
    expect(reducer(s, { type: "TRACK_ENDED" }).music.level).toBe("off");
    expect(reducer(s, { type: "NEXT" })).toBe(s);
  });
  it("a fresh show waits in silence for its opening slot — never a segue before the first break", () => {
    const s = reducer(reducer(initialState, { type: "PRODUCING" }), { type: "RUN" });
    expect(s.loop).toBe("running");
    expect(s.music.level).toBe("off");
    const opened = reducer(s, { type: "SEGMENT_OPENED", view: view(1, ["a", "b"], 0) });
    expect(opened.music.level).toBe("off");
    expect(awaiting(opened)).toBe(true);
    const landed = reducer(opened, { type: "SEGMENT_SLOT", view: view(1, ["a", "b"], 1) });
    expect(landed.cursor).toBe(0);
    expect(landed.mic).toBe("/api/clip/seg-1/0");
    expect(landed.music.level).toBe("off");
  });
  it("RUN on an empty show with nothing on its way is a no-op", () => {
    expect(reducer(initialState, { type: "RUN" })).toBe(initialState);
  });
});

describe("segments landing", () => {
  it("LOAD_SHOW: every segment becomes an element range, the unfinished one still growing", () => {
    const s = reducer(initialState, {
      type: "LOAD_SHOW",
      segments: [view(2, ["c", "d"]), view(1, ["a", "b", "x"]), view(3, ["e", "f"], 1)],
    });
    expect(s.elements).toHaveLength(9);
    expect(s.segments.map((g) => [g.seq, g.from, g.to, g.complete])).toEqual([
      [1, 0, 4, true],
      [2, 4, 7, true],
      [3, 7, 9, false],
    ]);
    expect(ahead(s).map((r) => r.id)).toEqual(["f"]);
    expect(segmentAt(s, 5)?.seq).toBe(2);
    expect(s.cursor).toBeNull();
  });
  it("LOAD_SHOW is refused while running", () => {
    const s = run();
    expect(reducer(s, { type: "LOAD_SHOW", segments: [] })).toBe(s);
  });
  it("SEGMENT_OPENED never touches the lanes while something is playing", () => {
    const s = at(1);
    const p = reducer(s, { type: "SEGMENT_OPENED", view: view(2, ["x"], 0) });
    expect(p.music).toEqual(s.music);
    expect(p.mic).toBe(s.mic);
    expect(p.playSeq).toBe(s.playSeq);
    expect(p.segments.at(-1)).toMatchObject({ id: "seg-2", from: 7, to: 7, complete: false });
  });
  it("SEGMENT_SLOT while playing grows the last segment, slot by slot, until it is complete", () => {
    const s = reducer(at(1), { type: "SEGMENT_OPENED", view: view(2, ["x", "y"], 0) });
    const one = reducer(s, { type: "SEGMENT_SLOT", view: view(2, ["x", "y"], 1) });
    expect(one.elements).toHaveLength(9);
    expect(one.segments.at(-1)).toMatchObject({ id: "seg-2", from: 7, to: 9, complete: false });
    expect(one.cursor).toBe(1);
    expect(nextRecord(one)?.id).toBe("y");
    const two = reducer(one, { type: "SEGMENT_SLOT", view: view(2, ["x", "y"], 2) });
    expect(two.elements).toHaveLength(10);
    expect(two.segments.at(-1)).toMatchObject({ from: 7, to: 10, complete: true });
    expect(awaiting(two)).toBe(false);
    // the same slot again changes nothing
    expect(reducer(two, { type: "SEGMENT_SLOT", view: view(2, ["x", "y"], 2) }).elements).toHaveLength(10);
  });
  it("SEGMENT_SLOT for a segment never opened opens it first", () => {
    const s = reducer(at(1), { type: "SEGMENT_SLOT", view: view(2, ["x"], 1) });
    expect(s.segments.at(-1)).toMatchObject({ id: "seg-2", from: 7, to: 9, complete: true });
  });
  it("SEGMENT_SLOT over its own segue keeps the song playing and moves the cursor onto it", () => {
    const gap = reducer(reducer(at(6), { type: "SEGMENT_OPENED", view: view(2, ["x", "y"], 0) }), {
      type: "CLIP_ENDED",
      clip: "tail",
    });
    const a = reducer(gap, { type: "SEGMENT_SLOT", view: view(2, ["x", "y"], 1) });
    expect(a.cursor).toBe(8); // the song after the break
    expect(a.music).toEqual({ uri: "spotify:track:x", level: "full" });
    expect(a.playSeq).toBe(gap.playSeq); // not restarted
    expect(a.mic).toBeNull();
  });
  it("SEGMENT_SLOT in the silent gap (the segue ran out) resumes at the new elements", () => {
    const gap = reducer(reducer(at(6), { type: "SEGMENT_OPENED", view: view(2, ["x", "y"], 0) }), {
      type: "CLIP_ENDED",
      clip: "tail",
    });
    const silent = reducer(gap, { type: "TRACK_ENDED" });
    expect(silent.music.level).toBe("off");
    const a = reducer(silent, { type: "SEGMENT_SLOT", view: view(2, ["x", "y"], 1) });
    expect(a.cursor).toBe(7);
    expect(a.mic).toBe("/api/clip/seg-2/0");
  });
  it("SEGMENT_FAILED in the silent gap stops; elsewhere it only reports", () => {
    const waiting = reducer(reducer(at(6), { type: "PRODUCING" }), { type: "CLIP_ENDED", clip: "tail" });
    const f = reducer(waiting, { type: "SEGMENT_FAILED", error: "busy" });
    expect(f.loop).toBe("stopped");
    expect(f.error).toBe("busy");
    const playing = reducer(reducer(at(1), { type: "PRODUCING" }), { type: "SEGMENT_FAILED", error: "busy" });
    expect(playing.loop).toBe("running");
    expect(playing.producing).toBe(false);
  });
});

describe("transport", () => {
  it("STOP silences both lanes and keeps the cursor", () => {
    const s = reducer(at(2), { type: "STOP" });
    expect(s.loop).toBe("stopped");
    expect(s.cursor).toBe(2);
    expect(s.music).toEqual({ uri: null, level: "off" });
    expect(s.mic).toBeNull();
  });
  it("NEXT/PREV move the cursor and restart", () => {
    const n = reducer(at(1), { type: "NEXT" });
    expect(n.cursor).toBe(2);
    expect(n.playSeq).toBe(at(1).playSeq + 1);
    expect(reducer(at(1), { type: "PREV" }).cursor).toBe(0);
    const first = at(0);
    expect(reducer(first, { type: "PREV" })).toBe(first);
  });
  it("JUMP onto a kept break re-asserts mic and bed and bumps both seqs", () => {
    const s = reducer(at(1), { type: "JUMP", index: 4 });
    expect(s.mic).toBe("break-big");
    expect(s.bed).toBe("bed");
    expect(s.playSeq).toBe(at(1).playSeq + 1);
    expect(s.micSeq).toBe(at(1).micSeq + 1);
  });
  it("JUMP out of bounds is a no-op; JUMP while stopped starts the loop", () => {
    expect(reducer(loaded, { type: "JUMP", index: 9 })).toBe(loaded);
    expect(at(3).loop).toBe("running");
  });
  it("HALT stops with the error", () => {
    const s = reducer(at(1), { type: "HALT", error: "device gone" });
    expect(s.loop).toBe("stopped");
    expect(s.error).toBe("device gone");
  });
});
