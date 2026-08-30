import type Anthropic from "@anthropic-ai/sdk";
import { msToHour, RULES_TEXT } from "./clock-rules";
import type { Card, Log, Record, Request } from "./shapes";

/**
 * The maker's prompts: one system prompt, four briefs, four finish tools. The tools are strict
 * (every property required, nothing extra) so a field the model has nothing for is "" or 0, and
 * the stage strips it. Prompts live here, not in settings — the sandbox iterates on them in code.
 */

export const SYSTEM =
  "You are the program director and the DJ of a CHR / Top 40 radio station, 1980s-1990s style: tight, warm, hits-forward, never cheesy. You know the records: their intros, their posts, their tempo, their mood, their endings. You speak in short lines meant to be read aloud.";

/** "8:43 pm" from ms since midnight. */
export function clockOf(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const stationLine = (r: Request) =>
  `Station: ${r.station.calls}, ${r.station.city} — said on air as "${r.station.onAir}". On the mic: ${r.dj}. The program starts at ${clockOf(r.startMs)}.`;

// ── discover ────────────────────────────────────────────────────────────────────────────────────

export const DISCOVER_TOOL: Anthropic.Tool = {
  name: "finish_picks",
  description: "The set: the records picked for this program, in a first-draft order, and why.",
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

export function discoverBrief(r: Request): string {
  return [
    stationLine(r),
    "",
    `The request: "${r.request}"`,
    "",
    `Pick ${r.count} records for this hour. This is your room to be creative: the request is the brief, not a checklist. Deep cuts are welcome next to the hits, a surprise or two is welcome, a record nobody expects but everybody knows is welcome — as long as the hour hangs together and a listener who asked for this would nod. Mix eras and tempos the way a good hour does; vary energy so the set breathes. Real, released records only, with the artist and the title exactly as they appear on the single, so they can be found in a catalogue. No two records by the same artist.`,
    "",
    "Think first about what the request really wants — the room, the night, the listener — then about which records say it. Put that in the rationale. Call finish_picks.",
  ].join("\n");
}

// ── enrich ──────────────────────────────────────────────────────────────────────────────────────

export const ENRICH_TOOL: Anthropic.Tool = {
  name: "finish_card",
  description:
    "The card for one record: how it starts, how it ends, what it feels like, what to say about it.",
  input_schema: {
    type: "object",
    properties: {
      thinking: {
        type: "string",
        description:
          "first: think out loud about this record — how it opens (instrumental? how long before the vocal? what happens in those seconds?), what the first sung words are, how it ends (cold? a fade? when does the fade start?), its tempo and energy, and what a DJ could truthfully say about it in one breath. Then fill the rest from this.",
      },
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
        description: "the first sung words — the post a talk-up must end before; empty if none",
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
        description: "two or three talking points a DJ could say on air: true, short, safe to broadcast",
      },
    },
    required: ["thinking", "introMs", "sure", "post", "outro", "outroMs", "energy", "tempo", "mood", "notes"],
    additionalProperties: false,
  },
};

export function enrichBrief(rec: Record): string {
  return [
    `The record: ${rec.artists.join(", ")} — "${rec.name}" (album: ${rec.album}; this version runs ${Math.round(rec.durationMs / 1000)} s).`,
    "",
    "Make its card. Think out loud first, then fill in the card from what you worked out. Be honest in `sure`: a wrong intro length puts the DJ over the vocal on air, a false `sure` is worse than a true 0. Nothing in the notes that isn't true of the record. Call finish_card.",
  ].join("\n");
}

// ── log ─────────────────────────────────────────────────────────────────────────────────────────

export const LOG_TOOL: Anthropic.Tool = {
  name: "finish_log",
  description: "The log: the set in its final order, with what happens at the top of each record.",
  input_schema: {
    type: "object",
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "the record's id from the list" },
            intro: {
              type: "string",
              enum: ["break", "talkup", "segue", "sweeper"],
              description:
                "what happens at the top of this record: break = the DJ talks over a bed, then leads into it; talkup = the DJ talks over its instrumental intro and hits the post; segue = nothing, straight out of the last record; sweeper = a produced station ID, no DJ",
            },
            topOfHour: { type: "boolean", description: "this break is the top of the hour (legal ID first)" },
            why: { type: "string", description: "one line: why this record here, with this treatment" },
          },
          required: ["id", "intro", "topOfHour", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["slots"],
    additionalProperties: false,
  },
};

const cardLine = (c: Card | undefined) =>
  c
    ? `intro ${Math.round(c.introMs / 1000)} s${c.sure ? "" : " (unsure)"}${c.post ? `, post "${c.post}"` : ", no vocal post"}; ends ${c.outro}; energy ${c.energy}/5, ${c.tempo}-tempo; ${c.mood}`
    : "no card";

export function logBrief(r: Request, records: Record[], cards: Map<string, Card>): string {
  const list = records
    .map(
      (rec) =>
        `- id ${rec.id}: ${rec.artists.join(", ")} — ${rec.name} (${Math.round(rec.durationMs / 1000)} s). ${cardLine(cards.get(rec.id))}`,
    )
    .join("\n");
  const toHour = msToHour(r.startMs);
  return [
    stationLine(r),
    `The request was: "${r.request}"`,
    "",
    "The records, with their cards:",
    list,
    "",
    RULES_TEXT,
    "",
    `The hour turns ${Math.round(toHour / 60000)} minutes after the program starts; a break costs about 30 s of clock. If the records run past that, the first slot that starts after the hour is the top-of-the-hour break.`,
    "",
    "Build the log: order every record once, and decide what happens at the top of each. Think about flow — energy, tempo, how one record ends into how the next begins, where a reset is wanted, where the DJ should be heard. Do not write any words: this is the order and the treatments only. Call finish_log.",
  ].join("\n");
}

// ── script ──────────────────────────────────────────────────────────────────────────────────────

export const SCRIPT_TOOL: Anthropic.Tool = {
  name: "finish_script",
  description: "Every line of talk for the log, in order.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            seq: { type: "integer", description: "the slot's seq" },
            legalId: {
              type: "string",
              description:
                "top-of-the-hour break only: the legal ID said dry before the bed comes in (call letters, city; then the station name as said on air). Empty for every other slot.",
            },
            words: {
              type: "string",
              description:
                "what is said: the talk-up, the break (without its last line), or the sweeper's line. For a break, do NOT include the lead line here — it goes in leadLine.",
            },
            leadLine: {
              type: "string",
              description:
                "breaks only: the one sentence that leads into the record, said last, with the record starting under it. Returned separately here and NOT repeated in words. Empty for every other slot.",
            },
          },
          required: ["seq", "legalId", "words", "leadLine"],
          additionalProperties: false,
        },
      },
    },
    required: ["lines"],
    additionalProperties: false,
  },
};

export function scriptBrief(r: Request, records: Record[], cards: Map<string, Card>, log: Log): string {
  const byId = new Map(records.map((rec) => [rec.id, rec]));
  const list = log.slots
    .map((s) => {
      const rec = byId.get(s.id);
      const c = cards.get(s.id);
      const who = rec ? `${rec.artists.join(", ")} — ${rec.name}` : s.id;
      const talkup =
        s.intro === "talkup" && c
          ? ` over a ${Math.round(c.introMs / 1000)} s intro, hit the post: "${c.post}"`
          : "";
      const top = s.topOfHour ? " — TOP OF THE HOUR" : "";
      const notes = c?.notes.length ? `\n   about the record: ${c.notes.join(" · ")}` : "";
      return `${s.seq}. ${who}\n   at its top: ${s.intro}${talkup}${top} (${s.why})${notes}`;
    })
    .join("\n");
  return [
    stationLine(r),
    `The request was: "${r.request}"`,
    "",
    "The log:",
    list,
    "",
    "Now write every word that is said, in order, so the hour reads as one show: the DJ remembers what they said and what just played. One line per slot that isn't a segue; nothing for segues. Rules:",
    "- talkup: one or two lines that fit inside the intro with a beat to spare (about 2.5 words per second), ending right before the post. Name the record or the artist, not both every time.",
    "- sweeper: a produced station-ID line, 3-8 words, not the DJ.",
    "- break: 20-40 s of talk (50-100 words) in `words` — back-sell, front-sell, the time, one genuine line — and then, separately in `leadLine`, the one sentence that leads into the record (the record starts under it). Never repeat the lead line inside `words`.",
    "- the top-of-the-hour break: put the legal ID in `legalId` (dry, on its own), then in `words` 50-70 s (130-180 words): the time, the weather right now and tonight, three headlines — make them up, plausible and local to the station's city, harmless, never real people or real events — one thing coming up this hour; and the lead line in `leadLine`.",
    "- Say the station's name the way it is said on air. No stage directions, no emojis. `legalId` and `leadLine` are empty strings wherever they don't apply.",
    "Call finish_script.",
  ].join("\n");
}
