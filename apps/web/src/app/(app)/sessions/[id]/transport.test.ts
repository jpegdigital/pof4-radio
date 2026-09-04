import { describe, expect, it } from "vitest";
import type { Plan } from "./plan";
import {
  type ContextMove,
  DRIFT_MS,
  type LockScreen,
  lockScreen,
  onContext,
  onMic,
  prevTarget,
  realign,
  RESTART_AFTER_MS,
  resumes,
} from "./transport";
import type { DeckPhase, TrackClock } from "./types";

/**
 * The transport's judgment, pure: whether a paused deck can pick up where it was or must run
 * the slot again from the top, whether the mic is still on at a moment, and where ⏮ goes.
 */

const brk: Plan = {
  lengthMs: 25_000,
  mic: { atMs: 0, endMs: 20_000 },
  bed: { atMs: 0, fullMs: 800, downMs: 15_500, outMs: 17_000 },
  music: { atMs: 17_000 },
  duck: { atMs: 17_000, endMs: 20_000 },
};
const talkup: Plan = {
  lengthMs: 8000,
  mic: { atMs: 2000, endMs: 6000 },
  bed: null,
  music: { atMs: 0 },
  duck: { atMs: 2000, endMs: 6000 },
};
const segue: Plan = { lengthMs: 8000, mic: null, bed: null, music: { atMs: 0 }, duck: null };

describe("resumes", () => {
  it.each<[Plan, number, boolean, string]>([
    [brk, 5000, false, "a break with the voice still on: the mix runs again"],
    [brk, 18_000, false, "a break under the lead line, record started but voice not done"],
    [brk, 21_000, true, "a break once the voice is done: the track picks up"],
    [talkup, 1000, false, "a talk-up before the voice comes in"],
    [talkup, 4000, false, "a talk-up mid-voice"],
    [talkup, 7000, true, "a talk-up after the voice"],
    [segue, 100, true, "a segue: the track alone, always resumable"],
  ])("%#: %s", (plan, headMs, want, _id) => {
    expect(resumes(plan, headMs)).toBe(want);
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

describe("realign: the head the record's own clock implies", () => {
  // Two clocks: the head runs on wall time, the record on its element's. Once the record is on,
  // the element is the truth — an interruption stops it and the head runs on; a stall does the
  // same; a throttled page can leave the head behind. Past the tolerance the mix is laid again
  // from where the record actually is.
  it.each<[Plan, number, number, number | null, string]>([
    [brk, 20_000, 3000, null, "the timeline and the record agree"],
    [brk, 20_000, 3000 - DRIFT_MS + 1, null, "just inside the tolerance: left alone"],
    [brk, 20_000, 3000 - DRIFT_MS, 20_000 - DRIFT_MS, "at the tolerance: the record's head"],
    [brk, 50_000, 3000, 20_000, "the timeline ran through an interruption the record did not: back to it"],
    [brk, 5000, 0, null, "the record not on yet: its clock says nothing"],
    [segue, 8000, 12_000, 12_000, "the record ran on while the timeline stalled: forward to it"],
  ])("%#: %s", (plan, headMs, trackMs, want, _id) => {
    expect(realign(plan, headMs, trackMs)).toBe(want);
  });
});

describe("onContext: what the audio context's state means to the deck", () => {
  it.each<[DeckPhase, string, ContextMove | null, string]>([
    ["playing", "interrupted", "hold", "on air and the platform takes the audio (a call, Siri): hold"],
    ["held", "running", "play", "the audio back after a hold: play again from the head"],
    ["playing", "running", null, "on air, running: nothing"],
    [
      "playing",
      "suspended",
      null,
      "our own suspend (the kick after a stalled return) is not an interruption",
    ],
    ["paused", "interrupted", null, "the listener's pause: nothing to hold"],
    ["paused", "running", null, "the listener's pause stands when the audio comes back"],
    ["held", "interrupted", null, "already held"],
    ["idle", "interrupted", null, "nothing loaded"],
    ["loading", "interrupted", null, "still loading: the start will fail or play on its own"],
    ["error", "running", null, "stopped on an error stays stopped"],
  ])("%#: %s", (phase, state, want, _id) => {
    expect(onContext(phase, state)).toBe(want);
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
