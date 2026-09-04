import { describe, expect, it } from "vitest";
import { albumText, dedupe, fillBrief, foundText, searchQuery } from "./fill";

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

describe("fillBrief — the catalog is in the room", () => {
  const identity = { onAir: "The Wave", calls: "KWAV", city: "Anaheim", tagline: "" } as never;
  const base = { prompt: "Rebecca Black's new album, all 12 in order.", dj: null, identity, count: 6 };

  it.each([
    { id: "a fresh show", played: [], pending: [] },
    { id: "a show on the air", played: [{ artist: "A", title: "One" }], pending: [] },
  ])("$id tells the proposer to look up what it is not sure of", ({ played, pending }) => {
    const brief = fillBrief({ ...base, played, pending }, 8);
    expect(brief).toMatch(/search/);
    expect(brief).toMatch(/album/);
    expect(brief).toMatch(/not sure/);
  });

  it("a record named in the ask is played in the catalog's order", () => {
    expect(fillBrief({ ...base, played: [], pending: [] }, 8)).toMatch(/names a record[\s\S]*in its order/);
  });
});

describe("foundText — a search result as the proposer reads it", () => {
  const found = {
    albums: [
      {
        id: "a1",
        title: "Age of the Exhibitionist",
        artist: "Rebecca Black",
        tracks: 12,
        released: "2026-09-04",
        streamable: true,
      },
    ],
    tracks: [
      {
        id: "1",
        title: "Friday",
        artists: ["Rebecca Black"],
        album: "Friday",
        image: null,
        durationMs: 228_000,
        streamable: true,
      },
    ],
    artists: [{ id: "9", name: "Rebecca Black", albums: 53 }],
    playlists: [{ id: "p1", name: "Rebecca Black", tracks: 158, by: "Qobuz" }],
  };

  it("lists every bucket with ids the tools take back", () => {
    const text = foundText(found);
    expect(text).toContain("albums:");
    expect(text).toContain("a1  Rebecca Black — Age of the Exhibitionist (12 tracks, 2026-09-04)");
    expect(text).toContain("tracks:");
    expect(text).toContain("1  Rebecca Black — Friday  (Friday, 3:48)");
    expect(text).toContain("artists:");
    expect(text).toContain("9  Rebecca Black (53 albums)");
    expect(text).toContain("playlists:");
    expect(text).toContain("p1  Rebecca Black (158 tracks, by Qobuz)");
  });

  it("says so when nothing came back", () => {
    expect(foundText({ albums: [], tracks: [], artists: [], playlists: [] })).toBe("nothing found");
  });

  it("leaves out an empty bucket", () => {
    expect(foundText({ ...found, playlists: [], artists: [] })).not.toMatch(/artists:|playlists:/);
  });
});

describe("albumText — a record's tracklist as the proposer reads it", () => {
  it("is the tracks in order, numbered, the artist and record on top", () => {
    const text = albumText(
      {
        id: "a1",
        title: "Age of the Exhibitionist",
        artist: "Rebecca Black",
        tracks: 2,
        released: "2026-09-04",
        streamable: true,
      },
      [
        {
          id: "1",
          title: "Anaheim Star",
          artist: "Rebecca Black",
          disc: 1,
          number: 1,
          durationMs: 166_000,
          streamable: true,
        },
        {
          id: "2",
          title: "Hot Wet Delirious",
          artist: "Rebecca Black",
          disc: 1,
          number: 2,
          durationMs: 200_000,
          streamable: true,
        },
      ],
    );
    expect(text.split("\n")).toEqual([
      "Rebecca Black — Age of the Exhibitionist (2026-09-04), 2 tracks",
      "1. Anaheim Star (2:46)",
      "2. Hot Wet Delirious (3:20)",
    ]);
  });

  it("marks a track the plan cannot play, and a second disc", () => {
    const text = albumText(
      { id: "a1", title: "X", artist: "A", tracks: 2, released: "2000-01-01", streamable: true },
      [
        { id: "1", title: "One", artist: "A", disc: 1, number: 1, durationMs: 60_000, streamable: false },
        { id: "2", title: "Two", artist: "A", disc: 2, number: 1, durationMs: 60_000, streamable: true },
      ],
    );
    expect(text).toContain("1. One (1:00) — not streamable");
    expect(text).toContain("2-1. Two (1:00)");
  });
});
