import { ttsBody, type Voice } from "@radio/dj";
import { env } from "@/lib/env";
import { loadVoices } from "@/lib/voices";
import { assemble, type ClipInfo } from "./assemble";
import { MakeError, readJson, readPublicJson, writeClip, writeJson } from "./files";
import { recordsWithCards } from "./log";
import { pool } from "./pool";
import { type Line, Log, Picks, type Program, Request, Script } from "./shapes";

// reads: request.json, picks.json, cards/*, log.json, script.json. writes: clips/slot-<seq>.mp3, program.json.

/** ElevenLabs' character alignment for the clip it made. */
interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** The spoken text, in the one order the offsets below assume. */
export const textOf = (l: Line) => [l.legalId, l.words, l.leadLine].filter(Boolean).join(" ");

/**
 * The clip's timings from the alignment at *known* character offsets — nothing is searched for.
 * A timing whose offset doesn't add up is left out, and the assembly takes its fallback.
 */
export function timingsOf(l: Line, al: Alignment): ClipInfo {
  const text = textOf(l);
  const starts = al.character_start_times_seconds;
  const ends = al.character_end_times_seconds;
  const last = ends[ends.length - 1];
  if (last === undefined || starts.length !== ends.length) return { error: "empty alignment" };
  const clipMs = Math.round(last * 1000);
  const info: ClipInfo = { clipMs };
  const at = (i: number) => {
    const s = starts[i];
    return s !== undefined && i > 0 && s >= (starts[i - 1] ?? 0) ? Math.round(s * 1000) : null;
  };
  if (l.legalId) {
    const bedIn = at(l.legalId.length + 1);
    if (bedIn !== null && bedIn < clipMs) info.bedInMs = bedIn;
  }
  if (l.leadLine) {
    const leadAt = at(text.length - l.leadLine.length);
    if (leadAt !== null && leadAt > 0 && leadAt < clipMs) info.leadMs = clipMs - leadAt;
  }
  return info;
}

async function speak(voice: Voice, key: string, l: Line): Promise<{ bytes: Uint8Array; info: ClipInfo }> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(ttsBody(voice, textOf(l))),
    },
  );
  if (!res.ok)
    throw new Error(`elevenlabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { audio_base64: string; alignment: Alignment | null };
  const bytes = new Uint8Array(Buffer.from(j.audio_base64, "base64"));
  return { bytes, info: j.alignment ? timingsOf(l, j.alignment) : { error: "no alignment" } };
}

export interface Voiced {
  program: Program;
  failed: { seq: number; error: string }[];
}

export async function voice(): Promise<Voiced> {
  const request = await readJson("request.json", Request);
  const picks = await readJson("picks.json", Picks);
  const lg = await readJson("log.json", Log);
  const sc = await readJson("script.json", Script);
  const { records, cards } = await recordsWithCards(picks.records);
  const v = (await loadVoices())[0];
  if (!v) throw new MakeError(422, "no voice on the roster — add one on /settings");
  const key = env().ELEVENLABS_KEY;

  const segues = new Set(lg.slots.filter((s) => s.intro === "segue").map((s) => s.seq));
  const lines = sc.lines.filter((l) => l.words && !segues.has(l.seq));
  const clips = new Map<number, ClipInfo>();
  const failed: Voiced["failed"] = [];
  const results = key
    ? await pool(lines, 2, (l) => speak(v, key, l))
    : lines.map(() => ({ status: "rejected", reason: new Error("ELEVENLABS_KEY is not set") }) as const);
  for (const [i, r] of results.entries()) {
    const l = lines[i];
    if (r.status === "fulfilled") {
      await writeClip(`clips/slot-${l.seq}.mp3`, r.value.bytes);
      clips.set(l.seq, r.value.info);
      if ("error" in r.value.info) failed.push({ seq: l.seq, error: r.value.info.error });
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      clips.set(l.seq, { error });
      failed.push({ seq: l.seq, error });
    }
  }

  const manifest = (await readPublicJson("program/sweepers/manifest.json")) as { sweepers?: object } | null;
  const sweepers = manifest?.sweepers ? Object.keys(manifest.sweepers) : [];

  const program = assemble({ request, records, cards, log: lg, script: sc, clips, sweepers, voiceId: v.id });
  await writeJson("program.json", program);
  return { program, failed };
}
