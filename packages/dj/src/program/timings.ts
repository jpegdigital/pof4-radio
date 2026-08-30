import type { Line } from "./shapes.ts";

/**
 * A clip's timings from ElevenLabs' character alignment, at *known* character offsets — nothing
 * is searched for. The spoken text is `[legalId, words, leadLine]` joined by one space, so the
 * bed comes in at the character after the legal ID and the lead starts at `text.length −
 * leadLine.length`. A timing whose offset doesn't add up is left out, and the assembly takes its
 * fallback.
 */

/** ElevenLabs' character alignment for the clip it made. */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export type ClipInfo = { clipMs: number; bedInMs?: number; leadMs?: number } | { error: string };

/** The spoken text, in the one order the offsets assume. */
export const textOf = (l: Pick<Line, "legalId" | "words" | "leadLine">) =>
  [l.legalId, l.words, l.leadLine].filter(Boolean).join(" ");

export function timingsOf(l: Pick<Line, "legalId" | "words" | "leadLine">, al: Alignment): ClipInfo {
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
