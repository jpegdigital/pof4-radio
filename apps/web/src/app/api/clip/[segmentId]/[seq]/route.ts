import { z } from "zod";
import { bucket, clipKey } from "@/lib/bucket";
import { db } from "@/lib/db";

/**
 * One clip, streamed from the bucket (contracts/api.md). A key is written once, so the answer
 * is immutable and the browser caches it for good. Whole bodies only — clips are decoded whole
 * by the graph, so ranges are not honoured.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/clip/[segmentId]/[seq]">) {
  const { segmentId, seq } = await ctx.params;
  const n = Number(seq);
  if (!z.uuid().safeParse(segmentId).success || !Number.isInteger(n) || n < 0)
    return Response.json({ error: "no such clip" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const segment = await db().getSegment(segmentId);
  if (!segment) return Response.json({ error: "no such clip" }, { status: 404 });
  const obj = await store.open(clipKey(segment.stationId, segmentId, n));
  if (!obj) return Response.json({ error: "no such clip" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
