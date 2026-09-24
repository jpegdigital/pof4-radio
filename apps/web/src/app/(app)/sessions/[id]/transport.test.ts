import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/playback/plan";
import { type LockScreen, lockScreen, onMic, prevTarget, RESTART_AFTER_MS } from "./transport";
import type { DeckPhase, TrackClock } from "./types";

/** Display projections and previous-slot navigation, independent of the audio runtime. */

const brk: Plan = {
  previewEndMs: 25_000,
  mic: { atMs: 0, endMs: 20_000 },
  bed: { atMs: 0, fullMs: 800, downMs: 15_500, outMs: 17_000 },
  music: { atMs: 17_000 },
  duck: { atMs: 17_000, endMs: 20_000 },
};
const talkup: Plan = {
  previewEndMs: 8000,
  mic: { atMs: 2000, endMs: 6000 },
  bed: null,
  music: { atMs: 0 },
  duck: { atMs: 2000, endMs: 6000 },
};
const segue: Plan = { previewEndMs: 8000, mic: null, bed: null, music: { atMs: 0 }, duck: null };

describe("the lock screen while the next track is being prepared", () => {
  it("keeps pause available without showing a completed track position", () => {
    expect(lockScreen("waiting", { positionMs: 1000, durationMs: 1000, playing: false })).toEqual({
      playbackState: "playing",
      position: null,
    });
  });
});

describe("onMic", () => {
  it.each<[Plan, number, boolean, string]>([
    [brk, 0, true, "a break from the first ms"],
    [brk, 19_999, true, "a break until the clip ends"],
    [brk, 20_000, false, "a break at the clip's end"],
    [talkup, 1999, false, "a talk-up before the voice"],
    [talkup, 2000, true, "a talk-up as the voice comes in"],
    [segue, 0, false, "a segue never"],
  ])("%#: %s", (plan, headMs, want, _id) => {
    expect(onMic(plan, headMs)).toBe(want);
  });
});

describe("prevTarget", () => {
  it.each<[number, number, number, string]>([
    [3, 0, 2, "just started: the slot before"],
    [3, RESTART_AFTER_MS, 2, "at the threshold: still the slot before"],
    [3, RESTART_AFTER_MS + 1, 3, "past the threshold: this slot from the top"],
    [0, 0, 0, "the first slot has nothing before it"],
  ])("%#: %s", (index, headMs, want, _id) => {
    expect(prevTarget(index, headMs)).toBe(want);
  });
});

describe("lockScreen: what the device shows", () => {
  const on: TrackClock = { positionMs: 5000, durationMs: 200_000, playing: true };
  const off: TrackClock = { positionMs: 5000, durationMs: 200_000, playing: false };
  const scrub = { positionMs: 5000, durationMs: 200_000 };
  it.each<[DeckPhase, TrackClock | null, LockScreen, string]>([
    [
      "playing",
      on,
      { playbackState: "playing", position: scrub },
      "the record on: playing, with the scrubber",
    ],
    [
      "playing",
      { positionMs: 0, durationMs: 200_000, playing: false },
      { playbackState: "playing", position: null },
      "the voice before the record: playing, but no scrubber to creep from zero",
    ],
    [
      "loading",
      null,
      { playbackState: "playing", position: null },
      "between slots: still playing, the widget stays",
    ],
    [
      "paused",
      off,
      { playbackState: "paused", position: scrub },
      "paused mid-record: the scrubber where it stopped",
    ],
    ["held", off, { playbackState: "paused", position: scrub }, "held by the platform reads as paused"],
    ["idle", null, { playbackState: "none", position: null }, "nothing loaded"],
    ["error", off, { playbackState: "none", position: null }, "stopped on an error: no player"],
    [
      "playing",
      { positionMs: 250_000, durationMs: 200_000, playing: true },
      { playbackState: "playing", position: { positionMs: 200_000, durationMs: 200_000 } },
      "a position past the end is clamped (the device rejects it)",
    ],
    [
      "playing",
      { positionMs: 0, durationMs: 0, playing: true },
      { playbackState: "playing", position: null },
      "no length known yet: no scrubber",
    ],
  ])("%#: %s", (phase, track, want, _id) => {
    expect(lockScreen(phase, track)).toEqual(want);
  });
});
