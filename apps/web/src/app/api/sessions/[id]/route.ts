import { z } from "zod";
import { pool } from "@/lib/db";
import { loadClock } from "@/lib/settings";
import { SLOT_COLUMNS, type SlotRow, slotDoc } from "../doc";

/**
 * GET /api/sessions/:id — the session as stored, a snapshot that never produces anything: the
 * ask, the clock (so the browser knows the low-water mark), then every slot in order, each
 * carrying whatever its production has landed so far — the proposal, then the pick with its
 * tags and whether the bucket holds it, the chart, the copy, the timing, then the clip key —
 * status derived from presence (doc.ts), never audio, never the receipts. no-store while the
 * document can still grow. A missing clock row is a 500 naming it.
 */

interface SessionRow {
  id: string;
  prompt: string;
  voice_id: string;
  created_at: Date;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const { rows } = await pool().query<SessionRow>(
    "select id, prompt, voice_id, created_at from session where id = $1",
    [id],
  );
  if (!rows.length) return Response.json({ error: "unknown session" }, { status: 404 });
  const s = rows[0];
  try {
    const [clock, { rows: slots }] = await Promise.all([
      loadClock(),
      pool().query<SlotRow>(`select ${SLOT_COLUMNS} from session_slot where session_id = $1 order by seq`, [
        id,
      ]),
    ]);
    // Which of the session's picks the bucket holds — one query across every slot.
    const { rows: held } = await pool().query<{ id: string }>(
      "select id from track where id = any($1::text[])",
      [slots.map((r) => r.qobuz_id).filter((x): x is string => x !== null)],
    );
    const holds = new Set(held.map((r) => r.id));
    return Response.json(
      {
        sessionId: s.id,
        prompt: s.prompt,
        voiceId: s.voice_id,
        createdAt: s.created_at.toISOString(),
        clock,
        slots: slots.map((r) => slotDoc(r, holds)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[session ${id.slice(0, 8)}] snapshot failed: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
