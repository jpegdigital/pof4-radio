import { describe, expect, it } from "vitest";
import { type Element, initialState, type ProgramState, reducer } from "./reducer";

const track = (id: string, durationMs = 200_000) => ({
  uri: `spotify:track:${id}`,
  name: id,
  artists: [id],
  album: id,
  image: null,
  durationMs,
});
const elements: Element[] = [
  { kind: "break", clip: "break-small", bed: track("bed"), leadMs: 0, label: "Break" },
  { kind: "song", track: track("a") },
  { kind: "song", track: track("b"), talk: { clip: "talkup-2", over: "intro" } },
  { kind: "song", track: track("c"), talk: { clip: "outro-c", over: "outro" } },
  { kind: "break", clip: "break-big", bed: track("bed"), bedInMs: 5000, leadMs: 6000, label: "Top" },
  { kind: "song", track: track("d"), talk: { clip: "talkup-d", over: "intro" } },
  { kind: "break", clip: "tail", leadMs: 0, label: "Dry" },
];
const loaded: ProgramState = { ...initialState, elements };
const run = (s = loaded) => reducer(s, { type: "RUN" });
const at = (index: number) => reducer(loaded, { type: "JUMP", index });

describe("run", () => {
  it("starts element 0 with both lanes set: bed under, clip on the mic", () => {
    const s = run();
    expect(s.loop).toBe("running");
    expect(s.cursor).toBe(0);
    expect(s.music).toEqual({ uri: "spotify:track:bed", level: "bed" });
    expect(s.mic).toBe("break-small");
    expect(s.playSeq).toBe(1);
    expect(s.startedAt).not.toBeNull();
  });
  it("restarts the element at the cursor after a stop", () => {
    const s = run(reducer(at(1), { type: "STOP" }));
    expect(s.cursor).toBe(1);
    expect(s.music).toEqual({ uri: "spotify:track:a", level: "full" });
  });
  it("is a no-op while running", () => {
    const s = run();
    expect(run(s)).toBe(s);
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
  it("a song with an outro talk starts full; OUTRO_DUE ducks and puts the clip on", () => {
    const s = at(3);
    expect(s.music.level).toBe("full");
    expect(s.mic).toBeNull();
    const due = reducer(s, { type: "OUTRO_DUE" });
    expect(due.music.level).toBe("duck");
    expect(due.mic).toBe("outro-c");
    expect(reducer(due, { type: "OUTRO_DUE" })).toBe(due);
  });
  it("OUTRO_DUE is ignored off an outro song", () => {
    const s = at(2);
    expect(reducer(s, { type: "OUTRO_DUE" })).toBe(s);
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
  it("on an intro talk: mic off, music to full, cursor stays, track keeps playing", () => {
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
    expect(s.mic).toBeNull();
  });
  it("on an outro talk: mic off only", () => {
    const s = reducer(reducer(at(3), { type: "OUTRO_DUE" }), { type: "CLIP_ENDED", clip: "outro-c" });
    expect(s.cursor).toBe(3);
    expect(s.mic).toBeNull();
    expect(s.music.level).toBe("duck");
  });
  it("ignores a stale clip", () => {
    const s = at(2);
    expect(reducer(s, { type: "CLIP_ENDED", clip: "break-small" })).toBe(s);
  });
  it("CLIP_FAILED behaves like CLIP_ENDED", () => {
    expect(reducer(run(), { type: "CLIP_FAILED", clip: "break-small" }).cursor).toBe(1);
  });
});

describe("lead", () => {
  it("LEAD_DUE on a break starts the next song ducked and keeps the clip on the mic", () => {
    const s = reducer(at(4), { type: "LEAD_DUE" });
    expect(s.cursor).toBe(5);
    expect(s.music).toEqual({ uri: "spotify:track:d", level: "duck" });
    expect(s.mic).toBe("break-big");
    expect(s.playSeq).toBe(at(4).playSeq + 1);
    expect(s.micSeq).toBe(at(4).micSeq);
  });
  it("then the break clip's end brings the song to full", () => {
    const s = reducer(reducer(at(4), { type: "LEAD_DUE" }), { type: "CLIP_ENDED", clip: "break-big" });
    expect(s.cursor).toBe(5);
    expect(s.mic).toBeNull();
    expect(s.music).toEqual({ uri: "spotify:track:d", level: "full" });
  });
  it("is ignored on a hard-intro break or off a break", () => {
    const hard = at(0);
    expect(reducer(hard, { type: "LEAD_DUE" })).toBe(hard);
    const song = at(1);
    expect(reducer(song, { type: "LEAD_DUE" })).toBe(song);
  });
});

describe("track ended", () => {
  it("moves to the next element", () => {
    expect(reducer(at(1), { type: "TRACK_ENDED" }).cursor).toBe(2);
  });
  it("past the last element stops the loop and keeps the cursor", () => {
    const s = reducer(at(6), { type: "CLIP_ENDED", clip: "tail" });
    expect(s.loop).toBe("stopped");
    expect(s.cursor).toBe(6);
    expect(s.music.level).toBe("off");
    expect(s.mic).toBeNull();
  });
  it("is ignored while stopped", () => {
    const s = reducer(at(1), { type: "STOP" });
    expect(reducer(s, { type: "TRACK_ENDED" })).toBe(s);
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
