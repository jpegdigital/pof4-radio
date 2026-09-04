import { describe, expect, it } from "vitest";
import { dedupe, searchQuery } from "./fill";

/** The pure half of the fill: what Qobuz is asked, and which proposals never become slots. */

describe("searchQuery — the proposal as Qobuz hears it", () => {
  it.each([
    { give: ["Ariana Grande", "Break Free"], want: "Ariana Grande Break Free", id: "plain" },
    { give: ["Zedd", "Clarity (feat. Foxes)"], want: "Zedd Clarity", id: "feat in parentheses" },
    {
      give: ["Calvin Harris", "Outside [ft. Ellie Goulding]"],
      want: "Calvin Harris Outside",
      id: "ft in brackets",
    },
    {
      give: ["Ariana Grande", "Break Free (with Zedd)"],
      want: "Ariana Grande Break Free",
      id: "with",
    },
    {
      give: ["Don Henley", "The Boys of Summer (Remastered)"],
      want: "Don Henley The Boys of Summer (Remastered)",
      id: "a version tag stays",
    },
    { give: ["  Kesha ", " Die Young "], want: "Kesha Die Young", id: "trimmed" },
  ])("$id", ({ give: [artist, title], want }) => {
    expect(searchQuery(artist, title)).toBe(want);
  });
});

describe("dedupe — a title already in the show is never proposed again", () => {
  const p = (artist: string, title: string) => ({ artist, title, why: "w" });

  it("keeps everything new, in order, with nothing dropped", () => {
    const out = dedupe([p("A", "One"), p("B", "Two")], []);
    expect(out.kept).toEqual([p("A", "One"), p("B", "Two")]);
    expect(out.dropped).toEqual([]);
  });

  it.each<{
    id: string;
    give: { artist: string; title: string; why: string }[];
    taken: { artist: string; title: string }[];
    kept: string[];
    dropped: number;
  }>([
    {
      id: "one already played",
      give: [p("A", "One"), p("B", "Two")],
      taken: [{ artist: "A", title: "One" }],
      kept: ["Two"],
      dropped: 1,
    },
    {
      id: "case and spacing do not hide a repeat",
      give: [p("fleetwood mac", "  DREAMS ")],
      taken: [{ artist: "Fleetwood Mac", title: "Dreams" }],
      kept: [],
      dropped: 1,
    },
    {
      id: "the same title by another artist is new",
      give: [p("The Corrs", "Dreams")],
      taken: [{ artist: "Fleetwood Mac", title: "Dreams" }],
      kept: ["Dreams"],
      dropped: 0,
    },
    {
      id: "a proposal repeated within the same fill is kept once",
      give: [p("A", "One"), p("A", "One"), p("B", "Two")],
      taken: [],
      kept: ["One", "Two"],
      dropped: 1,
    },
  ])("$id", ({ give, taken, kept, dropped }) => {
    const out = dedupe(give, taken);
    expect(out.kept.map((k) => k.title)).toEqual(kept);
    expect(out.dropped).toHaveLength(dropped);
  });

  it("names the repeat in the dropped line", () => {
    expect(dedupe([p("A", "One")], [{ artist: "A", title: "One" }]).dropped[0]).toMatch(/A — One/);
  });
});
