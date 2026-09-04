import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Knobs } from "./params";
import { type Candidate, searchQuery, selectTracks } from "./select";
import { Choice, numbered, Pick } from "./shapes";
import { search } from "./spotify";

/**
 * One prompt becomes a playlist in three moves, straight through: Claude PROPOSES records by
 * name (leads, not gospel), Spotify search HYDRATES each into real candidate tracks (dumb,
 * keeps everything), Claude COMPOSES the playlist from those candidates by id — it can prefer
 * the live take when the ask wants one, and it cannot invent a track: every id is validated
 * against the pool and joined back to metadata we already hold (select.ts). Pure production:
 * no database in here; the caller owns the row. Failure throws PlaylistError with the receipts.
 */

// Inline for the stub; moves to the settings table when the prompts start being tuned.
const SYSTEM =
  "You are the music director of a radio station. You know records deeply — the singles, the versions, what defines a scene — and you build playlists that answer the listener's ask as it was meant: a record they name is wanted, an artist they name is wanted, a mood or a scene wants the record that defines it. The first record is the promise the hour makes.";

export interface Playlist {
  rationale: string;
  proposed: { rationale: string; picks: Pick[] };
  candidates: Candidate[];
  tracks: Candidate[];
  dropped: string[];
}

export class PlaylistError extends Error {
  readonly dropped: string[];
  constructor(message: string, dropped: string[] = []) {
    super(message);
    this.name = "PlaylistError";
    this.dropped = dropped;
  }
}

export async function producePlaylist(prompt: string, knobs: Knobs): Promise<Playlist> {
  const { propose, candidates: perPick, playlist, min } = knobs;

  // 1. PROPOSE — names only, wide on purpose: a dropped pick costs nothing now.
  const songs = numbered("song", propose, Pick);
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
                "how you read the request and what the opener has to be — a short paragraph in your own words",
              ),
            ...songs.shape,
          })
          .describe(
            `The request read and answered: ${propose} records, one per slot, in the order you would play them. Song 1 is the opener; the rest are leads for a catalogue search, the strongest first.`,
          ),
      ),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `The listener's request: ${prompt}`,
          "",
          "Read it first: what do they actually want, and what must the first record be?",
          "- If the request names a record, song 1 is that record, exactly as named — its artist, its title — never a substitute or a cousin.",
          "- If it names an artist, song 1 is that artist's record that best answers the request.",
          "- Otherwise song 1 is the record that defines what they asked for: the one anybody would expect to hear first, the canonical hit, not the deep cut.",
          "Song 1 hits hard — it is the first thing they hear.",
          `Then name ${propose - 1} more that could follow it, one per slot, fill every slot: the first few as strong and as on-the-nose as the opener, the range widening after that.`,
        ].join("\n"),
      },
    ],
  });
  if (!proposed.parsed_output) throw new PlaylistError(`claude proposed nothing (${proposed.stop_reason})`);
  const picks = songs.list(proposed.parsed_output);

  // 2. HYDRATE — dumb search, everything kept; a failed search is an empty hand, logged.
  const settled = await Promise.allSettled(picks.map((p) => search(searchQuery(p.artist, p.title), perPick)));
  const candidates: Candidate[] = [];
  const dropped: string[] = [];
  settled.forEach((s, i) => {
    const p = picks[i];
    if (s.status !== "fulfilled") {
      console.warn(`[sessions] search failed for ${p.artist} — ${p.title}: ${s.reason}`);
      dropped.push(`search failed for ${p.artist} — ${p.title}`);
      return;
    }
    if (!s.value.length) {
      dropped.push(`no hits for ${p.artist} — ${p.title}`);
      return;
    }
    for (const t of s.value)
      candidates.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: t.artists,
        album: t.album,
        image: t.images[0]?.url ?? null,
        durationMs: t.durationMs,
        pick: i,
        why: p.why,
      });
  });
  if (!candidates.length) throw new PlaylistError("no candidates resolved", dropped);

  // 3. COMPOSE — the real catalogue on the table, ids only; selection, not creation.
  const slots = numbered("slot", playlist, Choice);
  const menu = picks
    .map((p, i) => {
      const hits = candidates.filter((c) => c.pick === i);
      if (!hits.length) return null;
      const lines = hits.map(
        (c) =>
          `   ${c.id} | ${c.name} — ${c.artists.join(", ")} | ${c.album} | ${Math.floor(c.durationMs / 60000)}:${String(Math.floor((c.durationMs % 60000) / 1000)).padStart(2, "0")}`,
      );
      return `${i + 1}. ${p.artist} — ${p.title} (${p.why})\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n");
  const composed = await claude().messages.parse({
    model: env().CLAUDE_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(
        z
          .object({
            rationale: z
              .string()
              .describe("how this playlist works together, as a whole — a paragraph in your own words"),
            ...slots.shape,
          })
          .describe(
            `The playlist: ${playlist} slots in play order, each one candidate track id plus why it belongs in this set. Only ids from the candidate list count — anything else is discarded.`,
          ),
      ),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `The listener's request: ${prompt}`,
          "",
          "The catalogue offered these candidates for your proposed records. The version matters: the single or the original album cut unless the request wants a live take or a remix — never a remix, a cover, a karaoke, a sped-up or a tribute version by mistake; read the artist and the album, not just the title.",
          "",
          menu,
          "",
          `Compose the playlist: fill the ${playlist} slots in play order. Slot 1 is the opener — the record the request named if it named one, else the proposed song 1 — and it stays first; the rest follow in the order that plays best. Each slot one candidate id plus why that track belongs in this playlist (a slot's id is "" only if nothing deserves it).`,
        ].join("\n"),
      },
    ],
  });
  if (!composed.parsed_output)
    throw new PlaylistError(`claude composed nothing (${composed.stop_reason})`, dropped);
  const choices = slots.list(composed.parsed_output).filter((c) => c.id !== "");

  // 4. VALIDATE & JOIN — pure (select.ts); too few survivors is a failure with receipts.
  const sel = selectTracks(choices, candidates, playlist);
  dropped.push(...sel.dropped);
  if (sel.kept.length < min)
    throw new PlaylistError(`only ${sel.kept.length} tracks composed (need ${min})`, dropped);

  return {
    rationale: composed.parsed_output.rationale,
    proposed: { rationale: proposed.parsed_output.rationale, picks },
    candidates,
    tracks: sel.kept,
    dropped,
  };
}
