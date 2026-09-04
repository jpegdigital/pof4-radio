import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Identity } from "@/lib/identity";
import type { Hit } from "./doc";
import type { Qobuz } from "./qobuz";
import { numbered, Proposal } from "./shapes";

/**
 * The fill: a few more slots for the show, straight through. Claude PROPOSES songs by name —
 * leads, not gospel — knowing what has played and what is coming; a proposal already in the show
 * is dropped (`dedupe`); Qobuz search finds up to HITS_PER_PROPOSAL streamable versions of each
 * (`searchQuery`); a proposal with at least one hit becomes a slot, in the proposer's order,
 * until `count` are made. The pick among the hits is the writer's, later, one slot at a time.
 * Pure production: no database in here; the caller owns the rows. Nothing made throws
 * FillError with the receipts.
 */

/** How many versions of a song the writer gets to choose from. */
export const HITS_PER_PROPOSAL = 3;
/** The proposer names this many more than the fill wants: a dropped proposal costs nothing now. */
export const PROPOSE_OVER = 2;

// Inline for now; moves to the settings table when the prompts start being tuned.
const SYSTEM =
  "You are the music director of a radio station. You know records deeply — the singles, the versions, what defines a scene — and you build shows that answer the listener's ask as it was meant: a song they name is wanted, an artist they name is wanted, a mood or a scene wants the song that defines it. The first song is the promise the hour makes.";

/** A featured-artist tag in a title: "(feat. X)", "[ft. X]", "(with X)" — Qobuz's own titles carry it differently, so it only hurts a search. */
export const FEAT_TAG = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;

/** What Qobuz is asked for a proposal: the artist, then the title without its feat tag — plain words, the catalog search has no field syntax. */
export function searchQuery(artist: string, title: string): string {
  return `${artist.trim()} ${title.replace(FEAT_TAG, "").trim()}`;
}

/** A song already in the show, as the proposer named it. */
export interface Taken {
  title: string;
  artist: string;
}

const keyOf = (t: Taken) => `${t.artist.trim().toLowerCase()}\n${t.title.trim().toLowerCase()}`;

/** Drop every proposal already in the show, or already proposed in this fill, case-insensitive; keep the order. */
export function dedupe(proposals: Proposal[], taken: Taken[]): { kept: Proposal[]; dropped: string[] } {
  const seen = new Set(taken.map(keyOf));
  const kept: Proposal[] = [];
  const dropped: string[] = [];
  for (const p of proposals) {
    const k = keyOf(p);
    if (seen.has(k)) {
      dropped.push(`${p.artist} — ${p.title} is already in the show`);
      continue;
    }
    seen.add(k);
    kept.push(p);
  }
  return { kept, dropped };
}

export class FillError extends Error {
  readonly dropped: string[];
  constructor(message: string, dropped: string[] = []) {
    super(message);
    this.name = "FillError";
    this.dropped = dropped;
  }
}

/** One slot as the fill lands it: the proposal and the versions Qobuz found. */
export interface NewSlot {
  title: string;
  artist: string;
  why: string;
  hits: Hit[];
}

export interface FillInput {
  prompt: string;
  dj: string | null;
  identity: Identity;
  /** Written slots so far, in show order. */
  played: Taken[];
  /** Proposed slots not yet written, in show order. */
  pending: Taken[];
  /** How many slots to make. */
  count: number;
}

const list = (songs: Taken[]) => songs.map((s) => `- ${s.artist} — ${s.title}`).join("\n");

/** The brief: the ask, the station, what has played, what is coming, and what the first song must be. */
export function fillBrief(input: FillInput, propose: number): string {
  const { prompt, dj, identity, played, pending } = input;
  const fresh = played.length === 0 && pending.length === 0;
  const opener = [
    "Read it first: what do they actually want, and what must the first song be?",
    "- If the request names a song, song 1 is that song, exactly as named — its artist, its title — never a substitute or a cousin.",
    "- If it names an artist, song 1 is that artist's song that best answers the request.",
    "- Otherwise song 1 is the song that defines what they asked for: the one anybody would expect to hear first, the canonical hit, not the deep cut.",
    "Song 1 hits hard — it is the first thing they hear.",
    `Then name ${propose - 1} more that could follow it, one per slot, fill every slot: the first few as strong and as on-the-nose as the opener, the range widening after that.`,
  ];
  const more = [
    `The show is on the air. Name ${propose} more songs that carry it on from where it stands, one per slot, in the order you would play them — the next as strong as what has played, the range widening after that. Never name a song already played or already coming up, and never the same song twice.`,
  ];
  return [
    `The listener's request: ${prompt}`,
    `The station: ${identity.onAir} (${identity.calls}, ${identity.city})${dj ? `; ${dj} is on the mic` : ""}.`,
    "",
    ...(played.length ? [`Already played, in order:`, list(played), ""] : []),
    ...(pending.length
      ? [`Coming up, already on the rundown — never name any of these again:`, list(pending), ""]
      : []),
    ...(fresh ? opener : more),
  ].join("\n");
}

export async function produceFill(
  q: Qobuz,
  input: FillInput,
): Promise<{ slots: NewSlot[]; dropped: string[] }> {
  const propose = input.count + PROPOSE_OVER;
  const fresh = input.played.length === 0 && input.pending.length === 0;

  // 1. PROPOSE — names only, wide on purpose.
  const songs = numbered("song", propose, Proposal);
  const proposed = await claude().messages.parse({
    model: env().CLAUDE_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(
        z
          .object({
            rationale: z
              .string()
              .describe(
                fresh
                  ? "how you read the request and what the opener has to be — a short paragraph in your own words"
                  : "how these carry the show on from where it stands — a short paragraph in your own words",
              ),
            ...songs.shape,
          })
          .describe(
            `${propose} songs, one per slot, in the order you would play them: leads for a catalogue search, the strongest first.`,
          ),
      ),
    },
    system: SYSTEM,
    messages: [{ role: "user", content: fillBrief(input, propose) }],
  });
  if (!proposed.parsed_output) throw new FillError(`claude proposed nothing (${proposed.stop_reason})`);
  const { kept, dropped } = dedupe(songs.list(proposed.parsed_output), [...input.played, ...input.pending]);

  // 2. SEARCH — dumb, in parallel; a failed search is an empty hand, logged.
  const settled = await Promise.allSettled(
    kept.map((p) => q.search(searchQuery(p.artist, p.title), HITS_PER_PROPOSAL)),
  );
  const slots: NewSlot[] = [];
  settled.forEach((s, i) => {
    const p = kept[i];
    if (slots.length >= input.count) {
      dropped.push(`${p.artist} — ${p.title} is over the fill (${input.count})`);
      return;
    }
    if (s.status !== "fulfilled") {
      console.warn(`[sessions] search failed for ${p.artist} — ${p.title}: ${s.reason}`);
      dropped.push(`search failed for ${p.artist} — ${p.title}`);
      return;
    }
    if (!s.value.length) {
      dropped.push(`no hits for ${p.artist} — ${p.title}`);
      return;
    }
    slots.push({
      title: p.title,
      artist: p.artist,
      why: p.why,
      hits: s.value.map((t) => ({
        id: t.id,
        title: t.title,
        artists: t.artists,
        album: t.album,
        image: t.image,
        durationMs: t.durationMs,
      })),
    });
  });
  if (!slots.length) throw new FillError("no proposal found a version to play", dropped);
  return { slots, dropped };
}
