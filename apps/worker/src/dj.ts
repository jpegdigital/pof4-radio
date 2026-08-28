import Anthropic from "@anthropic-ai/sdk";
import type { SegmentTrack } from "@radio/db";
import type { Track } from "@radio/spotify";

/**
 * The DJ: one Claude conversation per segment, with two tools.
 *
 *   search_spotify(query)  — the only way the DJ learns a track exists. Results are remembered
 *                            in `seen`, keyed by Spotify id.
 *   finish_segment(...)    — the structured answer: intro, ordered track ids, outro. Strict
 *                            schema, so the input shape is guaranteed; the ids are then checked
 *                            against `seen` — an id the DJ never got from a search is rejected
 *                            with a tool error, and the DJ tries again.
 *
 * The loop is manual (no beta helper, nothing to keep up with). System prompt and tool list
 * are frozen strings so the prefix caches across segments; everything that changes per segment
 * (listener prompt, recent history) lives in the user message.
 */

export interface DjInput {
  listenerPrompt: string;
  /** Newest first. What not to repeat. */
  recentlyPlayed: SegmentTrack[];
}

export interface DjOutput {
  intro: string;
  outro: string;
  tracks: SegmentTrack[];
}

export interface DjDeps {
  client: Anthropic;
  model: string;
  search: (query: string, limit: number) => Promise<Track[]>;
  signal?: AbortSignal;
}

export const SYSTEM = `You are the on-air DJ of a small personal radio station. One listener, listening now, told you what they're in the mood for. You program one *segment* at a time: a short spoken intro, 3 to 4 tracks, and a short spoken outro. The station plays your segments back to back, so each one should flow from what came before.

How you work:
- Use search_spotify to find real tracks. Search as many times as you need (different artists, eras, moods, exact titles you have in mind) — but only tracks that came back from a search can go in the segment. Never invent an id.
- Pick for flow: an arc across the 3–4 tracks, and a link to the previous segment when there was one. Avoid anything in the recently-played list and avoid repeating an artist inside one segment unless the listener asked for that artist.
- Your commentary is *spoken*, not read. Write the way a warm, unhurried late-night host talks: short sentences, contractions, no lists, no markdown, no emoji, nothing a voice can't say. The intro names the artist and title of the first track and says something true and specific (a year, a place, a detail about the record) — 2 to 4 sentences. The outro closes the block and teases the next one — 1 to 3 sentences.
- When you're done, call finish_segment exactly once. Don't write anything else after it.`;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_spotify",
    description:
      "Search Spotify's catalog for tracks. Query supports Spotify search syntax, e.g. 'artist:Khruangbin', 'track:Texas Sun', 'year:1971-1975 genre:soul', or plain words. Returns up to `limit` tracks with their Spotify ids, artists, album, year and duration.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        limit: { type: "integer", description: "Max results, 1 to 20. Use 8 unless you need more." },
      },
      required: ["query", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "finish_segment",
    description:
      "Deliver the finished segment. Every id in track_ids must have come back from a search_spotify call in this conversation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        intro: { type: "string", description: "Spoken lead-in, 2–4 sentences." },
        track_ids: {
          type: "array",
          description: "Spotify track ids in play order, 3 to 4 of them.",
          items: { type: "string" },
        },
        outro: { type: "string", description: "Spoken sign-off for this block, 1–3 sentences." },
      },
      required: ["intro", "track_ids", "outro"],
      additionalProperties: false,
    },
  },
];

interface SearchInput {
  query: string;
  limit: number;
}
interface FinishInput {
  intro: string;
  track_ids: string[];
  outro: string;
}

const MAX_TURNS = 12; // searches are cheap; this is a runaway guard, not a budget

export function describeTrack(t: Track | SegmentTrack): string {
  const year = "releaseDate" in t && t.releaseDate ? ` (${t.releaseDate.slice(0, 4)})` : "";
  return `${t.artists.join(", ")} — ${t.name} [${t.album}${year}, ${Math.round(t.durationMs / 1000)}s] id=${t.id}`;
}

/** The per-segment user message: the listener's ask plus the station's recent memory. */
export function userMessage(input: DjInput): string {
  const recent = input.recentlyPlayed.length
    ? input.recentlyPlayed.map((t) => `- ${t.artists.join(", ")} — ${t.name}`).join("\n")
    : "(nothing yet — this is the first segment of the session)";
  return `Listener's request: ${input.listenerPrompt}

Recently played (newest first):
${recent}

Program the next segment.`;
}

/**
 * Check a finish_segment call against what the DJ actually saw. Returns the resolved
 * tracks in order, or the reason it's not acceptable (sent back as a tool error).
 */
export function resolveFinish(
  input: FinishInput,
  seen: ReadonlyMap<string, Track>,
): { ok: true; tracks: SegmentTrack[] } | { ok: false; error: string } {
  const unknown = input.track_ids.filter((id) => !seen.has(id));
  if (unknown.length) {
    return {
      ok: false,
      error: `These ids never came back from search_spotify: ${unknown.join(", ")}. Search for the tracks you want and use the ids from the results.`,
    };
  }
  if (input.track_ids.length < 3 || input.track_ids.length > 4) {
    return { ok: false, error: `A segment has 3 or 4 tracks; you gave ${input.track_ids.length}.` };
  }
  if (new Set(input.track_ids).size !== input.track_ids.length) {
    return { ok: false, error: "track_ids contains a duplicate." };
  }
  if (!input.intro.trim() || !input.outro.trim()) {
    return { ok: false, error: "intro and outro must both be non-empty." };
  }
  const tracks = input.track_ids.map((id) => {
    const t = seen.get(id)!;
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: t.artists,
      album: t.album,
      durationMs: t.durationMs,
    };
  });
  return { ok: true, tracks };
}

export async function planSegment(input: DjInput, deps: DjDeps): Promise<DjOutput> {
  const seen = new Map<string, Track>();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage(input) }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await deps.client.messages.create(
      {
        model: deps.model,
        max_tokens: 4096,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      },
      { signal: deps.signal },
    );

    if (response.stop_reason === "refusal") throw new Error("the DJ declined this request");
    if (response.stop_reason === "max_tokens") throw new Error("the DJ ran out of output tokens");

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      // It talked instead of acting. Nudge once; the turn cap stops a loop.
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: "Use the tools: search, then finish_segment." });
      continue;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    let finished: DjOutput | null = null;

    for (const use of toolUses) {
      if (use.name === "search_spotify") {
        const { query, limit } = use.input as SearchInput;
        try {
          const tracks = await deps.search(query, limit);
          for (const t of tracks) seen.set(t.id, t);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: tracks.length ? tracks.map(describeTrack).join("\n") : "No results.",
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `search failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      } else if (use.name === "finish_segment") {
        const fin = use.input as FinishInput;
        const check = resolveFinish(fin, seen);
        if (check.ok) {
          finished = { intro: fin.intro.trim(), outro: fin.outro.trim(), tracks: check.tracks };
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Segment accepted." });
        } else {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: check.error });
        }
      } else {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "unknown tool" });
      }
    }

    if (finished) return finished;
    messages.push({ role: "user", content: results });
  }

  throw new Error(`the DJ did not finish within ${MAX_TURNS} turns`);
}
