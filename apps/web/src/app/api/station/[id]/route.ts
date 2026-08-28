import { z } from "zod";
import { db } from "@/lib/db";

/** Rehydrate a station after a reload: its prompt and the last 20 segments, newest first. */
export async function GET(_req: Request, ctx: RouteContext<"/api/station/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown station" }, { status: 404 });
  const station = await db().getStation(id);
  if (!station) return Response.json({ error: "unknown station" }, { status: 404 });
  const segments = await db().listSegments(id, 20);
  return Response.json(
    {
      stationId: station.id,
      prompt: station.prompt,
      segmentCount: station.segmentCount,
      segments: segments.map((s) => ({
        id: s.id,
        seq: s.seq,
        prompt: s.prompt,
        talk: s.talk,
        tracks: s.tracks,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
