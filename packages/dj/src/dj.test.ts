import type { Track } from "@radio/spotify";
import { describe, expect, it } from "vitest";
import { resolveFinish } from "./dj.ts";

const track = (id: string): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: ["Someone"],
  album: "Album",
  images: [],
  durationMs: 200_000,
  explicit: false,
  releaseDate: "1999-01-01",
});

const seen = new Map([
  ["a", track("a")],
  ["b", track("b")],
  ["c", track("c")],
  ["d", track("d")],
  ["e", track("e")],
]);

describe("resolveFinish", () => {
  it("resolves ids the DJ saw, in order", () => {
    const r = resolveFinish({ talk: "hi", track_ids: ["c", "a", "b"] }, seen);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.tracks.map((t) => t.uri)).toEqual(["spotify:track:c", "spotify:track:a", "spotify:track:b"]);
  });

  it("rejects an id that never came back from search", () => {
    const r = resolveFinish({ talk: "hi", track_ids: ["a", "zzz", "b"] }, seen);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("zzz");
  });

  it("rejects the wrong count, duplicates and empty talk", () => {
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "b"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "b", "c", "d", "e"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "a", "b"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: " ", track_ids: ["a", "b", "c"] }, seen).ok).toBe(false);
  });
});
