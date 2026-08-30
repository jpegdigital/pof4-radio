import { z } from "zod";
import { db } from "@/lib/db";
import { ProducerError } from "@/lib/producer/errors";
import { openSegment } from "@/lib/producer/segment";

/**
 * The segment after the last kept one (contracts/api.md): its records off the skeleton (a new
 * hour discovered when it runs short or the ask changed), nothing produced yet. The browser
 * calls this as the previous segment's last song starts, then asks for the slots. The station
 * row is locked for the duration; a second tab gets 409.
 */
const Body = z.object({
  prompt: z.string().trim().min(1).max(500),
  clockMs: z.number().int().min(0).max(86_400_000).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/station/[id]/next">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown station" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const lock = await db().lockStation(id);
  if (lock.status === "missing") return Response.json({ error: "unknown station" }, { status: 404 });
  if (lock.status === "busy") return Response.json({ error: "busy" }, { status: 409 });

  const tag = `[station ${id.slice(0, 8)} #${lock.station.segmentCount + 1}]`;
  let ok = false;
  try {
    const out = await openSegment(lock, {
      request: parsed.data.prompt,
      first: false,
      clockMs: parsed.data.clockMs,
    });
    ok = true;
    const t = out.timing;
    console.log(
      `${tag} opened in ${t.ms} ms (discover ${t.discoverMs}): ${out.segment.records
        .map((r) => `${r.artists[0]} – ${r.name}`)
        .join(" | ")}`,
    );
    return Response.json({ segment: out.segment, skeleton: out.skeleton, timing: t });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} failed: ${message}`);
    return Response.json({ error: message }, { status: err instanceof ProducerError ? err.status : 502 });
  } finally {
    await lock.release(ok);
  }
}
