import { Card, CARD_TOOL, fillVars, type PromptTemplate, type Record } from "@radio/dj";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ask, isRefusal, type Usage } from "./ask";

/**
 * The card for one record: the table first (a record's card belongs to the record, shared by
 * every station), made now when it is missing. A refusal — or the API's output filter — is noise
 * more often than a verdict: one more try, then no card, with the reason. No card is never an
 * error: the slot is written without one and the clock rules make it a segue.
 */

type Finish = Omit<Card, "id" | "name" | "artists" | "model" | "thinking">;

export const describeRecord = (rec: Record) =>
  `${rec.artists.join(", ")} — "${rec.name}" (album: ${rec.album}; this version runs ${Math.round(rec.durationMs / 1000)} s)`;

async function makeCard(template: PromptTemplate, rec: Record): Promise<{ card: Card; usage: Usage }> {
  const brief = fillVars(template["prompt.card"], { record: describeRecord(rec) });
  const once = () => ask<Finish>(template["prompt.system"], brief, CARD_TOOL, "medium");
  const { out, usage } = await once().catch((e: unknown) => {
    if (isRefusal(e)) return once();
    throw e;
  });
  const card = Card.parse({
    ...out,
    id: rec.id,
    name: rec.name,
    artists: rec.artists,
    introMs: Math.max(0, Math.min(out.introMs, rec.durationMs)),
    outroMs: Math.max(0, Math.min(out.outroMs, rec.durationMs)),
    thinking: "",
    model: env().CLAUDE_MODEL,
  });
  return { card, usage };
}

export interface Carded {
  card: Card | null;
  /** Why there is no card. */
  reason?: string;
  /** Made on this call (else read from the table, or none). */
  made: boolean;
  usage: Usage | null;
}

export async function cardFor(template: PromptTemplate, rec: Record): Promise<Carded> {
  const have = (await db().getCards([rec.id])).get(rec.id);
  if (have) return { card: have, made: false, usage: null };
  try {
    const { card, usage } = await makeCard(template, rec);
    await db().putCard(card);
    return { card, made: true, usage };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { card: null, reason: `no card for ${rec.name}: ${reason}`, made: false, usage: null };
  }
}
