import { z } from "zod";
import { db } from "@/lib/db";
import { viewOf } from "@/lib/producer/segment";

/** A kept station, whole: the row, its skeleton, every segment (voiced or not) in seq order. */
export async function GET(_req: Request, ctx: RouteContext<"/api/station/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown station" }, { status: 404 });
  const station = await db().getStation(id);
  if (!station) return Response.json({ error: "unknown station" }, { status: 404 });
  const segments = await db().listSegments(id);
  const cards = await db().getCards([...new Set(segments.flatMap((s) => s.records.map((r) => r.id)))]);
  return Response.json(
    {
      station: {
        id: station.id,
        prompt: station.prompt,
        dj: station.dj,
        voiceId: station.voiceId,
        identity: station.identity,
        segmentCount: station.segmentCount,
        updatedAt: station.updatedAt.toISOString(),
      },
      skeleton: station.skeleton,
      segments: segments.map((s) => viewOf(s, cards)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
