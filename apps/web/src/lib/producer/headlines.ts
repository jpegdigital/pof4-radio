import { HEADLINES_PER_FEED, type Headlines, parseHeadlines } from "@radio/dj";

/**
 * The headlines pull: three Google News RSS feeds — the city, the nation, the world — no key,
 * no package, plain fetch (each answers with a redirect to its topic id; fetch follows it),
 * parsed by hand and cached for ten minutes so every slot of a show reads one pull. The city is
 * the station's: Dallas, the feed's own geo section. Google's feeds are for personal,
 * non-commercial use, which is what this station is.
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
