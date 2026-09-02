import { z } from "zod";
import { db } from "@/lib/db";
import { SLOT_COLUMNS, SLOT_FROM, type SlotRow, slotDoc, statusOf } from "../doc";

/**
 * GET /api/sessions/:id — the session as stored, a snapshot that never produces anything: the
 * ask, then every segment in order, each carrying whatever its production has landed so far —
 * the playlist, then the slots (words, the writer's numbers, the card's intro, refs — never audio). A segment's status is
 * derived from presence (doc.ts); the telemetry columns (proposed, candidates, program) stay
 * in the database, off the wire. no-store while the document can still grow.
 */

interface SessionRow {
  id: string;
  prompt: string;
  voice_id: string;
  created_at: Date;
}

interface SegmentRow {
  id: string;
  num: number;
  rationale: string | null;
  tracks: unknown;
  dropped: unknown;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const { rows } = await db().pool.query<SessionRow>(
    "select id, prompt, voice_id, created_at from session where id = $1",
    [id],
  );
  if (!rows.length) return Response.json({ error: "unknown session" }, { status: 404 });
  const s = rows[0];
  const { rows: segments } = await db().pool.query<SegmentRow>(
    "select id, num, rationale, tracks, dropped from session_segment where session_id = $1 order by num",
    [id],
  );
  const { rows: slots } = await db().pool.query<SlotRow & { segment_id: string }>(
    `select s.segment_id, ${SLOT_COLUMNS} from ${SLOT_FROM}
     where s.segment_id = any($1::uuid[]) order by s.seq`,
    [segments.map((g) => g.id)],
  );
  return Response.json(
    {
      sessionId: s.id,
      prompt: s.prompt,
      voiceId: s.voice_id,
      createdAt: s.created_at.toISOString(),
      segments: segments.map((g) => {
        const own = slots.filter((r) => r.segment_id === g.id);
        return {
          num: g.num,
          status: statusOf(g.tracks, own),
          rationale: g.rationale,
          tracks: g.tracks ?? [],
          dropped: g.dropped ?? [],
          slots: own.map(slotDoc),
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
