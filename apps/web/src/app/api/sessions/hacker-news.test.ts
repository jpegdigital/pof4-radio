import { describe, expect, it, vi } from "vitest";
import { readHackerNews } from "./hacker-news";

const now = Date.parse("2026-09-24T03:00:00Z");
const story = (id: number) => ({
  id,
  type: "story",
  title: `Show HN: AI tool ${id}`,
  by: "builder",
  time: now / 1000 - 3600,
  score: 45,
  descendants: 12,
  url: "https://example.com/demo",
  kids: [90],
});
describe("Hacker News front page", () => {
  it("reads the top 30 in rank order and keeps discussion attribution and metadata", async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.endsWith("topstories.json"))
        return Promise.resolve(Response.json(Array.from({ length: 40 }, (_, i) => i + 1)));
      const id = Number(url.match(/item\/(\d+)/)?.[1]);
      return Promise.resolve(
        Response.json(
          id === 90
            ? {
                id,
                type: "comment",
                parent: 1,
                by: "reader",
                text: "I tried this demo and found it useful.",
                time: now / 1000,
              }
            : story(id),
        ),
      );
    });
    const result = await readHackerNews({
      now,
      fetchFn: fetchFn as typeof fetch,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.articles).toHaveLength(30);
    expect(result.articles[0]).toMatchObject({
      sourceId: "hacker-news",
      scope: "tech",
      community: { rank: 1, score: 45, comments: 12, url: "https://news.ycombinator.com/item?id=1" },
    });
    expect(result.articles[0].community?.discussion?.[0]).toMatchObject({
      author: "reader",
      text: "I tried this demo and found it useful.",
    });
    expect(result.articles[0].evidence).toBe("");
    expect(result.raw.topstories).toHaveLength(40);
    expect(result.articles[29].community?.rank).toBe(30);
    expect(fetchFn.mock.calls.some(([url]) => url === "https://example.com/demo")).toBe(false);
  });
  it("keeps healthy stories when one item fails and omits dead, deleted and job items", async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.endsWith("topstories.json")) return Promise.resolve(Response.json([1, 2, 3, 4, 5]));
      const id = Number(url.match(/item\/(\d+)/)?.[1]);
      if (id === 2) return Promise.resolve(new Response("down", { status: 503 }));
      return Promise.resolve(
        Response.json({
          ...story(id),
          kids: [],
          ...(id === 3 ? { dead: true } : id === 4 ? { deleted: true } : id === 5 ? { type: "job" } : {}),
        }),
      );
    });
    const result = await readHackerNews({
      now,
      fetchFn: fetchFn as typeof fetch,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.articles).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
  it("rejects a malformed front page instead of declaring it healthy", async () => {
    await expect(
      readHackerNews({
        now,
        signal: AbortSignal.timeout(5000),
        fetchFn: () => Promise.resolve(Response.json({ error: "bad" })),
      }),
    ).rejects.toThrow();
  });
});
