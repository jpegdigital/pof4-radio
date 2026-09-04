/**
 * The headlines as the DJ reads them, from three Google News RSS feeds — the city, the nation,
 * the world — each a ranked list of `<item>`s whose title is `Headline - Source`. No key, no
 * package: plain fetch (each feed answers with a redirect to its topic id; fetch follows it),
 * the XML read by hand (a regex over the items), the top few of each kept with the source beside
 * the title so the DJ can credit it, cached for ten minutes so every break of a show reads one
 * pull. The city is the station's: Dallas, the feed's own geo section. Google's feeds are for
 * personal, non-commercial use, which is what this station is.
 */

const GOOGLE_NEWS = "https://news.google.com/rss";
const EDITION = "hl=en-US&gl=US&ceid=US:en";
export const HEADLINES_URLS = {
  local: `${GOOGLE_NEWS}/headlines/section/geo/Dallas,TX?${EDITION}`,
  nation: `${GOOGLE_NEWS}/headlines/section/topic/NATION?${EDITION}`,
  world: `${GOOGLE_NEWS}/headlines/section/topic/WORLD?${EDITION}`,
} as const;

const USER_AGENT = "pof4-radio (jpegdigital@users.noreply.github.com)";
export const HEADLINES_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;

/** How many of each feed the brief carries. */
export const HEADLINES_PER_FEED = 3;

export interface Headline {
  /** The headline as written, its `- Source` suffix removed. */
  title: string;
  /** Who wrote it: "Dallas News", "Reuters". */
  source: string;
  /** When it was published, ISO. */
  at: string;
}

export interface Headlines {
  local: Headline[];
  nation: Headline[];
  world: Headline[];
}

// ── the feed, read ───────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The five named XML entities and numeric ones; anything else is left as it came. */
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        Number.parseInt(e[1] === "x" ? e.slice(2) : e.slice(1), e[1] === "x" ? 16 : 10),
      );
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const tag = (xml: string, name: string) => {
  const inner = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];
  return inner === undefined ? null : decode(inner.trim());
};

/** The top `take` items of one feed, in feed order; a body that is not RSS throws. */
export function parseHeadlines(xml: string, take: number): Headline[] {
  if (!/<rss[\s>]/.test(xml) || !xml.includes("<channel>")) throw new Error("not an RSS feed");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1] ?? "");
  const out: Headline[] = [];
  for (const it of items) {
    if (out.length >= take) break;
    const raw = tag(it, "title");
    if (!raw) continue;
    let source = tag(it, "source");
    let title = raw;
    if (source && raw.endsWith(` - ${source}`)) title = raw.slice(0, -(source.length + 3));
    else if (!source) {
      const dash = raw.lastIndexOf(" - ");
      if (dash > 0) {
        title = raw.slice(0, dash);
        source = raw.slice(dash + 3);
      } else source = "";
    }
    const published = tag(it, "pubDate");
    const at = published ? new Date(published) : new Date(Number.NaN);
    out.push({
      title: title.trim(),
      source: source.trim(),
      at: Number.isNaN(at.getTime()) ? "" : at.toISOString(),
    });
  }
  return out;
}

/** The headlines as the brief carries them: one line each, grouped by where they are from. */
export function headlinesText(h: Headlines, city: string): string {
  const line = (label: string) => (x: Headline) => `${label}: ${x.title}${x.source ? ` (${x.source})` : ""}`;
  return [...h.local.map(line(city)), ...h.nation.map(line("Nation")), ...h.world.map(line("World"))].join(
    "\n",
  );
}

// ── the pull ─────────────────────────────────────────────────────────────────────────────────

let cached: { at: number; headlines: Headlines } | null = null;

async function pull(url: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`google news ${res.status} ${url}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.text();
}

/** The headlines now, from the cache inside its window, else pulled fresh. A failed pull throws. */
export async function fetchHeadlines(
  opts: { fetchFn?: typeof fetch; now?: number } = {},
): Promise<Headlines> {
  const now = opts.now ?? Date.now();
  if (cached && now - cached.at < HEADLINES_TTL_MS) return cached.headlines;
  const fetchFn = opts.fetchFn ?? fetch;
  const [local, nation, world] = await Promise.all(
    [HEADLINES_URLS.local, HEADLINES_URLS.nation, HEADLINES_URLS.world].map(async (u) =>
      parseHeadlines(await pull(u, fetchFn), HEADLINES_PER_FEED),
    ),
  );
  const headlines: Headlines = { local, nation, world };
  cached = { at: now, headlines };
  return headlines;
}
