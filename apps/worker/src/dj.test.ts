import { describe, expect, it } from "vitest";
import type { Track } from "@radio/spotify";
import { resolveFinish, userMessage } from "./dj.ts";

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
]);

describe("resolveFinish", () => {
  it("resolves ids the DJ saw, in order", () => {
    const r = resolveFinish({ intro: "hi", track_ids: ["c", "a", "b"], outro: "bye" }, seen);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.tracks.map((t) => t.uri)).toEqual(["spotify:track:c", "spotify:track:a", "spotify:track:b"]);
  });

  it("rejects an id that never came back from search", () => {
    const r = resolveFinish({ intro: "hi", track_ids: ["a", "zzz", "b"], outro: "bye" }, seen);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("zzz");
  });

  it("rejects duplicates and empty commentary", () => {
    expect(resolveFinish({ intro: "hi", track_ids: ["a", "a", "b"], outro: "bye" }, seen).ok).toBe(false);
    expect(resolveFinish({ intro: " ", track_ids: ["a", "b", "c"], outro: "bye" }, seen).ok).toBe(false);
  });
});

describe("userMessage", () => {
  it("says so when nothing has played", () => {
    expect(userMessage({ listenerPrompt: "rainy jazz", recentlyPlayed: [] })).toContain("first segment");
  });
});
