import { describe, expect, it } from "vitest";
import { mixAt, type PreparedSlot, seekPosition, slotDuration } from "./mix";
import { type Plan, planSlot, TRACK_DUCK, TRACK_FULL } from "./plan";

const slot: PreparedSlot = {
  id: "slot",
  songUrl: "song",
  voiceUrl: "voice",
  bedUrl: "bed",
  songDurationMs: 180_000,
  plan: planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 3000, legalIdChars: 0 }),
};
describe("one mix timeline", () => {
  it("the mixer viewport includes a long DJ overlap and its release envelope", () => {
    const plan = planSlot({ kind: "talkup", clipMs: 20_000, recordUnderMs: 20_000, legalIdChars: 0 });
    expect(plan.previewEndMs).toBe(21_800);
  });
  it("distinguishes preview extent, song duration and full slot duration", () => {
    expect(slot.plan.previewEndMs).toBe(25_000);
    expect(slotDuration(slot)).toBe(197_000);
    expect(seekPosition(slot, { coordinate: "song", ms: 90_000 })).toBe(107_000);
    expect(seekPosition(slot, { coordinate: "slot", ms: 500_000 })).toBe(197_000);
  });
  it("projects before, overlapping and completed lanes from one position", () => {
    expect(mixAt(slot, 5000)).toMatchObject({
      voice: { phase: "active", offsetMs: 5000 },
      song: { phase: "before", offsetMs: 0 },
    });
    expect(mixAt(slot, 18_000)).toMatchObject({
      voice: { phase: "active", offsetMs: 18_000 },
      song: { phase: "active", offsetMs: 1000, gain: TRACK_DUCK },
      bed: { phase: "ended", gain: 0 },
    });
    expect(mixAt(slot, 197_000).song.phase).toBe("ended");
  });
  it("preserves the remainder of the duck-release envelope after pause or seek", () => {
    const song = mixAt(slot, 20_500).song;
    expect(song.gain).toBeGreaterThan(TRACK_DUCK);
    expect(song.gain).toBeLessThan(TRACK_FULL);
    expect(song.remaining[0][0]).toBeGreaterThan(20_500);
    expect(song.remaining.at(-1)).toEqual([21_800, TRACK_FULL]);
  });
  it("clamps invalid user input without producing NaN", () => {
    expect(seekPosition(slot, { coordinate: "song", ms: Number.NaN })).toBe(17_000);
    expect(seekPosition(slot, { coordinate: "slot", ms: -1 })).toBe(0);
  });
});

describe("mixAt: voice and song positions at lane boundaries", () => {
  // A hidden page's timers fire late (iOS aligns them to a second while the page plays audio):
  // an element is seeked to where the head really is when its start fires, never to the plan's mark.
  const brk = planSlot({ kind: "break", clipMs: 20_000, recordUnderMs: 3000, legalIdChars: 0 });
  const talkup = planSlot({ kind: "talkup", clipMs: 4000, voiceInMs: 2000, legalIdChars: 0 });
  const segue = planSlot({ kind: "segue", clipMs: null, legalIdChars: 0 });
  it.each<[Plan, number, { micMs: number | null; trackMs: number | null }, string]>([
    [brk, 0, { micMs: 0, trackMs: null }, "a break at the top: the mic from its start, the record not yet"],
    [
      brk,
      900,
      { micMs: 900, trackMs: null },
      "a mic start that fired 900 ms late lands 900 ms into the clip",
    ],
    [brk, 17_000, { micMs: 17_000, trackMs: 0 }, "the record's mark: the record from its top"],
    [brk, 17_900, { micMs: 17_900, trackMs: 900 }, "a record start that fired 900 ms late lands 900 ms in"],
    [brk, 21_000, { micMs: null, trackMs: 4000 }, "the voice done: the record alone"],
    [talkup, 0, { micMs: null, trackMs: 0 }, "a talk-up at the top: the record, no voice yet"],
    [talkup, 2500, { micMs: 500, trackMs: 2500 }, "a talk-up mid-voice"],
    [talkup, 6000, { micMs: null, trackMs: 6000 }, "a talk-up once the voice is done"],
    [segue, 5000, { micMs: null, trackMs: 5000 }, "a segue: the record only"],
  ])("%#: %s", (plan, headMs, want, _id) => {
    const mix = mixAt({ ...slot, plan }, headMs);
    expect({
      micMs: mix.voice.phase === "active" ? mix.voice.offsetMs : null,
      trackMs: mix.song.phase === "active" ? mix.song.offsetMs : null,
    }).toEqual(want);
  });
});
