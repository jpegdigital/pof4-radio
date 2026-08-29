import type Anthropic from "@anthropic-ai/sdk";
import type { SegmentTrack } from "@radio/db";
import type { Track } from "@radio/spotify";
import { withCache } from "./history.ts";
import { TOOLS } from "./prompt.ts";

/**
 * One segment = one continuation of the station's conversation, with two tools:
 *
 *   search_spotify(query)  — the only way the DJ learns a track exists. Results are remembered
 *                            in `seen`, keyed by Spotify id.
 *   finish_segment(...)    — the structured answer: talk + ordered track ids. Strict schema, so
 *                            the shape is guaranteed; the ids are then checked against `seen` —
 *                            an id the DJ never got from a search is rejected with a tool error
 *                            and the DJ tries again.
 *
 * The loop is manual (no beta helper). The caller passes the station's trimmed history and the
 * new user turn; it gets back the segment and the raw messages of this turn to trim and store.
 */

export interface DjInput {
  /** The system prompt (settings slot `prompt.system`) — cached for an hour, so keep it stable. */
  system: string;
  history: Anthropic.MessageParam[];
  userTurn: string;
}

export interface DjOutput {
  talk: string;
  tracks: SegmentTrack[];
  /** The messages this turn appended (untrimmed) — pass through `trimTurn` before storing. */
  turn: Anthropic.MessageParam[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number };
}

export interface DjDeps {
  client: Anthropic;
  model: string;
  search: (query: string, limit: number) => Promise<Track[]>;
  signal?: AbortSignal;
}

interface SearchInput {
  query: string;
  limit: number;
}
interface FinishInput {
  talk: string;
  track_ids: string[];
}

const MAX_TURNS = 12; // searches are cheap; this is a runaway guard, not a budget
/** With this many calls left, the DJ is told to finish with what it has seen. */
const WRAP_UP_AT = 3;

/** What the DJ did this turn, for the log when it fails: searches made, finishes rejected. */
export function describeTurn(turn: Anthropic.MessageParam[]): string {
  const queries: string[] = [];
  let rejected = 0;
  let lastError = "";
  for (const m of turn) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use" && b.name === "search_spotify") queries.push((b.input as SearchInput).query);
      if (
        b.type === "tool_result" &&
        b.is_error &&
        typeof b.content === "string" &&
        !b.content.startsWith("search failed")
      ) {
        rejected++;
        lastError = b.content;
      }
    }
  }
  const shown = queries.length > 4 ? [...queries.slice(0, 3), "…", queries.at(-1) ?? ""] : queries;
  const parts = [
    `${queries.length} search${queries.length === 1 ? "" : "es"}${queries.length ? ` (${shown.join(", ")})` : ""}`,
  ];
  if (rejected) parts.push(`finish_segment rejected ${rejected}×, last: ${lastError}`);
  return parts.join("; ");
}

export function describeTrack(t: Track | SegmentTrack): string {
  const year = "releaseDate" in t && t.releaseDate ? ` (${t.releaseDate.slice(0, 4)})` : "";
  return `${t.artists.join(", ")} — ${t.name} [${t.album}${year}, ${Math.round(t.durationMs / 1000)}s] id=${t.id}`;
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
  if (!input.talk.trim()) {
    return { ok: false, error: "talk must not be empty." };
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
  const turn: Anthropic.MessageParam[] = [{ role: "user", content: input.userTurn }];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };

  for (let i = 0; i < MAX_TURNS; i++) {
    const response = await deps.client.messages.create(
      {
        model: deps.model,
        max_tokens: 4096,
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
        tools: TOOLS,
        messages: withCache([...input.history, ...turn]),
      },
      { signal: deps.signal },
    );
    usage.requests++;
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    if (response.stop_reason === "refusal") throw new Error("the DJ declined this request");
    if (response.stop_reason === "max_tokens") throw new Error("the DJ ran out of output tokens");

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    turn.push({ role: "assistant", content: response.content });
    if (toolUses.length === 0) {
      // It talked instead of acting. Nudge once; the turn cap stops a loop.
      turn.push({ role: "user", content: "Use the tools: search, then finish_segment." });
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let finished: { talk: string; tracks: SegmentTrack[] } | null = null;

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
          finished = { talk: fin.talk.trim(), tracks: check.tracks };
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Segment accepted." });
        } else {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: check.error });
        }
      } else {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "unknown tool" });
      }
    }

    const left = MAX_TURNS - i - 1;
    const content: Anthropic.ContentBlockParam[] =
      left === WRAP_UP_AT
        ? [
            ...results,
            {
              type: "text",
              text: `You have ${left} tool calls left. Call finish_segment now with 3 or 4 of the tracks you have already seen.`,
            },
          ]
        : results;
    turn.push({ role: "user", content });
    if (finished) return { ...finished, turn, usage };
  }

  throw new Error(`the DJ did not finish within ${MAX_TURNS} turns: ${describeTurn(turn)}`);
}
