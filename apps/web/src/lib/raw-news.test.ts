import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { RawHeadline, readNews } from "./prepared";
import { NEWS_DEFAULTS } from "./news";

const headline = {
  articleId: "a",
  storyId: "story-a",
  revision: "v1",
  title: "A Dallas discovery",
  sourceId: "kxt",
  source: "KXT",
  url: "https://kxt.org/a",
  scope: "culture",
  publishedAt: null,
  fetchedAt: "2026-09-24T04:00:00Z",
  excerpt: "",
};
describe("raw news database contract", () => {
  it.each(["facts", "checkedAt", "topic", "expiresAt"])("rejects the generated field %s", (field) => {
    expect(RawHeadline.safeParse({ ...headline, [field]: "generated" }).success).toBe(false);
  });
  it("reads only raw editions and filters source settings and reservations", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "edition",
          date: "2026-09-23",
          preparedAt: new Date(),
          expiresAt: new Date(),
          data: [headline, { ...headline, articleId: "b", sourceId: "npr" }],
        },
      ],
    });
    const db = { query } as unknown as Pool;
    const news = await readNews(db, NEWS_DEFAULTS);
    expect(query.mock.calls[0][0]).toContain("articles is not null");
    expect(query.mock.calls[0][0]).toContain("articles as data");
    expect(news?.data).toEqual([headline]);
    expect(await readNews(db, NEWS_DEFAULTS, [{ articleId: "a", revision: "v0" }])).toBeNull();
  });
  it("does not touch storage when news is disabled", async () => {
    const query = vi.fn();
    expect(await readNews({ query } as unknown as Pool, { ...NEWS_DEFAULTS, enabled: false })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
