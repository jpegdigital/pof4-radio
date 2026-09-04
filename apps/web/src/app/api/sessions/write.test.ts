import { describe, expect, it } from "vitest";
import { clockOf, legalIdOf, type WriteInput, writeBrief } from "./write";

/** The brief the writer gets for one slot: what it carries, and what it leaves out. */

const input = (over: Partial<WriteInput> = {}): WriteInput => ({
  prompt: "rainy morning soul",
  dj: "Ada",
  identity: { calls: "WFAI", city: "Dallas", onAir: "56.6, Claude Radio" },
  clock: "7:25 am",
  seq: 3,
  clockSaysBreak: false,
  proposal: { title: "Song C", artist: "Artist C", why: "follows the mood" },
  hits: [
    { id: "c1", title: "Song C", artists: ["Artist C"], album: "Album C", image: null, durationMs: 200_000 },
    {
      id: "c2",
      title: "Song C (Live)",
      artists: ["Artist C"],
      album: "Live",
      image: null,
      durationMs: 250_000,
    },
  ],
  recent: [
    {
      seq: 1,
      kind: "break",
      words: "Good morning.",
      leadLine: "Here is A.",
      title: "Song A",
      artist: "Artist A",
    },
    { seq: 2, kind: "segue", words: null, leadLine: null, title: "Song B", artist: "Artist B" },
  ],
  played: [
    { title: "Song A", artist: "Artist A" },
    { title: "Song B", artist: "Artist B" },
  ],
  priorCharts: [],
  legalId: null,
  weather: null,
  headlines: null,
  ...over,
});

describe("writeBrief — the slot", () => {
  it("carries the ask, the clock, the proposal and every hit as a numbered menu with its length", () => {
    const brief = writeBrief(input());
    expect(brief).toContain("The listener's request: rainy morning soul");
    expect(brief).toContain("The clock: 7:25 am");
    expect(brief).toContain("Artist C — Song C");
    expect(brief).toContain("follows the mood");
    expect(brief).toContain("c1 | Song C — Artist C | Album C | 3:20");
    expect(brief).toContain("c2 | Song C (Live) — Artist C | Live | 4:10");
  });

  it("says this slot is the break when the clock says so, and asks for the lead line", () => {
    const brief = writeBrief(input({ clockSaysBreak: true }));
    expect(brief).toMatch(/this slot is the break/i);
    expect(brief).toMatch(/lead line/);
  });

  it("says this slot is not a break otherwise", () => {
    expect(writeBrief(input())).toMatch(/not a break/i);
  });
});

describe("writeBrief — what came before", () => {
  it("carries the last slots' copy in order and everything played", () => {
    const brief = writeBrief(input());
    expect(brief).toContain("Good morning.");
    expect(brief).toContain("Here is A.");
    expect(brief.indexOf("Good morning.")).toBeLessThan(brief.indexOf("Song B"));
    expect(brief).toMatch(/played so far/i);
    expect(brief).toContain("Artist A — Song A");
  });

  it("a fresh show says so", () => {
    const brief = writeBrief(input({ seq: 1, recent: [], played: [], clockSaysBreak: true }));
    expect(brief).toMatch(/first slot of the show|nothing has played yet/i);
  });

  it("offers another DJ's chart of a hit as notes, read-only", () => {
    const brief = writeBrief(
      input({
        priorCharts: [
          {
            id: "c1",
            title: "Song C",
            artists: ["Artist C"],
            rampMs: 12_000,
            sure: true,
            post: "the title line",
            outro: "fade",
            outroMs: 180_000,
            energy: 3,
            tempo: "mid",
            mood: "easy",
            words: "Here is one for the rain.",
          },
        ],
      }),
    );
    expect(brief).toMatch(/Another DJ's read of c1/);
    expect(brief).toContain("ramp 12 s (sure)");
    expect(brief).toContain("Here is one for the rain.");
  });
});

describe("writeBrief — the legal ID, the weather, the headlines", () => {
  it("names the legal ID when due and says it is added, not written", () => {
    const brief = writeBrief(input({ clockSaysBreak: true, legalId: "WFAI, Dallas. 56.6, Claude Radio." }));
    expect(brief).toContain('"WFAI, Dallas. 56.6, Claude Radio."');
    expect(brief).toMatch(/do not write it/i);
  });

  it("says no legal ID on a break when not due, and nothing of it on other slots", () => {
    expect(writeBrief(input({ clockSaysBreak: true }))).toMatch(/No legal ID on this break/);
    expect(writeBrief(input())).not.toMatch(/legal ID on this break|said first, dry/);
  });

  it("carries the weather, and asks for it tight, in the break", () => {
    const brief = writeBrief(
      input({
        clockSaysBreak: true,
        weather: "Now (7:25 AM): Cloudy, 81°F.\nToday: Storms, high near 93.\nTonight: Low around 76.",
      }),
    );
    expect(brief).toContain("The weather in Dallas right now");
    expect(brief).toContain("Today: Storms, high near 93.");
    expect(brief).toMatch(/one breath/);
  });

  it("says nothing of the weather or the headlines when there are none", () => {
    const brief = writeBrief(input({ clockSaysBreak: true }));
    expect(brief).not.toMatch(/weather/i);
    expect(brief).not.toMatch(/headline/i);
  });

  it("carries the headlines, and asks for one, a sentence", () => {
    const brief = writeBrief(
      input({
        clockSaysBreak: true,
        headlines: "Dallas: Grass fires burn along highways (FOX 4)\nNation: A headline (Reuters)",
      }),
    );
    expect(brief).toContain("The headlines right now");
    expect(brief).toContain("Nation: A headline (Reuters)");
    expect(brief).toMatch(/single spoken sentence/);
  });
});

describe("clockOf and legalIdOf", () => {
  it.each<[number, string]>([
    [0, "12:00 am"],
    [8 * 3_600_000 + 43 * 60_000, "8:43 am"],
    [12 * 3_600_000, "12:00 pm"],
    [20 * 3_600_000 + 5 * 60_000 + 59_000, "8:05 pm"],
  ])("%i ms → %s", (ms, want) => {
    expect(clockOf(ms)).toBe(want);
  });

  it("the legal ID is the calls, the city, the name on air", () => {
    expect(legalIdOf({ calls: "WFAI", city: "Dallas", onAir: "56.6, Claude Radio" })).toBe(
      "WFAI, Dallas. 56.6, Claude Radio.",
    );
  });
});
