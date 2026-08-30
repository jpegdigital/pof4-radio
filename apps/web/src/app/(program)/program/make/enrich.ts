import { env } from "@/lib/env";
import { ask, sumUsage, type Usage } from "./ask";
import { ENRICH_CONCURRENCY } from "./clock-rules";
import { MakeError, readJson, readJsonIfValid, remove, writeJson } from "./files";
import { pool } from "./pool";
import { ENRICH_TOOL, enrichBrief } from "./prompts";
import { Card, Picks, type Record } from "./shapes";

// reads: picks.json, cards/*. writes: cards/<id>.json (new, or all with refresh), picks.json (dropped).

type Finish = Omit<Card, "id" | "name" | "artists" | "enrichedAt" | "model">;

const cardFile = (id: string) => `cards/${id}.json`;

async function makeCard(rec: Record): Promise<{ card: Card; usage: Usage }> {
  // A refusal on a record's name is noise more often than a verdict: one more try, then drop it.
  const { out, usage } = await ask<Finish>(enrichBrief(rec), ENRICH_TOOL, "medium").catch((e: unknown) => {
    if (e instanceof MakeError && e.message.includes("refused"))
      return ask<Finish>(enrichBrief(rec), ENRICH_TOOL, "medium");
    throw e;
  });
  const card = Card.parse({
    ...out,
    id: rec.id,
    name: rec.name,
    artists: rec.artists,
    introMs: Math.max(0, Math.min(out.introMs, rec.durationMs)),
    outroMs: Math.max(0, Math.min(out.outroMs, rec.durationMs)),
    enrichedAt: new Date().toISOString(),
    model: env().CLAUDE_MODEL,
  });
  return { card, usage };
}

export interface Enriched {
  cards: Card[];
  dropped: Picks["dropped"];
  reused: string[];
  failed: { id: string; error: string }[];
  usage: Usage;
}

/** Every record gets a card: the ones on disk are reused (unless `refresh`), the rest are made now. */
export async function enrich({ refresh }: { refresh: boolean }): Promise<Enriched> {
  const picks = await readJson("picks.json", Picks);
  const cards: Card[] = [];
  const reused: string[] = [];
  const todo: Record[] = [];
  for (const rec of picks.records) {
    const had = refresh ? null : await readJsonIfValid(cardFile(rec.id), Card);
    if (had) {
      cards.push(had);
      reused.push(rec.id);
    } else todo.push(rec);
  }

  const results = await pool(todo, ENRICH_CONCURRENCY, makeCard);
  const failed: Enriched["failed"] = [];
  const usages: Usage[] = [];
  const keep = new Set(reused);
  for (const [i, r] of results.entries()) {
    const rec = todo[i];
    if (r.status === "fulfilled") {
      await writeJson(cardFile(rec.id), r.value.card);
      cards.push(r.value.card);
      usages.push(r.value.usage);
      keep.add(rec.id);
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      failed.push({ id: rec.id, error });
      await remove(cardFile(rec.id));
    }
  }

  const dropped = [...picks.dropped];
  for (const f of failed) {
    const rec = picks.records.find((r) => r.id === f.id);
    if (rec) dropped.push({ pick: rec.pick, reason: `enrichment failed for ${rec.name}: ${f.error}` });
  }
  const records = picks.records.filter((r) => keep.has(r.id));
  if (failed.length) await writeJson("picks.json", { ...picks, records, dropped });

  cards.sort((a, b) => records.findIndex((r) => r.id === a.id) - records.findIndex((r) => r.id === b.id));
  return { cards, dropped, reused, failed, usage: sumUsage(usages) };
}
