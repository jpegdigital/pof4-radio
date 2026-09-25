import { describe, expect, it, vi } from "vitest";
import { chooseHeadlines, headlineRequest, readHeadlineChoice } from "./headline-choice";
import type { RawHeadline } from "../../../lib/prepared";

const now = Date.parse("2026-09-24T03:00:00Z");
const headline = (id: string): RawHeadline => ({
  articleId: id,
  storyId: `story-${id}`,
  revision: "v1",
  title: `Story ${id}`,
  sourceId: "kxt",
  source: "KXT",
  url: `https://kxt.org/${id}`,
  scope: "culture",
  publishedAt: new Date(now).toISOString(),
  fetchedAt: new Date(now).toISOString(),
  excerpt: `Source text ${id}`,
});
const input = () => ({ prompt: "Dallas music", headlines: ["a", "b", "c"].map(headline), history: [], now });
function response(req: ReturnType<typeof headlineRequest>, choice: string) {
  return {
    model: req.model,
    answers: {
      selection: {
        type: "choice",
        choice,
        confidence: 0.2,
        probabilities: Object.fromEntries(
          Object.keys(req.questions.selection.criteria).map((key) => [key, key === choice ? 1 : 0]),
        ),
      },
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}
describe("Jev chooses raw headlines", () => {
  it("requires a first headline with the listener's interests and original source text", () => {
    const req = headlineRequest(input(), "jev-1.13.0");
    expect(Object.keys(req.questions)).toEqual(["selection"]);
    expect(Object.keys(req.questions.selection.criteria)).toEqual(["headline_0", "headline_1", "headline_2"]);
    expect(req.state.headlines[0].excerpt).toBe("Source text a");
    expect(req.questions.selection.instructions).toMatch(/AI/);
  });
  it.each([["headline_1", ["b"]]] as const)(
    "obeys the declared choice %s without a confidence gate",
    (choice, expected) => {
      const req = headlineRequest(input(), "jev-1.13.0");
      expect(readHeadlineChoice(req, response(req, choice), 5).selected.map((h) => h.articleId)).toEqual(
        expected,
      );
    },
  );
  it("asks for a complementary second story only after knowing the first", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      const req = JSON.parse(init.body as string) as ReturnType<typeof headlineRequest>;
      if (!req.state.selected.length) return Promise.resolve(Response.json(response(req, "headline_1")));
      expect(req.questions.selection.criteria).toHaveProperty("none");
      expect(req.state.selected.map((h) => h.articleId)).toEqual(["b"]);
      expect(req.state.headlines.map((h) => h.articleId)).toEqual(["a", "c"]);
      return Promise.resolve(Response.json(response(req, "headline_1")));
    });
    const result = await chooseHeadlines(input(), {
      apiKey: "test",
      model: "jev-1.13.0",
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.selected.map((h) => h.articleId)).toEqual(["b", "c"]);
    expect(result.followup?.response).toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("keeps the first story when the optional second choice is none", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve(
        Response.json(
          response(
            JSON.parse(init.body as string) as ReturnType<typeof headlineRequest>,
            (JSON.parse(init.body as string) as ReturnType<typeof headlineRequest>).state.selected.length
              ? "none"
              : "headline_0",
          ),
        ),
      ),
    );
    expect(
      (
        await chooseHeadlines(input(), {
          apiKey: "test",
          model: "jev-1.13.0",
          fetchFn: fetchFn as typeof fetch,
        })
      ).selected,
    ).toEqual([headline("a")]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    fetchFn.mockClear();
    expect(
      (
        await chooseHeadlines(
          { ...input(), headlines: [] },
          { apiKey: "test", model: "jev-1.13.0", fetchFn: fetchFn as typeof fetch },
        )
      ).selected,
    ).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("deduplicates by article and story and excludes already reserved stories", () => {
    const req = headlineRequest(
      {
        ...input(),
        headlines: [headline("a"), headline("a"), { ...headline("b"), storyId: "story-a" }, headline("c")],
        history: [{ ...headline("c"), topic: "culture", seq: 1 }],
      },
      "jev-1.13.0",
    );
    expect(req.state.headlines.map((h) => h.articleId)).toEqual(["a"]);
  });
  it("does not silently cut the menu down to twelve stories", () => {
    const req = headlineRequest(
      { ...input(), headlines: Array.from({ length: 60 }, (_, i) => headline(String(i))) },
      "jev-1.13.0",
    );
    expect(req.state.headlines).toHaveLength(60);
  });
  it.each(["none", "invented"])("rejects %s as a first selection", (invalid) => {
    const req = headlineRequest(input(), "jev-1.13.0");
    expect(() => readHeadlineChoice(req, response(req, invalid), 5)).toThrow();
  });
});
