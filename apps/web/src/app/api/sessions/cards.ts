import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { claude } from "@/lib/claude";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { CardFacts } from "./shapes";

/**
 * The cards for a segment's tracks: the table first (a record's card belongs to the record,
 * shared by every session — the first to play it pays), the missing ones made now, all at once.
 * A refusal gets one more try (noise more often than a verdict); then no card, with why. No card
 * is never an error: the clock rules make that slot a segue.
 */

/** A record's card (schema/card.sql), keyed by Spotify track id: the facts plus the record's own fields. */
export interface Card extends CardFacts {
  id: string;
  name: string;
  artists: string[];
  thinking: string;
  model: string;
}

interface CardRow {
  id: string;
  name: string;
  artists: string[];
  intro_ms: number;
  sure: boolean;
  post: string;
  outro: Card["outro"];
  outro_ms: number;
  energy: number;
  tempo: Card["tempo"];
  mood: string;
  notes: string[];
  thinking: string;
  model: string;
}

const cardOf = (r: CardRow): Card => ({
  id: r.id,
  name: r.name,
  artists: r.artists,
  introMs: r.intro_ms,
  sure: r.sure,
  post: r.post,
  outro: r.outro,
  outroMs: r.outro_ms,
  energy: r.energy,
  tempo: r.tempo,
  mood: r.mood,
  notes: r.notes,
  thinking: r.thinking,
  model: r.model,
});

async function getCards(ids: string[]): Promise<Map<string, Card>> {
  if (!ids.length) return new Map();
  const { rows } = await pool().query<CardRow>("select * from card where id = any($1::text[])", [ids]);
  return new Map(rows.map((r) => [r.id, cardOf(r)]));
}

/** Insert or correct a card in place. */
async function putCard(c: Card): Promise<Card> {
  const { rows } = await pool().query<CardRow>(
    `insert into card (id, name, artists, intro_ms, sure, post, outro, outro_ms, energy, tempo, mood, notes, thinking, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (id) do update set
       name = excluded.name, artists = excluded.artists, intro_ms = excluded.intro_ms, sure = excluded.sure,
       post = excluded.post, outro = excluded.outro, outro_ms = excluded.outro_ms, energy = excluded.energy,
       tempo = excluded.tempo, mood = excluded.mood, notes = excluded.notes, thinking = excluded.thinking,
       model = excluded.model
     returning *`,
    [
      c.id,
      c.name,
      JSON.stringify(c.artists),
      c.introMs,
      c.sure,
      c.post,
      c.outro,
      c.outroMs,
      c.energy,
      c.tempo,
      c.mood,
      JSON.stringify(c.notes),
      c.thinking,
      c.model,
    ],
  );
  return cardOf(rows[0]);
}

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
  cards: Map<string, Card>;
  /** Made on this call, by track id. */
  made: string[];
  /** Why a track has no card, one line each. */
  missing: string[];
}

export async function ensureCards(tracks: CardTrack[]): Promise<Carded> {
  const cards = await getCards(tracks.map((t) => t.id));
  const todo = tracks.filter((t) => !cards.has(t.id));
  const settled = await Promise.allSettled(todo.map((t) => makeCard(t)));
  const made: string[] = [];
  const missing: string[] = [];
  for (const [i, s] of settled.entries()) {
    const t = todo[i];
    if (s.status === "fulfilled") {
      cards.set(t.id, await putCard(s.value));
      made.push(t.id);
    } else {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.warn(`[sessions] no card for ${t.artists.join(", ")} — ${t.name}: ${reason}`);
      missing.push(`no card for ${t.name}: ${reason}`);
    }
  }
  return { cards, made, missing };
}
