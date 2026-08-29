import { ttsBody, type Voice } from "@radio/dj";
import { env } from "./env";

/**
 * The DJ's voice: stream ElevenLabs text-to-speech straight through to the browser. The voice
 * and its settings come from the `settings.voices` row (or, on /settings, the unsaved form);
 * the only thing the server adds is the key. No storage — the browser holds the clip.
 */
export async function streamTts(voice: Voice, text: string): Promise<Response> {
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });

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
