import { describe, expect, it } from "vitest";
import { pickRequest, readPick, type PickInput } from "./pick";

const input: PickInput = {
  prompt: "Play the live version of Song C by Artist C",
  proposal: { title: "Song C", artist: "Artist C", why: "requested" },
  hits: [
    { id: "1", title: "Song C", artists: ["Artist C"], album: "Studio", image: null, durationMs: 200000 },
    {
      id: "2",
      title: "Song C (Live)",
      artists: ["Artist C"],
      album: "Live",
      image: null,
      durationMs: 250000,
    },
  ],
};
const request = () => pickRequest(input, "jev-1.13.0");
const response = (over = {}) => ({
  model: "jev-1.13.0",
  answers: {
    pick: {
      type: "choice",
      choice: "2",
      confidence: 0.9,
      probabilities: { "1": 0.05, "2": 0.9, none: 0.05 },
      ...over,
    },
  },
  usage: { input_tokens: 500, output_tokens: 20 },
});

describe("Jev recording selection", () => {
  it("offers every supplied ID and a no-match option, with the listener request", () => {
    const sent = request();
    expect(sent.state).toEqual(input);
    expect(Object.keys(sent.questions.pick.criteria)).toEqual(["1", "2", "none"]);
    expect(sent.questions.pick.criteria["2"]).toContain("Live");
  });

  it.each([
    { id: "empty hits", hits: [] },
    { id: "duplicate IDs", hits: [input.hits[0], input.hits[0]] },
    { id: "reserved ID", hits: [{ ...input.hits[0], id: "none" }] },
  ])("rejects $id before calling Jev", ({ hits }) => {
    expect(() => pickRequest({ ...input, hits }, "jev-1.13.0")).toThrow();
  });

  it("keeps the model decision and receipt, even when confidence is low", () => {
    const receipt = readPick(request(), response({ confidence: 0.01 }), 12);
    expect(receipt.pick).toBe("2");
    expect(receipt.response.model).toBe("jev-1.13.0");
    expect(receipt.request).toEqual(request());
    expect(receipt.elapsedMs).toBe(12);
  });

  it("accepts rounding in the API distribution without rewriting it", () => {
    const raw = response({ probabilities: { "1": 0.03, "2": 0.93, none: 0.03 } });
    expect(readPick(request(), raw, 1).response.answers.pick.probabilities).toEqual(
      raw.answers.pick.probabilities,
    );
  });

  it("preserves the declared choice instead of recomputing it from rounded probabilities", () => {
    expect(
      readPick(request(), response({ choice: "1", probabilities: { "1": 0.49, "2": 0.5, none: 0.01 } }), 1)
        .pick,
    ).toBe("1");
  });
  it("preserves none for evaluation; it is never turned into a hit", () => {
    expect(
      readPick(request(), response({ choice: "none", probabilities: { "1": 0, "2": 0, none: 1 } }), 1).pick,
    ).toBeNull();
  });

  it("refuses an answer from a model other than the one asked", () => {
    expect(() => readPick(request(), { ...response(), model: "jev-0.0.1" }, 1)).toThrow(/model/i);
  });

  it.each([
    { id: "unknown choice", over: { choice: "999" } },
    { id: "missing choice", over: { choice: undefined } },
    { id: "wrong answer type", over: { type: "score" } },
    { id: "invalid confidence", over: { confidence: 2 } },
    { id: "missing option", over: { probabilities: { "2": 1 } } },
    { id: "unknown option", over: { probabilities: { "1": 0, "2": 0.5, none: 0, x: 0.5 } } },
    { id: "invalid probability", over: { probabilities: { "1": -1, "2": 2, none: 0 } } },
    { id: "invalid sum", over: { probabilities: { "1": 0.1, "2": 0.1, none: 0.1 } } },
  ])("fails on $id without substituting a hit", ({ over }) => {
    expect(() => readPick(request(), response(over), 1)).toThrow();
  });
});
