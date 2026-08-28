import { env } from "@/lib/env";

/** The voices on the ElevenLabs account, for the settings panel. */
export async function GET() {
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!res.ok) return Response.json({ error: `elevenlabs ${res.status}` }, { status: 502 });
  const data = (await res.json()) as { voices: { voice_id: string; name: string; category?: string }[] };
  return Response.json(
    data.voices.map((v) => ({ voiceId: v.voice_id, name: v.name, category: v.category ?? "" })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
