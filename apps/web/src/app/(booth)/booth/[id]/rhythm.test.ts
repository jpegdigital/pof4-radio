import { describe, expect, it } from "vitest";
import {
  BEAT_FLOOR,
  GOLD_MIC,
  beatStep,
  lockBeats,
  micFrame,
  newBeat,
  newSpeech,
  SPEECH_FLOOR,
  sceneSize,
  speechStep,
  tempoOf,
} from "./rhythm";

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

describe("lockBeats", () => {
  it.each([
    { give: { beats: 0, dtMs: 500, bpm: 120, hit: false }, want: 1, id: "a beat per half second at 120" },
    { give: { beats: 2, dtMs: 250, bpm: 60, hit: false }, want: 2.25, id: "a quarter beat at 60" },
    {
      give: { beats: 3.8, dtMs: 0, bpm: 120, hit: true },
      want: 3.9,
      id: "a hit early pulls the count halfway up to the beat",
    },
    { give: { beats: 4.2, dtMs: 0, bpm: 120, hit: true }, want: 4.1, id: "a hit late pulls it halfway back" },
    { give: { beats: 5, dtMs: 0, bpm: 120, hit: true }, want: 5, id: "a hit on the beat leaves it" },
    { give: { beats: 3.8, dtMs: 0, bpm: 120, hit: false }, want: 3.8, id: "no hit, no pull" },
  ])("$id", ({ give, want }) => {
    expect(lockBeats(give.beats, give.dtMs, give.bpm, give.hit)).toBeCloseTo(want, 5);
  });
});

describe("speechStep", () => {
  const run = (levels: [number, number][], from = newSpeech()) => {
    let s = from;
    const onsets: number[] = [];
    for (const [ms, level] of levels) {
      const step = speechStep(s, level, ms);
      if (step.onset) onsets.push(ms);
      s = step.state;
    }
    return { s, onsets };
  };
  const hold = (from: number, to: number, level: number): [number, number][] =>
    Array.from({ length: Math.floor((to - from) / 16) }, (_, i) => [from + i * 16, level]);

  it("hears a syllable when the voice jumps", () => {
    const { onsets, s } = run([...hold(0, 300, 0), ...hold(300, 500, 0.4)]);
    expect(onsets).toEqual([300]);
    expect(s.syllables).toBe(1);
  });

  it("a steady voice is one syllable, not sixty", () => {
    expect(run([...hold(0, 100, 0), ...hold(100, 1100, 0.4)]).onsets).toHaveLength(1);
  });

  it("stays quiet under the floor", () => {
    expect(run([...hold(0, 100, 0), ...hold(100, 400, SPEECH_FLOOR * 0.8)]).onsets).toHaveLength(0);
  });

  it("a pause starts a new phrase; a breath does not", () => {
    const talk = (at: number) => hold(at, at + 200, 0.4);
    const breath = run([...talk(0), ...hold(200, 300, 0), ...talk(300)]);
    expect(breath.s.phrase).toBe(0);
    const pause = run([...talk(0), ...hold(200, 800, 0), ...talk(800)]);
    expect(pause.s.phrase).toBe(1);
  });
});
