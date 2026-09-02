import { describe, expect, it } from "vitest";
import { type Candidate, searchQuery, selectTracks } from "./select";

/** A hydrated candidate as the route builds it from a Spotify hit + the pick it answered. */
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: ["Some Artist"],
  album: "Some Album",
  image: "https://img/1",
  durationMs: 230_000,
  pick: 0,
  why: "the propose-stage lead",
  ...over,
});

describe("selectTracks — compose chooses {id, why}, we join the metadata back", () => {
  it("keeps the chosen ids in compose's order, metadata intact, compose's why on top", () => {
    const pool = [cand("a"), cand("b"), cand("c")];
    const out = selectTracks(
      [
        { id: "c", why: "sets the scene" },
        { id: "a", why: "answers it" },
      ],
      pool,
      10,
    );
    expect(out.kept.map((k) => k.id)).toEqual(["c", "a"]);
    expect(out.kept[0]).toMatchObject({ uri: "spotify:track:c", name: "Song c", why: "sets the scene" });
    expect(out.kept[1]?.why).toBe("answers it");
    expect(out.dropped).toEqual([]);
  });

  it.each<{
    id: string;
    choices: { id: string; why: string }[];
    pool: Candidate[];
    max: number;
    kept: string[];
    droppedHas: string;
  }>([
    {
      id: "an id not in the pool is dropped with the id named",
      choices: [
        { id: "a", why: "w" },
        { id: "ghost", why: "w" },
      ],
      pool: [cand("a")],
      max: 10,
      kept: ["a"],
      droppedHas: "ghost",
    },
    {
      id: "a duplicate id is kept once, the repeat dropped",
      choices: [
        { id: "a", why: "w" },
        { id: "b", why: "w" },
        { id: "a", why: "again" },
      ],
      pool: [cand("a"), cand("b")],
      max: 10,
      kept: ["a", "b"],
      droppedHas: "duplicate",
    },
    {
      id: "beyond max is truncated, noted",
      choices: [
        { id: "a", why: "w" },
        { id: "b", why: "w" },
        { id: "c", why: "w" },
      ],
      pool: [cand("a"), cand("b"), cand("c")],
      max: 2,
      kept: ["a", "b"],
      droppedHas: "over the playlist size",
    },
  ])("$id", ({ choices, pool, max, kept, droppedHas }) => {
    const out = selectTracks(choices, pool, max);
    expect(out.kept.map((k) => k.id)).toEqual(kept);
    expect(out.dropped.length).toBeGreaterThan(0);
    expect(out.dropped.join(" ")).toContain(droppedHas);
  });

  it("empty choice → nothing kept, nothing invented", () => {
    const out = selectTracks([], [cand("a")], 10);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual([]);
  });
});

describe("searchQuery — the pick as Spotify hears it", () => {
  it.each([
    { give: ["Ariana Grande", "Break Free"], want: "Break Free artist:Ariana Grande", id: "plain" },
    { give: ["Zedd", "Clarity (feat. Foxes)"], want: "Clarity artist:Zedd", id: "feat in parentheses" },
    {
      give: ["Calvin Harris", "Outside [ft. Ellie Goulding]"],
      want: "Outside artist:Calvin Harris",
      id: "ft in brackets",
    },
    {
      give: ["Ariana Grande", "Break Free (with Zedd)"],
      want: "Break Free artist:Ariana Grande",
      id: "with",
    },
    {
      give: ["Don Henley", "The Boys of Summer (Remastered)"],
      want: "The Boys of Summer (Remastered) artist:Don Henley",
      id: "a version tag stays",
    },
    { give: ["  Kesha ", " Die Young "], want: "Die Young artist:Kesha", id: "trimmed" },
  ])("$id", ({ give: [artist, title], want }) => {
    expect(searchQuery(artist, title)).toBe(want);
  });
});
