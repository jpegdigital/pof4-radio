import { z } from "zod";
import { env } from "@/lib/env";

/**
 * The DJ's voice: stream ElevenLabs text-to-speech straight through to the browser.
 * Voice, model and settings are the listener's choice and arrive with each request; the only
 * thing the server adds is the key. No storage — the browser holds the clip for the session.
 */
const Query = z.object({
  text: z.string().trim().min(1).max(5000),
  voiceId: z.string().min(1).max(64),
  modelId: z.string().min(1).max(64).default("eleven_v3"),
  stability: z.coerce.number().min(0).max(1).default(0.5),
  similarityBoost: z.coerce.number().min(0).max(1).default(0.75),
  style: z.coerce.number().min(0).max(1).default(0),
  speed: z.coerce.number().min(0.7).max(1.2).default(1),
  speakerBoost: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) return Response.json({ error: "invalid query" }, { status: 400 });
  const q = parsed.data;
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(q.voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: q.text,
        model_id: q.modelId,
        voice_settings: {
          stability: q.stability,
          similarity_boost: q.similarityBoost,
          style: q.style,
          speed: q.speed,
          use_speaker_boost: q.speakerBoost,
        },
      }),
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
