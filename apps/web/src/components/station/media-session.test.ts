import { describe, expect, it } from "vitest";
import { lockScreen } from "./media-session.ts";

describe("lockScreen", () => {
  it("names a track by its tags and carries the album art", () => {
    expect(
      lockScreen({
        kind: "track",
        name: "Texas Sun",
        artists: ["Khruangbin", "Leon Bridges"],
        album: "Texas Sun",
        image: "https://i.scdn.co/image/abc",
        playback: { paused: false, position: 0, duration: 1, at: 0 },
      }),
    ).toEqual({
      title: "Texas Sun",
      artist: "Khruangbin, Leon Bridges",
      album: "Texas Sun",
      artwork: [{ src: "https://i.scdn.co/image/abc" }],
    });
  });

  it("puts the DJ on the lock screen during a talk, with no art", () => {
    expect(
      lockScreen({ kind: "talk", dj: "Nova", initial: "N", seq: 2, excerpt: "That was…", playback: null }),
    ).toEqual({ title: "Nova on the mic", artist: "That was…", album: "Radio", artwork: [] });
  });

  it("says what the DJ is doing while planning", () => {
    expect(lockScreen({ kind: "planning", dj: "Nova" })).toEqual({
      title: "Nova is producing…",
      artist: "",
      album: "Radio",
      artwork: [],
    });
  });
});
