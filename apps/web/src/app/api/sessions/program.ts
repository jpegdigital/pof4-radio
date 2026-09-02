import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Card, Identity } from "@radio/dj";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import { checkProgram, type ProgramSlot, RULES_TEXT } from "./rules";
import { numbered, Slot } from "./shapes";

/**
 * One call writes the whole segment: the break and every talk-up, sweeper and segue in one
 * pass, because the writing is one coherent piece — the break sets up the set and the talk-ups
 * reference what is around them. The brief carries the ask, the clock, the station, the DJ,
 * every record with its card, and the legal ID when this break is the top of the hour. The
 * clock rules go in the brief and are enforced after (`checkProgram`). A refusal gets one more
 * try. Pure production: no database in here; the caller owns the rows.
 */

// Inline for the stub, like the playlist's; moves to the settings table when the prompts start being tuned.
const system = (dj: string | null, identity: Identity) =>
  `You are ${dj ? `${dj}, ` : ""}the DJ on ${identity.onAir} (${identity.calls}, ${identity.city}). You write what is said on air, exactly as it will be voiced: spoken, not read — short sentences, contractions, no lists, no headers, no stage directions, no lyrics. Tight: one detail about a record, two at most, never three. You talk about the records and the listener's ask, not about yourself.`;

export interface ProgramTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  why: string;
}

export interface ProgramInput {
  prompt: string;
  dj: string | null;
  identity: Identity;
  /** "8:43 pm". */
  clock: string;
  tracks: ProgramTrack[];
  cards: Map<string, Card>;
  /** The legal ID to open with, or null when this break is not the top of the hour. */
  legalId: string | null;
}

export interface Program {
  slots: ProgramSlot[];
  /** The writer's output as parsed, kept on the segment as telemetry. */
  raw: unknown;
}

export const legalIdOf = (i: Identity) => `${i.calls}, ${i.city}. ${i.onAir}.`;

const cardLine = (c: Card | undefined) => {
  if (!c) return "no card — nothing is known of its intro, so it can only be a segue (or the break)";
  const intro = `intro ${Math.round(c.introMs / 1000)} s${c.sure ? "" : " (unsure)"}`;
  const post = c.post ? `, the vocal comes in on ${c.post}` : ", no vocal";
  const notes = c.notes.length ? ` Talking points: ${c.notes.join(" · ")}` : "";
  return `${intro}${post}; ends ${c.outro}; energy ${c.energy}/5, ${c.tempo}-tempo; ${c.mood}.${notes}`;
};

export async function produceProgram(input: ProgramInput): Promise<Program> {
  const { tracks, cards, legalId } = input;
  const n = tracks.length;
  const list = tracks
    .map(
      (t, i) =>
        `${i + 1}. ${t.artists.join(", ")} — ${t.name} (${Math.round(t.durationMs / 1000)} s). Why it is here: ${t.why}\n   ${cardLine(cards.get(t.id))}`,
    )
    .join("\n");
  const brief = [
    `The listener's request: ${input.prompt}`,
    `The clock: ${input.clock}`,
    "",
    `This segment, ${n} records in play order:`,
    list,
    "",
    legalId
      ? `This break is the top of the hour: the legal ID "${legalId}" is said first, dry, before the bed comes in. It is added for you — do not write it into your words.`
      : "This break is not the top of the hour: no legal ID.",
    "",
    `Write the program: one slot per record, ${n} in all. Slot 1 is the break — set up the set for the listener, then the lead line into record 1. For every other record choose how it is brought on air and write every word said there.`,
    "",
    RULES_TEXT,
  ].join("\n");
  const slots = numbered("slot", n, Slot);
  const once = () =>
    claude().messages.parse({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: zodOutputFormat(
          z
            .object(slots.shape)
            .describe(
              `The segment's program: ${n} slots in play order, one per record — how each is brought on air and every word said there. Slot 1 is the break.`,
            ),
        ),
      },
      system: system(input.dj, input.identity),
      messages: [{ role: "user", content: brief }],
    });
  let res = await once();
  if (res.stop_reason === "refusal") res = await once();
  if (!res.parsed_output) throw new Error(`claude wrote no program (${res.stop_reason})`);
  return {
    slots: checkProgram(slots.list(res.parsed_output), tracks, cards, legalId),
    raw: res.parsed_output,
  };
}
