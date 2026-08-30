import { ask, type Usage } from "./ask";
import { checkLog, type RawSlot } from "./clock-rules";
import { readJson, readJsonIfValid, writeJson } from "./files";
import { LOG_TOOL, logBrief } from "./prompts";
import { Card, type Log, Picks, type Record, Request } from "./shapes";

// reads: request.json, picks.json, cards/*. writes: log.json.

interface Finish {
  slots: RawSlot[];
}

/** The records that have a card, and the cards by id; the rest are skipped for this run. */
export async function recordsWithCards(records: Record[]) {
  const cards = new Map<string, Card>();
  const skipped: string[] = [];
  for (const rec of records) {
    const c = await readJsonIfValid(`cards/${rec.id}.json`, Card);
    if (c) cards.set(rec.id, c);
    else skipped.push(rec.id);
  }
  return { records: records.filter((r) => cards.has(r.id)), cards, skipped };
}

export async function log(): Promise<{ log: Log; warnings: string[]; skipped: string[]; usage: Usage }> {
  const req = await readJson("request.json", Request);
  const picks = await readJson("picks.json", Picks);
  const { records, cards, skipped } = await recordsWithCards(picks.records);
  const { out, usage } = await ask<Finish>(logBrief(req, records, cards), LOG_TOOL, "high");
  const checked = checkLog(out.slots, cards, records, req.startMs);
  await writeJson("log.json", checked.log);
  return { log: checked.log, warnings: checked.warnings, skipped, usage };
}
