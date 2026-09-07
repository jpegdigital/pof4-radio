import { describe, expect, it } from "vitest";
import { newsFreeCue, shouldCheckNews } from "./news-playback";
import type { Cue } from "./types";

const cue: Cue = {
  seq: 1,
  status: "voiced",
  title: "Track",
  artist: "Artist",
  why: "",
  kind: "break",
  voiced: true,
  words: "News. Music.",
  legalId: "WFAI Dallas",
  clipKey: "news.mp3",
  pick: { id: "1", title: "Track", artists: ["Artist"], album: "", image: null, durationMs: 180000 },
  news: {
    snapshotId: "s",
    selectedAt: "2026-09-06T18:00:00Z",
    checkedAt: "2026-09-06T18:00:00Z",
    expiresAt: "2026-09-06T18:10:00Z",
    storyId: "s",
    revision: "v",
    topic: "music",
    words: "News.",
    musicWords: "Music.",
    reason: "",
    sources: [],
    fallbackClipKey: "safe.mp3",
  },
};
describe("news playback", () => {
  it("rechecks a retained recording when the listener switches back to live mode", () => {
    const archived = {
      ...cue,
      news: {
        ...cue.news!,
        words: null,
        previous: [{ clipKey: cue.clipKey!, words: cue.words!, at: "2026-09-06T18:00:00Z" }],
      },
    };
    expect(shouldCheckNews(archived, false, 0, 40_000)).toBe(true);
    expect(shouldCheckNews(archived, true, 0, 40_000)).toBe(false);
    expect(shouldCheckNews({ ...archived, clipKey: "safe.mp3" }, false, 0, 40_000)).toBe(false);
  });
  it("requires a live preflight for legacy breaks without receipts", () => {
    expect(shouldCheckNews({ ...cue, news: undefined }, false, 0, 40_000)).toBe(true);
  });
  it("news-free fallback keeps the ID and music but changes the clip", () => {
    expect(newsFreeCue(cue)).toMatchObject({
      words: "Music.",
      legalId: "WFAI Dallas",
      clipKey: "safe.mp3",
      news: { words: null },
    });
  });
  it.each([
    ["live", false, 0, true],
    ["archive", true, 0, false],
    ["voice finished", false, 50_000, false],
  ])("preflight %s", (_, replay, from, want) =>
    expect(shouldCheckNews(cue, replay, from, 40_000)).toBe(want),
  );
});
