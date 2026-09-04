import { describe, expect, it } from "vitest";
import { CLOCK_KEY, Clock } from "./clock";

/** The clock: one settings row, three integers, none optional, none zero. */

describe("Clock — the settings row parses", () => {
  it("is the row named `clock`", () => {
    expect(CLOCK_KEY).toBe("clock");
  });

  it("accepts the defaults", () => {
    expect(Clock.parse({ breakEvery: 5, fill: 6, lowWater: 2 })).toEqual({
      breakEvery: 5,
      fill: 6,
      lowWater: 2,
    });
  });

  it.each<{ id: string; give: object }>([
    { id: "a missing field", give: { breakEvery: 5, fill: 6 } },
    { id: "a zero", give: { breakEvery: 0, fill: 6, lowWater: 2 } },
    { id: "a non-integer", give: { breakEvery: 5, fill: 6.5, lowWater: 2 } },
    { id: "a negative", give: { breakEvery: 5, fill: 6, lowWater: -1 } },
    { id: "a string", give: { breakEvery: "5", fill: 6, lowWater: 2 } },
  ])("rejects $id", ({ give }) => {
    expect(Clock.safeParse(give).success).toBe(false);
  });
});
