import { describe, expect, it } from "vitest";
import { editionDate, usableNews } from "../src/lib/prepared.ts";
import { checkedOptions } from "./prep-news.mts";

describe("prepared editions", () => {
  it("keys runs by Dallas date across UTC midnight and daylight saving", () => {
    expect(editionDate(new Date("2026-09-20T02:00:00Z"), "America/Chicago")).toBe("2026-09-19");
    expect(editionDate(new Date("2026-01-20T05:30:00Z"), "America/Chicago")).toBe("2026-01-19");
  });
  it("keeps prepared facts and omits already selected articles across revisions", () => {
    const options = [
      { articleId: "a", revision: "r1", expiresAt: "2026-09-19T18:00:00Z" },
      { articleId: "b", revision: "r1", expiresAt: "2026-09-19T12:00:00Z" },
      { articleId: "a", revision: "r2", expiresAt: "2026-09-19T18:00:00Z" },
    ];
    expect(usableNews(options, [{ articleId: "a", revision: "r1" }])).toEqual([options[1]]);
  });
});

describe("scheduled evidence checks", () => {
  const now = Date.parse("2026-09-19T15:00:00Z");
  const article = {
    id: "a",
    revision: "r",
    title: "A Dallas concert",
    source: "KXT",
    sourceId: "kxt",
    url: "https://kxt.org/concert",
    scope: "culture" as const,
    at: "2026-09-19T12:00:00Z",
    fetchedAt: "2026-09-19T15:00:00Z",
    evidence: "The free concert takes place in Dallas on September 20. Doors open at six in the evening.",
  };
  const option = {
    articleId: "a",
    topic: "Free Dallas concert",
    expiresAt: "2026-09-19T19:00:00Z",
    facts: [{ text: "The concert is free.", quote: "The free concert takes place in Dallas" }],
  };
  it("requires real evidence and an independent affirmative review", () => {
    expect(
      checkedOptions([option], [article], [{ articleId: "a", approved: true, reason: "Supported" }], now),
    ).toHaveLength(1);
    expect(checkedOptions([option], [article], [], now)).toEqual([]);
    expect(
      checkedOptions(
        [{ ...option, facts: [{ text: "Invented", quote: "not in the source" }] }],
        [article],
        [{ articleId: "a", approved: true, reason: "yes" }],
        now,
      ),
    ).toEqual([]);
  });
  it("rejects unknown, duplicate, expired and overlong validity options", () => {
    const reviews = [{ articleId: "a", approved: true, reason: "yes" }];
    expect(checkedOptions([option, option], [article], reviews, now)).toHaveLength(1);
    for (const change of [
      { articleId: "other" },
      { expiresAt: "yesterday" },
      { expiresAt: "2026-09-20T19:00:00Z" },
    ]) {
      expect(checkedOptions([{ ...option, ...change }], [article], reviews, now)).toEqual([]);
    }
  });
});
