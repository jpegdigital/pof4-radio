import { readdir } from "node:fs/promises";
import path from "node:path";
import { type Alignment, type ClipInfo, type Line, textOf, timingsOf, ttsBody, type Voice } from "@radio/dj";
import { env } from "@/lib/env";
import { ProducerError } from "./errors";

/**
 * One line through ElevenLabs with alignment: the bytes for the bucket and the timings at known
 * character offsets. The produced sweepers under public/sweepers, the bed, and where a slot's
 * clip is served from.
 */

export const BED_URL = "/bed.mp3";
export const clipUrl = (segmentId: string, seq: number) => `/api/clip/${segmentId}/${seq}`;

export async function speak(voice: Voice, l: Line): Promise<{ bytes: Uint8Array; info: ClipInfo }> {
  const key = env().ELEVENLABS_KEY;
  if (!key) throw new ProducerError(503, "ELEVENLABS_KEY is not set on the server");
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

/** The produced sweepers under public/sweepers, as play URLs; none is fine. */
export async function sweeperUrls(): Promise<string[]> {
  try {
    const names = await readdir(path.join(process.cwd(), "public", "sweepers"));
    return names
      .filter((n) => n.endsWith(".mp3"))
      .sort()
      .map((n) => `/sweepers/${n}`);
  } catch {
    return [];
  }
}
