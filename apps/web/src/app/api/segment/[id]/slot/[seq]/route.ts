import { z } from "zod";
import { bucketMissing } from "@/lib/bucket";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ProducerError } from "@/lib/producer/errors";
import { produceSlot } from "@/lib/producer/slot";
import { loadVoices } from "@/lib/voices";

/**
 * One slot of a segment, end to end (contracts/api.md): card, line, clip, elements, kept. Slots
 * go in order; a slot already produced answers with the segment as kept. The station row is
 * locked for the duration; a second tab gets 409. A failed clip is a fallback in the assembly,
 * so the answer is still 200; 503 only when the key or the bucket is missing.
 */
const Body = z.object({
  clockMs: z.number().int().min(0).max(86_400_000).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/segment/[id]/slot/[seq]">) {
  const { id, seq: seqText } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown segment" }, { status: 404 });
  const seq = Number(seqText);
  if (!Number.isInteger(seq) || seq < 0 || seq > 99)
    return Response.json({ error: "bad slot" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  if (!env().ELEVENLABS_KEY) return Response.json({ error: "ELEVENLABS_KEY is not set" }, { status: 503 });
  const missing = bucketMissing();
  if (missing) return Response.json({ error: `${missing} is not set` }, { status: 503 });

  const segment = await db().getSegment(id);
  if (!segment) return Response.json({ error: "unknown segment" }, { status: 404 });
  const lock = await db().lockStation(segment.stationId);
  if (lock.status === "missing") return Response.json({ error: "unknown station" }, { status: 404 });
  if (lock.status === "busy") return Response.json({ error: "busy" }, { status: 409 });
  const voices = await loadVoices();
  const voice = voices.find((v) => v.id === lock.station.voiceId) ?? voices[0];
  if (!voice) {
    await lock.release(false);
    return Response.json({ error: "no voice on the roster — add one on /settings" }, { status: 503 });
  }

  const tag = `[segment ${id.slice(0, 8)} #${segment.seq} slot ${seq}]`;
  let ok = false;
  try {
    const out = await produceSlot(lock, id, seq, voice, { clockMs: parsed.data.clockMs });
    ok = true;
    const t = out.timing;
    const slot = out.segment.log.slots[seq];
    console.log(
      `${tag} ${slot?.intro ?? "kept"} in ${t.ms} ms (card ${t.cardMs}, write ${t.writeMs}, voice ${t.voiceMs})${
        out.segment.complete ? " — segment complete" : ""
      }`,
    );
    return Response.json({ segment: out.segment, seq, timing: t });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} failed: ${message}`);
    return Response.json({ error: message }, { status: err instanceof ProducerError ? err.status : 502 });
  } finally {
    await lock.release(ok);
  }
}
