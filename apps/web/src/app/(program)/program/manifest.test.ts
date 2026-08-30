import { describe, expect, it } from "vitest";
import { clipUrl } from "./manifest";

describe("clipUrl", () => {
  it("puts the maker's clips under /program/make/clips", () => {
    expect(clipUrl("slot-4")).toBe("/program/make/clips/slot-4.mp3");
  });
  it("leaves the bed and the sweepers under /program", () => {
    expect(clipUrl("bed")).toBe("/program/bed.mp3");
    expect(clipUrl("sweepers/sweep-hits")).toBe("/program/sweepers/sweep-hits.mp3");
  });
});
