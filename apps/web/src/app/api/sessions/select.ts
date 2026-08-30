import type { Choice } from "./tools";

/**
 * The guarantee half of composition, pure: compose chooses {id, why}; this validates every id
 * against the candidate pool (the model cannot invent a track), drops duplicates and overflow
 * with why, and joins the metadata we already hold — compose's why (written for the playlist)
 * replacing the propose-stage lead. Judgment lives in the model; this is the law.
 */

/** A hydrated candidate: one Spotify hit joined to the pick it answered. */
export interface Candidate {
  id: string;
  uri: string;
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
