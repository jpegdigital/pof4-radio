import { z } from "zod";
import { db } from "@/lib/db";

/**
 * GET /api/sessions/:id — the session as stored, a snapshot that never produces anything: the
 * ask, then every segment in order, each carrying whatever its production has landed so far.
 * A segment's status is derived from presence (tracks null = open, present = playlisted); the
 * telemetry columns (proposed, candidates) stay in the database, off the wire. no-store while
 * the document can still grow.
 */

interface SessionRow {
  id: string;
  prompt: string;
  voice_id: string;
  created_at: Date;
}

interface SegmentRow {
  num: number;
  rationale: string | null;
  tracks: unknown;
  dropped: unknown;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "unknown session" }, { status: 404 });
  const { rows } = await db().pool.query<SessionRow>(
    "select id, prompt, voice_id, created_at from session where id = $1",
    [id],
  );
  if (!rows.length) return Response.json({ error: "unknown session" }, { status: 404 });
  const s = rows[0];
  const { rows: segments } = await db().pool.query<SegmentRow>(
    "select num, rationale, tracks, dropped from session_segment where session_id = $1 order by num",
    [id],
  );
  return Response.json(
    {
      sessionId: s.id,
      prompt: s.prompt,
      voiceId: s.voice_id,
      createdAt: s.created_at.toISOString(),
      segments: segments.map((g) => ({
        num: g.num,
        status: g.tracks ? "playlisted" : "open",
        rationale: g.rationale,
        tracks: g.tracks ?? [],
        dropped: g.dropped ?? [],
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
