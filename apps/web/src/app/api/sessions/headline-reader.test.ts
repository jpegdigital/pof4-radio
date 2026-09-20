import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { canonicalUrl, eligibleArticles, HEADLINES_PER_FEED, parseFeed, readHeadlines } from "./headlines";
import { NEWS_DEFAULTS, NEWS_SOURCES, type NewsConfig } from "../../../lib/news";

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

describe("canonical article URL", () => {
  it.each([
    [
      "tracking-stripped",
      "https://kxt.org/a?utm_source=rss&utm_medium=x&fbclid=1&gclid=2",
      "https://kxt.org/a",
    ],
    ["other-params-kept", "https://kxt.org/a?id=7&utm_campaign=x", "https://kxt.org/a?id=7"],
    ["hash-dropped", "https://kxt.org/a#comments", "https://kxt.org/a"],
    ["http-refused", "http://kxt.org/a", ""],
    ["credentials-refused", "https://user:pw@kxt.org/a", ""],
    ["not-a-url", "kxt dot org", ""],
    ["empty", "", ""],
  ])("%s", (_, give, want) => {
    expect(canonicalUrl(give)).toBe(want);
  });
});

describe("eligible articles", () => {
  const base = parseFeed(feed(), source, now)[0];
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const HOUR = 3_600_000;
  it.each([
    ["culture-six-days-kept", { scope: "culture", at: ago(6 * 24 * HOUR) }, 1],
    ["culture-eight-days-dropped", { scope: "culture", at: ago(8 * 24 * HOUR) }, 0],
    ["local-23h-kept", { scope: "local", at: ago(23 * HOUR) }, 1],
    ["local-25h-dropped", { scope: "local", at: ago(25 * HOUR) }, 0],
    ["four-minutes-ahead-kept", { at: ago(-4 * 60_000) }, 1],
    ["six-minutes-ahead-dropped", { at: ago(-6 * 60_000) }, 0],
    ["no-url-dropped", { url: "" }, 0],
    ["no-source-dropped", { source: "" }, 0],
  ] as const)("%s", (_, give, want) => {
    expect(eligibleArticles([{ ...base, at: ago(HOUR), ...give }], now)).toHaveLength(want);
  });
  it("keeps the first of two titles that differ only in case and punctuation", () => {
    const at = ago(HOUR);
    const kept = eligibleArticles(
      [
        { ...base, at, id: "first", title: "Show moves indoors!" },
        { ...base, at, id: "second", title: "show moves — INDOORS" },
        { ...base, at, id: "third", title: "Another story" },
      ],
      now,
    );
    expect(kept.map((a) => a.id)).toEqual(["first", "third"]);
  });
});

/** The news worker's call, on a fixed clock and a fetch of the test's own. */
const readOnce = (
  fetchFn: unknown,
  config: NewsConfig,
  opts: { budgetMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
) => readHeadlines(config, { now, fetchFn: fetchFn as typeof fetch, ...opts });

describe("one read, as the news worker makes it", () => {
  const config: NewsConfig = { ...NEWS_DEFAULTS, sources: ["kxt"] };
  const nowIso = new Date(now).toISOString();
  const hosts = (fetchFn: { mock: { calls: unknown[][] } }) =>
    fetchFn.mock.calls.map(([url]) => new URL(String(url)).hostname);
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("a healthy source is fresh, counted and stamped with the read's clock", async () => {
    const snapshot = await readOnce(
      vi.fn(() => Promise.resolve(new Response(feed()))),
      config,
    );
    expect(snapshot.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot).toMatchObject({
      at: nowIso,
      config,
      sources: [{ id: "kxt", checkedAt: nowIso, status: "fresh", count: 1, error: null }],
    });
    expect(snapshot.articles).toHaveLength(1);
    expect(snapshot.articles[0]).toMatchObject({ sourceId: "kxt", fetchedAt: nowIso });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a valid empty feed is fresh with nothing in it", async () => {
    const snapshot = await readOnce(
      vi.fn(() => Promise.resolve(new Response(feed("")))),
      config,
    );
    expect(snapshot.sources).toEqual([
      { id: "kxt", checkedAt: nowIso, status: "fresh", count: 0, error: null },
    ]);
    expect(snapshot.articles).toEqual([]);
  });

  it.each([
    ["http-500", () => Promise.resolve(new Response("down", { status: 500 })), /kxt HTTP 500/],
    ["http-404", () => Promise.resolve(new Response("gone", { status: 404 })), /kxt HTTP 404/],
    [
      "http-429-retry-after",
      () => Promise.resolve(new Response("slow down", { status: 429, headers: { "Retry-After": "120" } })),
      /kxt HTTP 429/,
    ],
    [
      "http-304-with-nothing-held",
      () => Promise.resolve(new Response(null, { status: 304 })),
      /kxt HTTP 304/,
    ],
    ["network-rejection", () => Promise.reject(new Error("offline")), /offline/],
    ["html-consent-page", () => Promise.resolve(new Response("<html>Consent</html>")), /not an RSS feed/],
    [
      "dtd",
      () => Promise.resolve(new Response('<!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>')),
      /DTD/,
    ],
    ["no-body", () => Promise.resolve(new Response(null)), /empty news response body/],
    ["oversize-body", () => Promise.resolve(new Response("x".repeat(2_000_001))), /too large/],
  ])("a failed source is unavailable, named and warned: %s", async (_, give, want) => {
    const snapshot = await readOnce(vi.fn(give), config);
    expect(snapshot.articles).toEqual([]);
    expect(snapshot.sources).toEqual([
      {
        id: "kxt",
        checkedAt: null,
        status: "unavailable",
        count: 0,
        error: expect.stringMatching(want) as string,
      },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[news\] kxt: /));
  });

  it("one source failing never discards another", async () => {
    const fetchFn = vi.fn((url: string) =>
      Promise.resolve(url.includes("kxt.org") ? new Response(feed()) : new Response("down", { status: 500 })),
    );
    const snapshot = await readOnce(fetchFn, { ...config, sources: ["kxt", "kera"] });
    expect(snapshot.sources.map((s) => [s.id, s.status])).toEqual([
      ["kera", "unavailable"],
      ["kxt", "fresh"],
    ]);
    expect(snapshot.articles.map((a) => a.sourceId)).toEqual(["kxt"]);
  });

  it("asks as the station, for feeds, without conditions, and follows redirects by hand", async () => {
    const fetchFn = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(feed())));
    await readOnce(fetchFn, config);
    const [url, init] = fetchFn.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://kxt.org/feed/");
    expect(headers.get("User-Agent")).toContain("pof4-radio");
    expect(headers.get("Accept")).toContain("application/rss+xml");
    expect(headers.get("If-None-Match")).toBeNull();
    expect(headers.get("If-Modified-Since")).toBeNull();
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  describe("redirects stay with the publisher", () => {
    const redirect = (location: string | null, status = 301) =>
      new Response(null, { status, headers: location ? { Location: location } : {} });

    it.each([301, 302, 303, 307, 308])("follows a %i to the publisher's www alias", async (status) => {
      const fetchFn = vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValueOnce(redirect("https://www.kxt.org/feed/", status))
        .mockResolvedValueOnce(new Response(feed()));
      const snapshot = await readOnce(fetchFn, config);
      expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
        "https://kxt.org/feed/",
        "https://www.kxt.org/feed/",
      ]);
      expect(snapshot.sources[0].status).toBe("fresh");
    });

    it("resolves a relative location against the feed", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(redirect("/feed/rss2/"))
        .mockResolvedValueOnce(new Response(feed()));
      await readOnce(fetchFn, config);
      expect(fetchFn.mock.calls[1][0]).toBe("https://kxt.org/feed/rss2/");
    });

    it.each([
      ["another-host", "https://evil.example/feed/"],
      ["a-subdomain", "https://feeds.kxt.org/feed/"],
      ["plain-http", "http://kxt.org/feed/"],
      ["a-port", "https://kxt.org:8443/feed/"],
      ["credentials", "https://user:pw@kxt.org/feed/"],
      ["no-location", null],
    ])("refuses %s", async (_, give) => {
      const fetchFn = vi.fn().mockResolvedValueOnce(redirect(give));
      const snapshot = await readOnce(fetchFn, config);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(snapshot.sources[0]).toMatchObject({
        status: "unavailable",
        error: "news redirect outside publisher",
      });
    });

    it("stops after three hops", async () => {
      const fetchFn = vi.fn(() => Promise.resolve(redirect("https://kxt.org/feed/")));
      const snapshot = await readOnce(fetchFn, config);
      expect(fetchFn).toHaveBeenCalledTimes(4);
      expect(snapshot.sources[0]).toMatchObject({ status: "unavailable", error: "kxt HTTP 301" });
    });
  });

  describe("which sources are read", () => {
    const ok = () => vi.fn((_url: string) => Promise.resolve(new Response(feed())));

    it("news switched off reads nothing", async () => {
      const fetchFn = ok();
      const snapshot = await readOnce(fetchFn, { ...NEWS_DEFAULTS, enabled: false });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(snapshot).toMatchObject({ articles: [], sources: [] });
    });

    it("only the configured sources are read", async () => {
      const fetchFn = ok();
      const snapshot = await readOnce(fetchFn, { ...config, sources: ["npr"] });
      expect(hosts(fetchFn)).toEqual(["feeds.npr.org"]);
      expect(snapshot.sources.map((s) => s.id)).toEqual(["npr"]);
    });

    it.each([
      ["dallas-tx", "Dallas", "TX", ["feeds.npr.org", "kxt.org"]],
      ["any-case", "dallas", "tx", ["feeds.npr.org", "kxt.org"]],
      ["another-city", "Austin", "TX", ["feeds.npr.org"]],
      ["another-region", "Dallas", "GA", ["feeds.npr.org"]],
    ])("Dallas stations are read only for Dallas: %s", async (_, city, region, want) => {
      const fetchFn = ok();
      await readOnce(fetchFn, { ...config, city, region, sources: ["kxt", "npr"] });
      expect(hosts(fetchFn).sort()).toEqual(want);
    });

    it("the local discovery feed is asked for the configured place", async () => {
      const fetchFn = ok();
      await readOnce(fetchFn, { ...config, city: "Fort Worth", region: "TX", sources: ["google-local"] });
      expect(fetchFn.mock.calls[0][0]).toBe(
        "https://news.google.com/rss/headlines/section/geo/Fort%20Worth%2CTX?hl=en-US&gl=US&ceid=US:en",
      );
    });

    it("reads every source once, four at a time", async () => {
      let active = 0;
      let most = 0;
      const fetchFn = vi.fn(async (_url: string) => {
        most = Math.max(most, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return new Response(feed());
      });
      const snapshot = await readOnce(fetchFn, NEWS_DEFAULTS);
      expect(fetchFn).toHaveBeenCalledTimes(NEWS_DEFAULTS.sources.length);
      expect(most).toBe(4);
      expect(snapshot.sources.every((s) => s.status === "fresh")).toBe(true);
    });
  });

  describe("what comes back", () => {
    const entry = (n: number) =>
      `<item><title>Story ${n}</title><link>https://kxt.org/story/${n}</link><pubDate>Sun, 06 Sep 2026 17:00:00 GMT</pubDate><description>Evidence for story ${n}.</description></item>`;
    const many = (count: number) => feed(Array.from({ length: count }, (_, n) => entry(n)).join(""));

    it("takes the top of each feed", async () => {
      const snapshot = await readOnce(
        vi.fn(() => Promise.resolve(new Response(many(HEADLINES_PER_FEED + 3)))),
        config,
      );
      expect(snapshot.articles).toHaveLength(HEADLINES_PER_FEED);
      expect(snapshot.sources[0].count).toBe(HEADLINES_PER_FEED);
    });

    it("orders sources and articles the same way every time", async () => {
      const snapshot = await readOnce(
        vi.fn(() => Promise.resolve(new Response(many(3)))),
        { ...config, sources: ["npr", "kxt", "kera"] },
      );
      expect(snapshot.sources.map((s) => s.id)).toEqual(["kera", "kxt", "npr"]);
      expect(snapshot.articles.map((a) => a.sourceId)).toEqual([
        ...Array<string>(3).fill("kera"),
        ...Array<string>(3).fill("kxt"),
        ...Array<string>(3).fill("npr"),
      ]);
      const kxt = snapshot.articles.filter((a) => a.sourceId === "kxt").map((a) => a.id);
      expect(kxt).toEqual([...kxt].sort((a, b) => a.localeCompare(b)));
    });
  });

  describe("the worker's deadline", () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => reject(signal.reason as Error));
      });

    it("the caller's signal ends a read in flight", async () => {
      const stop = new AbortController();
      setTimeout(() => stop.abort(new Error("worker stopped")), 5);
      const snapshot = await readOnce(vi.fn(hang), config, { signal: stop.signal });
      expect(snapshot.sources[0]).toMatchObject({ status: "unavailable", error: "worker stopped" });
    });

    it.each([
      ["per-source-timeout", { timeoutMs: 10 }],
      ["whole-read-budget", { budgetMs: 10 }],
    ])("%s ends a source that never answers", async (_, give) => {
      const snapshot = await readOnce(vi.fn(hang), config, give);
      expect(snapshot.sources[0]).toMatchObject({
        status: "unavailable",
        error: expect.stringMatching(/timeout|timed out/i) as string,
      });
    });
  });
});
