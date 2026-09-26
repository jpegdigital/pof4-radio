import { describe, expect, it } from "vitest";
import { BEAT_FLOOR, GOLD_MIC, beatStep, grooveFrame, micFrame, newBeat, sceneSize, tempoOf } from "./rhythm";

describe("tempoOf", () => {
  it.each([
    { give: "down" as const, want: 92, id: "slow chart" },
    { give: "mid" as const, want: 112, id: "mid chart" },
    { give: "up" as const, want: 126, id: "fast chart" },
    { give: "unknown" as const, want: 118, id: "unknown chart" },
    { give: undefined, want: 118, id: "no chart" },
  ])("$id", ({ give, want }) => {
    expect(tempoOf(give)).toBe(want);
  });
});

describe("grooveFrame", () => {
  it.each([
    { give: { ms: 0, bpm: 120 }, want: 0, id: "starts on the first frame" },
    { give: { ms: 124, bpm: 120 }, want: 0, id: "holds until an eighth of the loop" },
    { give: { ms: 125, bpm: 120 }, want: 1, id: "eight frames over two beats at 120 bpm" },
    { give: { ms: 999, bpm: 120 }, want: 7, id: "last frame before the loop turns" },
    { give: { ms: 1000, bpm: 120 }, want: 0, id: "loops after two beats" },
    { give: { ms: 250, bpm: 60 }, want: 1, id: "slower tempo, slower frames" },
    { give: { ms: -50, bpm: 120 }, want: 0, id: "a negative clock clamps" },
  ])("$id", ({ give, want }) => {
    expect(grooveFrame(give.ms, give.bpm, 8)).toBe(want);
  });
});

describe("micFrame", () => {
  const { raise, loopFrom, loopTo, raiseMs, talkMs } = GOLD_MIC;
  it.each([
    { give: { talking: true, sinceMs: 0 }, want: 0, id: "the raise starts from the groove pose" },
    { give: { talking: true, sinceMs: raiseMs * 3 }, want: 3, id: "mid-raise" },
    { give: { talking: true, sinceMs: raiseMs * raise }, want: loopFrom, id: "raised: the talk loop begins" },
    {
      give: { talking: true, sinceMs: raiseMs * raise + talkMs * (loopTo - loopFrom) },
      want: loopTo,
      id: "talk loop reaches its far end",
    },
    {
      give: { talking: true, sinceMs: raiseMs * raise + talkMs * (loopTo - loopFrom + 1) },
      want: loopTo - 1,
      id: "and bounces back",
    },
    { give: { talking: false, sinceMs: 0 }, want: loopFrom, id: "lowering starts from the held mic" },
    { give: { talking: false, sinceMs: raiseMs * 2 }, want: loopFrom - 2, id: "mid-lower" },
    { give: { talking: false, sinceMs: raiseMs * raise }, want: null, id: "lowered: back to the groove" },
  ])("$id", ({ give, want }) => {
    expect(micFrame(give.talking, give.sinceMs)).toBe(want);
  });
});

describe("beatStep", () => {
  it("fires on a bass hit over the running level, then holds off", () => {
    let s = newBeat();
    for (let t = 0; t < 1000; t += 16) s = beatStep(s, 0.2, t).state;
    const hit = beatStep(s, 0.6, 1000);
    expect(hit.beat).toBe(true);
    const again = beatStep(hit.state, 0.6, 1050);
    expect(again.beat).toBe(false);
  });

  it("stays quiet under the floor however sharp the rise", () => {
    let s = newBeat();
    for (let t = 0; t < 500; t += 16) s = beatStep(s, 0, t).state;
    expect(beatStep(s, BEAT_FLOOR * 0.9, 500).beat).toBe(false);
  });

  it.each([
    { give: 500, want: 120, id: "hits every half second read as 120" },
    { give: 600, want: 100, id: "hits every 600 ms read as 100" },
    { give: 250, want: 120, id: "double time folds into range" },
    { give: 1200, want: 100, id: "half time folds into range" },
  ])("$id", ({ give, want }) => {
    let s = newBeat();
    let t = 0;
    for (let i = 0; i < 12; i++) {
      for (let q = 0; q < give - 16; q += 16) s = beatStep(s, 0.1, t + q).state;
      t += give;
      s = beatStep(s, 0.8, t).state;
    }
    expect(s.bpm).not.toBeNull();
    expect(Math.round(s.bpm!)).toBe(want);
  });

  it("knows no tempo before it has heard enough", () => {
    const s = beatStep(newBeat(), 0.8, 0).state;
    expect(s.bpm).toBeNull();
  });
});

describe("sceneSize", () => {
  it.each([
    { give: { w: 1920, h: 1080 }, want: { width: 800, height: 450 }, id: "16:9 desktop" },
    { give: { w: 3440, h: 1440 }, want: { width: 1075, height: 450 }, id: "ultrawide widens the world" },
    { give: { w: 390, h: 844 }, want: { width: 360, height: 779 }, id: "a phone keeps the booth, grows sky" },
    { give: { w: 1000, h: 1000 }, want: { width: 450, height: 450 }, id: "square" },
    { give: { w: 0, h: 0 }, want: { width: 800, height: 450 }, id: "unmeasured falls back to 16:9" },
  ])("$id", ({ give, want }) => {
    expect(sceneSize(give.w, give.h)).toEqual(want);
  });
});
