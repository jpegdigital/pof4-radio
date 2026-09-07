import { describe, expect, it } from "vitest";
import { NewsConfig, NEWS_DEFAULTS, newsExpired } from "./news";

describe("news configuration and airtime", () => {
  it.each([
    ["unknown source", { sources: ["https://localhost/"] }],
    ["timezone", { timeZone: "not-a-zone" }],
    ["duplicate source", { sources: ["kxt", "kxt"] }],
    ["unbounded words", { maxWords: 1000 }],
  ])("rejects %s", (_, change) =>
    expect(NewsConfig.safeParse({ ...NEWS_DEFAULTS, ...change }).success).toBe(false),
  );
  it.each([
    ["before", "2026-09-06T18:10:00Z", false],
    ["boundary", "2026-09-06T18:00:00Z", true],
    ["unknown", "", true],
  ])("expiry %s", (_, expiresAt, want) =>
    expect(newsExpired({ words: "news", expiresAt }, Date.parse("2026-09-06T18:00:00Z"))).toBe(want),
  );
  it("omitted news never triggers refresh", () =>
    expect(newsExpired({ words: null, expiresAt: "" }, Date.now())).toBe(false));
});
