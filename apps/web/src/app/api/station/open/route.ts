import { z } from "zod";
import { bucketMissing } from "@/lib/bucket";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ProducerError } from "@/lib/producer/errors";
import { openSegment } from "@/lib/producer/segment";
import { loadIdentity } from "@/lib/prompts";
import { loadVoices } from "@/lib/voices";

/**
 * A request becomes a station and its opening segment (contracts/api.md): the station row (its
 * identity copied from settings), the hour discovered, the first run's records kept on a segment
 * row with nothing produced yet. The browser paints the records and asks for slot 0 next.
 */
const Body = z.object({
  prompt: z.string().trim().min(1).max(500),
  dj: z.string().trim().min(1).max(60),
  voiceId: z.string().min(1).max(64),
  /** The listener's clock, ms since local midnight (the top of the hour is theirs, not the server's). */
  clockMs: z.number().int().min(0).max(86_400_000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { prompt, dj, voiceId, clockMs } = parsed.data;

  if (!env().ELEVENLABS_KEY) return Response.json({ error: "ELEVENLABS_KEY is not set" }, { status: 503 });
  const missing = bucketMissing();
  if (missing) return Response.json({ error: `${missing} is not set` }, { status: 503 });
  if (!(await loadVoices()).some((v) => v.id === voiceId))
    return Response.json({ error: "no such voice" }, { status: 400 });

  let identity: Awaited<ReturnType<typeof loadIdentity>>;
  try {
    identity = await loadIdentity();
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
  const station = await db().createStation({ prompt, dj, voiceId, identity });
  const lock = await db().lockStation(station.id);
  if (lock.status !== "ok") return Response.json({ error: lock.status }, { status: 409 });

  const tag = `[station ${station.id.slice(0, 8)} #1]`;
  let ok = false;
  try {
    const out = await openSegment(lock, { request: prompt, first: true, clockMs });
    ok = true;
    const t = out.timing;
    console.log(
      `${tag} opened in ${t.ms} ms (discover ${t.discoverMs}): ${out.segment.records
        .map((r) => `${r.artists[0]} – ${r.name}`)
        .join(" | ")}`,
    );
    return Response.json({ stationId: station.id, skeleton: out.skeleton, segment: out.segment, timing: t });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} failed: ${message}`);
    return Response.json({ error: message }, { status: err instanceof ProducerError ? err.status : 502 });
  } finally {
    await lock.release(ok);
  }
}
