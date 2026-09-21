import { z } from "zod";
import { clipKeysOf, openClip } from "../../../../show-store";

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
  const kept = await clipKeysOf(p.id, seq);
  const requested = new URL(_req.url).searchParams.get("take");
  const allowed = new Set([kept?.clipKey, ...(kept?.takeKeys ?? [])]);
  if (requested && !allowed.has(requested))
    return Response.json({ error: "unknown clip take" }, { status: 404 });
  const clipKey = requested ?? kept?.clipKey;
  if (!clipKey) return Response.json({ error: "no such clip" }, { status: 404 });
  const obj = await openClip(clipKey);
  if (!obj) return Response.json({ error: "no such clip" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": requested ? "public, max-age=31536000, immutable" : "no-store",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
