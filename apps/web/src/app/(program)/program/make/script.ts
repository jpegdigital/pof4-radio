import { ask, type Usage } from "./ask";
import { readJson, writeJson } from "./files";
import { recordsWithCards } from "./log";
import { SCRIPT_TOOL, scriptBrief } from "./prompts";
import { type Line, Log, Picks, Request, Script } from "./shapes";

// reads: request.json, picks.json, cards/*, log.json. writes: script.json.

interface Finish {
  lines: { seq: number; legalId: string; words: string; leadLine: string }[];
}

export async function script(): Promise<{ script: Script; skipped: string[]; usage: Usage }> {
  const req = await readJson("request.json", Request);
  const picks = await readJson("picks.json", Picks);
  const lg = await readJson("log.json", Log);
  const { records, cards, skipped } = await recordsWithCards(picks.records);
  const { out, usage } = await ask<Finish>(scriptBrief(req, records, cards, lg), SCRIPT_TOOL, "high");

  const slots = new Map(lg.slots.map((s) => [s.seq, s]));
  const lines: Line[] = [];
  for (const l of out.lines) {
    const slot = slots.get(l.seq);
    if (!slot || slot.intro === "segue" || lines.some((x) => x.seq === l.seq)) continue;
    const line: Line = { seq: l.seq, words: l.words.trim() };
    if (slot.topOfHour && l.legalId.trim()) line.legalId = l.legalId.trim();
    if (slot.intro === "break" && l.leadLine.trim()) line.leadLine = l.leadLine.trim();
    lines.push(line);
  }
  lines.sort((a, b) => a.seq - b.seq);
  const sc = Script.parse({ lines });
  await writeJson("script.json", sc);
  return { script: sc, skipped, usage };
}
