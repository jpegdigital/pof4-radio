import { describe, expect, it } from "vitest";
import { MOVES, moveAt, nod, pose, type Stage, TALK_STEP, talkFrame } from "./dance";

const stage = (over: Partial<Stage> = {}): Stage => ({
  t: 0,
  beats: 0,
  playing: true,
  talking: false,
  micMs: Number.POSITIVE_INFINITY,
  voice: 0,
  syllable: 0,
  syllables: 0,
  phrase: 0,
  bass: 0.5,
  ...over,
});

describe("nod", () => {
  it.each([
    { give: 0, want: 0, id: "the head is up as the beat lands" },
    { give: 0.1, want: 1, id: "and all the way down a moment after" },
    { give: 0.55, want: 0.25, id: "coming back up slower than it went down" },
    { give: 0.9999, want: 0, id: "up again for the next one" },
    { give: 3.1, want: 1, id: "every beat alike" },
  ])("$id", ({ give, want }) => {
    expect(nod(give)).toBeCloseTo(want, 2);
  });
});

describe("moveAt", () => {
  it.each([
    {
      give: { who: "gold" as const, beats: 0 },
      want: { move: "nod", from: "nod" },
      id: "gold opens on a nod",
    },
    {
      give: { who: "gold" as const, beats: 16.5 },
      want: { move: "sway", from: "nod" },
      id: "sixteen beats on, the next move",
    },
    {
      give: { who: "silver" as const, beats: 0 },
      want: { move: "sway", from: "sway" },
      id: "silver opens on its own move",
    },
    {
      give: { who: "silver" as const, beats: 8.2 },
      want: { move: "dig", from: "sway" },
      id: "silver changes half a section off gold",
    },
  ])("$id", ({ give, want }) => {
    const at = moveAt(give.who, give.beats);
    expect({ move: at.move, from: at.from }).toEqual(want);
  });

  it("blends into a new move over its first beat", () => {
    expect(moveAt("gold", 16).blend).toBe(0);
    expect(moveAt("gold", 16.5).blend).toBeGreaterThan(0);
    expect(moveAt("gold", 17).blend).toBe(1);
  });

  it("every move in the book is danceable", () => {
    for (const move of Object.values(MOVES)) {
      const body = move(0.1);
      for (const v of Object.values(body)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("talkFrame", () => {
  it.each([
    { give: { voice: 0, syllables: 3, phrase: 0 }, want: 7, id: "between words, the held mic" },
    { give: { voice: 0, syllables: 3, phrase: 1 }, want: 12, id: "the next phrase's rest pose" },
    { give: { voice: 0.6, syllables: 0, phrase: 0 }, want: 8, id: "speaking: a mouth per syllable" },
    { give: { voice: 0.6, syllables: 1, phrase: 0 }, want: 10, id: "the next syllable, another" },
  ])("$id", ({ give, want }) => {
    expect(talkFrame(give.voice, give.syllables, give.phrase)).toBe(want);
  });
});

describe("pose", () => {
  it("stopped: both breathe on the groove sheet's first cell", () => {
    for (const who of ["gold", "silver"] as const) {
      const p = pose(who, stage({ playing: false, t: 3 }));
      expect(p.sheet).toBe("groove");
      expect(p.frame).toBe(0);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it("playing: the head drops on the beat", () => {
    const up = pose("gold", stage({ beats: 4 }));
    const down = pose("gold", stage({ beats: 4.1 }));
    expect(down.headY).toBeGreaterThan(up.headY);
  });

  it("the two never dance the same body at once", () => {
    const beats = [0.1, 2.3, 5.6, 9.1, 17.4, 30.2];
    const same = beats.filter((b) => {
      const g = pose("gold", stage({ beats: b }));
      const s = pose("silver", stage({ beats: b }));
      return g.lean === s.lean && g.headY === s.headY && g.tilt === s.tilt;
    });
    expect(same.length).toBeLessThan(beats.length);
  });

  it.each([
    { give: 0, want: 0, id: "the mic just opened: not stepped yet" },
    { give: TALK_STEP.ms, want: TALK_STEP.gold, id: "stepped up to the front" },
    { give: TALK_STEP.ms * 10, want: TALK_STEP.gold, id: "and stays there" },
  ])("on the mic, gold steps toward the middle: $id", ({ give, want }) => {
    expect(pose("gold", stage({ talking: true, micMs: give })).x).toBeCloseTo(want, 5);
  });

  it("off the mic, gold steps back", () => {
    expect(pose("gold", stage({ micMs: 0 })).x).toBeCloseTo(TALK_STEP.gold, 5);
    expect(pose("gold", stage({ micMs: TALK_STEP.ms })).x).toBeCloseTo(0, 5);
  });

  it("on the mic, gold holds the mic sheet: raising, then a mouth per syllable", () => {
    expect(pose("gold", stage({ talking: true, micMs: 0 }))).toMatchObject({ sheet: "mic", frame: 0 });
    const talking = pose("gold", stage({ talking: true, micMs: 5000, voice: 0.7, syllables: 1 }));
    expect(talking).toMatchObject({ sheet: "mic", frame: 10 });
  });

  it("a syllable lands with a dip of the head", () => {
    const talk = stage({ talking: true, micMs: 5000, voice: 0.5 });
    const quiet = pose("gold", talk);
    const hit = pose("gold", { ...talk, syllable: 1 });
    expect(hit.headY).toBeGreaterThan(quiet.headY);
  });

  it("while gold talks, silver makes room and turns toward gold", () => {
    const p = pose("silver", stage({ talking: true, micMs: 5000, beats: 3 }));
    expect(p.x).toBeCloseTo(TALK_STEP.silver, 5);
    expect(p.lean).toBeLessThan(0);
    expect(p.tilt).toBeLessThan(0);
  });

  it("the music coming back after the talk hits harder", () => {
    const drop = pose("gold", stage({ beats: 40.1, micMs: 500 }));
    const later = pose("gold", stage({ beats: 40.1 }));
    expect(drop.y).toBeGreaterThan(later.y);
  });
});
