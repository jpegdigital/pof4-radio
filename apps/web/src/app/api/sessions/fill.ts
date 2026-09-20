import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Hit } from "./doc";
import { FIND_KINDS, type Qobuz } from "./qobuz";
import type { Proposal } from "./shapes";
import { prompts } from "../../../lib/prompts/index.ts";
import { albumText, foundText, type FillInput, type Taken } from "../../../lib/prompts/fill.ts";
export type { FillInput, Taken } from "../../../lib/prompts/fill.ts";

/**
 * The fill: a few more slots for the show, straight through. Claude PROPOSES songs by name —
 * leads, not gospel — knowing what has played and what is coming, with the catalog in the room:
 * two tools, `search` (albums, tracks, artists, playlists by name) and `album` (a record's tracks
 * in order), so a record it has never heard of — released after its training, or just obscure —
 * is a lookup, not a guess (`catalogTools`). A proposal already in the show is dropped
 * (`dedupe`); Qobuz search finds up to HITS_PER_PROPOSAL streamable versions of each
 * (`searchQuery`); a proposal with at least one hit becomes a slot, in the proposer's order,
 * until `count` are made. Jev picks among the hits later, one slot at a time, before Claude writes.
 * Pure production: no database in here; the caller owns the rows. Nothing made throws
 * FillError with the receipts.
 */

/** How many recordings of a song Jev gets to choose from. */
export const HITS_PER_PROPOSAL = 3;
/** The proposer names this many more than the fill wants: a dropped proposal costs nothing now. */
export const PROPOSE_OVER = 2;
/** How many lookups the proposer may make before it must answer; each is one more model call. */
export const LOOKUPS = 6;
/** Hits per bucket on an untyped search, and on a typed one. */
export const FIND_ALL_LIMIT = 5;
export const FIND_ONE_LIMIT = 10;

/** A featured-artist tag in a title: "(feat. X)", "[ft. X]", "(with X)" — Qobuz's own titles carry it differently, so it only hurts a search. */
export const FEAT_TAG = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;

/** What Qobuz is asked for a proposal: the artist, then the title without its feat tag — plain words, the catalog search has no field syntax. */
export function searchQuery(artist: string, title: string): string {
  return `${artist.trim()} ${title.replace(FEAT_TAG, "").trim()}`;
}

/** A song already in the show, as the proposer named it. */
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

/** The two lookups the proposer may make; each result is text it reads, logged as it happens. */
export function catalogTools(q: Qobuz) {
  const search = betaZodTool({
    name: "search",
    description: prompts.fill.tools.search,
    inputSchema: z.object({
      query: z.string().describe(prompts.fill.tools.query),
      kind: z.enum(FIND_KINDS).describe(prompts.fill.tools.kind),
    }),
    run: async ({ query, kind }) => {
      const found = await q.find(query, kind, kind === "all" ? FIND_ALL_LIMIT : FIND_ONE_LIMIT);
      const n = found.albums.length + found.tracks.length + found.artists.length + found.playlists.length;
      console.log(`[sessions] fill search "${query}" (${kind}) → ${n}`);
      return foundText(found);
    },
  });
  const album = betaZodTool({
    name: "album",
    description: prompts.fill.tools.album,
    inputSchema: z.object({ id: z.string().describe(prompts.fill.tools.albumId) }),
    run: async ({ id }) => {
      const r = await q.album(id);
      console.log(
        `[sessions] fill album ${id}: ${r.album.artist} — ${r.album.title}, ${r.tracks.length} tracks`,
      );
      return albumText(r.album, r.tracks);
    },
  });
  return [search, album];
}

export async function produceFill(
  q: Qobuz,
  input: FillInput,
): Promise<{ slots: NewSlot[]; dropped: string[] }> {
  const propose = input.count + PROPOSE_OVER;

  // 1. PROPOSE — names, with the catalog to hand: the runner loops the lookups, the last message
  // is the answer, held to the shape. Out of lookups with none given is a fault, not a guess.
  const prompt = prompts.fill.render(input, propose);
  const { output, list } = prompts.fill.output(input, propose);
  const format = betaZodOutputFormat(output);
  const last = await claude()
    .beta.messages.toolRunner({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format },
      tools: catalogTools(q),
      max_iterations: LOOKUPS + 1,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.brief }],
    })
    .runUntilDone();
  const answer = last.content.find((b) => b.type === "text");
  if (!answer) throw new FillError(`claude proposed nothing (${last.stop_reason})`);
  const proposed = format.parse(answer.text);
  const { kept, dropped } = dedupe(list(proposed), [...input.played, ...input.pending]);

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
