/**
 * The headlines as the station reads them, cut from Google News RSS: three feeds — the city, the
 * nation, the world — each a ranked list of `<item>`s whose title is `Headline - Source`. Pure:
 * the pull lives in apps/web (lib/producer/headlines.ts); this file reads the XML by hand (a
 * regex over the items, no XML library) and keeps the top few of each, the source beside the
 * title so the DJ can credit it.
 */

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
