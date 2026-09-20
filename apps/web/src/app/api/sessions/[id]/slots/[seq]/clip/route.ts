import type { SlotGeneration } from "../../../../generation";
import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";

/**
 * GET /api/sessions/:id/slots/:seq/clip — the clip's bytes, streamed from the bucket. A key is
 * written once, so the answer is immutable and the browser caches it for good (it appends
 * `?take=<clipKey>` so another take is another URL). 404 when the slot has no clip.
 */

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]/slots/[seq]/clip">) {
  const p = await ctx.params;
  const seq = Number(p.seq);
  if (!z.uuid().safeParse(p.id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "no such clip" }, { status: 404 });
  const store = bucket();
  const { rows } = await pool().query<{
    clip_key: string | null;
    generation: SlotGeneration | null;
  }>("select clip_key, generation from session_slot where session_id = $1 and seq = $2", [p.id, seq]);
  const requested = new URL(_req.url).searchParams.get("take");
  const row = rows[0];
  const allowed = new Set([row?.clip_key, ...(row?.generation?.takes ?? []).map((take) => take.clipKey)]);
  if (requested && !allowed.has(requested))
    return Response.json({ error: "unknown clip take" }, { status: 404 });
  const clipKey = requested ?? row?.clip_key;
  if (!clipKey) return Response.json({ error: "no such clip" }, { status: 404 });
  const obj = await store.open(clipKey);
  if (!obj) return Response.json({ error: "no such clip" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": requested ? "public, max-age=31536000, immutable" : "no-store",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
