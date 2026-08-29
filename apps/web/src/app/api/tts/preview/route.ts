import { VoiceSchema } from "@radio/dj";
import { z } from "zod";
import { streamTts } from "@/lib/elevenlabs";

/**
 * The voice form's "hear it": a line of talk in a voice as it stands in the form, saved or not.
 * Guarded like /settings (proxy.ts) — this is the one place the caller chooses the settings.
 */
const Body = z.object({ text: z.string().trim().min(1).max(1000), voice: VoiceSchema });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  return streamTts(parsed.data.voice, parsed.data.text);
}
