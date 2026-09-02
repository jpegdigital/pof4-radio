import { describe, expect, it } from "vitest";
import type { Plan } from "./plan";
import { onMic, prevTarget, RESTART_AFTER_MS, resumes } from "./transport";

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
    [brk, 21_000, true, "a break once the voice is done: the record picks up"],
    [talkup, 1000, false, "a talk-up before the voice comes in"],
    [talkup, 4000, false, "a talk-up mid-voice"],
    [talkup, 7000, true, "a talk-up after the voice"],
    [segue, 100, true, "a segue: the record alone, always resumable"],
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
