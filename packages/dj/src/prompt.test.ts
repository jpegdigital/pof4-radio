import { describe, expect, it } from "vitest";
import { buildUserTurn, fillVars, type PromptTemplate, templateFrom } from "./prompt.ts";

/** A stand-in for the `settings` rows — the real text lives only in the database. */
const T: PromptTemplate = {
  "prompt.system": "You are the host.",
  "prompt.opening": "Listener's request: {request}\nOn the mic: {dj}\nThis is the first segment.",
  "prompt.bridge":
    "Listener's request: {request}\nOn the mic: {dj}\n{previous_talk}\n{previous_tracks}\nThe listener may have skipped some of it.",
  "prompt.shift": "The listener changed the mood to: {request}.",
};

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
  it("opens the show on the first segment, signing on as the DJ", () => {
    const t = buildUserTurn(T, {
      prompt: "soul",
      dj: "Guy",
      previous: null,
      promptChanged: false,
    });
    expect(t).toContain("Listener's request: soul");
    expect(t).toContain("first segment");
    expect(t).toContain("On the mic: Guy");
    expect(t).not.toContain("previous");
  });

  it("carries the whole previous segment, the host and the skip-safe instruction", () => {
    const t = buildUserTurn(T, {
      prompt: "soul",
      dj: "Rachelle",
      previous,
      promptChanged: false,
    });
    expect(t).toContain("On the mic: Rachelle");
    expect(t).toContain("That was Al Green.");
    expect(t).toContain("1. Al Green — Simply Beautiful");
    expect(t).toContain("2. Donny Hathaway — A Song for You");
    expect(t).toContain("may have skipped");
    expect(t).not.toContain("changed the mood");
  });

  it("announces a prompt change", () => {
    const t = buildUserTurn(T, { prompt: "now jazz", previous, promptChanged: true });
    expect(t).toContain("changed the mood to: now jazz");
    expect(t).toContain("On the mic: Claude"); // the default when the browser sends no name
  });
});

describe("templateFrom", () => {
  it("builds the template from the rows", () => {
    const rows = Object.entries(T).map(([key, value]) => ({ key, value }));
    expect(templateFrom(rows)).toEqual(T);
  });

  it("refuses a missing or blank slot — there is no text in code to fall back to", () => {
    const rows = Object.entries(T)
      .filter(([key]) => key !== "prompt.shift")
      .map(([key, value]) => ({ key, value }));
    expect(() => templateFrom(rows)).toThrow(/prompt\.shift/);
    expect(() => templateFrom([...rows, { key: "prompt.shift", value: "  " }])).toThrow(/prompt\.shift/);
  });
});

describe("fillVars", () => {
  it("fills known placeholders, leaves the rest, skips missing values", () => {
    expect(
      fillVars("{request} / {previous_talk} / {other}", { request: "x", previous_talk: undefined }),
    ).toBe("x / {previous_talk} / {other}");
  });
});
