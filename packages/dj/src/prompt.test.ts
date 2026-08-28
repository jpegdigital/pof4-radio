import { describe, expect, it } from "vitest";
import { buildUserTurn } from "./prompt.ts";

const previous = {
  talk: "That was Al Green.",
  tracks: [
    {
      id: "a",
      uri: "spotify:track:a",
      name: "Simply Beautiful",
      artists: ["Al Green"],
      album: "x",
      durationMs: 1,
    },
    {
      id: "b",
      uri: "spotify:track:b",
      name: "A Song for You",
      artists: ["Donny Hathaway"],
      album: "y",
      durationMs: 1,
    },
  ],
};

describe("buildUserTurn", () => {
  it("opens the show on the first segment", () => {
    const t = buildUserTurn({ prompt: "soul", previous: null, promptChanged: false });
    expect(t).toContain("first segment");
    expect(t).not.toContain("previous");
  });

  it("carries the whole previous segment and the skip-safe instruction", () => {
    const t = buildUserTurn({ prompt: "soul", previous, promptChanged: false });
    expect(t).toContain("That was Al Green.");
    expect(t).toContain("1. Al Green — Simply Beautiful");
    expect(t).toContain("2. Donny Hathaway — A Song for You");
    expect(t).toContain("may have skipped");
    expect(t).not.toContain("changed the mood");
  });

  it("announces a prompt change", () => {
    const t = buildUserTurn({ prompt: "now jazz", previous, promptChanged: true });
    expect(t).toContain("changed the mood to: now jazz");
  });
});
