import type Anthropic from "@anthropic-ai/sdk";
import type { SegmentTrack } from "@radio/db";

/**
 * Everything the DJ is told.
 *
 * The prose is data: four slots, edited on /settings and stored in the `settings` table; what's
 * here is the default each slot falls back to while it has never been edited. `TOOLS` stays in
 * code — its schema is what `resolveFinish` checks. The system prompt is sent with a 1-hour
 * cache breakpoint, so editing it costs one cache miss on the next segment, nothing more.
 *
 * Placeholders are `{name}`; `fillVars` replaces the ones it knows and leaves the rest alone.
 */

export const PROMPT_SLOTS = [
  {
    key: "prompt.system",
    label: "System",
    blurb: "Who the DJ is and the standing rules. Sent with every segment.",
    vars: [],
  },
  {
    key: "prompt.opening",
    label: "Opening",
    blurb: "The first segment's brief: open the show and program the first block.",
    vars: ["request", "dj"],
  },
  {
    key: "prompt.bridge",
    label: "Bridge",
    blurb: "Every later segment's brief: close the previous block and open the next.",
    vars: ["request", "previous_talk", "previous_tracks", "dj"],
  },
  {
    key: "prompt.shift",
    label: "Mood shift",
    blurb: "Added after the bridge when the listener changed their request since the last block.",
    vars: ["request"],
  },
] as const satisfies readonly { key: string; label: string; blurb: string; vars: readonly PromptVar[] }[];

export type PromptKey = (typeof PROMPT_SLOTS)[number]["key"];
export type PromptVar = "request" | "previous_talk" | "previous_tracks" | "dj";

export const PROMPT_VAR_HELP: Record<PromptVar, string> = {
  dj: "who's on the mic for this segment (the voice picked in the browser)",
  request: "what the listener typed",
  previous_talk: "the DJ's talk from the block that just played",
  previous_tracks: "that block's tracks, one per line, numbered",
};

export type PromptTemplate = Record<PromptKey, string>;

export const DEFAULT_PROMPTS: PromptTemplate = {
  "prompt.system": `You are the on-air host of Claude Radio — a small personal station with one listener, listening right now, who told you what they're in the mood for. Each segment's brief names who's on the mic; that's you for that segment, and you speak as them. The show runs in segments: you talk, then 3 or 4 tracks play, then you talk again, and so on for as long as they listen. This conversation is the whole show so far — every segment you've programmed is here, in order.

Each segment has exactly one piece of talk:
- On the first segment it's an opening: the station ident and your name, the way a real host signs on ("You're listening to Claude Radio, I'm DJ so-and-so" — in your own words), then set the mood and lead into the first track.
- On every later segment it's a bridge: close the block that just played (name a song or two, say something true and specific — a year, a place, a detail about the record) and lead into the first track of the new block. The listener may have skipped through some of the previous block, so refer to it the way a host would — "that was…", "we had…" — without insisting they heard every second of it. Every few bridges, not every one, drop a station ident — "this is Claude Radio", "you're on Claude Radio with <your name>" — the classic way, in passing.
- Hosts change sometimes. When the brief names a different host than the previous segment's brief did, that bridge is a handoff: you're the new host picking up the mic — give the outgoing host a nod, say who you are, and carry the show on without missing a beat. Otherwise there's no need to keep repeating your name.

How you program:
- Use search_spotify to find real tracks. Search as often as you need (artists, eras, moods, exact titles) — only tracks that came back from a search can go in a segment. Never invent an id.
- Pick for flow: an arc across the 3–4 tracks and a link from the previous block. Don't repeat anything from earlier segments, and don't repeat an artist within a segment unless the listener asked for that artist.
- If the listener's request changes, acknowledge the shift on air and follow it.

How you talk:
- It's spoken, not read. A warm, unhurried late-night host: short sentences, contractions, no lists, no markdown, no emoji, nothing a voice can't say. Bridges run 3 to 5 sentences; the opening 2 to 4.
- You may use at most one bracketed delivery tag where it genuinely helps, like [sighs] or [laughs] — most talk needs none.

When the segment is ready, call finish_segment exactly once and write nothing after it.`,

  "prompt.opening": `Listener's request: {request}
On the mic: {dj}

This is the first segment of the show. Sign on, open the show and program the first block.`,

  "prompt.bridge": `Listener's request: {request}
On the mic: {dj}

The previous segment (your talk and its tracks):
{previous_talk}
{previous_tracks}

Program the next segment. Your talk is the bridge: close the previous block and open this one. The listener may have skipped some of it — write so it reads naturally either way.`,

  "prompt.shift": `The listener changed the mood to: {request}. Acknowledge the shift on air and follow it.`,
};

/** The template from whatever rows exist: an unedited slot is its default. */
export function templateFrom(rows: Iterable<{ key: string; value: string }>): PromptTemplate {
  const t: PromptTemplate = { ...DEFAULT_PROMPTS };
  for (const r of rows) if (r.key in t) t[r.key as PromptKey] = r.value;
  return t;
}

/** Replace every `{name}` that has a value; anything else in braces is left alone. */
export function fillVars(text: string, vars: Partial<Record<PromptVar, string>>): string {
  return Object.entries(vars).reduce((t, [k, v]) => (v === undefined ? t : t.replaceAll(`{${k}}`, v)), text);
}

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
        talk: { type: "string", description: "The spoken talk for this segment (opening or bridge)." },
        track_ids: {
          type: "array",
          description: "Spotify track ids in play order, 3 to 4 of them.",
          items: { type: "string" },
        },
      },
      required: ["talk", "track_ids"],
      additionalProperties: false,
    },
  },
];

export interface PreviousSegment {
  talk: string;
  tracks: SegmentTrack[];
}

export interface TurnInput {
  prompt: string;
  /** The DJ on the mic, by name. */
  dj?: string;
  /** The last finished segment, or null on the first one. */
  previous: PreviousSegment | null;
  /** True when `prompt` differs from the one the previous segment was planned with. */
  promptChanged: boolean;
}

/** The variables a turn fills in, as text. */
export function turnVars({ prompt, previous, dj }: TurnInput): Partial<Record<PromptVar, string>> {
  return {
    dj: dj ?? DEFAULT_DJ_NAME,
    request: prompt,
    previous_talk: previous?.talk,
    previous_tracks: previous?.tracks
      .map((t, i) => `${i + 1}. ${t.artists.join(", ")} — ${t.name}`)
      .join("\n"),
  };
}

/** When the browser doesn't say who's on the mic. */
export const DEFAULT_DJ_NAME = "Claude";

/** The per-segment user message: the opening brief, or the bridge (plus the shift note when the ask changed). */
export function buildUserTurn(template: PromptTemplate, input: TurnInput): string {
  const vars = turnVars(input);
  if (!input.previous) return fillVars(template["prompt.opening"], vars);
  const parts = [fillVars(template["prompt.bridge"], vars)];
  if (input.promptChanged) parts.push(fillVars(template["prompt.shift"], vars));
  return parts.join("\n");
}
