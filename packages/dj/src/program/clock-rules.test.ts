import { describe, expect, it } from "vitest";
import {
  checkSegmentLog,
  hourTurnedBetween,
  layBreaks,
  MIN_TALKUP_INTRO_MS,
  type RawSlot,
  SEGMENT_MAX,
  SEGMENT_MIN,
} from "./clock-rules.ts";
import type { Card } from "./shapes.ts";

const card = (id: string, introMs = 14_000, sure = true): Card => ({
  id,
  name: id,
  artists: [id],
  introMs,
  sure,
  post: "post",
  outro: "fade",
  outroMs: 180_000,
  energy: 3,
  tempo: "mid",
  mood: "",
  notes: [],
  thinking: "",
  model: "",
});
const slot = (id: string, intro: RawSlot["intro"]): RawSlot => ({ id, intro, why: "" });

const ids = ["a", "b", "c", "d"];
const cards = new Map(ids.map((id) => [id, card(id)]));
const valid = [slot("a", "break"), slot("b", "talkup"), slot("c", "segue"), slot("d", "sweeper")];

describe("checkSegmentLog", () => {
  it("passes a valid segment untouched, assigning seq", () => {
    const r = checkSegmentLog(valid, cards, { first: false, hourTurned: false });
    expect(r.fallbacks).toEqual([]);
    expect(r.slots.map((s) => [s.seq, s.id, s.intro])).toEqual([
      [0, "a", "break"],
      [1, "b", "talkup"],
      [2, "c", "segue"],
      [3, "d", "sweeper"],
    ]);
    expect(r.topOfHour).toBe(false);
  });

  it("promotes slot 0 to a break with a fallback", () => {
    const r = checkSegmentLog([slot("a", "talkup"), ...valid.slice(1)], cards, {
      first: true,
      hourTurned: false,
    });
    expect(r.slots[0]?.intro).toBe("break");
    expect(r.fallbacks).toEqual([
      { seq: 0, from: "talkup", to: "break", reason: "the first slot is the break" },
    ]);
  });

  it("a second break becomes a sweeper: one break per segment", () => {
    const r = checkSegmentLog([slot("a", "break"), slot("b", "break")], cards, {
      first: false,
      hourTurned: false,
    });
    expect(r.slots[1]?.intro).toBe("sweeper");
    expect(r.fallbacks[0]).toMatchObject({ seq: 1, from: "break", to: "sweeper" });
  });

  it("a talk-up under 7 s becomes a segue, with the reason", () => {
    const short = new Map(cards).set("b", card("b", MIN_TALKUP_INTRO_MS - 1000));
    const r = checkSegmentLog(valid, short, { first: false, hourTurned: false });
    expect(r.slots[1]?.intro).toBe("segue");
    expect(r.fallbacks).toEqual([
      {
        seq: 1,
        from: "talkup",
        to: "segue",
        reason: `${MIN_TALKUP_INTRO_MS - 1000} ms intro is under 7000 ms`,
      },
    ]);
    const none = checkSegmentLog(valid, new Map(), { first: false, hourTurned: false });
    expect(none.fallbacks[0]).toMatchObject({ seq: 1, to: "segue", reason: "no card" });
  });

  it("topOfHour on the opening and when the hour turned", () => {
    expect(checkSegmentLog(valid, cards, { first: true, hourTurned: false }).topOfHour).toBe(true);
    expect(checkSegmentLog(valid, cards, { first: false, hourTurned: true }).topOfHour).toBe(true);
    expect(checkSegmentLog(valid, cards, { first: false, hourTurned: false }).topOfHour).toBe(false);
  });
});

describe("hourTurnedBetween", () => {
  const at = (h: number, m: number, d = 30) => Date.UTC(2026, 7, d, h, m);
  it("is true across 10:59 → 11:00", () => {
    expect(hourTurnedBetween(at(10, 59), at(11, 0))).toBe(true);
  });
  it("is false inside the hour", () => {
    expect(hourTurnedBetween(at(10, 10), at(10, 50))).toBe(false);
  });
  it("is true across midnight", () => {
    expect(hourTurnedBetween(at(23, 59), at(0, 1, 31))).toBe(true);
  });
  it("is false when the clock didn't move forward", () => {
    expect(hourTurnedBetween(at(11, 0), at(10, 59))).toBe(false);
  });
});

describe("layBreaks", () => {
  const sizes = (count: number) => {
    const b = layBreaks(count);
    return b.map((start, i) => (b[i + 1] ?? count) - start);
  };
  it.each([6, 7, 10, 11, 13, 14])("%i records: every segment holds 3–5", (n) => {
    const s = sizes(n);
    expect(s.reduce((a, b) => a + b, 0)).toBe(n);
    for (const size of s) {
      expect(size).toBeGreaterThanOrEqual(SEGMENT_MIN);
      expect(size).toBeLessThanOrEqual(SEGMENT_MAX);
    }
    expect(layBreaks(n)[0]).toBe(0);
  });
  it("lays them every four when it divides", () => {
    expect(layBreaks(8)).toEqual([0, 4]);
    expect(layBreaks(12)).toEqual([0, 4, 8]);
  });
  it("folds a short tail", () => {
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(13)).toEqual([5, 4, 4]);
  });
  it("is empty for nothing", () => {
    expect(layBreaks(0)).toEqual([]);
  });
});
