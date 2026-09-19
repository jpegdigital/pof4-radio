import { describe, expect, it } from "vitest";
import { NewsConfig, NEWS_DEFAULTS } from "./news";

describe("news configuration", () => {
  it.each([
    ["unknown source", { sources: ["https://localhost/"] }],
    ["timezone", { timeZone: "not-a-zone" }],
    ["duplicate source", { sources: ["kxt", "kxt"] }],
    ["unbounded words", { maxWords: 1000 }],
  ])("rejects %s", (_, change) =>
    expect(NewsConfig.safeParse({ ...NEWS_DEFAULTS, ...change }).success).toBe(false),
  );
});
