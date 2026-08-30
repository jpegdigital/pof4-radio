import {
  DISCOVER_TOOL,
  type Dropped,
  fillVars,
  type Identity,
  layBreaks,
  type Pick,
  type PromptTemplate,
  type Record,
  SKELETON_MAX,
  SKELETON_MIN,
  Skeleton,
} from "@radio/dj";
import type { Track } from "@radio/spotify";
import { search } from "@/lib/spotify";
import { ask, type Usage } from "./ask";
import { ProducerError } from "./errors";

/**
 * The hour's skeleton: one call for the picks, then Spotify resolves each — the shortest hit whose
 * name is the title *and* whose artist is the pick's (the single, not the 12" or the live take;
 * never a different record that happened to rank first), never a record already played on this
 * station. A pick with no such hit is dropped, with why. Fewer than SKELETON_MIN resolved is a
 * 502; breaks are laid every 3–5.
 */

export interface DiscoverInput {
  template: PromptTemplate;
  request: string;
  dj: string;
  identity: Identity;
  clock: string;
  /** Every record kept on this station so far — never repeated. */
  played: Record[];
}

interface Finish {
  rationale: string;
  picks: Pick[];
}

export const identityLine = (i: Identity) => `${i.calls}, ${i.city} — said on air as "${i.onAir}"`;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Talk Talk" matches "Talk Talk", "The Talk Talk", "Talk Talk feat. X" — one name contains the other. */
const sameArtist = (hit: string[], artist: string) => {
  const want = norm(artist).replace(/^the /, "");
  return hit.some((a) => {
    const have = norm(a).replace(/^the /, "");
    return have === want || have.includes(want) || want.includes(have);
  });
};

/** Search the catalogue for a pick: the shortest hit that is the title by the artist, or nothing. */
async function resolve(p: Pick, index: number): Promise<Record | { dropped: Dropped }> {
  const hits = await search(`${p.title} artist:${p.artist}`, 5);
  const same = hits.filter((t) => norm(t.name) === norm(p.title) && sameArtist(t.artists, p.artist));
  const t: Track | undefined = same.length
    ? same.reduce((a, b) => (b.durationMs < a.durationMs ? b : a))
    : undefined;
  if (!t) {
    const top = hits[0];
    const reason = top
      ? `no hit for ${p.artist} — ${p.title} (nearest: ${top.artists.join(", ")} — ${top.name})`
      : `no hit for ${p.artist} — ${p.title}`;
    return { dropped: { pick: index, reason } };
  }
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists,
    album: t.album,
    image: t.images[0]?.url ?? null,
    durationMs: t.durationMs,
    pick: index,
    why: p.why,
    ...(t.id !== hits[0]?.id ? { resolved: `shortest match of ${hits.length}` } : {}),
  };
}

export async function discover(input: DiscoverInput): Promise<{ skeleton: Skeleton; usage: Usage }> {
  const brief = fillVars(input.template["prompt.discover"], {
    request: input.request,
    dj: input.dj,
    identity: identityLine(input.identity),
    clock: input.clock,
    played: input.played.length
      ? input.played.map((r, i) => `${i + 1}. ${r.artists.join(", ")} — ${r.name}`).join("\n")
      : "none",
  });
  const { out, usage } = await ask<Finish>(input.template["prompt.system"], brief, DISCOVER_TOOL, "medium");

  const played = new Set(input.played.map((r) => r.id));
  const seen = new Set<string>();
  const records: Record[] = [];
  const dropped: Dropped[] = [];
  const resolved = await Promise.allSettled(out.picks.map(resolve));
  for (const [i, r] of resolved.entries()) {
    if (r.status !== "fulfilled") {
      dropped.push({
        pick: i,
        reason: `search failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      });
      continue;
    }
    if ("dropped" in r.value) {
      dropped.push(r.value.dropped);
      continue;
    }
    const rec = r.value;
    if (played.has(rec.id) || seen.has(rec.id)) continue;
    seen.add(rec.id);
    records.push(rec);
  }
  const kept = records.slice(0, SKELETON_MAX);
  if (kept.length < SKELETON_MIN) {
    throw new ProducerError(
      502,
      `discover: only ${kept.length} of ${out.picks.length} picks resolved (need ${SKELETON_MIN})`,
    );
  }
  const skeleton = Skeleton.parse({
    rationale: out.rationale,
    records: kept,
    breaks: layBreaks(kept.length),
    consumed: 0,
    plannedAt: new Date().toISOString(),
    dropped,
  });
  return { skeleton, usage };
}
