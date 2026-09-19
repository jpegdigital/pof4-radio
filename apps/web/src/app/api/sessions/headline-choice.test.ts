import { describe, expect, it } from "vitest";
import { headlineRequest, readHeadlineChoice } from "./headline-choice";
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
const answer = (choice: string, probability: number) => ({
  type: "choice",
  choice,
  confidence: 0.8,
  probabilities: { include: probability, omit: 1 - probability, repeat: 0 },
});
const response = (answers: Record<string, ReturnType<typeof answer>>) => ({
  model: "jev-1.13.0",
  answers,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe("Jev headline choices", () => {
  it("asks one explicit include/omit/repeat choice per eligible option with the prompt and history", () => {
    const req = request();
    expect(req.state.prompt).toBe("Dallas music discoveries");
    expect(Object.keys(req.questions)).toHaveLength(4);
    expect(req.questions.headline_0.criteria).toHaveProperty("omit");
  });
  it("ranks only affirmative choices and keeps at most one", () => {
    const result = readHeadlineChoice(
      request(),
      response({
        headline_0: answer("include", 0.7),
        headline_1: answer("include", 0.9),
        headline_2: answer("include", 0.8),
        headline_3: answer("include", 0.6),
      }),
      5,
    );
    expect(result.selected.map((h) => h.articleId)).toEqual(["b"]);
    expect(result.response?.usage.input_tokens).toBe(10);
  });
  it("does not fill empty slots with rejected options", () => {
    const result = readHeadlineChoice(
      request(),
      response({
        headline_0: answer("omit", 0.2),
        headline_1: answer("omit", 0.1),
        headline_2: answer("omit", 0.3),
        headline_3: answer("omit", 0.2),
      }),
      5,
    );
    expect(result.selected).toEqual([]);
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
  it("refuses missing, invented or malformed model answers", () => {
    expect(() => readHeadlineChoice(request(), response({}), 5)).toThrow();
    expect(() =>
      readHeadlineChoice(
        request(),
        response({
          headline_0: answer("invented", 1),
          headline_1: answer("include", 1),
          headline_2: answer("include", 1),
          headline_3: answer("include", 1),
        }),
        5,
      ),
    ).toThrow();
  });
});
