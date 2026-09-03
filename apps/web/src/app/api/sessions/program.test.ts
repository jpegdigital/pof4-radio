import { describe, expect, it } from "vitest";
import { programBrief, type ProgramInput } from "./program";

/** The brief the writer gets: what it carries, and what it leaves out when nothing is known. */

const input = (over: Partial<ProgramInput> = {}): ProgramInput => ({
  prompt: "rainy morning soul",
  dj: "Ada",
  identity: { calls: "WFAI", city: "Dallas", onAir: "56.6, Claude Radio" },
  clock: "7:25 am",
  tracks: [
    { id: "a", name: "Song A", artists: ["Artist A"], album: "A", durationMs: 200_000, why: "opens it" },
    { id: "b", name: "Song B", artists: ["Artist B"], album: "B", durationMs: 180_000, why: "follows" },
  ],
  cards: new Map(),
  legalId: null,
  weather: null,
  headlines: null,
  ...over,
});

describe("programBrief", () => {
  it("carries the weather, and asks for it tight, in the break, now and then today and tonight", () => {
    const brief = programBrief(
      input({
        weather: "Now (7:25 AM): Cloudy, 81°F.\nToday: Storms, high near 93.\nTonight: Low around 76.",
      }),
    );
    expect(brief).toContain("The weather in Dallas right now");
    expect(brief).toContain("Today: Storms, high near 93.");
    expect(brief).toMatch(/one breath/);
    expect(brief).toMatch(/in the break/);
    expect(brief).toMatch(/nowhere else/i);
  });
  it("says nothing of the weather when there is none, so the DJ does not guess", () => {
    const brief = programBrief(input());
    expect(brief).not.toMatch(/weather/i);
  });
  it("carries the headlines, and asks for one or two across the segment, one to a slot, a sentence each", () => {
    const brief = programBrief(
      input({
        headlines:
          "Dallas: Grass fires burn along highways (FOX 4)\nNation: Gloria Steinem dies at 92 (Reuters)",
      }),
    );
    expect(brief).toContain("The headlines right now");
    expect(brief).toContain("Nation: Gloria Steinem dies at 92 (Reuters)");
    expect(brief).toMatch(/one, two at most/);
    expect(brief).toMatch(/never more than one to a slot/);
    expect(brief).toMatch(/single spoken sentence/);
  });
  it("says nothing of headlines when there are none", () => {
    expect(programBrief(input())).not.toMatch(/headline/i);
  });
  it("keeps the rest of the brief regardless", () => {
    for (const w of [null, "Now: Clear."]) {
      const brief = programBrief(input({ weather: w, headlines: w && "Dallas: A headline (Source)" }));
      expect(brief).toContain("The listener's request: rainy morning soul");
      expect(brief).toContain("The clock: 7:25 am");
      expect(brief).toContain("1. Artist A — Song A (200 s)");
      expect(brief).toContain("2 records in play order");
    }
  });
});
