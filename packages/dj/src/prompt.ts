import type Anthropic from "@anthropic-ai/sdk";
import type { SegmentTrack } from "@radio/db";

/**
 * Everything the DJ is told.
 *
 * The prose is data and lives only in the database: four `settings` rows, one per slot, edited on
 * /settings (or straight in the table). Code knows the slot names, the placeholders each may use,
 * and how to assemble a turn — no prompt text. `TOOLS` stays in code — its schema is what
 * `resolveFinish` checks. The system prompt is sent with a 1-hour cache breakpoint, so editing it
 * costs one cache miss on the next segment, nothing more.
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

/** The template from the `settings` rows. Every slot must be present: there is no fallback text in code. */
export function templateFrom(rows: Iterable<{ key: string; value: string }>): PromptTemplate {
  const byKey = new Map<string, string>();
  for (const r of rows) byKey.set(r.key, r.value);
  const missing = PROMPT_SLOTS.filter((s) => !byKey.get(s.key)?.trim()).map((s) => s.key);
  if (missing.length) throw new Error(`prompt slot(s) missing from settings: ${missing.join(", ")}`);
  return Object.fromEntries(PROMPT_SLOTS.map((s) => [s.key, byKey.get(s.key)!])) as PromptTemplate;
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
