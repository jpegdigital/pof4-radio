import { describe, expect, it, vi } from "vitest";
import { editionDate, usableNews } from "../src/lib/prepared.ts";
import { prepareNews } from "./prep-news.mts";
import { NEWS_DEFAULTS } from "../src/lib/news.ts";

describe("raw news collection", () => {
  it("keys editions by Dallas date", () => {
    expect(editionDate(new Date("2026-09-20T02:00:00Z"), "America/Chicago")).toBe("2026-09-19");
  });
  it("keeps source text and title-only stories without model calls or model-produced fields", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(
          "<rss><channel><item><title>Dallas concert</title><link>https://kxt.org/concert</link><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate><description>Doors open at six.</description></item><item><title>Another event</title><link>https://kxt.org/another</link></item></channel></rss>",
        ),
      ),
    );
    const result = await prepareNews(
      { ...NEWS_DEFAULTS, sources: ["kxt"] },
      AbortSignal.timeout(5000),
      fetchFn,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.articles).toHaveLength(2);
    expect(result.articles.find((a) => a.title === "Dallas concert")).toMatchObject({
      excerpt: "Doors open at six.",
      publishedAt: "2026-09-23T12:00:00.000Z",
    });
    expect(result.articles.find((a) => a.title === "Another event")?.publishedAt).toBeNull();
    for (const article of result.articles) {
      expect(article).not.toHaveProperty("facts");
      expect(article).not.toHaveProperty("checkedAt");
      expect(article).not.toHaveProperty("topic");
      expect(article).not.toHaveProperty("expiresAt");
    }
    expect(result.snapshot.raw?.kxt).toContain("<rss>");
  });
  it("preserves a usable source during a partial outage", async () => {
    const fetchFn = vi.fn((url: string) =>
      Promise.resolve(
        url.includes("keranews")
          ? new Response("unavailable", { status: 503 })
          : new Response(
              "<rss><channel><item><title>A story</title><link>https://kxt.org/story</link></item></channel></rss>",
            ),
      ),
    );
    const result = await prepareNews(
      { ...NEWS_DEFAULTS, sources: ["kera", "kxt"] },
      AbortSignal.timeout(5000),
      fetchFn as typeof fetch,
    );
    expect(result.articles).toHaveLength(1);
    expect(result.snapshot.sources.find((s) => s.id === "kera")?.status).toBe("unavailable");
  });
  it("fails a total outage without publishing an empty replacement", async () => {
    await expect(
      prepareNews({ ...NEWS_DEFAULTS, sources: ["kxt"] }, AbortSignal.timeout(5000), () =>
        Promise.resolve(new Response("down", { status: 503 })),
      ),
    ).rejects.toThrow(/No news sources/);
  });
  it("omits selected articles across revisions", () => {
    expect(
      usableNews(
        [
          { articleId: "a", revision: "v2" },
          { articleId: "b", revision: "v1" },
        ],
        [{ articleId: "a", revision: "v1" }],
      ),
    ).toEqual([{ articleId: "b", revision: "v1" }]);
  });
});
