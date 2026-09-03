import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchHeadlines, HEADLINES_TTL_MS, HEADLINES_URLS } from "./headlines";

/**
 * The pull against recorded Google News feeds (headlines.fixtures/, the first six items of each
 * as news.google.com answered on 2026-09-03): the three URLs, the User-Agent, the shape out, the
 * cache and a failure. The live pull is scripts/headlines-smoke.mts.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./headlines.fixtures/${name}.xml`, import.meta.url), "utf8");
const feeds: Record<string, string> = {
  [HEADLINES_URLS.local]: fixture("local"),
  [HEADLINES_URLS.nation]: fixture("nation"),
  [HEADLINES_URLS.world]: fixture("world"),
};

/** A clock of our own, far from now, so the module cache starts cold in each window used below. */
const T0 = Date.UTC(2031, 0, 1);

type Call = { url: string; headers: Record<string, string> };
const fetchOf = (status = 200) => {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (status !== 200) return Promise.resolve(new Response("Too Many Requests", { status }));
    const body = feeds[url];
    if (!body) return Promise.resolve(new Response("Not Found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } }),
    );
  }) as typeof fetch;
  return { calls, fetchFn };
};

describe("fetchHeadlines", () => {
  it("pulls the three feeds and keeps the top three of each, source beside title", async () => {
    const { calls, fetchFn } = fetchOf();
    const h = await fetchHeadlines({ fetchFn, now: T0 });
    expect(calls.map((c) => c.url).sort()).toEqual(Object.values(HEADLINES_URLS).sort());
    for (const c of calls) expect(c.headers["user-agent"]).toMatch(/^pof4-radio \(.+@.+\)$/);
    expect(h.local).toHaveLength(3);
    expect(h.nation).toHaveLength(3);
    expect(h.world).toHaveLength(3);
    expect(h.local[0]).toEqual({
      title:
        "Stalked across Dallas: How license plate readers tracked gunman before fatal shooting of 20-year-old",
      source: "FOX 4 News Dallas-Fort Worth",
      at: "2026-09-02T18:53:20.000Z",
    });
    expect(h.nation[0]).toMatchObject({
      title: "Feminist activist Gloria Steinem dies at age 92",
      source: "Reuters",
    });
    expect(h.world[0]).toMatchObject({ source: "nytimes.com" });
  });
  it("answers from the cache inside the window and pulls again after it", async () => {
    const { calls, fetchFn } = fetchOf();
    await fetchHeadlines({ fetchFn, now: T0 + 1 });
    await fetchHeadlines({ fetchFn, now: T0 + HEADLINES_TTL_MS - 1 });
    expect(calls).toHaveLength(0);
    await fetchHeadlines({ fetchFn, now: T0 + HEADLINES_TTL_MS + 1 });
    expect(calls).toHaveLength(3);
  });
  it("a failed pull is an error naming the status and the URL", async () => {
    const { fetchFn } = fetchOf(429);
    await expect(fetchHeadlines({ fetchFn, now: T0 + 2 * HEADLINES_TTL_MS + 1 })).rejects.toThrow(
      /google news 429 https:\/\/news\.google\.com\//,
    );
  });
});
