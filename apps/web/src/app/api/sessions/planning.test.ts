import { describe, expect, it } from "vitest";
import { chartRequest, readChart, mixRequest, readMix, type PlanningInput } from "./planning";
const input: PlanningInput = {
  prompt: "warm evening radio",
  seq: 2,
  clockSaysBreak: false,
  proposal: { title: "Song", artist: "Artist", why: "requested" },
  hit: { id: "one", title: "Song", artists: ["Artist"], album: "Album", image: null, durationMs: 200000 },
  recent: [],
};
const response = (
  request: { questions: Record<string, { criteria: Record<string, string> }> },
  choices: Record<string, string>,
) => ({
  model: "jev-1.13.0",
  usage: { input_tokens: 100, output_tokens: 20 },
  answers: Object.fromEntries(
    Object.entries(request.questions).map(([id, q]) => [
      id,
      {
        type: "choice",
        choice: choices[id],
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(q.criteria).map((option) => [option, option === choices[id] ? 1 : 0]),
        ),
      },
    ]),
  ),
});
const chart = (intro = "10") => {
  const req = chartRequest(input, "jev-1.13.0");
  return readChart(
    req,
    response(req, { intro, ending: "fade_10", energy: "3", tempo: "mid", mood: "warm" }),
    100,
  );
};
describe("Jev chart and mixer decisions", () => {
  it("batches independent chart questions for the exact recording", () => {
    const req = chartRequest(input, "jev-1.13.0");
    expect(Object.keys(req.questions)).toEqual(["intro", "ending", "energy", "tempo", "mood"]);
    expect(req.state.hit.id).toBe("one");
    expect(req.questions.intro.criteria).toHaveProperty("unknown");
    expect(chart().chart).toMatchObject({ rampMs: 10000, sure: false, outro: "fade", outroMs: 190000 });
  });
  it.each(["unknown", "0", "1", "5"])("%s intro permits a two-second talk-up or zero overlap", (intro) => {
    const req = mixRequest(input, chart(intro), "jev-1.13.0");
    const out = readMix(req, response(req, { action: "talkup_after_0_for_2" }), 100);
    expect(out.plan).toMatchObject({ kind: "talkup", voiceInMs: 0, talkOverMs: 2000, wordsMax: 3 });
    expect(readMix(req, response(req, { action: "segue" }), 100).plan.wordsMax).toBe(0);
  });
  it("lets Jev choose break overlap even across an immediate vocal", () => {
    const req = mixRequest({ ...input, clockSaysBreak: true }, chart("0"), "jev-1.13.0");
    const out = readMix(req, response(req, { action: "break_under_2" }), 100);
    expect(out.plan).toMatchObject({ kind: "break", recordUnderMs: 2000, voiceInMs: null, wordsMax: 35 });
    expect(readMix(req, response(req, { action: "break_dry" }), 100).plan.recordUnderMs).toBe(0);
  });
  it("budgets the chosen duration without filling the whole available intro", () => {
    const req = mixRequest(input, chart(), "jev-1.13.0");
    const out = readMix(req, response(req, { action: "talkup_after_1_for_2" }), 100);
    expect(out.plan).toMatchObject({ kind: "talkup", voiceInMs: 1000, talkOverMs: 2000, wordsMax: 3 });
  });
  it("offers a one-word sting and a delayed entry after an opening hit", () => {
    const req = mixRequest(input, chart("0"), "jev-1.13.0");
    expect(readMix(req, response(req, { action: "talkup_after_0_for_1" }), 1).plan.wordsMax).toBe(1);
    expect(readMix(req, response(req, { action: "talkup_after_3_for_2" }), 1).plan.voiceInMs).toBe(3000);
  });
  it("keeps talk-up targets inside the actual track length", () => {
    const req = mixRequest({ ...input, hit: { ...input.hit, durationMs: 4000 } }, chart(), "jev-1.13.0");
    expect(req.questions.action.criteria).toHaveProperty("talkup_after_1_for_2");
    expect(req.questions.action.criteria).not.toHaveProperty("talkup_after_3_for_2");
  });
  it("fails instead of replacing a rejected or invalid action", () => {
    const req = mixRequest(input, chart(), "jev-1.13.0");
    expect(() => readMix(req, response(req, { action: "stop" }), 100)).toThrow(/no suitable/i);
    expect(() => readMix(req, response(req, { action: "invented" }), 100)).toThrow(/invalid/i);
  });
  it("accepts probabilities rounded to two decimals without changing Jev's answer", () => {
    const req = chartRequest(input, "jev-1.13.0");
    const raw = response(req, { intro: "10", ending: "cold", energy: "3", tempo: "mid", mood: "warm" });
    raw.answers.mood.probabilities.warm = 0.64;
    raw.answers.mood.probabilities.bright = 0.24;
    raw.answers.mood.probabilities.calm = 0.04;
    raw.answers.mood.probabilities.dreamy = 0.07;
    expect(readChart(req, raw, 1).response.answers.mood.probabilities.warm).toBe(0.64);
  });
  it("uses Jev's explicit choice even when another reported probability is slightly higher", () => {
    const req = chartRequest(input, "jev-1.13.0");
    const raw = response(req, { intro: "10", ending: "cold", energy: "3", tempo: "mid", mood: "warm" });
    raw.answers.intro.probabilities = {
      "0": 0.04,
      "1": 0.05,
      "5": 0.14,
      "10": 0.21,
      "20": 0.22,
      "30": 0.15,
      "45": 0.03,
      "60": 0.06,
      "90": 0.02,
      "120": 0.02,
      unknown: 0.06,
      instrumental: 0,
    };
    expect(readChart(req, raw, 1).chart.rampMs).toBe(10000);
  });
  it("rejects missing answers, wrong models, and broken distributions", () => {
    const req = chartRequest(input, "jev-1.13.0");
    const raw = response(req, { intro: "10", ending: "cold", energy: "3", tempo: "mid", mood: "warm" });
    expect(() => readChart(req, { ...raw, model: "different" }, 100)).toThrow(/model/i);
    expect(() => readChart(req, { ...raw, answers: {} }, 100)).toThrow(/answers/i);
    raw.answers.intro.probabilities["0"] = 0.5;
    expect(() => readChart(req, raw, 100)).toThrow(/distribution/i);
  });
});
