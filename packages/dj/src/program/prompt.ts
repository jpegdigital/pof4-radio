import type Anthropic from "@anthropic-ai/sdk";
import type { Intro } from "./shapes.ts";

/**
 * Everything the producer tells the model, minus the prose.
 *
 * The prose is data and lives only in the database: four `settings` rows, one per slot, edited on
 * /settings (or straight in the table). Code knows the slot names, the placeholders each may use,
 * and the tools — their schemas are what the producer checks. The rules of the clock
 * (`RULES_TEXT`) are appended to the write brief by the producer, so the prompt and the validator
 * cannot drift.
 *
 * Placeholders are `{name}`; `fillVars` replaces the ones it knows and leaves the rest alone.
 */

export type PromptVar =
  | "request"
  | "dj"
  | "played"
  | "clock"
  | "identity"
  | "record"
  | "slot"
  | "records"
  | "cards"
  | "previous_words"
  | "legal_id"
  | "weather"
  | "headlines";

export const PROMPT_SLOTS = [
  {
    key: "prompt.system",
    label: "System",
    blurb: "Who the DJ is and the standing rules. The system prompt of every call.",
    vars: [],
  },
  {
    key: "prompt.discover",
    label: "Discover",
    blurb: "The hour brief: pick the records for the hour, in a first-draft order, and why.",
    vars: ["request", "dj", "identity", "clock", "played"],
  },
  {
    key: "prompt.card",
    label: "Card",
    blurb: "The card brief: how one record starts, how it ends, what it feels like, what to say.",
    vars: ["record"],
  },
  {
    key: "prompt.write",
    label: "Write",
    blurb: "The slot brief: what happens at the top of one record and every word that is said there.",
    vars: [
      "request",
      "dj",
      "identity",
      "clock",
      "slot",
      "records",
      "cards",
      "previous_words",
      "legal_id",
      "weather",
      "headlines",
    ],
  },
] as const satisfies readonly { key: string; label: string; blurb: string; vars: readonly PromptVar[] }[];

export type PromptKey = (typeof PROMPT_SLOTS)[number]["key"];

export const PROMPT_VAR_HELP: Record<PromptVar, string> = {
  request: "what the listener typed",
  dj: "who's on the mic (the voice picked in the browser)",
  identity: 'the station: calls, city, and the name as said on air ("WFAI, Dallas — said on air as …")',
  clock: 'the time of day right now ("8:43 pm")',
  played: 'the records already played on this station, one per line, numbered ("none" on a fresh one)',
  record: "the one record to describe: artist, title, album, length",
  slot: 'which slot is being written ("the break, then record 1 of 4" / "record 3 of 4")',
  records: "this segment's records in play order, one per line, the slot's own marked with →",
  cards: "the slot's record's card in full: intro, post, ending, energy, talking points",
  previous_words: 'everything the DJ has said on this station so far, latest last ("none" at the opening)',
  legal_id: 'the legal ID to say first when the break is the top of the hour, else "none"',
  weather:
    'the weather from the National Weather Service, one line for now and one each for today and tonight ("none" when the pull failed)',
  headlines:
    "the top headlines from Google News, one per line, the city's then the nation's then the world's, each with its source (\"none\" when the pull failed)",
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

/** "8:43 pm" from ms since midnight. */
export function clockOf(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// ── the tools ───────────────────────────────────────────────────────────────────────────────────
// Strict (every property required, nothing extra) so a field the model has nothing for is "" or 0,
// and the producer strips it.

export const DISCOVER_TOOL: Anthropic.Tool = {
  name: "finish_picks",
  description: "The set: the records picked for this hour, in a first-draft order, and why.",
  input_schema: {
    type: "object",
    properties: {
      rationale: {
        type: "string",
        description: "why this set, as a whole, answers the request — a paragraph in your own words",
      },
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            artist: { type: "string", description: "the artist as credited on the record" },
            title: {
              type: "string",
              description: "the title as released — the single version, not a live or remix",
            },
            why: { type: "string", description: "one line: why this record, here" },
          },
          required: ["artist", "title", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["rationale", "picks"],
    additionalProperties: false,
  },
};

/**
 * The card. No lyrics anywhere in it — quoting a record's words gets the whole answer blocked,
 * and a DJ never reads the lyric anyway: the post is *where* the vocal comes in, described.
 */
export const CARD_TOOL: Anthropic.Tool = {
  name: "finish_card",
  description:
    "The card for one record: how it starts, how it ends, what it feels like, what to say about it. Never quote a lyric anywhere in it.",
  input_schema: {
    type: "object",
    properties: {
      introMs: {
        type: "integer",
        description:
          "how long the instrumental intro runs before the first vocal, in milliseconds, on the single version; 0 if it starts on the vocal or on spoken words",
      },
      sure: {
        type: "boolean",
        description: "true only if you are confident of introMs to within a second or two",
      },
      post: {
        type: "string",
        description:
          "where the vocal comes in, in a few words and never the lyric itself — 'the title line', 'a count-in, then the verse', 'a held note over the synth'; empty if there is no vocal",
      },
      outro: { type: "string", enum: ["cold", "fade"], description: "how the record ends" },
      outroMs: {
        type: "integer",
        description:
          "when the ending begins, in milliseconds from the start: where the fade starts, or the full length for a cold ending",
      },
      energy: { type: "integer", description: "1 (a ballad) to 5 (a floor-filler)" },
      tempo: { type: "string", enum: ["down", "mid", "up"] },
      mood: { type: "string", description: "one line" },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "two or three talking points a DJ could say on air: true, short, safe to broadcast, no lyrics",
      },
    },
    required: ["introMs", "sure", "post", "outro", "outroMs", "energy", "tempo", "mood", "notes"],
    additionalProperties: false,
  },
};

/** What the slot tool returns: one record's treatment and words. */
export interface SlotLine {
  treatment: Intro;
  legalId: string;
  words: string;
  leadLine: string;
  why: string;
}

export const SLOT_TOOL: Anthropic.Tool = {
  name: "finish_slot",
  description:
    "One slot of the segment: what happens at the top of this record and every word that is said there.",
  input_schema: {
    type: "object",
    properties: {
      treatment: {
        type: "string",
        enum: ["break", "talkup", "segue", "sweeper"],
        description:
          "what happens at the top of this record: break = the DJ over a bed, then the lead line into it (slot 0 only); talkup = the DJ over its instrumental intro, hitting the post; segue = nothing, straight out of the last record; sweeper = a short produced station-ID line, no DJ",
      },
      legalId: {
        type: "string",
        description:
          "the break only, and only when the brief gives a legal ID: said dry before the bed comes in, exactly as the brief gives it. Empty otherwise.",
      },
      words: {
        type: "string",
        description:
          "what is said: the talk-up, the break (without its lead line), or the sweeper's line. Empty for a segue. For the break, do NOT include the lead line here — it goes in leadLine.",
      },
      leadLine: {
        type: "string",
        description:
          "the break only: the one sentence that leads into the record, said last, with the record starting under it. Not repeated in words. Empty otherwise.",
      },
      why: { type: "string", description: "one line: why this treatment here" },
    },
    required: ["treatment", "legalId", "words", "leadLine", "why"],
    additionalProperties: false,
  },
};
