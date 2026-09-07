import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { NEWS_SOURCES, type NewsConfig, type NewsScope, type NewsSource } from "../../../lib/news.ts";

export interface Headline {
  title: string;
  source: string;
  at: string;
}
export interface Article extends Headline {
  id: string;
  sourceId: string;
  url: string;
  scope: NewsScope;
  evidence: string;
  revision: string;
  fetchedAt: string;
}
export interface SourceStatus {
  id: string;
  checkedAt: string | null;
  status: "fresh" | "stale" | "unavailable";
  count: number;
  error: string | null;
}
export interface HeadlineSnapshot {
  id: string;
  at: string;
  config: NewsConfig;
  articles: Article[];
  sources: SourceStatus[];
}
export const HEADLINES_PER_FEED = 12;
const MAX_BODY_BYTES = 2_000_000;
const TIMEOUT_MS = 4_000;
const MAX_ARTICLES = 84;
const MAX_EVIDENCE = 1800;
const MAX_CACHE_ENTRIES = 64;
const USER_AGENT = "pof4-radio (jpegdigital@users.noreply.github.com)";
export const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? whole;
    const hex = name[1]?.toLowerCase() === "x";
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : "\ufffd";
  });
const valueOf = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? valueOf(v["#text"]) : "";
const plain = (v: unknown) =>
  decode(
    decode(valueOf(v))
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const iso = (v: unknown) => {
  const at = Date.parse(valueOf(v));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
};

export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch {
    return "";
  }
}

/** XML entities/DTDs are disabled in the parser. Only bounded plain text crosses into a prompt. */
export function parseFeed(xml: string, source: NewsSource, now: number): Article[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD/entities are not accepted in news feeds");
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
  type Feed = {
    item?: Record<string, unknown> | Record<string, unknown>[];
    entry?: Record<string, unknown> | Record<string, unknown>[];
  };
  const root = parser.parse(xml, true) as { rss?: { channel?: Feed }; feed?: Feed };
  const channel = root.rss?.channel;
  const atom = root.feed;
  if (!channel && !atom) throw new Error("not an RSS feed or Atom feed");
  const items = channel?.item ?? atom?.entry ?? [];
  return (Array.isArray(items) ? items : [items]).slice(0, HEADLINES_PER_FEED).flatMap((item): Article[] => {
    const raw = plain(item.title);
    if (!raw) return [];
    let publisher = plain(item.source) || source.name;
    let title = raw;
    if (source.discoveryOnly) {
      if (raw.endsWith(` - ${publisher}`)) title = raw.slice(0, -(publisher.length + 3));
      else if (!plain(item.source)) {
        const dash = raw.lastIndexOf(" - ");
        if (dash > 0) {
          title = raw.slice(0, dash);
          publisher = raw.slice(dash + 3);
        }
      }
    }
    const links: unknown[] = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(
      (l: unknown) =>
        typeof l === "string" ||
        (l && typeof l === "object" && (!("@_rel" in l) || l["@_rel"] === "alternate")),
    );
    const url = canonicalUrl(
      typeof link === "string"
        ? decode(link)
        : link && typeof link === "object" && "@_href" in link
          ? valueOf(link["@_href"])
          : "",
    );
    const evidence = source.discoveryOnly
      ? ""
      : plain(item["content:encoded"] || item.content || item.description || item.summary).slice(
          0,
          MAX_EVIDENCE,
        );
    return [
      {
        id: fingerprint(url || `${source.id}:${plain(item.guid || item.id) || title}`),
        sourceId: source.id,
        title,
        source: publisher,
        url,
        scope: source.scope,
        at: iso(item.pubDate || item.published || item.updated),
        evidence,
        revision: fingerprint(evidence || title),
        fetchedAt: new Date(now).toISOString(),
      },
    ];
  });
}

export function eligibleArticles(articles: Article[], now: number): Article[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const age = now - Date.parse(a.at);
    const maxAge = (a.scope === "culture" ? 7 : 1) * 86_400_000;
    const key = a.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!a.url || !a.source || !Number.isFinite(age) || age < -300_000 || age > maxAge || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

interface CachedFeed {
  control: string;
  articles: Article[];
  checked: number;
  next: number;
  retryAt: number;
  failures: number;
  etag: string | null;
  modified: string | null;
  error: string | null;
}

/** Per-source cache and single-flight ownership, created once per server process (or per test). */
export function createHeadlineReader(fetchFn: typeof fetch = fetch) {
  const cache = new Map<string, CachedFeed>();
  const inflight = new Map<string, Promise<void>>();
  return async (
    config: NewsConfig,
    opts: { now?: number; refresh?: boolean } = {},
  ): Promise<HeadlineSnapshot> => {
    const clock = () => opts.now ?? Date.now();
    const deadline = AbortSignal.timeout(6_000);
    const articles: Article[] = [];
    const statuses: SourceStatus[] = [];
    const sources = config.enabled
      ? NEWS_SOURCES.filter(
          (s) =>
            config.sources.includes(s.id) &&
            (!s.localOnly ||
              (config.city.toLowerCase() === "dallas" && config.region.toUpperCase() === "TX")),
        )
      : [];
    // Four independent feeds at a time; a rejected source never discards another source.
    for (let offset = 0; offset < sources.length; offset += 4) {
      await Promise.allSettled(
        sources.slice(offset, offset + 4).map(async (source) => {
          const url =
            source.id === "google-local"
              ? `${source.url}${encodeURIComponent(`${config.city},${config.region}`)}?hl=en-US&gl=US&ceid=US:en`
              : source.url;
          const ttl =
            (source.scope === "culture" ? config.cultureRefreshMinutes : config.refreshMinutes) * 60_000;
          const key = `${source.id}:${url}:${ttl}`;
          let c = cache.get(key);
          if (!c) {
            if (cache.size >= MAX_CACHE_ENTRIES)
              for (const old of cache.keys()) {
                if (!inflight.has(old)) {
                  cache.delete(old);
                  break;
                }
              }
            c = {
              control: "",
              articles: [],
              checked: 0,
              next: 0,
              retryAt: 0,
              failures: 0,
              etag: null,
              modified: null,
              error: null,
            };
            cache.set(key, c);
          }
          const entry = c;
          if (clock() >= entry.retryAt && (opts.refresh || clock() >= entry.next)) {
            let pending = inflight.get(key);
            if (!pending) {
              pending = (async () => {
                try {
                  const headers = new Headers({
                    "User-Agent": USER_AGENT,
                    Accept: "application/rss+xml, application/atom+xml, application/xml",
                  });
                  if (entry.etag) headers.set("If-None-Match", entry.etag);
                  if (entry.modified) headers.set("If-Modified-Since", entry.modified);
                  // All destinations are code-owned. Redirects stay on the same publisher host (www alias allowed).
                  let target = url;
                  let res: Response | undefined;
                  const signal = AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]);
                  for (let n = 0; n <= 3; n++) {
                    res = await fetchFn(target, { headers, signal, redirect: "manual", cache: "no-store" });
                    if (![301, 302, 303, 307, 308].includes(res.status)) break;
                    const location = res.headers.get("location");
                    const next = location ? new URL(location, target) : null;
                    if (
                      !next ||
                      next.protocol !== "https:" ||
                      next.port ||
                      next.username ||
                      next.password ||
                      next.hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "")
                    )
                      throw new Error("news redirect outside publisher");
                    await res.body?.cancel();
                    target = next.href;
                  }
                  if (!res) throw new Error("no news response");
                  if (res.status === 429 || res.status === 503) {
                    const retry = res.headers.get("Retry-After");
                    if (retry)
                      entry.retryAt = Math.max(
                        entry.retryAt,
                        /^\d+$/.test(retry) ? clock() + Number(retry) * 1000 : Date.parse(retry) || 0,
                      );
                  }
                  if (res.status === 304 && entry.checked) {
                    /* unchanged evidence; only validation time moves */
                  } else {
                    if (!res.ok) {
                      await res.body?.cancel();
                      throw new Error(`${source.id} HTTP ${res.status}`);
                    }
                    const reader = res.body?.getReader();
                    if (!reader) throw new Error("empty news response body");
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    try {
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.byteLength;
                        if (size > MAX_BODY_BYTES) throw new Error("news response too large");
                        chunks.push(value);
                      }
                    } finally {
                      await reader.cancel().catch(() => {});
                      reader.releaseLock();
                    }
                    entry.articles = parseFeed(Buffer.concat(chunks).toString("utf8"), source, clock());
                    entry.etag = res.headers.get("ETag");
                    entry.modified = res.headers.get("Last-Modified");
                  }
                  entry.control =
                    res.headers.get("Cache-Control") ?? (res.status === 304 ? entry.control : "");
                  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(entry.control)?.[1];
                  const originTtl =
                    maxAge === undefined
                      ? ttl
                      : Math.max(0, Number(maxAge) - (Number(res.headers.get("Age")) || 0)) * 1000;
                  entry.checked = clock();
                  entry.next = clock() + (/\bno-cache\b/i.test(entry.control) ? 0 : Math.min(ttl, originTtl));
                  entry.failures = 0;
                  entry.retryAt = 0;
                  entry.error = null;
                } catch (err) {
                  entry.error = err instanceof Error ? err.message : String(err);
                  entry.failures++;
                  entry.retryAt = Math.max(
                    entry.retryAt,
                    clock() +
                      [30_000, 120_000, 600_000][Math.min(2, entry.failures - 1)] * (1 + Math.random() * 0.2),
                  );
                  console.warn(`[news] ${source.id}: ${entry.error}`);
                } finally {
                  inflight.delete(key);
                }
              })();
              inflight.set(key, pending);
            }
            await pending;
          }
          const available =
            entry.checked > 0 &&
            !(entry.error && /\b(?:must-revalidate|no-cache|no-store)\b/i.test(entry.control)) &&
            clock() - entry.checked <= (source.scope === "culture" ? 7_200_000 : 1_800_000);
          if (available) articles.push(...entry.articles);
          statuses.push({
            id: source.id,
            checkedAt: entry.checked ? new Date(entry.checked).toISOString() : null,
            status: !available ? "unavailable" : entry.error ? "stale" : "fresh",
            count: available ? entry.articles.length : 0,
            error: entry.error,
          });
          if (/\bno-store\b/i.test(entry.control)) cache.delete(key);
        }),
      );
    }
    articles.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id));
    statuses.sort((a, b) => a.id.localeCompare(b.id));
    return {
      id: crypto.randomUUID(),
      at: new Date(clock()).toISOString(),
      config,
      articles: articles.slice(0, MAX_ARTICLES),
      sources: statuses,
    };
  };
}

export const readHeadlines = createHeadlineReader();
