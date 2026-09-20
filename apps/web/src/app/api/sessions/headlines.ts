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
  status: "fresh" | "unavailable";
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
const BUDGET_MS = 6_000;
const CONCURRENT_FEEDS = 4;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const MAX_ARTICLES = 84;
const MAX_EVIDENCE = 1800;
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

/** One read of the configured sources, for the news worker. Nothing is kept between reads. */
export async function readHeadlines(
  config: NewsConfig,
  opts: {
    now?: number;
    budgetMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
  } = {},
): Promise<HeadlineSnapshot> {
  const fetchFn = opts.fetchFn ?? fetch;
  const clock = () => opts.now ?? Date.now();
  const deadline = AbortSignal.any([
    AbortSignal.timeout(opts.budgetMs ?? BUDGET_MS),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  const articles: Article[] = [];
  const statuses: SourceStatus[] = [];
  const sources = config.enabled
    ? NEWS_SOURCES.filter(
        (s) =>
          config.sources.includes(s.id) &&
          (!s.localOnly || (config.city.toLowerCase() === "dallas" && config.region.toUpperCase() === "TX")),
      )
    : [];
  // A few independent feeds at a time; a failed source never discards another source.
  for (let offset = 0; offset < sources.length; offset += CONCURRENT_FEEDS) {
    await Promise.all(
      sources.slice(offset, offset + CONCURRENT_FEEDS).map(async (source) => {
        const url =
          source.id === "google-local"
            ? `${source.url}${encodeURIComponent(`${config.city},${config.region}`)}?hl=en-US&gl=US&ceid=US:en`
            : source.url;
        try {
          const headers = {
            "User-Agent": USER_AGENT,
            Accept: "application/rss+xml, application/atom+xml, application/xml",
          };
          // All destinations are code-owned. Redirects stay on the same publisher host (www alias allowed).
          let target = url;
          let res: Response | undefined;
          const signal = AbortSignal.any([deadline, AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)]);
          for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            res = await fetchFn(target, { headers, signal, redirect: "manual", cache: "no-store" });
            if (!REDIRECT_STATUSES.includes(res.status)) break;
            const location = res.headers.get("location");
            const next = location ? new URL(location, target) : null;
            if (
              !next ||
              next.protocol !== "https:" ||
              next.port ||
              next.username ||
              next.password ||
              next.hostname.replace(/^www./, "") !== new URL(url).hostname.replace(/^www./, "")
            )
              throw new Error("news redirect outside publisher");
            await res.body?.cancel();
            target = next.href;
          }
          if (!res) throw new Error("no news response");
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
          const found = parseFeed(Buffer.concat(chunks).toString("utf8"), source, clock());
          articles.push(...found);
          statuses.push({
            id: source.id,
            checkedAt: new Date(clock()).toISOString(),
            status: "fresh",
            count: found.length,
            error: null,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.warn(`[news] ${source.id}: ${error}`);
          statuses.push({ id: source.id, checkedAt: null, status: "unavailable", count: 0, error });
        }
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
}
