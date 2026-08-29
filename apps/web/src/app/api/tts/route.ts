import { z } from "zod";
import { streamTts } from "@/lib/elevenlabs";
import { loadVoices } from "@/lib/voices";

/**
 * A line of talk in one of the roster's voices. The browser names the voice; its model and
 * settings are whatever /settings holds right now, so a tuning change reaches the next line
 * without a redeploy (lines already cached in an open tab keep their old voice).
 */
const Query = z.object({
  text: z.string().trim().min(1).max(5000),
  voiceId: z.string().min(1).max(64),
});

export async function GET(req: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid query" }, { status: 400 });
  const { text, voiceId } = parsed.data;
  const voice = (await loadVoices()).find((v) => v.id === voiceId);
  if (!voice) return Response.json({ error: "no such voice" }, { status: 404 });
  return streamTts(voice, text);
}
