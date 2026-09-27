import { describe, expect, it } from "vitest";
import { aim, BEAMS, cue, type Energy, energyStep, inBreakdown, newEnergy, type Show } from "./lights";

const show = (over: Partial<Show> = {}): Show => ({
  beats: 8.5,
  playing: true,
  talking: false,
  micMs: Number.POSITIVE_INFINITY,
  breakdown: false,
  dropMs: Number.POSITIVE_INFINITY,
  bass: 0.6,
  ...over,
});

/** Feed `bass` every 16 ms from `fromMs` to `toMs`. */
const feed = (state: Energy, bass: number, fromMs: number, toMs: number) => {
  let s = state;
  for (let t = fromMs; t <= toMs; t += 16) s = energyStep(s, bass, t);
  return s;
};

describe("energyStep", () => {
  const groove = feed(newEnergy(), 0.7, 0, 20_000);

  it("learns the room's level from a steady groove", () => {
    expect(groove.room).toBeCloseTo(0.7, 1);
    expect(inBreakdown(groove, 20_000)).toBe(false);
    expect(groove.dropAt).toBeNull();
  });

  it.each([
    { give: { bass: 0.2, ms: 1000 }, want: false, id: "a dip for a beat is not a breakdown" },
    { give: { bass: 0.2, ms: 4000 }, want: true, id: "bass gone for bars is" },
    { give: { bass: 0.6, ms: 8000 }, want: false, id: "a slightly quieter groove is still the groove" },
  ])("$id", ({ give, want }) => {
    const s = feed(groove, give.bass, 20_016, 20_000 + give.ms);
    expect(inBreakdown(s, 20_000 + give.ms)).toBe(want);
  });

  it("the bass coming back after a breakdown is the drop", () => {
    const down = feed(groove, 0.15, 20_016, 30_000);
    const back = feed(down, 0.75, 30_016, 31_000);
    expect(back.dropAt).not.toBeNull();
    expect(back.dropAt).toBeGreaterThan(30_000);
    expect(inBreakdown(back, 31_000)).toBe(false);
  });

  it("coming back from a dip too short to be a breakdown is no drop", () => {
    const dip = feed(groove, 0.15, 20_016, 21_000);
    expect(feed(dip, 0.75, 21_016, 22_000).dropAt).toBeNull();
  });

  it("a record that stays quiet long enough becomes the new normal", () => {
    const quiet = feed(groove, 0.2, 20_016, 50_000);
    expect(inBreakdown(quiet, 50_000)).toBe(false);
    expect(quiet.room).toBeCloseTo(0.2, 1);
  });

  it("silence is never a breakdown to drop from", () => {
    const s = feed(feed(newEnergy(), 0, 0, 10_000), 0.7, 10_016, 11_000);
    expect(s.dropAt).toBeNull();
  });
});

describe("aim", () => {
  it.each(BEAMS)("%s: every fixture has a finite angle", (beams) => {
    for (let i = 0; i < 6; i++) expect(Number.isFinite(aim(beams, i, 6, 3.3, 0.2))).toBe(true);
  });

  it.each([
    { give: "fan" as const, id: "the fan opens both ways alike" },
    { give: "tunnel" as const, id: "the tunnel closes both ways alike" },
    { give: "rest" as const, id: "at rest the rig hangs even" },
  ])("$id", ({ give }) => {
    for (let i = 0; i < 6; i++) expect(aim(give, i, 6, 2.7, 0)).toBeCloseTo(-aim(give, 5 - i, 6, 2.7, 0), 6);
  });

  it("cross: neighbours point opposite ways", () => {
    expect(Math.sign(aim("cross", 0, 6, 1, 0))).toBe(-Math.sign(aim("cross", 1, 6, 1, 0)));
  });

  it("sweep: the whole rig as one", () => {
    expect(aim("sweep", 0, 6, 1.5, 0)).toBe(aim("sweep", 5, 6, 1.5, 0));
  });

  it("tunnel: the outside fixtures point in", () => {
    expect(aim("tunnel", 0, 6, 0, 0)).toBeGreaterThan(0);
    expect(aim("tunnel", 5, 6, 0, 0)).toBeLessThan(0);
  });

  it("follow: every fixture on the DJ", () => {
    for (let i = 0; i < 6; i++) expect(aim("follow", i, 6, 3, 0.4)).toBeCloseTo(0.4, 1);
  });
});

describe("cue", () => {
  it("stopped: the rig dark and still, no effects", () => {
    const c = cue(show({ playing: false }));
    expect(c.beams).toBe("rest");
    expect(c.level).toBeLessThan(0.3);
    expect(c.pyro + c.co2 + c.confetti + c.strobe + c.blinders).toBe(0);
  });

  it("on the mic: every head on the DJ, warm, the phones up, no effects", () => {
    const c = cue(show({ talking: true, micMs: 3000 }));
    expect(c.beams).toBe("follow");
    expect(c.phones).toBe(1);
    expect(c.pyro + c.co2 + c.strobe).toBe(0);
  });

  it("the drop: everything at once", () => {
    const c = cue(show({ dropMs: 100, beats: 64.2 }));
    expect(c).toMatchObject({ level: 1, pyro: 1, co2: 1 });
    expect(c.blinders).toBeGreaterThan(0.5);
    expect(c.confetti).toBeGreaterThan(0.9);
    expect(c.hands).toBe(1);
  });

  it("the mic closing is a drop too", () => {
    expect(cue(show({ micMs: 200 })).co2).toBe(1);
  });

  it.each([
    { give: 300, want: { pyro: 1 }, id: "flames on the drop" },
    { give: 1400, want: { pyro: 0, co2: 1 }, id: "the flames out, the CO2 still blasting" },
    { give: 4000, want: { co2: 0 }, id: "then the confetti alone" },
  ])("after the drop: $id", ({ give, want }) => {
    expect(cue(show({ dropMs: give, beats: 66.5 }))).toMatchObject(want);
  });

  it("the confetti settles", () => {
    expect(cue(show({ dropMs: 1000 })).confetti).toBeGreaterThan(cue(show({ dropMs: 4000 })).confetti);
    expect(cue(show({ dropMs: 20_000 })).confetti).toBe(0);
  });

  it("the breakdown: slow, no effects, the phones out", () => {
    const c = cue(show({ breakdown: true, beats: 4.5 }));
    expect(c.beams).toBe("wave");
    expect(c.pyro + c.co2 + c.strobe).toBe(0);
    expect(c.phones).toBeGreaterThan(0.5);
  });

  it("the end of the breakdown's bars rolls the strobe up", () => {
    const early = cue(show({ breakdown: true, beats: 12.05 }));
    const late = cue(show({ breakdown: true, beats: 15.55 }));
    expect(late.strobe).toBeGreaterThan(early.strobe);
  });

  it("the groove changes its look every phrase", () => {
    const looks = [0, 1, 2, 3].map((p) => cue(show({ beats: p * 32 + 8 })));
    expect(new Set(looks.map((c) => c.beams)).size).toBeGreaterThan(1);
    expect(new Set(looks.map((c) => c.colors[0].join())).size).toBeGreaterThan(1);
  });

  it("the last beats of a phrase strobe into the next, and the next hits the blinders", () => {
    expect(cue(show({ beats: 31.05 })).strobe).toBe(1);
    expect(cue(show({ beats: 20.05 })).strobe).toBe(0);
    expect(cue(show({ beats: 32.05 })).blinders).toBeGreaterThan(0.5);
  });
});
