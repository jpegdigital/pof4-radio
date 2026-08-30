import type Anthropic from "@anthropic-ai/sdk";

/**
 * The tool schemas, built per request: strict tool use enforces `required` properties but NOT
 * array lengths — an unbounded picks[] is how "about 12" came back as 42. So counts are enforced
 * by shape instead: song1…songN / slot1…slotN, every slot a required property. The converters
 * read the slots back into arrays; a compose slot may carry id "" (nothing fit), and is dropped.
 */

export interface Pick {
  artist: string;
  title: string;
  why: string;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export function proposeTool(n: number): Anthropic.Tool {
  const properties: Record<string, unknown> = {
    rationale: {
      type: "string",
      description: "how you read the request — a short paragraph in your own words",
    },
  };
  for (const i of range(n))
    properties[`song${i}`] = {
      type: "object",
      properties: {
        artist: { type: "string", description: "the artist" },
        title: { type: "string", description: "the record — a song title as you know it" },
        why: { type: "string", description: "one line: why this record, here" },
      },
      required: ["artist", "title", "why"],
      additionalProperties: false,
    };
  return {
    name: "propose_records",
    description: `A wide first draft: ${n} records that could answer the request, one per slot. Leads for a catalogue search, not the final playlist — range beats precision.`,
    strict: true,
    input_schema: {
      type: "object",
      properties,
      required: ["rationale", ...range(n).map((i) => `song${i}`)],
      additionalProperties: false,
    },
  };
}

export function picksOf(input: Record<string, unknown>, n: number): Pick[] {
  return range(n).map((i) => input[`song${i}`] as Pick);
}

export function composeTool(n: number): Anthropic.Tool {
  const properties: Record<string, unknown> = {
    rationale: {
      type: "string",
      description: "how this playlist works together, as a whole — a paragraph in your own words",
    },
  };
  for (const i of range(n))
    properties[`slot${i}`] = {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `play order ${i}: a candidate track id, verbatim — or "" if no candidate deserves this slot`,
        },
        why: {
          type: "string",
          description:
            "one line: why this track, here, in this playlist — written for the set, not the search",
        },
      },
      required: ["id", "why"],
      additionalProperties: false,
    };
  return {
    name: "compose_playlist",
    description: `The playlist: ${n} slots in play order, each one candidate track id plus why it belongs in this set. Only ids from the candidate list count — anything else is discarded.`,
    strict: true,
    input_schema: {
      type: "object",
      properties,
      required: ["rationale", ...range(n).map((i) => `slot${i}`)],
      additionalProperties: false,
    },
  };
}

/** One composed slot: a candidate id and a why written for this playlist. */
export interface Choice {
  id: string;
  why: string;
}

export function choicesOf(input: Record<string, unknown>, n: number): Choice[] {
  return range(n)
    .map((i) => input[`slot${i}`] as Choice)
    .filter((c) => typeof c?.id === "string" && c.id !== "");
}
