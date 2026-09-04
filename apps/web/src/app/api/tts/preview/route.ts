import { z } from "zod";
import { env } from "@/lib/env";
import { ttsBody, VoiceSchema } from "@/lib/voices";

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
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });
  const { voice, text } = parsed.data;
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(ttsBody(voice, text)),
    },
  );
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `elevenlabs ${upstream.status}: ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
