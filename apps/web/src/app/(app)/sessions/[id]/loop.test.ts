import { describe, expect, it } from "vitest";
import { nextMove } from "./loop";

/**
 * The frontier, pure: from the slots as the page holds them, the clock, the cue in the deck and
 * what has been attempted this page life, the one call to make now — a fill, a slot, or nothing.
 */

type Status = "proposed" | "written" | "voiced";
const slots = (...statuses: Status[]) => statuses.map((status, i) => ({ seq: i + 1, status }));
const clock = { breakEvery: 5, fill: 6, lowWater: 2 };
const none = new Set<string>();

describe("nextMove — the fill", () => {
  it("no slots at all → fill, keyed by the slot count", () => {
    expect(nextMove([], clock, null, none)).toEqual({ kind: "fill", key: "fill:0" });
  });

  it("proposed slots down to the low-water mark → fill", () => {
    expect(
      nextMove(slots("voiced", "voiced", "voiced", "voiced", "proposed", "proposed"), clock, 4, none),
    ).toEqual({
      kind: "fill",
      key: "fill:6",
    });
  });

  it("the same fill attempted once → falls through to the slot rule", () => {
    expect(
      nextMove(
        slots("voiced", "voiced", "voiced", "voiced", "proposed", "proposed"),
        clock,
        4,
        new Set(["fill:6"]),
      ),
    ).toEqual({ kind: "slot", seq: 5, key: "slot:5" });
  });

  it("a written-not-voiced slot does not count as pending", () => {
    // 3 voiced, 1 written, 2 proposed: the unwritten count is 2 → fill
    expect(
      nextMove(slots("voiced", "voiced", "voiced", "written", "proposed", "proposed"), clock, 3, none)?.kind,
    ).toBe("fill");
  });

  it("fill takes precedence over the slot when both apply", () => {
    expect(nextMove(slots("proposed"), clock, null, none)).toEqual({ kind: "fill", key: "fill:1" });
  });

  it("no fill attempted at this count, but one at another count → still fills", () => {
    expect(nextMove([], clock, null, new Set(["fill:6"]))).toEqual({ kind: "fill", key: "fill:0" });
  });
});

describe("nextMove — the slot, one ahead of the cue", () => {
  it("six proposed and nothing playing → slot 1", () => {
    expect(nextMove(slots(...Array<Status>(6).fill("proposed")), clock, null, none)).toEqual({
      kind: "slot",
      seq: 1,
      key: "slot:1",
    });
  });

  it("slot 1 voiced and nothing playing → nothing (slot 2 waits for play)", () => {
    expect(nextMove(slots("voiced", ...Array<Status>(5).fill("proposed")), clock, null, none)).toBeNull();
  });

  it("slot 1 voiced and in the deck → slot 2", () => {
    expect(nextMove(slots("voiced", ...Array<Status>(5).fill("proposed")), clock, 1, none)).toEqual({
      kind: "slot",
      seq: 2,
      key: "slot:2",
    });
  });

  it("slots 1–2 voiced, slot 1 in the deck → nothing (one ahead only)", () => {
    expect(
      nextMove(slots("voiced", "voiced", ...Array<Status>(4).fill("proposed")), clock, 1, none),
    ).toBeNull();
  });

  it("slot 1 written but not voiced (the voicing failed) → slot 1 again", () => {
    expect(nextMove(slots("written", ...Array<Status>(5).fill("proposed")), clock, null, none)).toEqual({
      kind: "slot",
      seq: 1,
      key: "slot:1",
    });
  });

  it("the same slot attempted once → nothing until a reload", () => {
    expect(
      nextMove(slots("written", ...Array<Status>(5).fill("proposed")), clock, null, new Set(["slot:1"])),
    ).toBeNull();
  });

  it("the cue far ahead of a gap → the first unvoiced slot, wherever it is", () => {
    expect(
      nextMove(slots("voiced", "written", "voiced", "proposed", "proposed", "proposed"), clock, 3, none),
    ).toEqual({
      kind: "slot",
      seq: 2,
      key: "slot:2",
    });
  });

  it("everything voiced → nothing", () => {
    expect(nextMove(slots("voiced", "voiced", "voiced"), clock, 3, new Set(["fill:3"]))).toBeNull();
  });
});
