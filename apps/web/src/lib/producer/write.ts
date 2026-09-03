import {
  type Card,
  checkSlot,
  fillVars,
  type Identity,
  type Intro,
  type Line,
  type LogFallback,
  type PromptTemplate,
  type Record,
  RULES_TEXT,
  SLOT_TOOL,
  type SlotLine,
} from "@radio/dj";
import { ask, type Usage } from "./ask";
import { identityLine } from "./discover";

/**
 * One call writes one slot: what happens at the top of this record and every word said there.
 * The brief carries the segment's records (this one marked), this record's card, everything the
 * DJ has said on the station so far, and the legal ID when this break is the top of the hour.
 * The rules of the clock go in the brief and are enforced after (`checkSlot`).
 */

export interface WriteSlotInput {
  template: PromptTemplate;
  request: string;
  dj: string;
  identity: Identity;
  clock: string;
  seq: number;
  records: Record[];
  card: Card | undefined;
  /** Everything said on the station so far, in order. */
  said: string[];
  topOfHour: boolean;
  /** The weather as the brief carries it (`weatherText`), or null when the pull failed. */
  weather: string | null;
  /** The headlines as the brief carries them (`headlinesText`), or null when the pull failed. */
  headlines: string | null;
}

export interface Written {
  intro: Intro;
  why: string;
  /** The line to voice; none for a segue. */
  line: Line | null;
  fallbacks: LogFallback[];
  usage: Usage;
}

export const legalIdOf = (i: Identity) => `${i.calls}, ${i.city}. ${i.onAir}.`;

const cardLine = (c: Card | undefined) =>
  c
    ? `intro ${Math.round(c.introMs / 1000)} s${c.sure ? "" : " (unsure)"}${c.post ? `, the vocal comes in on ${c.post}` : ", no vocal"}; ends ${c.outro}; energy ${c.energy}/5, ${c.tempo}-tempo; ${c.mood}`
    : "no card — nothing is known of its intro, so it can only be a segue (or the break)";

export async function writeSlot(input: WriteSlotInput): Promise<Written> {
  const { records, seq, card } = input;
  const rec = records[seq];
  if (!rec) throw new Error(`no record at slot ${seq}`);
  const n = records.length;
  const list = records
    .map(
      (r, i) =>
        `${i === seq ? "→" : " "} ${i + 1}. ${r.artists.join(", ")} — ${r.name} (${Math.round(r.durationMs / 1000)} s)${
          i === seq ? "  ← this slot" : ""
        }`,
    )
    .join("\n");
  const notes = card?.notes.length ? ` Talking points: ${card.notes.join(" · ")}` : "";
  const full = `${rec.artists.join(", ")} — ${rec.name}: ${cardLine(card)}.${notes}`;
  const legal = seq === 0 && input.topOfHour;
  const brief = [
    fillVars(input.template["prompt.write"], {
      request: input.request,
      dj: input.dj,
      identity: identityLine(input.identity),
      clock: input.clock,
      slot: seq === 0 ? `the break, then record 1 of ${n}` : `record ${seq + 1} of ${n}`,
      records: list,
      cards: full,
      previous_words: input.said.length ? input.said.join("\n\n") : "none",
      legal_id: legal ? legalIdOf(input.identity) : "none",
      weather: input.weather ?? "none",
      headlines: input.headlines ?? "none",
    }),
    "",
    RULES_TEXT,
  ].join("\n");
  const { out, usage } = await ask<SlotLine>(input.template["prompt.system"], brief, SLOT_TOOL, "medium");

  const fallbacks: LogFallback[] = [];
  const checked = checkSlot(seq, out.treatment, card);
  if (checked.fallback) fallbacks.push(checked.fallback);
  const intro = checked.intro;
  if (intro === "segue") return { intro, why: out.why, line: null, fallbacks, usage };

  const line: Line = { seq, treatment: intro, words: out.words.trim() };
  if (intro === "break") {
    if (legal) {
      const given = out.legalId.trim();
      if (given) line.legalId = given;
      else {
        line.legalId = legalIdOf(input.identity);
        fallbacks.push({
          seq,
          from: "break",
          to: "break",
          reason: "legal ID filled from the station identity",
        });
      }
    }
    const lead = out.leadLine.trim();
    if (lead) line.leadLine = lead;
  }
  return { intro, why: out.why, line, fallbacks, usage };
}
