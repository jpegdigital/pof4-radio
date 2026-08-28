import { db } from "@/lib/db";

/** Past stations the listener can resume, most recently active first. */
export async function GET() {
  const stations = await db().listStations(20);
  return Response.json(
    stations.map((s) => ({
      stationId: s.id,
      prompt: s.prompt,
      segmentCount: s.segmentCount,
      updatedAt: s.updatedAt.toISOString(),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
