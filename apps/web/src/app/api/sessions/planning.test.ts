import { describe, expect, it } from "vitest";
import { chartRequest, readChart, mixRequest, readMix, type PlanningInput } from "./planning";
const input: PlanningInput = {
  prompt: "warm evening radio",
  seq: 2,
  clockSaysBreak: false,
  stationName: "56.6, Claude Radio",
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
const chart = (post = "3") => {
  const req = chartRequest(input, "jev-1.13.0");
  return readChart(
    req,
    response(req, { post, ending: "fade_10", energy: "3", tempo: "mid", mood: "warm" }),
    100,
  );
};
describe("Jev post and delivery decisions", () => {
  it("asks for a per-second finish point separately from delivery", () => {
    const req = chartRequest(input, "jev-1.13.0");
    expect(Object.keys(req.questions)).toEqual(["post", "ending", "energy", "tempo", "mood"]);
    expect(Object.keys(req.questions.post.criteria)).toEqual(["0", "1", "2", "3", "4", "5", "beyond_5"]);
    expect(chart().chart).toMatchObject({ postTiming: "3", rampMs: 3000, sure: false, outroMs: 190000 });
  });
  it("filters impossible posts for short recordings", () => {
    const req = chartRequest({ ...input, hit: { ...input.hit, durationMs: 3000 } }, "jev-1.13.0");
    expect(Object.keys(req.questions.post.criteria)).toEqual(["0", "1", "2"]);
  });
  it("a zero post offers music or a dry station sweeper, never overlapping speech", () => {
    const req = mixRequest(input, chart("0"), "jev-1.13.0");
    expect(Object.keys(req.state.actions)).toEqual(["segue", "sweeper"]);
    expect(readMix(req, response(req, { action: "sweeper" }), 1).plan).toMatchObject({
      kind: "sweeper",
      fixedWords: "56.6, Claude Radio.",
    });
  });
  it.each(["1", "2", "3", "4", "5"])(
    "post %s carries an alignment target and starts the voice at zero",
    (post) => {
      const req = mixRequest(input, chart(post), "jev-1.13.0");
      const plan = readMix(req, response(req, { action: "station" }), 1).plan;
      expect(plan).toMatchObject({
        finishAtMs: Number(post) * 1000,
        voiceInMs: 0,
        fixedWords: "56.6, Claude Radio.",
        copyStyle: "station",
      });
      expect(Object.values(req.state.actions).every((a) => a.copyStyle !== "identify")).toBe(true);
    },
  );
  it("keeps a long opening to a five-second thought without pretending the post is at five", () => {
    const req = mixRequest(input, chart("beyond_5"), "jev-1.13.0");
    const plan = readMix(req, response(req, { action: "talkup" }), 1).plan;
    expect(plan).toMatchObject({ voiceInMs: 0, talkOverMs: 5000, wordsMax: 9 });
    expect(plan.finishAtMs).toBeUndefined();
    expect(plan.chart.postTiming).toBe("beyond_5");
  });
  it("gives very short posts a fixed tag, and longer ones an optional brief thought", () => {
    expect(mixRequest(input, chart("2"), "jev-1.13.0").state.actions).not.toHaveProperty("talkup");
    const req = mixRequest(input, chart("3"), "jev-1.13.0");
    expect(req.state.actions.talkup).toMatchObject({ wordsMin: 3, wordsMax: 5 });
  });
  it("passes recent copy to Jev and avoids consecutive identical station tags", () => {
    const recent = [{ title: "Previous", artist: "Artist", kind: "talkup", words: "56.6, Claude Radio." }];
    const req = mixRequest({ ...input, recent }, chart(), "jev-1.13.0");
    expect(req.state.recent).toEqual(recent);
    expect(req.state.actions).not.toHaveProperty("station");
    expect(req.state.actions).not.toHaveProperty("sweeper");
    expect(req.state.actions).toHaveProperty("segue");
  });
  it("keeps scheduled breaks and their budgets, aligning only when overlap is possible", () => {
    const brk = { ...input, clockSaysBreak: true, contentWords: 75 };
    const dry = mixRequest(brk, chart("0"), "jev-1.13.0");
    expect(Object.keys(dry.state.actions)).toEqual(["break_dry"]);
    const req = mixRequest(brk, chart("3"), "jev-1.13.0");
    expect(readMix(req, response(req, { action: "break_post" }), 1).plan).toMatchObject({
      kind: "break",
      finishAtMs: 3000,
      wordsMax: 110,
    });
    const long = mixRequest(brk, chart("beyond_5"), "jev-1.13.0");
    expect(long.state.actions.break_post.recordUnderMs).toBe(5000);
    expect(long.state.actions.break_post.finishAtMs).toBeUndefined();
  });
  it("rejects invalid or declined delivery choices", () => {
    const req = mixRequest(input, chart(), "jev-1.13.0");
    expect(() => readMix(req, response(req, { action: "stop" }), 1)).toThrow(/no suitable/i);
    expect(() => readMix(req, response(req, { action: "invented" }), 1)).toThrow(/invalid/i);
  });
  it("preserves the explicit post choice and rounded probabilities", () => {
    const req = chartRequest(input, "jev-1.13.0");
    const raw = response(req, { post: "3", ending: "cold", energy: "3", tempo: "mid", mood: "warm" });
    raw.answers.post.probabilities = {
      "0": 0.05,
      "1": 0.1,
      "2": 0.15,
      "3": 0.21,
      "4": 0.22,
      "5": 0.17,
      beyond_5: 0.1,
    };
    expect(readChart(req, raw, 1).chart.rampMs).toBe(3000);
  });
  it("rejects missing answers, wrong models and obsolete timing options", () => {
    const req = chartRequest(input, "jev-1.13.0");
    const raw = response(req, { post: "3", ending: "cold", energy: "3", tempo: "mid", mood: "warm" });
    expect(() => readChart(req, { ...raw, model: "different" }, 1)).toThrow(/model/i);
    expect(() => readChart(req, { ...raw, answers: {} }, 1)).toThrow(/answers/i);
    raw.answers.post.choice = "unknown";
    expect(() => readChart(req, raw, 1)).toThrow(/choice/i);
  });
});
