import { describe, expect, it } from "vitest";
import { buildUserTurn, DEFAULT_PROMPTS, fillVars, PROMPT_SLOTS, templateFrom } from "./prompt.ts";

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
    const t = buildUserTurn(DEFAULT_PROMPTS, {
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
    const t = buildUserTurn(DEFAULT_PROMPTS, {
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
    const t = buildUserTurn(DEFAULT_PROMPTS, { prompt: "now jazz", previous, promptChanged: true });
    expect(t).toContain("changed the mood to: now jazz");
    expect(t).toContain("On the mic: Claude"); // the default when the browser sends no name
  });

  it("uses an edited slot and leaves the others at their default", () => {
    const template = templateFrom([{ key: "prompt.opening", value: "Go: {request}" }]);
    expect(buildUserTurn(template, { prompt: "soul", previous: null, promptChanged: false })).toBe(
      "Go: soul",
    );
    expect(template["prompt.bridge"]).toBe(DEFAULT_PROMPTS["prompt.bridge"]);
  });
});

describe("fillVars", () => {
  it("fills known placeholders, leaves the rest, skips missing values", () => {
    expect(
      fillVars("{request} / {previous_talk} / {other}", { request: "x", previous_talk: undefined }),
    ).toBe("x / {previous_talk} / {other}");
  });

  it("every default mentions each of its slot's placeholders", () => {
    for (const s of PROMPT_SLOTS) for (const v of s.vars) expect(DEFAULT_PROMPTS[s.key]).toContain(`{${v}}`);
  });
});
