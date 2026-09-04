import type { Choice } from "./shapes";

/**
 * The guarantee half of composition, pure: compose chooses {id, why}; this validates every id
 * against the candidate pool (the model cannot invent a track), drops duplicates and overflow
 * with why, and joins the metadata we already hold — compose's why (written for the playlist)
 * replacing the propose-stage lead. Judgment lives in the model; this is the law.
 */

/** A hydrated candidate: one Qobuz hit joined to the pick it answered. */
export interface Candidate {
  id: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
  /** Index of the pick this hit answered. */
  pick: number;
  why: string;
}

export function selectTracks(
  choices: Choice[],
  pool: Candidate[],
  max: number,
): { kept: Candidate[]; dropped: string[] } {
  const byId = new Map<string, Candidate>();
  for (const c of pool) if (!byId.has(c.id)) byId.set(c.id, c);

  const kept: Candidate[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const { id, why } of choices) {
    const c = byId.get(id);
    if (!c) {
      dropped.push(`compose chose ${id}, which is not a candidate`);
      continue;
    }
    if (seen.has(id)) {
      dropped.push(`duplicate choice of ${c.artists.join(", ")} — ${c.name}`);
      continue;
    }
    if (kept.length >= max) {
      dropped.push(`${c.artists.join(", ")} — ${c.name} is over the playlist size (${max})`);
      continue;
    }
    seen.add(id);
    kept.push({ ...c, why });
  }
  return { kept, dropped };
}

/** A featured-artist tag in a title: "(feat. X)", "[ft. X]", "(with X)" — Qobuz's own titles carry it differently, so it only hurts a search. */
const FEAT_TAG = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;

/** What Qobuz is asked for a pick: the artist, then the title without its feat tag — plain words, the catalog search has no field syntax. */
export function searchQuery(artist: string, title: string): string {
  return `${artist.trim()} ${title.replace(FEAT_TAG, "").trim()}`;
}
