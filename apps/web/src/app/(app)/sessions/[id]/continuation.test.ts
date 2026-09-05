import { describe, expect, it } from "vitest";
import { canContinue } from "./continuation";

describe("continuing after a track ends", () => {
  it.each([
    { id: "next track arrives after the end", ended: 1, current: 1, paused: false, ready: true, want: true },
    { id: "still preparing the next track", ended: 1, current: 1, paused: false, ready: false, want: false },
    { id: "listener paused while waiting", ended: 1, current: 1, paused: true, ready: true, want: false },
    { id: "listener picked another track", ended: 1, current: 3, paused: false, ready: true, want: false },
    { id: "track has not ended", ended: null, current: 1, paused: false, ready: true, want: false },
    { id: "empty deck", ended: null, current: null, paused: false, ready: true, want: false },
  ])("$id", ({ ended, current, paused, ready, want }) => {
    expect(canContinue(ended, current, paused, ready)).toBe(want);
  });
});
