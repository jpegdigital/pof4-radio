import { parseVoices, type Voice, VOICES_KEY } from "@radio/dj";
import { db } from "./db";

/**
 * The roster from the `settings.voices` row, per request. No row is an empty roster (the
 * station shows it, /settings fills it); a malformed row throws — a fault, not a fallback.
 */
export async function loadVoices(): Promise<Voice[]> {
  const row = await db().getSetting(VOICES_KEY);
  return row ? parseVoices(row.value) : [];
}
