import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Card as KeptCard } from "@radio/db";
import type { Card } from "@radio/dj";
import { claude } from "@/lib/claude";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { CardFacts } from "./shapes";

/**
 * The cards for a segment's tracks: the table first (a record's card belongs to the record,
 * shared by every session — the first to play it pays), the missing ones made now, all at once.
 * A refusal gets one more try (noise more often than a verdict); then no card, with why. No card
 * is never an error: the clock rules make that slot a segue.
 */

// Inline for the stub, like the playlist's; moves to the settings table when the prompts start being tuned.
const SYSTEM =
  "You are a radio music director with an encyclopedic memory of records: how they start, how they end, what they feel like. You never quote a lyric.";

export interface CardTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

const describe = (t: CardTrack) =>
  `${t.artists.join(", ")} — "${t.name}" (album: ${t.album}; this version runs ${Math.round(t.durationMs / 1000)} s)`;

async function makeCard(t: CardTrack): Promise<Card> {
  const once = () =>
    claude().messages.parse({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(CardFacts) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Describe this record for a DJ who is about to play it: ${describe(t)}.\n\nThe single version as released. The post is *where* the vocal comes in, in your own words — never the lyric. If you are not sure of the intro length to within a second or two, say so with sure=false.`,
        },
      ],
    });
  let res = await once();
  if (res.stop_reason === "refusal") res = await once();
  if (!res.parsed_output) throw new Error(`claude gave no card (${res.stop_reason})`);
  const facts = res.parsed_output;
  return {
    ...facts,
    id: t.id,
    name: t.name,
    artists: t.artists,
    introMs: Math.max(0, Math.min(facts.introMs, t.durationMs)),
    outroMs: Math.max(0, Math.min(facts.outroMs, t.durationMs)),
    thinking: "",
    model: env().CLAUDE_MODEL,
  };
}

export interface Carded {
  cards: Map<string, KeptCard>;
  /** Made on this call, by track id. */
  made: string[];
  /** Why a track has no card, one line each. */
  missing: string[];
}

export async function ensureCards(tracks: CardTrack[]): Promise<Carded> {
  const cards = await db().getCards(tracks.map((t) => t.id));
  const todo = tracks.filter((t) => !cards.has(t.id));
  const settled = await Promise.allSettled(todo.map((t) => makeCard(t)));
  const made: string[] = [];
  const missing: string[] = [];
  for (const [i, s] of settled.entries()) {
    const t = todo[i];
    if (s.status === "fulfilled") {
      cards.set(t.id, await db().putCard(s.value));
      made.push(t.id);
    } else {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.warn(`[sessions] no card for ${t.artists.join(", ")} — ${t.name}: ${reason}`);
      missing.push(`no card for ${t.name}: ${reason}`);
    }
  }
  return { cards, made, missing };
}
