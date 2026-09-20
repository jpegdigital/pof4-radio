import { z } from "zod";
import { ElevenLabsError, speakStream } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { VoiceSchema } from "@/lib/voices";

/**
 * The voice form's "hear it": a line of talk in a voice as it stands in the form, saved or not,
 * streamed straight through from ElevenLabs — the only thing the server adds is the key. Guarded
 * like /settings (proxy.ts) — this is the one place the caller chooses the settings.
 */
const Body = z.object({ text: z.string().trim().min(1).max(1000), voice: VoiceSchema });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  const { voice, text } = parsed.data;
  try {
    const audio = await speakStream(voice, text, { apiKey: env().ELEVENLABS_KEY });
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (!(err instanceof ElevenLabsError)) throw err;
    return Response.json({ error: err.message }, { status: 502 });
  }
}
