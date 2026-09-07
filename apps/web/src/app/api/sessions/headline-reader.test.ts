import { describe, expect, it, vi } from "vitest";
import { createHeadlineReader, eligibleArticles, parseFeed } from "./headlines";
import { NEWS_DEFAULTS, NEWS_SOURCES } from "../../../lib/news";

const now = Date.parse("2026-09-06T18:00:00Z");
const source = NEWS_SOURCES.find((s) => s.id === "kxt")!;
const item = (title = "A show moves indoors", at = "Sun, 06 Sep 2026 17:00:00 GMT") =>
  `<item><title><![CDATA[${title}]]></title><link>https://kxt.org/2026/09/show/?utm_source=rss</link><guid>x</guid><pubDate>${at}</pubDate><description><![CDATA[<p>The venue says Friday's show moves indoors. Existing tickets remain valid.</p>]]></description></item>`;
const feed = (items = item()) => `<rss version="2.0"><channel><title>KXT</title>${items}</channel></rss>`;

describe("headline evidence", () => {
  it("keeps source, identity, publication time and plain-text evidence from CDATA", () => {
    const [a] = parseFeed(feed(item("Tom &amp; Jerry &#X26; friends")), source, now);
    expect(a).toMatchObject({
      title: "Tom & Jerry & friends",
      source: "KXT",
      url: "https://kxt.org/2026/09/show/",
      at: "2026-09-06T17:00:00.000Z",
      scope: "culture",
    });
    expect(a.evidence).toBe("The venue says Friday's show moves indoors. Existing tickets remain valid.");
    expect(a.id).toBeTruthy();
  });
  it("contains malformed numeric entities without losing other items", () => {
    expect(parseFeed(feed(item("Bad &#99999999;") + item("Healthy")), source, now).at(-1)?.title).toBe(
      "Healthy",
    );
  });
  it.each(["<html>Consent</html>", '<!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>'])(
    "refuses non-feed / DTD input: %s",
    (xml) => expect(() => parseFeed(xml, source, now)).toThrow(),
  );
  it("does not mistake Google link lists for article evidence", () => {
    const google = NEWS_SOURCES.find((s) => s.id === "google-local")!;
    expect(parseFeed(feed(), google, now)[0].evidence).toBe("");
  });
  it.each([
    ["unknown", "", 0],
    ["old", "2026-08-01T00:00:00Z", 0],
    ["future", "2026-09-07T00:00:00Z", 0],
    ["recent", "2026-09-06T17:00:00Z", 1],
  ])("age gate: %s", (_, at, count) => {
    expect(eligibleArticles([{ ...parseFeed(feed(), source, now)[0], at }], now).length).toBe(count);
  });
});

describe("request-driven source cache", () => {
  const config = { ...NEWS_DEFAULTS, sources: ["kxt"] };
  it("honors no-store and revalidates no-cache responses", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(feed(), { headers: { "Cache-Control": "no-store" } }))
      .mockResolvedValueOnce(new Response(feed(), { headers: { "Cache-Control": "no-cache", ETag: '"v2"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const read = createHeadlineReader(fetchFn);
    await read(config, { now });
    await read(config, { now: now + 1 });
    await read(config, { now: now + 2 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchFn.mock.calls[2][1]?.headers).get("If-None-Match")).toBe('"v2"');
  });
  it("coalesces concurrent misses and reuses fresh responses", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(feed(), { headers: { ETag: '"v1"' } })));
    const read = createHeadlineReader(fetchFn);
    const [a, b] = await Promise.all([read(config, { now }), read(config, { now })]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a.articles).toEqual(b.articles);
    await read(config, { now: now + 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("304 preserves article age while advancing validation", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(feed(), { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const read = createHeadlineReader(fetchFn);
    const first = await read(config, { now });
    const second = await read(config, { now: now + 20 * 60_000 });
    expect(new Headers(fetchFn.mock.calls[1][1]?.headers).get("If-None-Match")).toBe('"v1"');
    expect(second.articles[0].at).toBe(first.articles[0].at);
    expect(second.sources[0].checkedAt).not.toBe(first.sources[0].checkedAt);
  });
  it("partial failure preserves another source and backs off even on refresh", async () => {
    const fetchFn = vi.fn((url: string) =>
      Promise.resolve(
        url.includes("kxt.org")
          ? new Response(feed())
          : new Response("unavailable", { status: 429, headers: { "Retry-After": "120" } }),
      ),
    );
    const read = createHeadlineReader(fetchFn as typeof fetch);
    const cfg = { ...config, sources: ["kxt", "kera"] };
    const result = await read(cfg, { now });
    expect(result.articles.length).toBe(1);
    expect(result.sources.find((s) => s.id === "kera")?.error).toContain("429");
    await read(cfg, { now: now + 60_000, refresh: true });
    expect(fetchFn.mock.calls.filter(([u]) => u.includes("keranews"))).toHaveLength(1);
  });
  it("last-good expires and rejected in-flight entries recover", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(feed()))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(feed(item("Recovered"))));
    const read = createHeadlineReader(fetchFn);
    await read(config, { now });
    expect((await read(config, { now: now + 3 * 3_600_000 })).articles).toEqual([]);
    expect((await read(config, { now: now + 4 * 3_600_000 })).articles[0].title).toBe("Recovered");
  });
  it("a valid empty feed replaces old data", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(feed()))
      .mockResolvedValueOnce(new Response(feed("")));
    const read = createHeadlineReader(fetchFn);
    await read(config, { now });
    expect((await read(config, { now: now + 20 * 60_000 })).articles).toEqual([]);
  });
  it("does not share local snapshots across places", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(feed())));
    const read = createHeadlineReader(fetchFn);
    const cfg = { ...config, sources: ["google-local"] };
    await read(cfg, { now });
    await read({ ...cfg, city: "Austin" }, { now });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
