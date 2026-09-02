import { describe, expect, it } from "vitest";
import {
  BEAT_MS,
  BED_FADE_MS,
  BED_GAIN,
  BED_IN_MS,
  bedGainAt,
  DUCK_MS,
  LEGAL_ID_MS_PER_CHAR,
  planSlot,
  RECORD_DUCK,
  RECORD_FULL,
  recordLevelAt,
  RISE_MS,
  TAIL_MS,
  VOCAL_TAIL_MS,
} from "./plan";

/**
 * The plan is the mix on paper: when the mic, the bed and the record start and stop, from the
 * kind, the clip's length, the writer's two numbers and the card's intro. Nothing measured,
 * nothing searched for — the numbers are opportunistic and the player follows them.
 */

describe("planSlot", () => {
  it("a break: mic from 0, bed under it, the record starts under the lead line", () => {
    const p = planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 3000, legalIdChars: 0 });
    expect(p.mic).toEqual({ atMs: 0, endMs: 20_000 });
    expect(p.music.atMs).toBe(17_000);
    expect(p.bed).toEqual({ atMs: 0, fullMs: BED_IN_MS, downMs: 17_000 - BED_FADE_MS, outMs: 17_000 });
    expect(p.lengthMs).toBe(17_000 + TAIL_MS);
  });

  it("a break with a legal ID keeps the bed out until it has been said, dry", () => {
    const p = planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 3000, legalIdChars: 40 });
    expect(p.bed?.atMs).toBe(40 * LEGAL_ID_MS_PER_CHAR);
    expect(p.bed?.fullMs).toBe(40 * LEGAL_ID_MS_PER_CHAR + BED_IN_MS);
  });

  it("a break whose clip is shorter than the bed's ramps still comes out in order", () => {
    const p = planSlot({ kind: "break", clipMs: 1000, recordUnderMs: 3000, legalIdChars: 0 });
    expect(p.music.atMs).toBe(0);
    expect(p.bed).toBeNull();
  });

  it("a talk-up: the record from 0, the voice in where the writer said", () => {
    const p = planSlot({ kind: "talkup", clipMs: 4000, voiceInMs: 1500, introMs: 12_000, legalIdChars: 0 });
    expect(p.music.atMs).toBe(0);
    expect(p.mic).toEqual({ atMs: 1500, endMs: 5500 });
    expect(p.bed).toBeNull();
    expect(p.note).toBeUndefined();
  });

  it("a talk-up that would run into the vocal starts earlier, to end a beat before it", () => {
    const p = planSlot({ kind: "talkup", clipMs: 8000, voiceInMs: 3000, introMs: 9000, legalIdChars: 0 });
    expect(p.mic).toEqual({ atMs: 9000 - BEAT_MS - 8000, endMs: 9000 - BEAT_MS });
  });

  it("a talk-up longer than the whole intro starts at 0 and says so", () => {
    const p = planSlot({ kind: "talkup", clipMs: 12_000, voiceInMs: 2000, introMs: 9000, legalIdChars: 0 });
    expect(p.mic?.atMs).toBe(0);
    expect(p.note).toContain("past the vocal");
  });

  it("a sweeper: dry, then a hard start", () => {
    const p = planSlot({ kind: "sweeper", clipMs: 2500, legalIdChars: 0 });
    expect(p.mic).toEqual({ atMs: 0, endMs: 2500 });
    expect(p.music.atMs).toBe(2500);
    expect(p.bed).toBeNull();
  });

  it.each([
    { id: "a segue is the record alone", kind: "segue" as const },
    { id: "a break with no clip is the record alone", kind: "break" as const },
    { id: "a talk-up with no clip is the record alone", kind: "talkup" as const },
  ])("$id", ({ kind }) => {
    const p = planSlot({ kind, clipMs: null, legalIdChars: 0 });
    expect(p.mic).toBeNull();
    expect(p.bed).toBeNull();
    expect(p.music.atMs).toBe(0);
    expect(p.lengthMs).toBe(TAIL_MS);
  });
});

describe("the vocal and the timeline's length", () => {
  it("a break into a record with a known intro runs to the vocal and a little past", () => {
    const p = planSlot({
      kind: "break",
      clipMs: 20_000,
      recordUnderMs: 3000,
      introMs: 15_000,
      legalIdChars: 0,
    });
    expect(p.vocalMs).toBe(17_000 + 15_000);
    expect(p.lengthMs).toBe(17_000 + 15_000 + VOCAL_TAIL_MS);
  });

  it("a talk-up marks the vocal where the card says", () => {
    const p = planSlot({ kind: "talkup", clipMs: 4000, voiceInMs: 1500, introMs: 12_000, legalIdChars: 0 });
    expect(p.vocalMs).toBe(12_000);
    expect(p.lengthMs).toBe(12_000 + VOCAL_TAIL_MS);
  });

  it("a short intro never makes the timeline shorter than the tail", () => {
    const p = planSlot({ kind: "segue", clipMs: null, introMs: 1000, legalIdChars: 0 });
    expect(p.vocalMs).toBe(1000);
    expect(p.lengthMs).toBe(TAIL_MS);
  });

  it("no intro known: no vocal mark", () => {
    expect(planSlot({ kind: "sweeper", clipMs: 2500, legalIdChars: 0 }).vocalMs).toBeUndefined();
  });
});

describe("bedGainAt", () => {
  const bed = { atMs: 1000, fullMs: 2000, downMs: 10_000, outMs: 12_000 };
  it.each<[number, number, string]>([
    [0, 0, "before the bed"],
    [1000, 0, "as it comes in"],
    [1500, BED_GAIN / 2, "halfway up"],
    [2000, BED_GAIN, "full"],
    [6000, BED_GAIN, "under the voice"],
    [11_000, BED_GAIN / 2, "halfway down"],
    [12_000, 0, "out"],
    [20_000, 0, "long gone"],
  ])("%#: %s", (ms, want, _id) => {
    expect(bedGainAt(bed, ms)).toBeCloseTo(want, 6);
  });
});

describe("the duck: the record under the voice", () => {
  it("a break: from the record's start under the lead line until the voice is done", () => {
    const p = planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 3000, legalIdChars: 0 });
    expect(p.duck).toEqual({ atMs: 17_000, endMs: 20_000 });
  });

  it("a break with a hard intro: nothing to duck", () => {
    const p = planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 0, legalIdChars: 0 });
    expect(p.duck).toBeNull();
  });

  it("a talk-up: the whole voice", () => {
    const p = planSlot({ kind: "talkup", clipMs: 4000, voiceInMs: 1500, introMs: 12_000, legalIdChars: 0 });
    expect(p.duck).toEqual({ atMs: 1500, endMs: 5500 });
  });

  it.each([
    { id: "a sweeper is dry then a hard start", kind: "sweeper" as const, clipMs: 2500 },
    { id: "a segue has no voice", kind: "segue" as const, clipMs: null },
  ])("$id", ({ kind, clipMs }) => {
    expect(planSlot({ kind, clipMs, legalIdChars: 0 }).duck).toBeNull();
  });
});

describe("recordLevelAt", () => {
  const duck = { atMs: 5000, endMs: 9000 };
  it.each<[number, number, string]>([
    [0, RECORD_FULL, "long before"],
    [5000 - DUCK_MS, RECORD_FULL, "as it starts down"],
    [5000 - DUCK_MS / 2, (RECORD_FULL + RECORD_DUCK) / 2, "halfway down"],
    [5000, RECORD_DUCK, "landed as the voice comes in"],
    [7000, RECORD_DUCK, "under the voice"],
    [9000, RECORD_DUCK, "as the voice ends"],
    [9000 + RISE_MS / 2, (RECORD_FULL + RECORD_DUCK) / 2, "halfway back up"],
    [9000 + RISE_MS, RECORD_FULL, "back"],
  ])("%#: %s", (ms, want, _id) => {
    expect(recordLevelAt(duck, ms)).toBeCloseTo(want, 6);
  });

  it("no duck: full throughout", () => {
    expect(recordLevelAt(null, 3000)).toBe(RECORD_FULL);
  });
});
