import { describe, expect, it } from "vitest";
import { chooseHeadlines, headlineRequest, readHeadlineChoice } from "./headline-choice";
import type { PreparedHeadline } from "../../../lib/prepared";

const now = Date.parse("2026-09-19T20:00:00Z");
const headline = (id: string): PreparedHeadline => ({
  articleId: id,
  storyId: `story-${id}`,
  revision: "v1",
  title: `Concert ${id}`,
  topic: "Dallas music",
  sourceId: "kxt",
  source: "KXT",
  url: `https://kxt.org/${id}`,
  scope: "culture",
  publishedAt: new Date(now - 3600000).toISOString(),
  fetchedAt: new Date(now).toISOString(),
  checkedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 3600000).toISOString(),
  evidence: "A free concert in Dallas.",
  facts: [{ text: "A free concert in Dallas.", quote: "A free concert in Dallas." }],
});
const request = () =>
  headlineRequest(
    { prompt: "Dallas music discoveries", headlines: ["a", "b", "c", "d"].map(headline), history: [], now },
    "jev-1.13.0",
  );
const answer = (choice: string, probabilities: Record<string, number>) => ({
  type: "choice",
  choice,
  confidence: 0.8,
  probabilities,
});
const response = (answers: Record<string, ReturnType<typeof answer>>) => ({
  model: "jev-1.13.0",
  answers,
  usage: { input_tokens: 10, output_tokens: 10 },
});
const answers = (count = "2") => ({
  ranking: answer("headline_1", { headline_0: 0.1, headline_1: 0.5, headline_2: 0.3, headline_3: 0.1 }),
  count: answer(count, { "0": 0.1, "1": 0.2, "2": 0.7 }),
});

describe("Jev headline choices", () => {
  it("asks ranking and count choices over the same prompt, headlines and history", () => {
    const req = request();
    expect(req.state.prompt).toBe("Dallas music discoveries");
    expect(Object.keys(req.questions)).toEqual(["ranking", "count"]);
    expect(Object.keys(req.questions.ranking.criteria)).toEqual([
      "headline_0",
      "headline_1",
      "headline_2",
      "headline_3",
    ]);
    expect(Object.keys(req.questions.count.criteria)).toEqual(["0", "1", "2"]);
    expect(req.questions.ranking.criteria.headline_0).toContain("headlines[0]");
  });
  it.each([
    ["0", []],
    ["1", ["b"]],
    ["2", ["b", "c"]],
  ])("takes the top headlines for count %s", (count, selected) => {
    const result = readHeadlineChoice(request(), response(answers(count as string)), 5);
    expect(result.selected.map((h) => h.articleId)).toEqual(selected);
    expect(result.version).toBe("headlines-2");
    expect(result.response?.usage.input_tokens).toBe(10);
  });
  it("breaks tied ranking probabilities in feed order", () => {
    const result = readHeadlineChoice(
      request(),
      response({
        ...answers(),
        ranking: answer("headline_0", {
          headline_0: 0.25,
          headline_1: 0.25,
          headline_2: 0.25,
          headline_3: 0.25,
        }),
      }),
      5,
    );
    expect(result.selected.map((h) => h.articleId)).toEqual(["a", "b"]);
  });
  it("excludes previously generated stories even when the revision changes or they were never heard", () => {
    const req = headlineRequest(
      {
        prompt: "music",
        headlines: [
          { ...headline("a"), revision: "v2" },
          headline("b"),
          { ...headline("c"), expiresAt: new Date(now).toISOString() },
        ],
        history: [{ ...headline("a"), seq: 1 }],
        now,
      },
      "jev-1.13.0",
    );
    expect(req.state.headlines.map((h) => h.articleId)).toEqual(["b", "c"]);
    expect(req.state.history).toHaveLength(1);
  });
  it("deduplicates article and story IDs before building options", () => {
    const req = headlineRequest(
      {
        prompt: "music",
        headlines: [headline("a"), headline("a"), { ...headline("b"), storyId: "story-a" }],
        history: [],
        now,
      },
      "jev-1.13.0",
    );
    expect(req.state.headlines).toHaveLength(1);
    expect(Object.keys(req.questions.count.criteria)).toEqual(["0", "1"]);
    const result = readHeadlineChoice(
      req,
      response({
        ranking: answer("headline_0", { headline_0: 1 }),
        count: answer("1", { "0": 0, "1": 1 }),
      }),
      5,
    );
    expect(result.selected.map((h) => h.articleId)).toEqual(["a"]);
  });
  it("skips the API for an empty menu", async () => {
    const result = await chooseHeadlines(
      { prompt: "music", headlines: [], history: [], now },
      { apiKey: "", model: "jev-1.13.0" },
    );
    expect(result.selected).toEqual([]);
    expect(result.request.questions).toEqual({});
    expect(result.response).toBeNull();
  });
  it.each([
    {},
    { ...answers(), extra: answer("x", { x: 1 }) },
    { ...answers(), ranking: answer("invented", answers().ranking.probabilities) },
    { ...answers(), ranking: answer("headline_0", { headline_0: 1 }) },
    {
      ...answers(),
      ranking: answer("headline_0", { headline_0: 0.1, headline_1: 0.1, headline_2: 0.1, headline_3: 0.1 }),
    },
    { ...answers(), count: answer("3", { "0": 0, "1": 0, "2": 1 }) },
    { ...answers(), count: answer("2", { "0": 0, "1": 0, "2": 1, "3": 0 }) },
  ])("refuses missing, invented or malformed model answers: %j", (invalid) => {
    expect(() => readHeadlineChoice(request(), response(invalid), 5)).toThrow();
  });
});
